import { Episode, Project, Scene, Shot } from "../../types/project";
import {
  ProductionQAIssue,
  ProductionQAReport,
  ProductionStageRun,
} from "../../types/production";
import { isTrustedReadyMediaReference } from "../../utils/mediaProvenance";
import { projectUniversalSkillRefs } from "../../utils/universalSkillRefs";
import { normalizeProductionQAReport } from "./qaIssue";
import {
  validateVideoStoryboardAssetBoardPlan,
  VideoStoryboardAssetBoardPlan,
} from "./videoStoryboardAssetBoards";
import {
  validateAssetRules,
  validateContextPlanRules,
  validatePromptRules,
  validateScriptRules,
  validateStoryboardRules,
} from "./ruleQa";

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  suggestion?: string,
  issueType = "agent",
): ProductionQAIssue => ({
  id: `linear-agent-issue-${Date.now()}-${crypto.randomUUID()}`,
  target,
  message,
  severity,
  suggestion,
  issueType,
});

export const createLinearQAReport = (
  checkerId: string,
  issues: ProductionQAIssue[] = [],
  score = issues.some((item) => item.severity === "blocking") ? 0 : issues.length ? 78 : 100,
): Omit<ProductionQAReport, "id" | "stageId" | "createdAt"> =>
  normalizeProductionQAReport({
    checkerId,
    status: issues.some((item) => item.severity === "blocking") ? "failed" : issues.length ? "warning" : "passed",
    score,
    issues,
    blocking: issues.some((item) => item.severity === "blocking"),
    fixInstructions: issues
      .filter((item) => item.severity === "blocking")
      .map((item) => item.repairInstruction || item.suggestion || item.message)
      .join("\n") || undefined,
  });

const characterIds = (project: Project) =>
  new Set((project.characters || []).map((character) => character.id));

const locationIds = (project: Project) =>
  new Set((project.assets || []).filter((asset) => asset.type === "location").map((asset) => asset.id));

const propIds = (project: Project) =>
  new Set((project.assets || []).filter((asset) => asset.type === "prop").map((asset) => asset.id));

const scenePath = (episode: Episode, scene: Scene, suffix: string) =>
  `episode.${episode.id}.scene.${scene.id}.${suffix}`;

export const validateLinearAssetRefs = (
  project: Project,
  episodes: Episode[],
  scope: "script" | "storyboard" | "prompt" | "media" = "storyboard",
): ProductionQAIssue[] => {
  const validCharacters = characterIds(project);
  const validLocations = locationIds(project);
  const validProps = propIds(project);
  const issues: ProductionQAIssue[] = [];

  episodes.forEach((episode) => {
    (episode.scenes || []).forEach((scene) => {
      const breakdown = scene.breakdown;
      if (breakdown && (scope === "script" || scope === "storyboard" || scope === "prompt")) {
        (breakdown.characterIds || []).forEach((id) => {
          if (!validCharacters.has(id)) {
            issues.push(issue(scenePath(episode, scene, `breakdown.characterIds.${id}`), `breakdown 引用了不存在的角色 ID：${id}。`, "blocking", "请使用 project.characters 中的 canonical id。", "asset_ref"));
          }
        });
        if (breakdown.locationId && !validLocations.has(breakdown.locationId)) {
          issues.push(issue(scenePath(episode, scene, "breakdown.locationId"), `breakdown 引用了不存在的地点 ID：${breakdown.locationId}。`, "blocking", "请使用 project.assets[type=location] 中的 canonical id。", "asset_ref"));
        }
        (breakdown.propIds || []).forEach((id) => {
          if (!validProps.has(id)) {
            issues.push(issue(scenePath(episode, scene, `breakdown.propIds.${id}`), `breakdown 引用了不存在的道具 ID：${id}。`, "blocking", "请使用 project.assets[type=prop] 中的 canonical id。", "asset_ref"));
          }
        });
      }

      (scene.scriptBlocks || []).forEach((block) => {
        if (block.linkedAssetId && !validCharacters.has(block.linkedAssetId) && !validProps.has(block.linkedAssetId)) {
          issues.push(issue(scenePath(episode, scene, `scriptBlocks.${block.id}.linkedAssetId`), `scriptBlock 引用了不存在的资产 ID：${block.linkedAssetId}。`, "blocking", "请改为 canonical character/prop id。", "asset_ref"));
        }
        if (block.locationId && !validLocations.has(block.locationId)) {
          issues.push(issue(scenePath(episode, scene, `scriptBlocks.${block.id}.locationId`), `scriptBlock 引用了不存在的地点 ID：${block.locationId}。`, "blocking", "请改为 canonical location id。", "asset_ref"));
        }
        (block.propIds || []).forEach((id) => {
          if (!validProps.has(id)) {
            issues.push(issue(scenePath(episode, scene, `scriptBlocks.${block.id}.propIds.${id}`), `scriptBlock 引用了不存在的道具 ID：${id}。`, "blocking", "请改为 canonical prop id。", "asset_ref"));
          }
        });
      });

      (scene.shots || []).forEach((shot) => {
        (shot.characterIdsInShot || []).forEach((id) => {
          if (!validCharacters.has(id)) {
            issues.push(issue(scenePath(episode, scene, `shots.${shot.id}.characterIdsInShot.${id}`), `shot 引用了不存在的角色 ID：${id}。`, "blocking", "请让 shot 只引用 breakdown 允许的 canonical character id。", "asset_ref"));
          }
        });
        if (shot.locationId && !validLocations.has(shot.locationId)) {
          issues.push(issue(scenePath(episode, scene, `shots.${shot.id}.locationId`), `shot 引用了不存在的地点 ID：${shot.locationId}。`, "blocking", "请让 shot 只引用 breakdown 允许的 canonical location id。", "asset_ref"));
        }
        (shot.propIds || []).forEach((id) => {
          if (!validProps.has(id)) {
            issues.push(issue(scenePath(episode, scene, `shots.${shot.id}.propIds.${id}`), `shot 引用了不存在的道具 ID：${id}。`, "blocking", "请让 shot 只引用 breakdown 允许的 canonical prop id。", "asset_ref"));
          }
        });
      });
    });
  });

  return issues;
};

