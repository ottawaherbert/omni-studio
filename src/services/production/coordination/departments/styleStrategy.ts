import type { Project } from "../../../../types/project";
import type {
  ProductionDepartmentFinding,
  ProductionQAIssue,
  ProductionStageType,
} from "../../../../types/production";
import type { OperatorArtifactEnvelope } from "../../../operator/types";
import type { ProductionCoordinationSnapshot } from "../../productionCoordination";
import { validateStoryboardStrategyDraft, type StoryboardStrategyDraft } from "../../storyboardStrategyDraft";
import {
  validateStoryboardStrategyDraftTrial,
  type StoryboardStrategyDraftTrial,
} from "../../storyboardStrategyTrial";
import type { StyleLockChangeOrder, VisualStyleLockCandidate } from "../../styleReference";
import type { StoryboardBoardPanel } from "../../videoStoryboardArtifacts";
import { collectProductionCoordinationArtifacts } from "../artifacts";
import {
  asArray,
  compact,
  coordinationIssue,
  departmentFindingFromIssues,
  refsForSnapshot,
} from "../shared";

const styleStrategyStageTypes = new Set<ProductionStageType>([
  "production_asset_detail",
  "asset_sync",
  "storyboard",
  "prompt",
  "expensive_generation_planning",
]);

const styleLockVersionForProject = (project: Project) =>
  compact(project.visualStyleLock?.version) ||
  (project.visualStyleLock?.lockedAt ? `visual-style-lock.${project.visualStyleLock.lockedAt}` : "");

const isExpensiveGenerationStage = (stageType?: ProductionStageType) =>
  stageType === "expensive_generation_planning";

const extractVisualStyleLockCandidate = (artifact: OperatorArtifactEnvelope): VisualStyleLockCandidate | undefined => {
  const data: any = artifact.data;
  const candidate = data?.visualStyleLockCandidate || data?.styleLockCandidate ||
    (artifact.kind === "visual_style_lock_candidate" ? data?.candidate || data : undefined);
  return candidate?.schemaVersion === "visual-style-lock-candidate.v1" ? candidate : undefined;
};

const extractStyleLockChangeOrder = (artifact: OperatorArtifactEnvelope): StyleLockChangeOrder | undefined => {
  const data: any = artifact.data;
  const order = data?.styleLockChangeOrder || data?.changeOrder || data?.order ||
    (artifact.kind === "style_lock_change_order" ? data : undefined);
  return order?.schemaVersion === "style-lock-change-order.v1" ? order : undefined;
};

const extractStoryboardStrategyDraft = (artifact: OperatorArtifactEnvelope): StoryboardStrategyDraft | undefined => {
  const data: any = artifact.data;
  const draft = data?.storyboardStrategyDraft || data?.strategyDraft ||
    (artifact.kind === "storyboard_strategy_draft" ? data?.draft || data : undefined);
  return draft?.schemaVersion === "storyboard-strategy-draft.v1" ? draft : undefined;
};

const extractStoryboardStrategyDraftTrial = (artifact: OperatorArtifactEnvelope): StoryboardStrategyDraftTrial | undefined => {
  const data: any = artifact.data;
  const trial = data?.storyboardStrategyDraftTrial || data?.strategyTrial || data?.trial ||
    (artifact.kind === "storyboard_strategy_draft_trial" ? data : undefined);
  return trial?.schemaVersion === "storyboard-strategy-draft-trial.v1" ? trial : undefined;
};

