import type { GameNode } from "../../types/game";
import type {
  ProductionQAIssue,
  ProductionRun,
  ProductionStageExecutionResult,
} from "../../types/production";
import { resolveProductionPrepBundle } from "./productionPrepRuntime";
import {
  getProject,
  loadFullEpisodes,
} from "./runnerRepositoryAccess";
import { makeArtifact, makeIssue, makeQA } from "./runnerArtifacts";
import type { VideoStoryboardArtifactIssue } from "./videoStoryboardArtifacts";
import { buildProductionVideoGenerationUnitDrafts } from "./videoStoryboardVideoUnits";

const toVideoStoryboardProductionIssues = (
  issues: VideoStoryboardArtifactIssue[],
): ProductionQAIssue[] =>
  issues.map((issue) =>
    makeIssue(
      issue.target,
      `${issue.code}: ${issue.message}`,
      issue.severity === "blocking" ? "blocking" : "warning",
      "检查故事板策略选择、panel 数、箭头 legend、镜头/资产/连续性引用后再进入 prompt 或媒体生成计划。",
    ),
  );

export const executeMediaGenerationPlanningStage = async (
  run: ProductionRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const episodes = await loadFullEpisodes(project);
  const scenes = episodes.flatMap((episode) => episode.scenes || []);
  const sceneShots = scenes.flatMap((scene) => scene.shots || []);
  const nodeShots = project.projectModel === "interactive"
    ? episodes.flatMap((episode) => (episode.gameData?.nodes || []).flatMap((node: GameNode) => node.shots || []))
    : [];
  const shots = Array.from(
    new Map([...sceneShots, ...nodeShots].map((shot) => [shot.id, shot])).values(),
  );
  const sceneAudioTracks = scenes.flatMap((scene) => scene.audioTracks || []);
  const nodeAudioTracks = project.projectModel === "interactive"
    ? episodes.flatMap((episode) => (episode.gameData?.nodes || []).flatMap((node: GameNode) => node.audioTracks || []))
    : [];
  const audioTracks = Array.from(
    new Map([...sceneAudioTracks, ...nodeAudioTracks].map((track) => [track.id, track])).values(),
  );
  const imagePromptCount = shots.filter((shot) => shot.imagePrompt).length;
  const videoPromptCount = shots.filter((shot) => shot.videoPrompt).length;
  const audioTrackCount = audioTracks.length;
  const missingImagePromptShotIds = shots.filter((shot) => !shot.imagePrompt).map((shot) => shot.id);
  const missingVideoPromptShotIds = shots.filter((shot) => !shot.videoPrompt).map((shot) => shot.id);
  const productionPrep = resolveProductionPrepBundle(run, project, episodes);
  const videoUnitDrafts = buildProductionVideoGenerationUnitDrafts(project, episodes, {
    departmentPrepPackages: productionPrep.departmentPrepPackages,
    requireDepartmentPrepRefs: productionPrep.departmentPrepPackages.length > 0,
  });
  const videoUnitIssues = toVideoStoryboardProductionIssues(videoUnitDrafts.issues);
  const planningIssues: ProductionQAIssue[] = [];
  if (shots.length > 0 && (missingImagePromptShotIds.length > 0 || missingVideoPromptShotIds.length > 0)) {
    planningIssues.push(makeIssue(
      "media.prompts.missing",
      `媒体生成计划缺少可用提示词：图片 ${imagePromptCount}/${shots.length}，视频 ${videoPromptCount}/${shots.length}。`,
      "blocking",
      "请先回到 prompt 阶段补齐所有镜头的 imagePrompt 和 videoPrompt，再重新生成媒体生成计划。",
    ));
  }
  const imageQueue = shots
    .filter((shot) => shot.imagePrompt)
    .map((shot, index) => ({
      index: index + 1,
      shotId: shot.id,
      priority: index < 3 ? "high" : index < 12 ? "normal" : "defer",
      estimatedMinutes: index < 3 ? 3 : 2,
      retryLimit: index < 3 ? 2 : 1,
      skippable: index >= 12,
    }));
  const videoQueue = shots
    .filter((shot) => shot.videoPrompt)
    .map((shot, index) => ({
      index: index + 1,
      shotId: shot.id,
      priority: index < 3 ? "high" : index < 12 ? "normal" : "defer",
      estimatedMinutes: index < 3 ? 12 : 8,
      retryLimit: index < 3 ? 2 : 1,
      skippable: index >= 12,
    }));
  const audioQueue = audioTracks.map((track, index) => ({
    index: index + 1,
    audioTrackId: track.id,
    type: track.type,
    priority: track.type === "dialogue" ? "high" : "normal",
    estimatedMinutes: Math.max(1, Math.ceil((track.duration || 1) / 30)),
    retryLimit: track.type === "dialogue" ? 2 : 1,
    skippable: track.type !== "dialogue",
  }));
  const videoUnitQueue = videoUnitDrafts.videoGenerationUnits.map((unit, index) => ({
    index: index + 1,
    videoGenerationUnitId: unit.id,
    storyboardBoardId: unit.storyboardBoardId,
    assetReferencePackId: unit.assetReferencePackId,
    shotCount: unit.shotIds.length,
    durationSeconds: unit.durationSeconds,
    modelProfileId: unit.modelProfileId,
    priority: index < 3 ? "high" : index < 12 ? "normal" : "defer",
    estimatedMinutes: index < 3 ? 14 : 10,
    retryLimit: index < 3 ? 2 : 1,
    skippable: index >= 12,
  }));
  const imageEstimatedMinutes = imageQueue.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const videoEstimatedMinutes = videoQueue.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const videoUnitEstimatedMinutes = videoUnitQueue.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const audioEstimatedMinutes = audioQueue.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  const imageRetryLimit = imageQueue.reduce((sum, item) => sum + item.retryLimit, 0);
  const videoRetryLimit = videoQueue.reduce((sum, item) => sum + item.retryLimit, 0);
  const videoUnitRetryLimit = videoUnitQueue.reduce((sum, item) => sum + item.retryLimit, 0);
  const audioRetryLimit = audioQueue.reduce((sum, item) => sum + item.retryLimit, 0);
  const recommendedVideoRetryLimit = videoUnitQueue.length > 0 ? videoUnitRetryLimit : videoRetryLimit;
  const skippableItems = [
    ...imageQueue.filter((item) => item.skippable).map((item) => ({
      kind: "image",
      id: item.shotId,
      reason: "低优先级镜头图片可延后到核心视觉验证之后。",
    })),
    ...videoQueue.filter((item) => item.skippable).map((item) => ({
      kind: "video",
      id: item.shotId,
      reason: "低优先级镜头视频可延后到主路径样片通过之后。",
    })),
    ...videoUnitQueue.filter((item) => item.skippable).map((item) => ({
      kind: "video_generation_unit",
      id: item.videoGenerationUnitId,
      reason: "低优先级视频生成单元可延后到主路径样片通过之后。",
    })),
    ...audioQueue.filter((item) => item.skippable).map((item) => ({
      kind: "audio",
      id: item.audioTrackId,
      reason: "非对白音频可在图片/视频闭合后补齐。",
    })),
  ];
  const generationPlan = {
    imagePromptCount,
    videoPromptCount,
    videoGenerationUnitCount: videoUnitQueue.length,
    audioTrackCount,
    missingImagePromptShotIds,
    missingVideoPromptShotIds,
    generationQueues: {
      image: {
        count: imageQueue.length,
        estimatedMinutes: imageEstimatedMinutes,
        retryLimit: imageRetryLimit,
        items: imageQueue,
      },
      video: {
        count: videoQueue.length,
        estimatedMinutes: videoEstimatedMinutes,
        retryLimit: videoRetryLimit,
        items: videoQueue,
      },
      videoUnit: {
        count: videoUnitQueue.length,
        estimatedMinutes: videoUnitEstimatedMinutes,
        retryLimit: videoUnitRetryLimit,
        items: videoUnitQueue,
      },
      audio: {
        count: audioQueue.length,
        estimatedMinutes: audioEstimatedMinutes,
        retryLimit: audioRetryLimit,
        items: audioQueue,
      },
    },
    estimatedDurationMinutes: {
      image: imageEstimatedMinutes,
      video: videoEstimatedMinutes,
      videoUnit: videoUnitEstimatedMinutes,
      audio: audioEstimatedMinutes,
      total: imageEstimatedMinutes + (videoUnitQueue.length > 0 ? videoUnitEstimatedMinutes : videoEstimatedMinutes) + audioEstimatedMinutes,
    },
    retryLimit: {
      image: imageRetryLimit,
      video: videoRetryLimit,
      videoUnit: videoUnitRetryLimit,
      audio: audioRetryLimit,
      totalRetries: imageRetryLimit + recommendedVideoRetryLimit + audioRetryLimit,
    },
    skippableItems,
    recommendation: planningIssues.length > 0
      ? "当前缺少完整提示词，不能进入图片/视频生成排期。"
      : "媒体生成队列已经就绪，可直接开始生成，也可先抽查关键镜头提示词。",
    priority: shots.slice(0, 12).map((shot, index) => ({
      index: index + 1,
      shotId: shot.id,
      reason: index < 3 ? "优先验证核心视觉风格" : "按故事顺序排队",
      mediaTypes: [
        shot.imagePrompt ? "image" : "",
        shot.videoPrompt ? "video" : "",
      ].filter(Boolean),
      estimatedMinutes: (shot.imagePrompt ? (index < 3 ? 3 : 2) : 0) + (shot.videoPrompt ? (index < 3 ? 12 : 8) : 0),
      retryLimit: (shot.imagePrompt ? (index < 3 ? 2 : 1) : 0) + (shot.videoPrompt ? (index < 3 ? 2 : 1) : 0),
    })),
  };

  return {
    summary: `已生成媒体生成计划：图片 ${imagePromptCount} 个，镜头级视频提示词 ${videoPromptCount} 个，视频生成单元 ${videoUnitQueue.length} 个，音频 ${audioTrackCount} 条，预计 ${generationPlan.estimatedDurationMinutes.total} 分钟。`,
    artifacts: [
      makeArtifact("generation_plan", "run.generationPlan", "媒体生成计划", [project.id]),
      makeArtifact("video_generation_unit", "run.outputSnapshot.videoGenerationUnitDrafts", "AI 视频生成单元草案", videoUnitDrafts.videoGenerationUnits.map((unit) => unit.id)),
    ],
    qaReports: [
      makeQA("media.readiness.qa", planningIssues, planningIssues.some((issue) => issue.severity === "blocking") ? 0 : 100),
      makeQA("qa.linear.video_generation_unit", videoUnitIssues, videoUnitIssues.some((issue) => issue.severity === "blocking") ? 0 : videoUnitIssues.length > 0 ? 78 : 100),
    ],
    outputSnapshot: {
      ...generationPlan,
      videoGenerationUnitDrafts: {
        count: videoUnitDrafts.videoGenerationUnits.length,
        unitIds: videoUnitDrafts.videoGenerationUnits.map((unit) => unit.id),
        storyboardBoardCount: videoUnitDrafts.storyboardBoards.length,
        assetReferencePackCount: videoUnitDrafts.assetReferencePacks.length,
        performanceBeatCount: videoUnitDrafts.performanceBeats.length,
        issueCount: videoUnitIssues.length,
        blockingIssueCount: videoUnitIssues.filter((issue) => issue.severity === "blocking").length,
      },
    },
  };
};
