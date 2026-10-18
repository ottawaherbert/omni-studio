import { Type } from "@google/genai";
import type {
  Episode,
  Project,
  Shot,
} from "../../types/project";
import type {
  ProductionRun,
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
  validateInteractiveStoryboardRules,
  validateStoryboardRules,
} from "./ruleQa";
import { createStoryboardAgentQAReports } from "./linearAgents";
import { buildProductionStoryboardBoardDrafts } from "./videoStoryboardStageBoards";
import { getProject, loadFullEpisodes, updateEpisode } from "./runnerRepositoryAccess";
import { resolveProductionPrepBundle } from "./productionPrepRuntime";
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
  sanitizeShotAssetRefs,
  sceneAssetReferenceContext,
} from "./productionAssetReferenceContext";
import { toVideoStoryboardProductionIssues } from "./videoStoryboardIssueAdapter";

const productionStoryboardTemplate = {
  id: "production.storyboard",
  name: "自动制片：分镜生成",
  template: `你是导演、摄影指导和分镜师。请根据剧本生成可拍摄分镜。

{{projectContext}}
{{formatInstruction}}
{{revisionGuidance}}

场景: {{sceneTitle}}
场景描述: {{sceneDescription}}
稳定资产 ID（每个镜头必须只使用这些 ID；如没有对应资产则返回空数组或省略）:
{{assetReferenceContext}}
剧本:
{{scriptText}}

连续性硬性要求：
- continuityNote 记录本镜实际相关的轴线、视线、动作和空间承接；空镜、插入镜头、蒙太奇等不适用项可注明不适用，不得为凑字段编造关系。
- 保留剧本对白的说话人、原文、重复次数与顺序，以及作者要求的画内文字；不要为了分镜而改写作品内容。
- 如果某个镜头故意越轴、跳切或打破动作连续，必须在 continuityNote 写明创作动机和可见承接点。

严格返回 JSON：
{
  "shots": [{
    "shotSize": "景别",
    "cameraAngle": "角度",
    "cameraMovement": "运动",
    "focalLength": "焦距或镜头选择",
    "lighting": "布光方案",
    "composition": "构图与画面层次",
    "blocking": "人物/道具/空间调度",
    "continuityNote": "实际相关的轴线、视线、动作或空间承接；有意打破连续性时说明安排",
    "visualAction": "画面动作",
    "lightingAtmo": "光线氛围",
    "duration": 4,
    "motivation": "镜头动机",
    "microExpression": "表演微动作",
    "characterIdsInShot": ["char-id"],
    "locationId": "location-id",
    "propIds": ["prop-id"]
  }]
}`,
};

const formatStageInstruction = (
  project: Project,
  stageKey: "storyboard",
) => buildFormatStageInstruction(getFormatProductionProfile(project), stageKey);

