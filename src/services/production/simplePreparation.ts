import type { Episode, ManualFilmTeamDepartment, ManualFilmTeamOutput, ManualFilmTeamPromptAudit, Project, SimplePreparationKind, SimplePreparationPlan, SimplePreparationReview } from '../../types/project';
import { manualFilmTeamUnitScenes, manualFilmTeamSceneSource, manualFilmTeamScriptHash, manualFilmTeamUnitSource, manualFilmTeamFullScriptHash, manualFilmTeamBreakdownHash } from './manualFilmTeam';

export const SIMPLE_PREPARATION_SECTIONS: Record<SimplePreparationKind, { label: string; fields: Record<string, string>; departments: ManualFilmTeamDepartment[] }> = {
  creative: { label: '制作方案', fields: { direction: '导演与表演', camera: '摄影与灯光', sound: '声音与音乐', continuity: '叙事与动作衔接' }, departments: ['directing', 'performance_directing', 'cinematography', 'lighting', 'sound_music'] },
  assets: { label: '视觉资产方案', fields: { design: '场景与美术', character: '服装与妆发', props: '道具与持有关系', continuity: '资产状态连续性' }, departments: ['production_design', 'wardrobe', 'makeup_hair', 'props'] },
  action: { label: '动作专项', fields: { action: '动作因果与空间', continuity: '动作前后状态' }, departments: ['action_choreography'] },
};

