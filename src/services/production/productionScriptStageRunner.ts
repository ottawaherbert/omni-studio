import { Type } from "@google/genai";
import type {
  Episode,
  Project,
  ScriptBlock,
  ScriptBreakdown,
} from "../../types/project";
import type {
  ProductionStageExecutionResult,
  ProductionStageRun,
} from "../../types/production";
import {
  buildFormatStageInstruction,
  getFormatProductionProfile,
} from "../../config/formatProductionProfiles";
import { renderPromptTemplate } from "./promptUtils";
import { loadProductionPromptTemplate } from "./templateLoader";
import {
  validateInteractiveScriptRules,
  validateScriptRules,
} from "./ruleQa";
import { createScriptAgentQAReports } from "./linearAgents";
import { buildProductionPerformanceBeatDrafts } from "./videoStoryboardPerformanceBeats";
import { getProject, loadFullEpisodes, updateEpisode } from "./runnerRepositoryAccess";
import { makeArtifact, makeIssue, makeQA } from "./runnerArtifacts";
import {
  aiTrace,
  generateStageAIContent,
} from "./productionPromptRuntime";
import {
  parseResult,
  projectContext,
  revisionGuidance,
} from "./productionPromptContext";
import {
  projectAssetCatalogContext,
  resolveBreakdownAssetIds,
} from "./productionAssetReferenceContext";
import { toVideoStoryboardProductionIssues } from "./videoStoryboardIssueAdapter";

const productionScriptTemplate = {
  id: "production.script",
  name: "自动制片：结构化剧本与 Breakdown",
  template: `你是影视编剧与制片 breakdown 负责人。请只为下列当前场景生成结构化剧本和生产拆解。

{{projectContext}}
{{formatInstruction}}
{{revisionGuidance}}

可用稳定资产 ID（breakdown 必须尽量填 characterIds/locationId/propIds，只能使用这些 ID）:
{{assetCatalog}}

所属段落/集: {{episodeTitle}}
段落梗概: {{episodeInspiration}}

场景 {{sceneIndex}}: {{sceneTitle}}
场景目标: {{sceneGoal}}
场景描述: {{sceneDescription}}
场景资产: {{sceneAssets}}
时间/空间: {{sceneEnvironment}} {{sceneTimeOfDay}}

严格返回 JSON：
{
  "breakdown": {
    "setting": "INT.|EXT.|INT./EXT.",
    "location": {"name": "地点名", "state": "状态"},
    "time": "DAY|NIGHT|DAWN|DUSK|CONTINUOUS",
    "characters": [{"name": "角色名", "state": "状态"}],
    "props": [{"name": "道具名", "state": "状态"}],
    "characterIds": ["char-id"],
    "locationId": "location-id",
    "propIds": ["prop-id"],
    "vfx": [],
    "sfx": [],
    "wardrobe": [],
    "makeupHair": []
  },
  "blocks": [
    {"type": "scene_heading", "content": "INT. 地点 - DAY"},
    {"type": "action", "content": "具体可拍摄动作", "camera": "镜头提示"},
    {"type": "character", "content": "角色名"},
    {"type": "dialogue", "content": "对白"}
  ]
}`,
};

const formatStageInstruction = (
  project: Project,
  stageKey: "script",
) => buildFormatStageInstruction(getFormatProductionProfile(project), stageKey);