export const executeStoryboardStage = async (
  run: ProductionRun,
  stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const loadedTemplate = await loadProductionPromptTemplate("production.storyboard", productionStoryboardTemplate);
  const episodes = await loadFullEpisodes(project);
  const updatedSceneIds: string[] = [];
  const validatedEpisodes: Episode[] = [];
  const promptLog: string[] = [];
  const rawLog: string[] = [];

  for (const episode of episodes) {
    let changed = false;
    const scenes = await Promise.all((episode.scenes || []).map(async (scene) => {
      if (scene.shots?.length) return scene;
      const scriptText = scene.scriptBlocks?.length
        ? scene.scriptBlocks.map((block) => `[${block.type}] ${block.content}`).join("\n")
        : scene.script || scene.description;
      const assetRefs = sceneAssetReferenceContext(project, scene);

      const prompt = renderPromptTemplate(loadedTemplate.template, {
        projectContext: projectContext(project, stage),
        formatInstruction: formatStageInstruction(project, "storyboard"),
        revisionGuidance: revisionGuidance(stage),
        sceneTitle: scene.title,
        sceneDescription: scene.description || "",
        assetReferenceContext: assetRefs.promptContext,
        scriptText,
      });
      const response = await generateStageAIContent(stage, {
        prompt,
        requireJson: true,
        schema: {
          type: Type.OBJECT,
          properties: {
            shots: { type: Type.ARRAY, items: { type: Type.OBJECT } },
          },
          required: ["shots"],
        },
      });
      promptLog.push(prompt);
      rawLog.push(response);
      const data = parseResult<any>(response, { shots: [] });
      const shots: Shot[] = (data.shots || []).map((shot: any) => ({
        id: `shot-${scene.id}-${crypto.randomUUID()}`,
        shotSize: shot.shotSize || "",
        cameraAngle: shot.cameraAngle || "",
        cameraMovement: shot.cameraMovement || "",
        focalLength: shot.focalLength || "",
        lighting: shot.lighting || "",
        composition: shot.composition || "",
        blocking: shot.blocking || "",
        continuityNote: shot.continuityNote || "",
        visualAction: shot.visualAction || "",
        lightingAtmo: shot.lightingAtmo || "",
        duration: Number(shot.duration || 4),
        motivation: shot.motivation || "",
        microExpression: shot.microExpression || "",
        ...sanitizeShotAssetRefs(project, shot, assetRefs),
      }));
      if (shots.length === 0) return scene;
      changed = true;
      updatedSceneIds.push(scene.id);
      return { ...scene, shots };
    }));
    if (changed) {
      await updateEpisode(episode.id, { scenes });
      validatedEpisodes.push({ ...episode, scenes });
    }
  }

  const storyboardIssues = updatedSceneIds.length === 0
    ? [makeIssue("storyboard.generated", "没有生成新分镜。", "warning")]
    : [
        ...validateStoryboardRules(validatedEpisodes, project),
        ...(stage.stageType === "interactive_storyboard" ? validateInteractiveStoryboardRules(validatedEpisodes) : []),
      ];
  const latestEpisodes = episodes.map((episode) => validatedEpisodes.find((item) => item.id === episode.id) || episode);
  const productionPrep = resolveProductionPrepBundle(run, project, latestEpisodes);
  const storyboardBoardDrafts = buildProductionStoryboardBoardDrafts(project, latestEpisodes, {
    departmentPrepPackages: productionPrep.departmentPrepPackages,
    requireDepartmentPrepRefs: productionPrep.departmentPrepPackages.length > 0,
  });
  const storyboardBoardIssues = toVideoStoryboardProductionIssues(storyboardBoardDrafts.issues);

  return {
    summary: `已生成 ${updatedSceneIds.length} 场分镜，派生 ${storyboardBoardDrafts.storyboardBoards.length} 页 AI 视频故事板草案。`,
    artifacts: [
      makeArtifact("storyboard", "episode.scenes.shots", "分镜", updatedSceneIds),
      makeArtifact("storyboard_board", "run.outputSnapshot.storyboardBoardDrafts", "AI 视频故事板页草案", storyboardBoardDrafts.storyboardBoards.map((board) => board.id)),
    ],
    qaReports: [
      makeQA("storyboard.qa", storyboardIssues),
      ...createStoryboardAgentQAReports(validatedEpisodes, project, [], storyboardBoardIssues),
    ],
    ...aiTrace(stage, promptLog.join("\n\n--- NEXT STORYBOARD PROMPT ---\n\n"), rawLog.join("\n\n--- NEXT STORYBOARD RESPONSE ---\n\n"), loadedTemplate.trace),
    outputSnapshot: {
      updatedSceneIds,
      storyboardBoardDrafts: {
        performanceBeats: storyboardBoardDrafts.performanceBeats,
        storyboardBoards: storyboardBoardDrafts.storyboardBoards,
        boardSceneIds: storyboardBoardDrafts.boardSceneIds,
      },
    },
  };
};
