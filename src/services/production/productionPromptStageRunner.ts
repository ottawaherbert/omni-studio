import { Type } from "@google/genai";
import type {
  Episode,
  Project,
} from "../../types/project";
import type {
  ProductionRun,
  ProductionStageExecutionResult,
  ProductionStageRun,
} from "../../types/production";
import { formatCreativeVision } from "../../utils/projectUtils";
import {
  buildFormatStageInstruction,
  getFormatProductionProfile,
} from "../../config/formatProductionProfiles";
import { compactJson, renderPromptTemplate } from "./promptUtils";
import { loadProductionPromptTemplate } from "./templateLoader";
import { validatePromptRules } from "./ruleQa";
import { createPromptAgentQAReports } from "./linearAgents";
import { buildProductionAssetReferencePackDrafts } from "./videoStoryboardPromptPacks";
import { getProject, loadFullEpisodes, updateEpisode } from "./runnerRepositoryAccess";
import { resolveProductionPrepBundle } from "./productionPrepRuntime";
import { makeArtifact, makeIssue, makeQA } from "./runnerArtifacts";
import {
  aiTrace,
  generateStageAIContent,
} from "./productionPromptRuntime";
import {
  parseResult,
  renderStageContextEnvelope,
  revisionGuidance,
} from "./productionPromptContext";
import { toVideoStoryboardProductionIssues } from "./videoStoryboardIssueAdapter";

const productionPromptTemplate = {
  id: "production.prompt",
  name: "自动制片：图片与视频提示词",
  template: `你是影视 AI 视觉提示词工程师。请为每个镜头生成 imagePrompt 和 videoPrompt。

项目视觉风格:
{{creativeVision}}
{{stageContext}}
{{formatInstruction}}
{{revisionGuidance}}

场景: {{sceneTitle}}
场景描述: {{sceneDescription}}

镜头:
{{shots}}

硬性要求：
- imagePrompt/videoPrompt 必须继承对应 shot 的 shotSize、cameraAngle、cameraMovement、focalLength、lighting、composition、blocking 等物理参数。
- videoPrompt 必须描述 cameraMovement 和可播放的物理运动，不允许只改写剧情摘要或情绪。
- 如果 continuityNote 提到轴线、视线或动作顺接，提示词必须避免破坏该空间关系。

严格返回 JSON：
{
  "prompts": [{"id": "shot id", "imagePrompt": "中文电影感图片生成提示词", "videoPrompt": "中文视频生成提示词"}]
}`,
};

const formatStageInstruction = (
  project: Project,
  stageKey: "prompt",
) => buildFormatStageInstruction(getFormatProductionProfile(project), stageKey);

