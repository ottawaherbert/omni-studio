import { Type } from "@google/genai";
import type {
  Episode,
  Project,
  Scene,
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
import { validateSceneRules } from "./ruleQa";
import {
  getProject,
  loadEpisodeOrFallback,
  updateEpisode,
} from "./runnerRepositoryAccess";
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

const productionSceneTemplate = {
  id: "production.scene",
  name: "自动制片：场景拆分",
  template: `你是导演和场景拆分专家。请把以下段落拆成可拍摄场景。

{{projectContext}}
{{formatInstruction}}
{{revisionGuidance}}

段落标题: {{episodeTitle}}
段落梗概: {{episodeInspiration}}

严格返回 JSON：
{
  "scenes": [{
    "title": "场景标题",
    "description": "发生了什么，谁在场，冲突如何推进",
    "valueCharge": "positive|negative|neutral",
    "valueShift": {"from": "开场价值状态", "to": "收场价值状态", "reason": "价值转换原因"},
    "sceneGoal": "场景目标",
    "sceneAssets": "核心角色/地点/道具",
    "environment": "INT.|EXT.|INT./EXT.",
    "timeOfDay": "DAY|NIGHT|DAWN|DUSK|CONTINUOUS",
    "targetDuration": 3,
    "hook": "钩子，可空",
    "cliffhanger": "短剧/微短剧集尾追更或付费点，可空"
  }]
}`,
};

const formatStageInstruction = (
  project: Project,
  stageKey: "scene",
) => buildFormatStageInstruction(getFormatProductionProfile(project), stageKey);

export const executeSceneStage = async (
  stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const loadedTemplate = await loadProductionPromptTemplate("production.scene", productionSceneTemplate);
  const episodeMetas = project.episodes || [];
  const formatProfile = getFormatProductionProfile(project);
  const sceneBatchLimit = Math.max(1, formatProfile.generationPolicy.maxGeneratedEpisodesPerBatch || 6);
  const episodeBatch = episodeMetas.slice(0, sceneBatchLimit);
  const skippedEpisodeCount = Math.max(0, episodeMetas.length - episodeBatch.length);
  const generatedSceneIds: string[] = [];
  const episodeOutputs: { episodeId: string; scenes: Scene[] }[] = [];
  const validatedEpisodes: Episode[] = [];
  const promptLog: string[] = [];
  const rawLog: string[] = [];

  for (const episodeMeta of episodeBatch) {
    const episode = await loadEpisodeOrFallback(project, episodeMeta);
    if (episode.scenes?.length > 0) continue;

    const prompt = renderPromptTemplate(loadedTemplate.template, {
      projectContext: projectContext(project, stage),
      formatInstruction: formatStageInstruction(project, "scene"),
      revisionGuidance: revisionGuidance(stage),
      episodeTitle: episode.title,
      episodeInspiration: episode.inspiration || "",
    });

    const sceneResponse = await generateStageAIContent(stage, {
      prompt,
      requireJson: true,
      schema: {
        type: Type.OBJECT,
        properties: {
          scenes: { type: Type.ARRAY, items: { type: Type.OBJECT } },
        },
        required: ["scenes"],
      },
    });
    promptLog.push(prompt);
    rawLog.push(sceneResponse);
    const data = parseResult<any>(sceneResponse, { scenes: [] });
    const scenes: Scene[] = (data.scenes || []).map((scene: any, index: number) => ({
      id: `scene-${episode.id}-${Date.now()}-${index}-${crypto.randomUUID()}`,
      title: scene.title || `场景 ${index + 1}`,
      description: scene.description || "",
      valueCharge: ["positive", "negative", "neutral"].includes(scene.valueCharge) ? scene.valueCharge : "neutral",
      valueShift: scene.valueShift && typeof scene.valueShift === "object"
        ? {
            from: String(scene.valueShift.from || ""),
            to: String(scene.valueShift.to || ""),
            reason: String(scene.valueShift.reason || ""),
          }
        : undefined,
      sceneGoal: scene.sceneGoal || "",
      sceneAssets: scene.sceneAssets || "",
      environment: scene.environment || "INT.",
      timeOfDay: scene.timeOfDay || "DAY",
      targetDuration: Number(scene.targetDuration || 3),
      hook: scene.hook || "",
      cliffhanger: scene.cliffhanger || "",
      script: "",
      scriptBlocks: [],
      shots: [],
    }));
    if (scenes.length > 0) {
      await updateEpisode(episode.id, { scenes });
      generatedSceneIds.push(...scenes.map((scene) => scene.id));
      episodeOutputs.push({ episodeId: episode.id, scenes });
      validatedEpisodes.push({ ...episode, scenes });
    }
  }

  const scopeIssue = skippedEpisodeCount > 0
    ? [makeIssue(
        "scene.scope.pilotBatch",
        `场景阶段按首批试制策略只处理前 ${episodeBatch.length}/${episodeMetas.length} 个${formatProfile.unitName}，剩余 ${skippedEpisodeCount} 个需后续批处理。`,
        "warning",
        "若目标是一次性全量生产，应增加批处理队列；若目标是 pilot first，UI 和阶段摘要必须明确范围。",
      )]
    : [];
  const issues = generatedSceneIds.length === 0
    ? [makeIssue("scene.generated", "没有生成新场景，可能所有段落已经存在 scenes。", "warning")]
    : [...scopeIssue, ...validateSceneRules(validatedEpisodes, project)];
  const scopeSummary = skippedEpisodeCount > 0
    ? `首批试制：本阶段按 ${formatProfile.label} batchLimit=${sceneBatchLimit} 处理前 ${episodeBatch.length}/${episodeMetas.length} 个${formatProfile.unitName}，剩余 ${skippedEpisodeCount} 个留待后续批处理。`
    : `本阶段已覆盖 ${episodeBatch.length}/${episodeMetas.length} 个${formatProfile.unitName}。`;
  return {
    summary: `${scopeSummary} 已生成 ${generatedSceneIds.length} 个场景。`,
    artifacts: [
      makeArtifact("scene", "episode.scenes", "场景拆分", generatedSceneIds),
    ],
    qaReports: [makeQA("scene.qa", issues)],
    ...aiTrace(stage, promptLog.join("\n\n--- NEXT SCENE PROMPT ---\n\n"), rawLog.join("\n\n--- NEXT SCENE RESPONSE ---\n\n"), loadedTemplate.trace),
    outputSnapshot: episodeOutputs,
  };
};