const requiredShotPhysicalFields: Array<keyof Shot> = [
  "shotSize",
  "cameraAngle",
  "cameraMovement",
  "visualAction",
  "duration",
];

export const validateLinearShotPlanning = (episodes: Episode[]): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  episodes.forEach((episode) => {
    (episode.scenes || []).forEach((scene) => {
      (scene.shots || []).forEach((shot) => {
        requiredShotPhysicalFields.forEach((field) => {
          if (!shot[field]) {
            issues.push(issue(scenePath(episode, scene, `shots.${shot.id}.${String(field)}`), `shot 缺少物理镜头字段 ${String(field)}。`, "warning", "补齐景别、角度、运动、动作和时长后再进入提示词阶段。", "shot_grammar"));
          }
        });
      });
    });
  });
  return issues;
};

export const validateLinearShotContinuity = (episodes: Episode[]): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  episodes.forEach((episode) => {
    (episode.scenes || []).forEach((scene) => {
      (scene.shots || []).forEach((shot) => {
        if (!shot.blocking && !shot.continuityNote) {
          issues.push(issue(scenePath(episode, scene, `shots.${shot.id}.continuityNote`), "shot 缺少 blocking/continuityNote，后续容易越轴或动作接不上。", "warning", "补充 180 度轴线、视线匹配、动作顺接和空间方位连续性说明。", "continuity"));
        }
      });
    });
  });
  return issues;
};

export const validateLinearMediaProvenance = (episodes: Episode[]): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  episodes.forEach((episode) => {
    (episode.scenes || []).forEach((scene) => {
      (scene.shots || []).forEach((shot) => {
        if (shot.imageUrl && !shot.imageMedia) {
          issues.push(issue(scenePath(episode, scene, `shots.${shot.id}.imageUrl`), "shot 使用裸 imageUrl，缺少 MediaAssetReference provenance。", "warning", "请改用 imageMedia 并记录 source/status/generationJobId。", "media_provenance"));
        }
        if (shot.videoUrl && !shot.videoMedia) {
          issues.push(issue(scenePath(episode, scene, `shots.${shot.id}.videoUrl`), "shot 使用裸 videoUrl，缺少 MediaAssetReference provenance。", "warning", "请改用 videoMedia 并记录 source/status/generationJobId。", "media_provenance"));
        }
        if (shot.imageMedia && !isTrustedReadyMediaReference(shot.imageMedia, "image")) {
          issues.push(issue(scenePath(episode, scene, `shots.${shot.id}.imageMedia`), "imageMedia 不是可信 ready 媒体引用。", "blocking", "AI 生成媒体必须有 generationJobId；failed/stale/legacy 媒体不能进入 ready。", "media_provenance"));
        }
        if (shot.videoMedia && !isTrustedReadyMediaReference(shot.videoMedia, "video")) {
          issues.push(issue(scenePath(episode, scene, `shots.${shot.id}.videoMedia`), "videoMedia 不是可信 ready 媒体引用。", "blocking", "AI 生成媒体必须有 generationJobId；failed/stale/legacy 媒体不能进入 ready。", "media_provenance"));
        }
      });
    });
  });
  return issues;
};

export const createContextPlannerQAReports = (
  contextPlan: Parameters<typeof validateContextPlanRules>[0],
  project: Project,
) => [
  createLinearQAReport("qa.linear.context_contamination", validateContextPlanRules(contextPlan, projectUniversalSkillRefs(project), project)),
];