export const executePromptStage = async (
  run: ProductionRun,
  stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const loadedTemplate = await loadProductionPromptTemplate("production.prompt", productionPromptTemplate);
  const episodes = await loadFullEpisodes(project);
  const updatedShotIds: string[] = [];
  const shotsNeedingPromptIds: string[] = [];
  const validatedEpisodes: Episode[] = [];
  const promptLog: string[] = [];
  const rawLog: string[] = [];

  for (const episode of episodes) {
    let changed = false;
    const scenes = await Promise.all((episode.scenes || []).map(async (scene) => {
      if (!scene.shots?.length) return scene;
      const shotsNeedPrompts = scene.shots.filter((shot) => !shot.imagePrompt || !shot.videoPrompt);
      if (shotsNeedPrompts.length === 0) return scene;
      shotsNeedingPromptIds.push(...shotsNeedPrompts.map((shot) => shot.id));

      const prompt = renderPromptTemplate(loadedTemplate.template, {
        creativeVision: formatCreativeVision(project.creativeVision),
        stageContext: renderStageContextEnvelope(project, stage),
        formatInstruction: formatStageInstruction(project, "prompt"),
        revisionGuidance: revisionGuidance(stage),
        sceneTitle: scene.title,
        sceneDescription: scene.description || "",
        shots: compactJson(shotsNeedPrompts.map((shot) => ({
          id: shot.id,
          shotSize: shot.shotSize,
          cameraAngle: shot.cameraAngle,
          cameraMovement: shot.cameraMovement,
          focalLength: shot.focalLength,
          lighting: shot.lighting || shot.lightingAtmo,
          composition: shot.composition,
          blocking: shot.blocking,
          continuityNote: shot.continuityNote,
          visualAction: shot.visualAction,
          lightingAtmo: shot.lightingAtmo,
          microExpression: shot.microExpression,
        }))),
      });
      const response = await generateStageAIContent(stage, {
        prompt,
        requireJson: true,
        schema: {
          type: Type.OBJECT,
          properties: {
            prompts: { type: Type.ARRAY, items: { type: Type.OBJECT } },
          },
          required: ["prompts"],
        },
      });
      promptLog.push(prompt);
      rawLog.push(response);
      const data = parseResult<any>(response, { prompts: [] });
      const promptById = new Map((data.prompts || []).map((item: any) => [item.id, item]));
      const shots = scene.shots.map((shot) => {
        const promptData: any = promptById.get(shot.id);
        if (!promptData) return shot;
        updatedShotIds.push(shot.id);
        changed = true;
        return {
          ...shot,
          imagePrompt: promptData.imagePrompt || shot.imagePrompt,
          videoPrompt: promptData.videoPrompt || shot.videoPrompt,
        };
      });
      return { ...scene, shots };
    }));
    if (changed) {
      await updateEpisode(episode.id, { scenes });
    }
    validatedEpisodes.push({ ...episode, scenes });
  }

  const promptIssues = shotsNeedingPromptIds.length > 0 && updatedShotIds.length === 0
    ? [makeIssue(
        "prompt.generated",
        `提示词阶段没有为 ${shotsNeedingPromptIds.length} 个缺失提示词的镜头生成有效 imagePrompt/videoPrompt。`,
        "blocking",
        "请检查视觉提示词模型返回的 JSON、shot id 是否与输入镜头一致，并重试当前 prompt 阶段。",
      )]
    : validatePromptRules(validatedEpisodes, project);
  const productionPrep = resolveProductionPrepBundle(run, project, validatedEpisodes);
  const assetReferencePackDrafts = buildProductionAssetReferencePackDrafts(project, validatedEpisodes, undefined, {
    departmentPrepPackages: productionPrep.departmentPrepPackages,
    requireDepartmentPrepRefs: productionPrep.departmentPrepPackages.length > 0,
  });
  const assetReferencePackIssues = toVideoStoryboardProductionIssues(assetReferencePackDrafts.issues);
  return {
    summary: `已生成 ${updatedShotIds.length} 个镜头的图片/视频提示词，派生 ${assetReferencePackDrafts.assetReferencePacks.length} 个资产参考包草案。`,
    artifacts: [
      makeArtifact("image_prompt", "episode.scenes.shots.imagePrompt", "图片提示词", updatedShotIds),
      makeArtifact("video_prompt", "episode.scenes.shots.videoPrompt", "视频提示词", updatedShotIds),
      makeArtifact("asset_reference_pack", "run.outputSnapshot.assetReferencePackDrafts", "AI 视频资产参考包草案", assetReferencePackDrafts.assetReferencePacks.map((pack) => pack.id)),
    ],
    qaReports: [
      makeQA("prompt.qa", promptIssues),
      ...createPromptAgentQAReports(validatedEpisodes, project, promptIssues, assetReferencePackIssues),
    ],
    ...aiTrace(stage, promptLog.join("\n\n--- NEXT PROMPT REQUEST ---\n\n"), rawLog.join("\n\n--- NEXT PROMPT RESPONSE ---\n\n"), loadedTemplate.trace),
    outputSnapshot: {
      updatedShotIds,
      shotsNeedingPromptIds,
      assetReferencePackDrafts: {
        assetReferencePacks: assetReferencePackDrafts.assetReferencePacks,
        packSceneIds: assetReferencePackDrafts.packSceneIds,
      },
    },
  };
};