export const runStyleStrategyCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => {
  const bundle = collectProductionCoordinationArtifacts(snapshot.operatorArtifacts);
  const issues: ProductionQAIssue[] = [];
  const styleLockVersion = styleLockVersionForProject(snapshot.project);
  const visualStyleLock = snapshot.project.visualStyleLock;
  const sourceRefs = asArray<string>(visualStyleLock?.styleSourceRefs);
  const strictStage = isExpensiveGenerationStage(snapshot.stageType);
  const stageRequiresStyle = !snapshot.stageType || styleStrategyStageTypes.has(snapshot.stageType);
  const candidates = snapshot.operatorArtifacts
    .map((artifact) => ({ artifact, candidate: extractVisualStyleLockCandidate(artifact) }))
    .filter((item): item is { artifact: OperatorArtifactEnvelope; candidate: VisualStyleLockCandidate } => Boolean(item.candidate));
  const changeOrders = snapshot.operatorArtifacts
    .map((artifact) => ({ artifact, order: extractStyleLockChangeOrder(artifact) }))
    .filter((item): item is { artifact: OperatorArtifactEnvelope; order: StyleLockChangeOrder } => Boolean(item.order));
  const committedStyleCandidateIds = new Set(changeOrders
    .filter((item) => item.artifact.status === "committed" && item.order.approvalState === "approved")
    .map((item) => item.order.sourceCandidateId)
    .filter(Boolean));
  const strategyDrafts = snapshot.operatorArtifacts
    .map((artifact) => ({ artifact, draft: extractStoryboardStrategyDraft(artifact) }))
    .filter((item): item is { artifact: OperatorArtifactEnvelope; draft: StoryboardStrategyDraft } => Boolean(item.draft));
  const strategyDraftById = new Map(strategyDrafts.map((item) => [item.draft.id, item]));
  const strategyDraftTrials = snapshot.operatorArtifacts
    .map((artifact) => ({ artifact, trial: extractStoryboardStrategyDraftTrial(artifact) }))
    .filter((item): item is { artifact: OperatorArtifactEnvelope; trial: StoryboardStrategyDraftTrial } => Boolean(item.trial));
  const passedTrialDraftIds = new Set(strategyDraftTrials
    .filter((item) => item.trial.status === "passed" && item.trial.blockingIssueCount === 0)
    .map((item) => item.trial.draftId));

  if (stageRequiresStyle && !visualStyleLock) {
    issues.push(coordinationIssue(
      "project.visualStyleLock",
      "当前项目没有显式 visualStyleLock，故事板/参考包/视频单元只能继承模糊视觉设定。",
      "warning",
      "在项目创建、Bible 或 Operator 风格参考流程中补齐 visualStyleLock；至少声明媒介、渲染方式、色彩/灯光/镜头语言和 no-source-copy 边界。",
      {
        issueType: "style_strategy_coordination",
        resolutionClass: "soft_hold",
      },
    ));
  }
  if (visualStyleLock && visualStyleLock.humanApprovalState && visualStyleLock.humanApprovalState !== "approved") {
    issues.push(coordinationIssue(
      "project.visualStyleLock.humanApprovalState",
      `当前 visualStyleLock 仍处于 ${visualStyleLock.humanApprovalState}，正式生产前应由导演/制片确认。`,
      visualStyleLock.humanApprovalState === "rejected" ? "blocking" : "warning",
      "通过 approved style_lock_change_order 或人工确认把项目风格锁状态推进到 approved；如拒绝则回退到上一版风格锁。",
      {
        issueType: "style_strategy_coordination",
        retryable: visualStyleLock.humanApprovalState !== "rejected",
        resolutionClass: visualStyleLock.humanApprovalState === "rejected" ? "hard_blocking" : "soft_hold",
      },
    ));
  }
  if (sourceRefs.length > 0 && !asArray<string>(visualStyleLock?.noSourceCopyRules).length) {
    issues.push(coordinationIssue(
      "project.visualStyleLock.noSourceCopyRules",
      "当前风格锁含参考图来源，但缺少 noSourceCopyRules。",
      "warning",
      "补充不得复制参考图人物、具体场景、logo、水印、独有道具或具体构图的边界。",
      {
        issueType: "style_strategy_coordination",
        resolutionClass: "soft_hold",
      },
    ));
  }

  for (const { artifact, candidate } of candidates) {
    const candidateResolvedByChangeOrder = committedStyleCandidateIds.has(candidate.id);
    if (!["rejected"].includes(candidate.approvalState) && artifact.status !== "committed" && !candidateResolvedByChangeOrder) {
      issues.push(coordinationIssue(
        `operatorArtifacts.${artifact.id}.visual_style_lock_candidate`,
        `风格候选 ${candidate.id} 尚未通过 style_lock_change_order 落定，不能被当作项目风格事实源。`,
        "warning",
        "如果要采用该候选，请创建 style_lock_change_order 并由人工批准；否则标记 rejected 或保留为参考。",
        {
          issueType: "style_strategy_coordination",
          retryable: false,
          resolutionClass: "soft_hold",
        },
      ));
    }
  }
  for (const { artifact, order } of changeOrders) {
    if (order.approvalState === "pending_review") {
      issues.push(coordinationIssue(
        `operatorArtifacts.${artifact.id}.style_lock_change_order`,
        `风格锁变更单 ${order.id} 仍在 pending_review，相关下游 artifact 需要保持复核状态。`,
        "warning",
        "由导演/制片批准、拒绝或要求重做该 style_lock_change_order。",
        {
          issueType: "style_strategy_coordination",
          retryable: false,
          resolutionClass: "soft_hold",
        },
      ));
    }
    if (order.approvalState === "approved" && artifact.status !== "committed") {
      issues.push(coordinationIssue(
        `operatorArtifacts.${artifact.id}.style_lock_change_order`,
        `风格锁变更单 ${order.id} 已 approved 但尚未 committed，project.visualStyleLock 可能仍是旧版。`,
        "warning",
        "提交该 style_lock_change_order 或撤销批准；提交后重跑/复核受影响的资产板、故事板、参考包和视频单元。",
        {
          issueType: "style_strategy_coordination",
          retryable: false,
          resolutionClass: "soft_hold",
        },
      ));
    }
  }

  const checkStyleVersion = (
    target: string,
    actualVersion: string | undefined,
    artifactLabel: string,
  ) => {
    if (!styleLockVersion) return;
    if (!compact(actualVersion)) {
      issues.push(coordinationIssue(
        target,
        `${artifactLabel} 缺少 styleLockVersion，无法判断是否继承当前项目风格锁。`,
        strictStage ? "blocking" : "warning",
        "重新生成或修补该 artifact，写入当前 project.visualStyleLock.version/lockedAt 对应的 styleLockVersion。",
        {
          issueType: "style_strategy_coordination",
          retryable: true,
          resolutionClass: strictStage ? "hard_blocking" : "auto_repairable",
        },
      ));
      return;
    }
    if (actualVersion !== styleLockVersion) {
      issues.push(coordinationIssue(
        target,
        `${artifactLabel} 的 styleLockVersion=${actualVersion} 与当前项目风格锁 ${styleLockVersion} 不一致。`,
        strictStage ? "blocking" : "warning",
        "按当前风格锁局部重跑 storyboard_board、asset_reference_pack 或 video_generation_unit，并重新 QA。",
        {
          issueType: "style_strategy_coordination",
          retryable: true,
          resolutionClass: strictStage ? "hard_blocking" : "auto_repairable",
        },
      ));
    }
  };

  for (const board of bundle.storyboardBoards) {
    checkStyleVersion(`storyboardBoard.${board.id}.styleLockVersion`, board.styleLockVersion, `故事板 ${board.id}`);
    if (!board.strategyOrigin) {
      issues.push(coordinationIssue(
        `storyboardBoard.${board.id}.strategyOrigin`,
        `故事板 ${board.id} 缺少 strategyOrigin，无法判断是否来自内置策略或项目草案。`,
        "warning",
        "重新生成 StoryboardBoard，写入 strategyOrigin=built_in/project_local/production_block_local/scene_range_local/global_candidate。",
        { issueType: "style_strategy_coordination", resolutionClass: "auto_repairable" },
      ));
    }
    if (board.strategyOrigin && board.strategyOrigin !== "built_in") {
      if (!board.strategyDraftId) {
        issues.push(coordinationIssue(
          `storyboardBoard.${board.id}.strategyDraftId`,
          `故事板 ${board.id} 使用 ${board.strategyOrigin} 策略，但没有绑定 storyboard_strategy_draft。`,
          strictStage ? "blocking" : "warning",
          "创建并 QA `storyboard_strategy_draft`，或回退到内置故事板策略后重跑该 StoryboardBoard。",
          {
            issueType: "style_strategy_coordination",
            retryable: true,
            resolutionClass: strictStage ? "hard_blocking" : "auto_repairable",
          },
        ));
      } else {
        const draftItem = strategyDraftById.get(board.strategyDraftId);
        if (!draftItem) {
          issues.push(coordinationIssue(
            `storyboardBoard.${board.id}.strategyDraftId`,
            `故事板 ${board.id} 绑定的 storyboard_strategy_draft=${board.strategyDraftId} 不存在于当前 Operator artifacts。`,
            strictStage ? "blocking" : "warning",
            "补交对应 storyboard_strategy_draft artifact 并自动 QA，或回退到内置策略。",
            {
              issueType: "style_strategy_coordination",
              retryable: true,
              resolutionClass: strictStage ? "hard_blocking" : "auto_repairable",
            },
          ));
        } else {
          issues.push(...validateStoryboardStrategyDraft(draftItem.draft).map((draftIssue) => coordinationIssue(
            `storyboardStrategyDraft.${draftItem.draft.id}`,
            draftIssue.message,
            draftIssue.severity,
            draftIssue.repairInstruction || draftIssue.message,
            {
              issueType: "style_strategy_coordination",
              retryable: draftIssue.retryable,
              fingerprint: draftIssue.fingerprint || `style_strategy:draft:${draftItem.draft.id}:${draftIssue.target}`,
              resolutionClass: draftIssue.resolutionClass,
            },
          )));
          if (!["approved", "promoted"].includes(draftItem.draft.status)) {
            issues.push(coordinationIssue(
              `storyboardStrategyDraft.${draftItem.draft.id}.status`,
              `项目级故事板策略草案 ${draftItem.draft.id} 状态为 ${draftItem.draft.status}，不能作为稳定生产模板。`,
              strictStage ? "blocking" : "warning",
              "先完成样本试跑、自动 QA 和人工批准；未批准前使用 fallbackStrategyId。",
              {
                issueType: "style_strategy_coordination",
                retryable: false,
                resolutionClass: strictStage ? "hard_blocking" : "soft_hold",
              },
            ));
          }
          if (!passedTrialDraftIds.has(draftItem.draft.id)) {
            issues.push(coordinationIssue(
              `storyboardStrategyDraft.${draftItem.draft.id}.trial`,
              `项目级故事板策略草案 ${draftItem.draft.id} 尚未提交通过的 storyboard_strategy_draft_trial。`,
              strictStage ? "blocking" : "warning",
              "先用真实 scene/video unit 渲染样本 storyboard_board，保存 storyboard_strategy_draft_trial artifact 并自动 QA；失败时回退到 fallbackStrategyId。",
              {
                issueType: "style_strategy_coordination",
                retryable: true,
                resolutionClass: strictStage ? "hard_blocking" : "auto_repairable",
              },
            ));
          }
        }
      }
    }
    if (asArray<StoryboardBoardPanel>(board.panels).some((panel) => !asArray<string>(panel.annotationLegendIds).length)) {
      issues.push(coordinationIssue(
        `storyboardBoard.${board.id}.panels.annotationLegendIds`,
        `故事板 ${board.id} 存在 panel 缺少 annotationLegendIds，后续模型难以区分动作、镜头、灯光、声音和镜头笔记。`,
        "warning",
        "为每个 panel 写入 annotationLegendIds，至少包含红色动作、蓝色镜头和黑色镜头笔记。",
        { issueType: "style_strategy_coordination", resolutionClass: "auto_repairable" },
      ));
    }
  }

  for (const pack of bundle.assetReferencePacks) {
    checkStyleVersion(`assetReferencePack.${pack.id}.styleLockVersion`, pack.styleLockVersion, `资产参考包 ${pack.id}`);
    if (!pack.storyboardStrategyOrigin) {
      issues.push(coordinationIssue(
        `assetReferencePack.${pack.id}.storyboardStrategyOrigin`,
        `资产参考包 ${pack.id} 缺少 storyboardStrategyOrigin，无法追溯该包对应的故事板策略。`,
        "warning",
        "重新投影 asset_reference_pack，保留 storyBoard strategy origin/id、styleLockVersion 和 visualStyleLockRefs。",
        { issueType: "style_strategy_coordination", resolutionClass: "auto_repairable" },
      ));
    }
  }

  for (const unit of bundle.videoGenerationUnits) {
    checkStyleVersion(`videoGenerationUnit.${unit.id}.styleLockVersion`, unit.styleLockVersion, `视频生成单元 ${unit.id}`);
    if (!unit.storyboardStrategyId) {
      issues.push(coordinationIssue(
        `videoGenerationUnit.${unit.id}.storyboardStrategyId`,
        `视频生成单元 ${unit.id} 缺少 storyboardStrategyId，媒体生成前无法追溯故事板模板来源。`,
        strictStage ? "blocking" : "warning",
        "从绑定 StoryboardBoard 继承 selectedStrategyId/selectedStrategyVersion 后重新 QA。",
        {
          issueType: "style_strategy_coordination",
          retryable: true,
          resolutionClass: strictStage ? "hard_blocking" : "auto_repairable",
        },
      ));
    }
    if (!unit.storyboardStrategyOrigin) {
      issues.push(coordinationIssue(
        `videoGenerationUnit.${unit.id}.storyboardStrategyOrigin`,
        `视频生成单元 ${unit.id} 缺少 storyboardStrategyOrigin。`,
        strictStage ? "blocking" : "warning",
        "从绑定 StoryboardBoard/AssetReferencePack 继承 strategyOrigin 后重新 QA。",
        {
          issueType: "style_strategy_coordination",
          retryable: true,
          resolutionClass: strictStage ? "hard_blocking" : "auto_repairable",
        },
      ));
    }
    if (!asArray<string>(unit.annotationLegendIds).length) {
      issues.push(coordinationIssue(
        `videoGenerationUnit.${unit.id}.annotationLegendIds`,
        `视频生成单元 ${unit.id} 缺少 annotationLegendIds，无法证明已继承故事板标注体系。`,
        strictStage ? "blocking" : "warning",
        "从 StoryboardBoard.arrowLegendIds 继承 annotationLegendIds，并保留 annotationLegendVersion。",
        {
          issueType: "style_strategy_coordination",
          retryable: true,
          resolutionClass: strictStage ? "hard_blocking" : "auto_repairable",
        },
      ));
    }
  }

  for (const { trial } of strategyDraftTrials) {
    issues.push(...validateStoryboardStrategyDraftTrial(trial).map((trialIssue) => coordinationIssue(
      `storyboardStrategyDraftTrial.${trial.id}`,
      trialIssue.message,
      trialIssue.severity,
      trialIssue.repairInstruction || trialIssue.message,
      {
        issueType: "style_strategy_coordination",
        retryable: trialIssue.retryable,
        fingerprint: trialIssue.fingerprint || `style_strategy:strategy_trial:${trial.id}:${trialIssue.target}`,
        resolutionClass: trialIssue.resolutionClass,
      },
    )));
    if (trial.status === "failed") {
      issues.push(coordinationIssue(
        `storyboardStrategyDraftTrial.${trial.id}.status`,
        `故事板策略草案试跑 ${trial.id} 失败，不能扩大使用。`,
        strictStage ? "blocking" : "warning",
        "修复草案或样本场景后重新试跑；正式生产先使用 fallbackStrategyId。",
        {
          issueType: "style_strategy_coordination",
          retryable: true,
          resolutionClass: strictStage ? "hard_blocking" : "auto_repairable",
        },
      ));
    }
  }

  return departmentFindingFromIssues({
    department: "style_strategy",
    issues,
    passedMessage: "风格锁和故事板策略统筹未发现当前范围的结构性缺口。",
    target: "coordination.style_strategy",
    ownerAgentId: "production.style_strategy.supervisor",
    suggestedStageType: snapshot.stageType || "storyboard",
    evidenceRefs: refsForSnapshot(snapshot),
  });
};
