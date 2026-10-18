import { Project } from "../../types/project";
import { buildAssetContinuityContext } from "../production/assetContinuity";
import { buildLongFormMemoryContext } from "../production/longFormMemory";
import { OPERATOR_HANDBOOK_VERSION, OperatorProjectContext, OperatorRun } from "./types";
import { projectUniversalSkillRefs } from "../../utils/universalSkillRefs";

const compactText = (value: unknown, maxLength = 220) => {
  void maxLength;
  const text = typeof value === "string" ? value.trim() : "";
  return text;
};

const compactAsset = (asset: any) => ({
  id: asset?.id,
  type: asset?.type,
  name: asset?.name,
  description: compactText(asset?.description),
  prompt: compactText(asset?.prompt),
  hasImage: Boolean(asset?.imageUrl || asset?.defaultReferenceUrl || asset?.multiViewUrl || asset?.panoramaUrl),
  variantCount: Array.isArray(asset?.variants) ? asset.variants.length : 0,
});

const compactCharacter = (character: any) => ({
  id: character?.id,
  name: character?.name,
  roleType: character?.roleType || character?.role,
  brief: compactText(character?.brief || character?.description || character?.background),
  goal: compactText(character?.goal || character?.motivation),
  hasReference: Boolean(character?.imageUrl || character?.defaultReferenceUrl || character?.multiViewUrl),
});

const compactEpisode = (episode: any, index: number) => {
  const scenes = Array.isArray(episode?.scenes) ? episode.scenes : [];
  return {
    id: episode?.id,
    index: index + 1,
    title: episode?.title,
    inspiration: compactText(episode?.inspiration || episode?.summary),
    targetDuration: episode?.targetDuration,
    sceneCount: scenes.length || episode?.sceneCount || 0,
    shotCount: scenes.reduce((sum: number, scene: any) => sum + (Array.isArray(scene?.shots) ? scene.shots.length : 0), 0),
  };
};

const compactScene = (episode: any, scene: any, index: number) => ({
  id: scene?.id,
  episodeId: episode?.id,
  episodeTitle: episode?.title,
  index: index + 1,
  title: scene?.title,
  sceneNumber: scene?.sceneNumber,
  description: compactText(scene?.description),
  sceneGoal: compactText(scene?.sceneGoal),
  valueShift: scene?.valueShift,
  breakdown: scene?.breakdown
    ? {
        locationId: scene.breakdown.locationId,
        characterIds: scene.breakdown.characterIds || [],
        propIds: scene.breakdown.propIds || [],
      }
    : undefined,
  scriptBlockCount: Array.isArray(scene?.scriptBlocks) ? scene.scriptBlocks.length : 0,
  shotCount: Array.isArray(scene?.shots) ? scene.shots.length : 0,
});

const compactShot = (episode: any, scene: any, shot: any, index: number) => ({
  id: shot?.id,
  episodeId: episode?.id,
  sceneId: scene?.id,
  index: index + 1,
  visualAction: compactText(shot?.visualAction),
  duration: shot?.duration,
  shotSize: shot?.shotSize,
  cameraAngle: shot?.cameraAngle,
  cameraMovement: shot?.cameraMovement,
  characterIdsInShot: shot?.characterIdsInShot || [],
  locationId: shot?.locationId,
  propIds: shot?.propIds || [],
  hasImagePrompt: Boolean(shot?.imagePrompt),
  hasImage: Boolean(shot?.imageUrl || shot?.imageMedia),
});

const collectBlockedIssues = (runs: any[], operatorRuns: OperatorRun[]) => {
  const issues: OperatorProjectContext["productionState"]["blockedIssues"] = [];
  for (const run of runs) {
    const stages = Array.isArray(run?.stages) ? run.stages : [];
    for (const stage of stages) {
      if (!["failed", "needs_human_review"].includes(stage?.status)) continue;
      const stageIssues = [
        ...(stage?.qaReport?.issues || []),
        ...(stage?.gateVerdicts || []).flatMap((gate: any) => gate?.issues || []),
      ];
      for (const issue of stageIssues) {
        issues.push({
          id: String(issue?.id || issue?.fingerprint || `${run.id}:${stage.id}`),
          severity: String(issue?.severity || "warning"),
          target: issue?.target || stage?.id,
          message: compactText(issue?.message || issue?.suggestion || stage?.title, 260),
          sourceRunId: run?.id,
          createdAt: run?.updatedAt,
        });
      }
    }
  }
  for (const run of operatorRuns) {
    for (const event of (run.events || []).filter((item) => item.type === "blocked" || item.type === "qa_failed")) {
      issues.push({
        id: event.id,
        severity: event.type === "blocked" ? "blocking" : "warning",
        target: event.targetPath,
        message: compactText(event.message, 260),
        sourceRunId: run.id,
        createdAt: event.createdAt,
      });
    }
  }
  return issues;
};

export const extractOperatorHandbookVersion = (content: string) => {
  const match = content.match(/handbookVersion\s*[:：]\s*`?([^`\n]+)/);
  return match?.[1]?.trim() || OPERATOR_HANDBOOK_VERSION;
};

