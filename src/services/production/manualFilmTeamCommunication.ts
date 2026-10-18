import { sha256 } from "js-sha256";
import type {
  Episode,
  ManualFilmTeamDepartment,
  ManualFilmTeamHandoff,
  ManualFilmTeamHandoffPriority,
  ManualFilmTeamOutput,
} from "../../types/project";
import {
  MANUAL_FILM_TEAM_DEPARTMENTS,
  manualFilmTeamDepartment,
  manualFilmTeamOutputFor,
} from "./manualFilmTeam";

export interface ManualFilmTeamCollaborationWave {
  id: string;
  name: string;
  purpose: string;
  departments: ManualFilmTeamDepartment[];
}

export const MANUAL_FILM_TEAM_COLLABORATION_WAVES: ManualFilmTeamCollaborationWave[] = [
  { id: "creative_lock", name: "创作定调", purpose: "导演先锁定戏剧目标、观众信息与场面表达边界。", departments: ["directing"] },
  { id: "production_brief", name: "统筹与表演", purpose: "制片统筹形成初版依赖，表演指导建立人物行为弧线。", departments: ["production_coordination", "performance_directing"] },
  { id: "world_design", name: "空间与造型基准", purpose: "美术先确定可拍空间、材质、色彩与资产状态规则。", departments: ["production_design"] },
  { id: "physical_design", name: "动作与服装", purpose: "动作和服装把人物行为、危险动作与可见状态落到场次。", departments: ["action_choreography", "wardrobe"] },
  { id: "craft_planning", name: "专业执行", purpose: "摄影、道具、妆发和声音基于已确认约束并行展开。", departments: ["cinematography", "props", "makeup_hair", "sound_music"] },
  { id: "visual_integration", name: "光影整合", purpose: "灯光结合摄影和美术方案完成光源逻辑与跨镜连续性。", departments: ["lighting"] },
  { id: "continuity_wrap", name: "统筹复核与场记收口", purpose: "制片统筹复核全部部门变更，场记完成最终连续性矩阵。", departments: ["continuity"] },
];

export const MANUAL_FILM_TEAM_DEPARTMENT_ORDER = MANUAL_FILM_TEAM_COLLABORATION_WAVES
  .flatMap((wave) => wave.departments);

const dependencies: Record<ManualFilmTeamDepartment, ManualFilmTeamDepartment[]> = {
  directing: [],
  production_coordination: ["directing"],
  performance_directing: ["directing"],
  production_design: ["directing", "production_coordination"],
  action_choreography: ["directing", "production_design", "performance_directing"],
  wardrobe: ["directing", "production_design"],
  cinematography: ["directing", "production_design", "performance_directing", "action_choreography"],
  props: ["production_design", "action_choreography"],
  makeup_hair: ["wardrobe", "performance_directing"],
  sound_music: ["directing", "performance_directing", "action_choreography"],
  lighting: ["cinematography", "production_design"],
  continuity: MANUAL_FILM_TEAM_DEPARTMENTS
    .map((department) => department.id)
    .filter((department) => department !== "continuity"),
};

const reviewPeers: Record<ManualFilmTeamDepartment, ManualFilmTeamDepartment[]> = {
  directing: [],
  production_coordination: ["directing"],
  performance_directing: ["directing"],
  production_design: ["directing", "production_coordination"],
  action_choreography: ["directing", "production_design", "performance_directing"],
  wardrobe: ["directing", "production_design"],
  cinematography: ["directing", "production_design", "performance_directing", "action_choreography"],
  props: ["production_design", "action_choreography"],
  makeup_hair: ["wardrobe", "performance_directing"],
  sound_music: ["directing", "performance_directing", "action_choreography"],
  lighting: ["cinematography", "production_design"],
  continuity: MANUAL_FILM_TEAM_DEPARTMENTS
    .map((department) => department.id)
    .filter((department) => department !== "continuity"),
};

const closingCoordinationPeers = MANUAL_FILM_TEAM_DEPARTMENTS
  .map((department) => department.id)
  .filter((department) => department !== "production_coordination" && department !== "continuity");

const isConfirmed = (output?: ManualFilmTeamOutput) => output?.status === "confirmed";