const fieldForDepartment: Partial<Record<ManualFilmTeamDepartment, string>> = {
  directing: 'direction', performance_directing: 'direction', cinematography: 'camera', lighting: 'camera', sound_music: 'sound',
  production_design: 'design', wardrobe: 'character', makeup_hair: 'character', props: 'props', action_choreography: 'action',
};
const list = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${label} 必须是文本数组；没有内容时填写 []。`);
  return value.map(item => item.trim()).filter(Boolean);
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fields = (value: unknown, kind: SimplePreparationKind, label: string) => {
  const row = object(value);
  const allowed = Object.keys(SIMPLE_PREPARATION_SECTIONS[kind].fields);
  if (Object.keys(row).some(key => !allowed.includes(key))) throw new Error(`${label} 存在不支持的字段，请使用提示词给出的字段。`);
  return Object.fromEntries(allowed.map(key => [key, list(row[key], `${label}.${key}`)]));
};

export const simplePreparationFingerprint = (episode: Episode) => manualFilmTeamScriptHash(JSON.stringify({
  scenes: manualFilmTeamUnitScenes(episode).map(scene => ({ id: scene.id, source: manualFilmTeamSceneSource(scene).text, breakdown: scene.breakdown })),
  outputs: (episode.productionTeam?.outputs || []).map(output => ({ department: output.department, version: output.version, updatedAt: output.updatedAt, status: output.status })),
}));

export const simplePreparationAssetIds = (project: Project) => [
  ...(project.characters || []), ...(project.assets || []),
].map(asset => asset.id);

/** Bound model output by scene batches, not by a separate task per department. */
export const simplePreparationBatches = (episode: Episode) => {
  const batches: string[][] = [];
  let current: string[] = [], chars = 0;
  for (const scene of manualFilmTeamUnitScenes(episode)) {
    const size = manualFilmTeamSceneSource(scene).text.length;
    if (current.length && (current.length >= 12 || chars + size > 12_000)) { batches.push(current); current = []; chars = 0; }
    current.push(scene.id); chars += size;
  }
  if (current.length) batches.push(current);
  return batches;
};

export const normalizeSimplePreparationPlan = (raw: unknown, kind: SimplePreparationKind, sceneIds: string[], assetIds: string[], audit: ManualFilmTeamPromptAudit): SimplePreparationPlan => {
  const root = object(raw);
  if (!sceneIds.length) throw new Error('请先选择有剧本内容的场次。');
  if (!Array.isArray(root.scenes)) throw new Error('返回值缺少 scenes 数组。');
  const seen = new Set<string>();
  const scenes = root.scenes.map((value, index) => {
    const row = object(value);
    const sceneId = typeof row.sceneId === 'string' ? row.sceneId : '';
    if (!sceneIds.includes(sceneId)) throw new Error(`第 ${index + 1} 条引用了当前范围之外的 sceneId。请保留提示词中的原样 ID。`);
    if (seen.has(sceneId)) throw new Error(`场次 ${sceneIds.indexOf(sceneId) + 1} 重复返回。`);
    seen.add(sceneId);
    const ids = list(row.assetIds, `第 ${index + 1} 场 assetIds`);
    if (ids.some(id => !assetIds.includes(id))) throw new Error(`第 ${index + 1} 场引用了不存在的资产 ID。新资产需求请写进方案，不要编造 ID。`);
    return { sceneId, notes: fields(row.notes, kind, `第 ${index + 1} 场 notes`), assetIds: [...new Set(ids)] };
  });
  if (seen.size !== sceneIds.length) throw new Error(`本次应覆盖 ${sceneIds.length} 场，返回了 ${seen.size} 场。请补齐当前所选范围。`);
  return { kind, shared: fields(root.shared, kind, 'shared'), scenes: sceneIds.map(id => scenes.find(scene => scene.sceneId === id)!), openQuestions: list(root.openQuestions, 'openQuestions'), audit, updatedAt: Date.now() };
};

export const normalizeSimplePreparationReview = (raw: unknown, episode: Episode, sceneIds: string[], audit: ManualFilmTeamPromptAudit): SimplePreparationReview => {
  const root = object(raw);
  const reviewed = list(root.reviewedSceneIds, 'reviewedSceneIds');
  if (reviewed.length !== sceneIds.length || new Set(reviewed).size !== sceneIds.length || reviewed.some(id => !sceneIds.includes(id))) throw new Error('综合检查必须逐一覆盖本次所选场次，不能遗漏或重复。');
  if (typeof root.summary !== 'string' || !root.summary.trim() || !Array.isArray(root.issues)) throw new Error('综合检查需要 summary 和 issues；无问题时 issues 填 []。');
  const issues = root.issues.map((value, index) => {
    const row = object(value);
    if (!['creative', 'assets', 'action'].includes(String(row.kind)) || !['blocking', 'warning', 'advisory'].includes(String(row.severity))) throw new Error(`第 ${index + 1} 个问题的 kind 或 severity 不正确。`);
    const ids = list(row.sceneIds, `问题 ${index + 1} 的 sceneIds`);
    if (!ids.length || ids.some(id => !sceneIds.includes(id))) throw new Error(`第 ${index + 1} 个问题必须定位到本次检查范围内的场次。`);
    for (const key of ['description', 'suggestion', 'sourceEvidence']) if (typeof row[key] !== 'string' || !(row[key] as string).trim()) throw new Error(`第 ${index + 1} 个问题缺少 ${key}。`);
    return { id: crypto.randomUUID(), kind: row.kind as SimplePreparationKind, severity: row.severity as 'blocking' | 'warning' | 'advisory', sceneIds: [...new Set(ids)], description: (row.description as string).trim(), suggestion: (row.suggestion as string).trim(), sourceEvidence: (row.sourceEvidence as string).trim() };
  });
  return { summary: root.summary.trim(), reviewedSceneIds: reviewed, issues, sourceFingerprint: simplePreparationFingerprint(episode), audit, updatedAt: Date.now() };
};

export const simplePreparationPlanSceneIds = (episode: Episode, kind: SimplePreparationKind) => {
  const departments = SIMPLE_PREPARATION_SECTIONS[kind].departments;
  return manualFilmTeamUnitScenes(episode).filter(scene => departments.every(department => episode.productionTeam?.outputs.some(output => output.department === department && output.status === 'confirmed' && output.scenePlans?.some(plan => plan.sceneId === scene.id)))).map(scene => scene.id);
};

export const simplePreparationReady = (episode: Episode) => {
  const count = manualFilmTeamUnitScenes(episode).length;
  return count > 0 && (['creative', 'assets'] as const).every(kind => simplePreparationPlanSceneIds(episode, kind).length === count);
};

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/** The adopted department outputs are authoritative, including edits made in professional mode. */
export const readSimplePreparationPlan = (episode: Episode, kind: SimplePreparationKind): SimplePreparationPlan | undefined => {
  const section = SIMPLE_PREPARATION_SECTIONS[kind];
  const outputs = (episode.productionTeam?.outputs || []).filter(output => section.departments.includes(output.department) && output.status === 'confirmed');
  if (!outputs.length) return undefined;
  const prior = episode.simplePreparation?.plans[kind];
  const keys = Object.keys(section.fields);
  const notes = (sceneId: string, key: string) => unique(outputs.flatMap(output => {
    const row = output.scenePlans?.find(item => item.sceneId === sceneId);
    if (!row) return [];
    if (key === 'continuity') return row.continuityNotes || [];
    if (fieldForDepartment[output.department] !== key) return [];
    return [...(row.executionNotes?.length ? row.executionNotes : [row.summary]), ...(row.assetNeeds || []), ...(row.handoffNotes || [])];
  }));
  return {
    kind,
    shared: Object.fromEntries(keys.map(key => [key, key === 'continuity' ? prior?.shared.continuity || [] : unique(outputs.filter(output => fieldForDepartment[output.department] === key).flatMap(output => output.content.split('\n')))])),
    scenes: manualFilmTeamUnitScenes(episode).filter(scene => outputs.some(output => output.scenePlans?.some(row => row.sceneId === scene.id))).map(scene => ({ sceneId: scene.id, notes: Object.fromEntries(keys.map(key => [key, notes(scene.id, key)])), assetIds: prior?.scenes.find(row => row.sceneId === scene.id)?.assetIds || [] })),
    openQuestions: unique(outputs.flatMap(output => output.openQuestions || [])),
    audit: outputs[0].audit,
    updatedAt: Math.max(...outputs.map(output => output.updatedAt)),
  };
};

/** Projects an adopted combined plan into existing downstream contracts without fabricating QA. */
export const adoptSimplePreparationPlan = (project: Project, episode: Episode, candidate: SimplePreparationPlan): Partial<Episode> => {
  const now = Date.now();
  const workspace = episode.simplePreparation || { plans: {}, history: [] };
  const prior = readSimplePreparationPlan(episode, candidate.kind);
  const scope = new Set(candidate.scenes.map(scene => scene.sceneId));
  const unitScenes = manualFilmTeamUnitScenes(episode);
  if (candidate.scenes.some(scene => !unitScenes.some(item => item.id === scene.sceneId))) throw new Error('场次列表已变化，请重新生成当前范围。');
  const source = manualFilmTeamUnitSource(project, episode);
  const sourceScriptHash = manualFilmTeamScriptHash(source.text);
  const fullScriptHash = manualFilmTeamFullScriptHash(project);
  const sourceBreakdownHash = manualFilmTeamBreakdownHash(episode);
  const plan: SimplePreparationPlan = { ...candidate,
    shared: prior && scope.size < unitScenes.length ? prior.shared : candidate.shared,
    openQuestions: prior && scope.size < unitScenes.length ? [...new Set([...prior.openQuestions, ...candidate.openQuestions])] : candidate.openQuestions,
    scenes: [...(prior?.scenes || []).filter(scene => !scope.has(scene.sceneId) && unitScenes.some(item => item.id === scene.sceneId)), ...candidate.scenes] };
  const plans = { ...workspace.plans, [candidate.kind]: plan };
  const adoptedPlans = (Object.keys(SIMPLE_PREPARATION_SECTIONS) as SimplePreparationKind[]).map(kind => kind === candidate.kind ? plan : readSimplePreparationPlan(episode, kind)).filter((item): item is SimplePreparationPlan => Boolean(item));
  const replaced = new Set<ManualFilmTeamDepartment>([...SIMPLE_PREPARATION_SECTIONS[candidate.kind].departments, 'continuity', 'production_coordination']);
  const previousOutputs = (episode.productionTeam?.outputs || []).filter(output => replaced.has(output.department));
  const outputs = (episode.productionTeam?.outputs || []).filter(output => !replaced.has(output.department));
  for (const department of replaced) {
    const previous = previousOutputs.find(output => output.department === department);
    const field = fieldForDepartment[department];
    const aggregate = department === 'continuity' || department === 'production_coordination';
    const shared = aggregate
      ? unique(adoptedPlans.flatMap(item => [...(item.shared.continuity || []), ...item.openQuestions]))
      : plan.shared[field!] || [];
    const scenePlans = unitScenes.flatMap(scene => {
      const row = plan.scenes.find(item => item.sceneId === scene.id);
      if (!scope.has(scene.id)) {
        const old = previous?.scenePlans?.find(item => item.sceneId === scene.id);
        return old ? [old] : [];
      }
      const relevant = aggregate ? adoptedPlans.flatMap(item => item.scenes.filter(row => row.sceneId === scene.id)) : row ? [row] : [];
      if (!relevant.length) return [];
      const notes = aggregate ? unique(relevant.flatMap(row => row.notes.continuity || [])) : row?.notes[field!] || [];
      const continuity = unique(relevant.flatMap(row => row.notes.continuity || []));
      return [{ sceneId: scene.id, sceneTitle: scene.title, summary: notes.join('\n'), executionNotes: notes, assetNeeds: candidate.kind === 'assets' && !aggregate ? notes : [], continuityNotes: continuity, handoffNotes: [] }];
    });
    outputs.push({ department, preparationOrigin: 'simple', ...(department === 'production_coordination' ? { coordinationPhase: 'wrap' as const } : {}),
      sourceScriptHash, sourceBreakdownHash, fullScriptHash, sourceSceneIds: unitScenes.map(scene => scene.id),
      taskSummary: aggregate ? '已采用方案中的连续性与待确认事项' : SIMPLE_PREPARATION_SECTIONS[candidate.kind].label,
      content: previous && scope.size < unitScenes.length ? previous.content : shared.join('\n'), scenePlans,
      openQuestions: unique([...(scope.size < unitScenes.length ? previous?.openQuestions || [] : []), ...(aggregate ? adoptedPlans.flatMap(item => item.openQuestions) : plan.openQuestions)]),
      handoffNotes: previous?.handoffNotes || [], handoffs: previous?.handoffs || [], status: 'confirmed', version: (previous?.version || 0) + 1,
      audit: candidate.audit, updatedAt: now, confirmedAt: now });
  }
  return {
    productionTeam: { schemaVersion: 'manual-film-team.v2', episodeId: episode.id, sourceDocumentId: source.sourceDocumentId, sourceScriptHash, sourceBreakdownHash, fullScriptHash, sourceSceneIds: unitScenes.map(scene => scene.id), outputs, updatedAt: now },
    simplePreparation: { ...workspace, plans, history: [...workspace.history, { at: now, kind: candidate.kind, plan: prior, outputs: previousOutputs }] },
  };
};

export const mergeSimplePreparationReview = (episode: Episode, review: SimplePreparationReview) => {
  const old = episode.simplePreparation?.review;
  if (!old) return review;
  const scope = new Set(review.reviewedSceneIds);
  const sameSource = old.sourceFingerprint === review.sourceFingerprint;
  return { ...review,
    reviewedSceneIds: sameSource ? unique([...old.reviewedSceneIds, ...review.reviewedSceneIds]) : review.reviewedSceneIds,
    issues: [...old.issues.filter(issue => !issue.sceneIds.every(id => scope.has(id))).map(issue => ({ ...issue, stale: issue.stale || !sameSource })), ...review.issues],
  };
};