export const executeScriptStage = async (
  stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const loadedTemplate = await loadProductionPromptTemplate("production.script", productionScriptTemplate);
  const episodes = await loadFullEpisodes(project);
  const updatedSceneIds: string[] = [];
  const outputs: { episodeId: string; sceneId: string; title: string }[] = [];
  const validatedEpisodes: Episode[] = [];
  const promptLog: string[] = [];
  const rawLog: string[] = [];

  for (const episode of episodes) {
    let changed = false;
    const scenes = await Promise.all((episode.scenes || []).map(async (scene, index) => {
      if (scene.scriptBlocks?.length && scene.breakdown) return scene;

      const prompt = renderPromptTemplate(loadedTemplate.template, {
        projectContext: projectContext(project, stage),
        formatInstruction: formatStageInstruction(project, "script"),
        revisionGuidance: revisionGuidance(stage),
        assetCatalog: projectAssetCatalogContext(project, {
          breakdown: scene.breakdown,
          sourceText: [episode.title, episode.inspiration, scene.title, scene.sceneGoal, scene.description, scene.sceneAssets]
            .filter(Boolean)
            .join("\n"),
        }),
        episodeTitle: episode.title,
        episodeInspiration: episode.inspiration || "",
        sceneIndex: index + 1,
        sceneTitle: scene.title,
        sceneGoal: scene.sceneGoal || "",
        sceneDescription: scene.description || "",
        sceneAssets: scene.sceneAssets || "",
        sceneEnvironment: scene.environment || "",
        sceneTimeOfDay: scene.timeOfDay || "",
      });

      const response = await generateStageAIContent(stage, {
        prompt,
        requireJson: true,
        schema: {
          type: Type.OBJECT,
          properties: {
            breakdown: { type: Type.OBJECT },
            blocks: { type: Type.ARRAY, items: { type: Type.OBJECT } },
          },
          required: ["breakdown", "blocks"],
        },
      });
      promptLog.push(prompt);
      rawLog.push(response);
      const data = parseResult<any>(response, { breakdown: undefined, blocks: [] });
      const breakdown = resolveBreakdownAssetIds(project, data.breakdown as ScriptBreakdown | undefined);
      const scriptBlocks: ScriptBlock[] = (data.blocks || []).map((block: any) => ({
        id: `block-${scene.id}-${crypto.randomUUID()}`,
        type: block.type || "action",
        content: block.content || "",
        camera: block.camera,
        locationId: ["scene_heading", "action"].includes(block.type) ? breakdown?.locationId : undefined,
        propIds: block.type === "action" ? breakdown?.propIds : undefined,
      }));
      const script = scriptBlocks.map((block) => block.content).join("\n");
      changed = true;
      updatedSceneIds.push(scene.id);
      outputs.push({ episodeId: episode.id, sceneId: scene.id, title: scene.title });
      return {
        ...scene,
        script,
        scriptBlocks,
        breakdown,
      };
    }));
    if (changed) {
      await updateEpisode(episode.id, { scenes });
      validatedEpisodes.push({ ...episode, scenes });
    }
  }

  const issues = updatedSceneIds.length === 0
    ? [makeIssue("script.generated", "没有生成新剧本，可能所有场景已有 scriptBlocks。", "warning")]
    : [
        ...validateScriptRules(validatedEpisodes, project),
        ...(stage.stageType === "interactive_script" ? validateInteractiveScriptRules(validatedEpisodes) : []),
      ];
  const latestEpisodes = episodes.map((episode) => validatedEpisodes.find((item) => item.id === episode.id) || episode);
  const performanceBeatDrafts = buildProductionPerformanceBeatDrafts(project, latestEpisodes);
  const performanceBeatIssues = toVideoStoryboardProductionIssues(performanceBeatDrafts.issues);
  return {
    summary: `已生成 ${updatedSceneIds.length} 场结构化剧本与 breakdown，派生 ${performanceBeatDrafts.performanceBeats.length} 个表演/动作节拍草案。`,
    artifacts: [
      makeArtifact("script", "episode.scenes.scriptBlocks", "结构化剧本", updatedSceneIds),
      makeArtifact("breakdown", "episode.scenes.breakdown", "生产拆解", updatedSceneIds),
      makeArtifact("performance_beats", "run.outputSnapshot.performanceBeatDrafts", "AI 视频表演/动作节拍草案", performanceBeatDrafts.performanceBeats.map((beat) => beat.id)),
    ],
    qaReports: [
      makeQA("script.qa", issues),
      ...createScriptAgentQAReports(latestEpisodes, project, stage, [], performanceBeatIssues),
    ],
    ...aiTrace(stage, promptLog.join("\n\n--- NEXT SCRIPT PROMPT ---\n\n"), rawLog.join("\n\n--- NEXT SCRIPT RESPONSE ---\n\n"), loadedTemplate.trace),
    outputSnapshot: {
      outputs,
      performanceBeatDrafts: {
        performanceBeats: performanceBeatDrafts.performanceBeats,
        beatSceneIds: performanceBeatDrafts.beatSceneIds,
      },
    },
  };
};