export const manualFilmTeamCoordinationPhaseFor = (
  episode: Episode,
  department: ManualFilmTeamDepartment,
): ManualFilmTeamOutput["coordinationPhase"] => {
  if (department !== "production_coordination") return undefined;
  return closingCoordinationPeers.every((peer) => isConfirmed(manualFilmTeamOutputFor(episode, peer)))
    ? "wrap"
    : "planning";
};

const isClosingCoordinationOutput = (
  episode: Episode,
  output?: ManualFilmTeamOutput,
) => {
  if (output?.department !== "production_coordination") return false;
  if (output.coordinationPhase === "wrap") return true;

  // v2 projects created before coordinationPhase was added remain readable. A
  // coordinator result that reviewed every craft is semantically a wrap pass.
  return closingCoordinationPeers.every((peer) => (
    (output.collaborationSourceVersions?.[peer] || 0) > 0
  ));
};

export const manualFilmTeamUnresolvedWrapHandoffs = (
  episode: Episode,
  output?: ManualFilmTeamOutput,
) => !isClosingCoordinationOutput(episode, output)
  ? []
  : (output?.handoffs || []).filter((handoff) => (
    handoff.priority !== "advisory"
    && handoff.toDepartments.some((department) => department !== "continuity")
  ));

export const manualFilmTeamDependencies = (department: ManualFilmTeamDepartment) =>
  dependencies[department] || [];

export const manualFilmTeamWaveFor = (department: ManualFilmTeamDepartment) =>
  MANUAL_FILM_TEAM_COLLABORATION_WAVES.find((wave) => wave.departments.includes(department))
  || MANUAL_FILM_TEAM_COLLABORATION_WAVES[0];

const text = (value: unknown) => String(value || "").trim();

const departments = (value: unknown, fromDepartment: ManualFilmTeamDepartment) => {
  const allowed = new Set(MANUAL_FILM_TEAM_DEPARTMENTS.map((department) => department.id));
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => text(item) as ManualFilmTeamDepartment)
      .filter((item) => allowed.has(item) && item !== fromDepartment),
  ));
};

export const normalizeManualFilmTeamHandoffs = (
  value: unknown,
  fromDepartment: ManualFilmTeamDepartment,
  _version: number,
): ManualFilmTeamHandoff[] => (Array.isArray(value) ? value : []).flatMap((item) => {
  const source = item && typeof item === "object" ? item as Record<string, unknown> : {};
  const toDepartments = departments(source.toDepartments, fromDepartment);
  const request = text(source.request);
  if (!toDepartments.length || !request) return [];
  const priority: ManualFilmTeamHandoffPriority = source.priority === "blocking" || source.priority === "advisory"
    ? source.priority
    : "review";
  const sceneId = text(source.sceneId) || undefined;
  const topic = text(source.topic) || "跨部门交接";
  return [{
    id: `handoff-${sha256(`${fromDepartment}:${toDepartments.join(",")}:${sceneId || "unit"}:${priority}:${topic}:${request}`).slice(0, 16)}`,
    fromDepartment,
    toDepartments,
    sceneId,
    topic,
    request,
    priority,
  }];
});

export interface ManualFilmTeamRoutedHandoff extends ManualFilmTeamHandoff {
  sourceVersion: number;
  sourceStatus: ManualFilmTeamOutput["status"];
  acknowledged: boolean;
}

const confirmedIncomingHandoffs = (
  episode: Episode,
  target: ManualFilmTeamDepartment,
  targetOutput?: ManualFilmTeamOutput,
): ManualFilmTeamRoutedHandoff[] => (episode.productionTeam?.outputs || []).flatMap((output) => {
  if (!isConfirmed(output)) return [];
  return (output.handoffs || [])
    .filter((handoff) => handoff.toDepartments.includes(target))
    .map((handoff) => ({
      ...handoff,
      sourceVersion: output.version,
      sourceStatus: output.status,
      acknowledged: handoff.priority === "advisory"
        || Boolean(targetOutput?.collaborationHandoffIds?.includes(handoff.id))
        || (targetOutput?.collaborationSourceVersions?.[output.department] || 0) >= output.version,
    }));
});