export const createAssetDetailQAReports = (
  project: Project,
  assetBoardPlan?: VideoStoryboardAssetBoardPlan,
) => {
  const characterIssues = (project.characters || []).flatMap((character) => [
    !character.name ? issue(`character.${character.id}.name`, "角色缺少名称。", "blocking", "补齐角色名。", "character_detail") : undefined,
    !character.multiViewPrompt ? issue(`character.${character.id}.multiViewPrompt`, `角色「${character.name}」缺少 multiViewPrompt。`, "warning", "补齐中文角色板/多视图提示词。", "character_detail") : undefined,
  ].filter(Boolean) as ProductionQAIssue[]);
  const locationIssues = (project.assets || []).filter((asset) => asset.type === "location").flatMap((asset) => [
    !asset.description ? issue(`asset.${asset.id}.description`, `地点「${asset.name}」缺少生产描述。`, "warning", "补齐空间功能和视觉特质。", "location_detail") : undefined,
    !asset.prompt ? issue(`asset.${asset.id}.prompt`, `地点「${asset.name}」缺少 prompt。`, "warning", "补齐中文环境图或场景板提示词。", "location_detail") : undefined,
  ].filter(Boolean) as ProductionQAIssue[]);
  const propIssues = (project.assets || []).filter((asset) => asset.type === "prop").flatMap((asset) => [
    !asset.description ? issue(`asset.${asset.id}.description`, `道具「${asset.name}」缺少生产描述。`, "warning", "补齐道具功能和可拍细节。", "prop_detail") : undefined,
    !asset.prompt ? issue(`asset.${asset.id}.prompt`, `道具「${asset.name}」缺少 prompt。`, "warning", "补齐中文道具图或道具板提示词。", "prop_detail") : undefined,
  ].filter(Boolean) as ProductionQAIssue[]);

  return [
    createLinearQAReport("linear.asset.character_detailer.qa", characterIssues),
    createLinearQAReport("linear.asset.location_detailer.qa", locationIssues),
    createLinearQAReport("linear.asset.prop_detailer.qa", propIssues),
    ...(assetBoardPlan ? [
      createLinearQAReport("qa.linear.asset_board_plan", validateVideoStoryboardAssetBoardPlan(assetBoardPlan, project).map((item) =>
        issue(item.target, `${item.code}: ${item.message}`, item.severity, "补齐资产板提示词、参考图或变体引用后再进入故事板/视频单元规划。", "asset_board_plan"),
      )),
    ] : []),
    createLinearQAReport("asset.qa", validateAssetRules(project)),
  ];
};

export const createScriptAgentQAReports = (
  episodes: Episode[],
  project: Project,
  stage: ProductionStageRun,
  extraIssues: ProductionQAIssue[] = [],
  performanceBeatIssues?: ProductionQAIssue[],
) => [
  createLinearQAReport("linear.script.writer.qa", validateScriptRules(episodes, project).filter((item) => !/breakdown|asset/i.test(`${item.target} ${item.message}`))),
  createLinearQAReport("linear.breakdown.extractor.qa", [
    ...validateScriptRules(episodes, project).filter((item) => /breakdown|asset/i.test(`${item.target} ${item.message}`)),
    ...validateLinearAssetRefs(project, episodes, stage.stageType === "prompt" ? "prompt" : "script"),
    ...extraIssues,
  ]),
  ...(performanceBeatIssues ? [
    createLinearQAReport("qa.linear.performance_beats", performanceBeatIssues),
  ] : []),
];

export const createStoryboardAgentQAReports = (
  episodes: Episode[],
  project: Project,
  extraIssues: ProductionQAIssue[] = [],
  storyboardBoardIssues?: ProductionQAIssue[],
) => [
  createLinearQAReport("linear.storyboard.shot_planner.qa", [
    ...validateStoryboardRules(episodes, project),
    ...validateLinearShotPlanning(episodes),
    ...extraIssues,
  ]),
  createLinearQAReport("linear.storyboard.continuity_planner.qa", validateLinearShotContinuity(episodes)),
  createLinearQAReport("qa.linear.asset_ref_integrity", validateLinearAssetRefs(project, episodes, "storyboard")),
  ...(storyboardBoardIssues ? [
    createLinearQAReport("qa.linear.storyboard_board", storyboardBoardIssues),
  ] : []),
];

export const createPromptAgentQAReports = (
  episodes: Episode[],
  project: Project,
  promptIssues: ProductionQAIssue[] = [],
  assetReferencePackIssues?: ProductionQAIssue[],
) => {
  const basePromptIssues = validatePromptRules(episodes, project);
  const imageIssues = [...basePromptIssues, ...promptIssues].filter((item) =>
    /image|图片|visual|prompt.generated/i.test(`${item.target} ${item.message}`),
  );
  const videoIssues = [...basePromptIssues, ...promptIssues].filter((item) =>
    /video|视频|motion|cameraMovement|prompt.generated/i.test(`${item.target} ${item.message}`),
  );
  return [
    createLinearQAReport("linear.prompt.image_compiler.qa", imageIssues),
    createLinearQAReport("linear.prompt.video_compiler.qa", videoIssues),
    createLinearQAReport("qa.linear.asset_ref_integrity", validateLinearAssetRefs(project, episodes, "prompt")),
    ...(assetReferencePackIssues ? [
      createLinearQAReport("qa.linear.asset_reference_pack", assetReferencePackIssues),
    ] : []),
    createLinearQAReport("qa.linear.media_provenance", validateLinearMediaProvenance(episodes)),
  ];
};