export const buildOperatorProjectContext = ({
  project,
  productionRuns = [],
  operatorRuns = [],
  handbookVersion = OPERATOR_HANDBOOK_VERSION,
}: {
  project: Project;
  productionRuns?: any[];
  operatorRuns?: OperatorRun[];
  handbookVersion?: string;
}): OperatorProjectContext => {
  const episodes = Array.isArray((project as any).episodes) ? (project as any).episodes : [];
  const scenes = episodes.flatMap((episode: any) =>
    (Array.isArray(episode?.scenes) ? episode.scenes : []).map((scene: any, index: number) => compactScene(episode, scene, index)),
  );
  const shots = episodes.flatMap((episode: any) =>
    (Array.isArray(episode?.scenes) ? episode.scenes : []).flatMap((scene: any) =>
      (Array.isArray(scene?.shots) ? scene.shots : []).map((shot: any, index: number) => compactShot(episode, scene, shot, index)),
    ),
  );
  const assets = Array.isArray((project as any).assets) ? (project as any).assets : [];
  const lastProductionRuns = productionRuns.map((run) => ({
    id: run.id,
    source: "production_run" as const,
    status: run.status,
    mode: run.mode,
    updatedAt: run.updatedAt,
    summary: compactText(run.title || run.projectTitle || run.status),
  }));
  const lastOperatorRuns = operatorRuns.map((run) => ({
    id: run.id,
    source: "operator_run" as const,
    status: run.status,
    mode: run.mode,
    updatedAt: run.updatedAt,
    summary: compactText(run.userRequest || run.events?.[run.events.length - 1]?.message),
  }));
  const longFormMemory = buildLongFormMemoryContext(project, { profile: "operator" });
  const assetContinuity = buildAssetContinuityContext(project, { profile: "operator" });
  const productionMemory = project.productionMemory || project.operatorProductionMemory;

  return {
    handbookVersion,
    operatorModeBoundary: {
      entryMode: "external_operator",
      preservesTraditionalMode: true,
      preservesProductionDetail: true,
      requiredInstruction: "AI Operator 只是外部操作入口，必须复用现有制片流程、资产治理、QA、版本、日志和媒体 provenance。",
    },
    project: {
      id: project.id,
      title: project.title,
      type: project.type,
      projectModel: project.projectModel || "linear",
      targetEpisodeCount: project.targetEpisodeCount,
      durationMinutes: project.durationMinutes,
      aspectRatio: project.aspectRatio,
      logline: compactText(project.logline),
      coreConflict: compactText(project.coreConflict),
      seasonArc: compactText(project.seasonArc),
    },
    productionState: {
      currentWorkflow: project.projectModel === "interactive" ? "interactive_production" : "linear_production",
      currentStage: operatorRuns[0]?.mode || productionRuns[0]?.currentStageId || productionRuns[0]?.status,
      completedStages: productionRuns
        .flatMap((run) => (Array.isArray(run?.stages) ? run.stages : []))
        .filter((stage) => stage?.status === "completed" || stage?.status === "approved")
        .map((stage) => stage?.stageType || stage?.id)
        .filter(Boolean),
      blockedIssues: collectBlockedIssues(productionRuns, operatorRuns),
      lastRuns: [...lastOperatorRuns, ...lastProductionRuns]
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)),
    },
    creativeMemory: {
      originalInspiration: compactText(project.originalInspiration),
      refinedInspiration: compactText(project.refinedInspiration),
      creativeVision: project.creativeVision,
      premiumProduction: productionMemory
        ? {
            commercialMemory: productionMemory.commercialMemory,
            skeletonMemory: productionMemory.skeletonMemory,
            continuityMemory: productionMemory.continuityMemory,
            qaCouncil: productionMemory.qaCouncil,
            updatedAt: productionMemory.updatedAt,
          }
        : undefined,
      longFormMemory,
      assetContinuity,
      worldRules: Array.isArray(project.worldBuildingRules) ? project.worldBuildingRules : [],
      characters: Array.isArray(project.characters) ? project.characters.map(compactCharacter) : [],
      locations: assets.filter((asset) => asset?.type === "location").map(compactAsset),
      props: assets.filter((asset) => asset?.type === "prop").map(compactAsset),
      relationships: Array.isArray(project.relationships) ? project.relationships : [],
      universalSkillRefs: projectUniversalSkillRefs(project),
      extractedDNAs: Array.isArray(project.extractedDNAs) ? project.extractedDNAs : [],
    },
    structureMemory: {
      episodes: episodes.map(compactEpisode),
      scenes,
      shots,
    },
    qaPolicy: {
      visualPromptLanguage: "project_language_chinese_first",
      requiredChecks: [
        "schema",
        "asset_refs",
        "script_breakdown",
        "storyboard_continuity",
        "visual_prompt_generability",
        "media_provenance",
        "operator_writeback_verification",
      ],
      forbiddenActions: [
        "bypass_existing_production_pipeline",
        "hardcode_project_specific_data",
        "overwrite_without_reloading_project",
        "fake_generated_media",
        "delete_failure_records",
      ],
    },
  };
};