const defaultPeerIds = (episode: Episode, target: ManualFilmTeamDepartment) => {
  if (target === "production_coordination" && closingCoordinationPeers.every((department) => isConfirmed(manualFilmTeamOutputFor(episode, department)))) {
    return closingCoordinationPeers;
  }
  const closingCoordination = manualFilmTeamOutputFor(episode, "production_coordination");
  return (reviewPeers[target] || []).filter((peer) => (
    peer !== "production_coordination" || !isClosingCoordinationOutput(episode, closingCoordination)
  ));
};

const relevantPeerIds = (episode: Episode, target: ManualFilmTeamDepartment) => {
  const targetOutput = manualFilmTeamOutputFor(episode, target);
  const incomingSources = confirmedIncomingHandoffs(episode, target, targetOutput).map((handoff) => handoff.fromDepartment);
  return Array.from(new Set([...defaultPeerIds(episode, target), ...incomingSources]))
    .filter((department) => department !== target)
    .sort();
};

export interface ManualFilmTeamCollaborationSnapshot {
  hash: string;
  peerVersions: Partial<Record<ManualFilmTeamDepartment, number>>;
  peerOutputs: ManualFilmTeamOutput[];
  incomingHandoffs: ManualFilmTeamRoutedHandoff[];
}

const semanticOutputFingerprint = (output: ManualFilmTeamOutput) => sha256(JSON.stringify({
  department: output.department,
  coordinationPhase: output.coordinationPhase,
  taskSummary: output.taskSummary,
  content: output.content,
  scenePlans: output.scenePlans || [],
  openQuestions: output.openQuestions,
  handoffNotes: output.handoffNotes,
  handoffs: output.handoffs || [],
}));

export const manualFilmTeamCollaborationSnapshot = (
  episode: Episode,
  target: ManualFilmTeamDepartment,
): ManualFilmTeamCollaborationSnapshot => {
  const targetOutput = manualFilmTeamOutputFor(episode, target);
  const peerOutputs = relevantPeerIds(episode, target)
    .map((department) => manualFilmTeamOutputFor(episode, department))
    .filter((output): output is ManualFilmTeamOutput => Boolean(output && isConfirmed(output)));
  const incomingHandoffs = confirmedIncomingHandoffs(episode, target, targetOutput);
  const peerVersions = Object.fromEntries(peerOutputs.map((output) => [output.department, output.version])) as Partial<Record<ManualFilmTeamDepartment, number>>;
  const versionSensitivePeers = new Set(defaultPeerIds(episode, target));
  const source = peerOutputs.flatMap((output) => {
    const actionableHandoffs = incomingHandoffs
      .filter((handoff) => handoff.fromDepartment === output.department && handoff.priority !== "advisory");
    if (!versionSensitivePeers.has(output.department) && !actionableHandoffs.length) return [];
    return [{
      department: output.department,
      ...(versionSensitivePeers.has(output.department) ? {
        fingerprint: semanticOutputFingerprint(output),
      } : {}),
      handoffs: actionableHandoffs
        .map((handoff) => ({ id: handoff.id, priority: handoff.priority, sceneId: handoff.sceneId, request: handoff.request })),
    }];
  });
  return {
    hash: sha256(JSON.stringify(source)),
    peerVersions,
    peerOutputs,
    incomingHandoffs,
  };
};

export const manualFilmTeamCollaborationIsStale = (
  episode: Episode,
  output?: ManualFilmTeamOutput,
) => {
  if (!output?.collaborationSourceHash) return false;
  const snapshot = manualFilmTeamCollaborationSnapshot(episode, output.department);
  if (output.collaborationSourceHash === snapshot.hash) return false;

  // Hash construction can evolve without invalidating a QA-reviewed department result.
  // Fall back to legacy persisted evidence for outputs created before semantic peer hashes.
  const requiredPeersUnchanged = defaultPeerIds(episode, output.department).every((department) => {
    const current = snapshot.peerVersions[department];
    if (current === undefined || output.collaborationSourceVersions?.[department] === current) return true;

    // A confirmed upstream may publish a later execution-only synchronization after this
    // department has closed. Its explicit advisory handoff is the contract that the newer
    // version carries no requested rework; keep it visible without reopening the recipient.
    return snapshot.incomingHandoffs.some((handoff) => (
      handoff.fromDepartment === department
      && handoff.sourceVersion === current
      && handoff.priority === "advisory"
      && handoff.acknowledged
    ));
  });
  const actionableHandoffsAcknowledged = snapshot.incomingHandoffs
    .filter((handoff) => handoff.priority !== "advisory")
    .every((handoff) => Boolean(output.collaborationHandoffIds?.includes(handoff.id))
      || (output.collaborationSourceVersions?.[handoff.fromDepartment] || 0) >= handoff.sourceVersion);

  return !(requiredPeersUnchanged && actionableHandoffsAcknowledged);
};

export const manualFilmTeamPendingCollaborationReviews = (
  episode: Episode,
  departmentOrder: ManualFilmTeamDepartment[] = MANUAL_FILM_TEAM_DEPARTMENT_ORDER,
) => departmentOrder.filter((department) => {
  if (department === "production_coordination" || department === "continuity") return false;
  const output = manualFilmTeamOutputFor(episode, department);
  return Boolean(output && manualFilmTeamCollaborationIsStale(episode, output));
});

export const manualFilmTeamMissingPrerequisites = (
  episode: Episode,
  department: ManualFilmTeamDepartment,
) => manualFilmTeamDependencies(department).filter((dependency) => {
  const output = manualFilmTeamOutputFor(episode, dependency);
  return !isConfirmed(output);
});

/** Confirmation uses the exact peer snapshot already QA-reviewed by this output.
 * A prerequisite reopened by the emitter's own directed handoff must not reverse-block that emitter.
 */
export const manualFilmTeamMissingConfirmationPrerequisites = (
  episode: Episode,
  department: ManualFilmTeamDepartment,
) => manualFilmTeamDependencies(department).filter((dependency) =>
  !isConfirmed(manualFilmTeamOutputFor(episode, dependency)));

export const manualFilmTeamCollaborationContext = (
  episode: Episode,
  department: ManualFilmTeamDepartment,
) => {
  const snapshot = manualFilmTeamCollaborationSnapshot(episode, department);
  const missingPrerequisites = manualFilmTeamMissingPrerequisites(episode, department);
  return JSON.stringify({
    requiredConfirmedDepartments: manualFilmTeamDependencies(department).map((id) => manualFilmTeamDepartment(id).name),
    missingPrerequisites: missingPrerequisites.map((id) => manualFilmTeamDepartment(id).name),
    confirmedPeerBriefs: snapshot.peerOutputs.map((output) => ({
      departmentName: manualFilmTeamDepartment(output.department).name,
      taskSummary: output.taskSummary,
      confirmedPlan: output.content,
    })),
    incomingHandoffs: snapshot.incomingHandoffs.map((handoff) => ({
      fromDepartmentName: manualFilmTeamDepartment(handoff.fromDepartment).name,
      priority: handoff.priority,
      topic: handoff.topic,
      request: handoff.request,
    })),
  }, null, 2);
};

export interface ManualFilmTeamCommunicationState {
  wave: ManualFilmTeamCollaborationWave;
  missingPrerequisites: ManualFilmTeamDepartment[];
  incomingHandoffs: ManualFilmTeamRoutedHandoff[];
  outgoingHandoffs: ManualFilmTeamHandoff[];
  collaborationStale: boolean;
}

export const buildManualFilmTeamCommunicationState = (
  episode: Episode,
  department: ManualFilmTeamDepartment,
): ManualFilmTeamCommunicationState => {
  const output = manualFilmTeamOutputFor(episode, department);
  const snapshot = manualFilmTeamCollaborationSnapshot(episode, department);
  return {
    wave: manualFilmTeamWaveFor(department),
    missingPrerequisites: manualFilmTeamMissingPrerequisites(episode, department),
    incomingHandoffs: snapshot.incomingHandoffs,
    outgoingHandoffs: output?.handoffs || [],
    collaborationStale: manualFilmTeamCollaborationIsStale(episode, output),
  };
};
