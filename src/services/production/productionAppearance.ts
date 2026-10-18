import { sha256 } from 'js-sha256';
import type { AppearanceFields, AssetVariant, Episode, Project, Scene, Shot, ShotAppearanceState } from '../../types/project';

export const appearanceLabels = { clothing: '服装', dirt: '污损', injury: '伤势', hair: '发型', makeup: '妆容', other: '其他外观' } as const;
const fields = Object.keys(appearanceLabels) as Array<keyof AppearanceFields>;
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const appearanceFields = (value: unknown): AppearanceFields => Object.fromEntries(fields.flatMap(key => {
  const text = clean((value as any)?.[key]);
  return text ? [[key, text]] : [];
}));
export const appearanceFingerprint = (value: AppearanceFields) => sha256(JSON.stringify(appearanceFields(value)));
export const appearanceSourceHash = (scene: Scene) => sha256(scene.script || scene.sourceEvidence || scene.description || '');
export const appearanceSummary = (value: AppearanceFields) => fields.flatMap(key => value[key] ? [`${appearanceLabels[key]}：${value[key]}`] : []).join('；') || '沿用基础身份';
export const appearanceOwner = (project: Project, id: string) => project.characters.find(item => item.id === id) || project.assets.find(item => item.id === id);
const identityImage = (owner: NonNullable<ReturnType<typeof appearanceOwner>>) => owner.cleanReferenceImageUrl || owner.defaultReferenceUrl || owner.boardImageUrl || ('referenceImageUrl' in owner ? owner.referenceImageUrl : 'imageUrl' in owner ? owner.imageUrl : undefined) || owner.multiViewUrl;
export const appearanceVisibleIds = (shot: Shot) => [...(shot.characterIdsInShot || []), ...(shot.propIds || []), shot.locationId].filter(Boolean) as string[];
export const appearanceSelectedFields = (state: ShotAppearanceState) => state.imageMoment === 'end' ? state.end : state.start;
export const appearanceSelectedVariantId = (state: ShotAppearanceState) => state.imageMoment === 'end' ? state.endVariantId : state.startVariantId;
export function appearanceReferenceImage(project: Project, state: ShotAppearanceState) {
  const owner = appearanceOwner(project, state.assetId);
  const variantId = appearanceSelectedVariantId(state);
  const variant = owner?.variants?.find(v => v.id === variantId);
  return variant?.cleanReferenceImageUrl || variant?.boardImageUrl || variant?.imageUrl || (!variantId && !Object.keys(appearanceSelectedFields(state)).length && owner ? identityImage(owner) : undefined);
}

/** Changes are patches: changing clothes must not erase an independent injury. */
export function normalizeShotAppearances(project: Project, scene: Scene, shots: Shot[], rawShots: any[], previousShots: Shot[] = []): Shot[] {
  const available = new Map(previousShots.map(shot => [shot.id, shot]));
  const returnedIds = new Map(rawShots.map((raw, index) => [clean(raw.id), shots[index]?.id]));
  const lastByAsset = new Map<string, { shot: Shot; state: ShotAppearanceState }>();
  const source = scene.script || scene.sourceEvidence || scene.description || '';
  return shots.map((shot, index) => {
    const raw = rawShots[index]?.appearance;
    const states: ShotAppearanceState[] = [];
    const seen = new Set<string>();
    for (const item of Array.isArray(raw?.states) ? raw.states : []) {
      const assetId = clean(item.assetId);
      if (seen.has(assetId)) continue;
      seen.add(assetId);
      const owner = appearanceOwner(project, assetId);
      const issues: string[] = [];
      if (!owner) issues.push('未关联项目资产，请先选择正确的角色或物件。');
      if (owner && !appearanceVisibleIds(shot).includes(assetId)) issues.push('此资产没有出现在当前画面中，无需为声音或提及的人物创建外观参考。');
      const origin = item.origin === 'proposal' ? 'proposal' : 'script';
      const evidence = clean(item.evidence);
      if (origin === 'script' && (!evidence || !source.includes(evidence))) issues.push('原文依据无法定位，暂不自动采用。');
      const timelineKey = clean(item.timelineKey);
      const continuity = ['new', 'continue'].includes(item.continuity) ? item.continuity : 'uncertain';
      if (!timelineKey || continuity === 'uncertain') issues.push('故事时间或状态承接尚不明确。');
      let existingVariantId = clean(item.existingVariantId) || undefined;
      const variant = owner?.variants?.find(v => v.id === existingVariantId);
      if (existingVariantId && !variant) issues.push('指定的既有状态不属于此资产。');
      let inherited: ShotAppearanceState | undefined;
      let inheritFromShotId = clean(item.inheritFromShotId) || undefined;
      if (inheritFromShotId && returnedIds.has(inheritFromShotId)) inheritFromShotId = returnedIds.get(inheritFromShotId);
      if (continuity === 'continue') {
        if (inheritFromShotId === 'previous') inheritFromShotId = lastByAsset.get(assetId)?.shot.id;
        const previous = inheritFromShotId ? available.get(inheritFromShotId) as (Shot & { currentSourceHash?: string }) | undefined : undefined;
        inherited = previous?.appearance?.states.find(s => s.assetId === assetId && s.decision === 'accepted');
        if (!inherited) issues.push('找不到已采用的前序状态，请明确开始状态或选择已有变体。');
        else if (previous?.currentSourceHash && inherited.sourceHash !== previous.currentSourceHash) { issues.push('前序剧本已修改，需要先复核原状态。'); inherited = undefined; }
        else if (inherited.timelineKey !== timelineKey) { issues.push('前序状态属于另一段故事时间，不能直接继承。'); inherited = undefined; }
      }
      // Reference inheritance is independent of the complete chronological state.
      if (!existingVariantId && inherited) existingVariantId = inherited.endVariantId || inherited.existingVariantId;
      const startChanges = appearanceFields(item.startChanges);
      const endChanges = appearanceFields(item.endChanges);
      const start = { ...(inherited?.end || variant?.appearanceFields || (variant ? { other: variant.description || variant.name } : {})), ...startChanges };
      const end = { ...start, ...endChanges };
      const state: ShotAppearanceState = {
        assetId, assetName: owner?.name || clean(item.assetName) || '未关联资产', timelineKey,
        event: clean(item.event), evidence, origin, continuity, inheritFromShotId,
        startChanges, endChanges, start, end,
        imageMoment: item.imageMoment === 'end' ? 'end' : 'start',
        referenceNeed: item.referenceNeed === 'image' ? 'image' : 'text',
        existingVariantId, decision: issues.length ? 'pending' : 'accepted', issues,
        sourceHash: appearanceSourceHash(scene),
        inheritedFingerprint: inherited ? appearanceFingerprint(inherited.end) : undefined,
      };
      states.push(state);
    }
    const next = { ...shot, appearance: { analysis: raw && Array.isArray(raw.states) ? 'complete' as const : 'unreviewed' as const, states } };
    available.set(next.id, next);
    for (const state of states) if (state.decision === 'accepted') lastByAsset.set(state.assetId, { shot: next, state });
    return next;
  });
}

export const appearanceVariantName = (values: AppearanceFields) => fields.flatMap(key => values[key]
  ? [`${appearanceLabels[key]}：${values[key]!.split(/[；;。\n]/)[0].slice(0, 18)}`] : []).join(' · ') || '基础外观';

export function appearanceVariantDisplayName(variant: AssetVariant, peers: AssetVariant[] = []) {
  const values = variant.appearanceFields;
  if (!values || !variant.appearanceFingerprint || ![Object.values(values).join('·').slice(0, 72), appearanceVariantName(values)].includes(variant.name)) return variant.name;
  const sameOutfit = peers.filter(p => p.id !== variant.id && p.appearanceFields?.clothing === values.clothing);
  const ordered = [...fields].sort((a, b) => Number(sameOutfit.some(p => p.appearanceFields?.[b] !== values[b])) - Number(sameOutfit.some(p => p.appearanceFields?.[a] !== values[a])));
  return ordered.flatMap(key => values[key] ? [`${appearanceLabels[key]}：${values[key]!.split(/[；;。\n]/)[0].slice(0, 18)}`] : []).join(' · ');
}

export function materializeAppearanceVariants(project: Project, shots: Shot[]) {
  const variants = new Map<string, AssetVariant[]>();
  const forOwner = (id: string) => {
    if (!variants.has(id)) variants.set(id, [...(appearanceOwner(project, id)?.variants || [])]);
    return variants.get(id)!;
  };
  const bind = (state: ShotAppearanceState, values: AppearanceFields): string | undefined => {
    if (!Object.keys(values).length) return undefined;
    const owned = forOwner(state.assetId);
    const fingerprint = appearanceFingerprint(values);
    const explicit = owned.find(v => v.id === state.existingVariantId);
    const match = owned.find(v => v.appearanceFingerprint === fingerprint) || (explicit && (appearanceFingerprint(explicit.appearanceFields || { other: explicit.description || explicit.name }) === fingerprint) ? explicit : undefined);
    // Text overlays reuse a chosen reference, but never turn shot notes into assets.
    if (state.referenceNeed === 'text') return match?.id || explicit?.id;
    if (match) return match.id;
    const id = `appearance-${sha256(`${state.assetId}:${fingerprint}`).slice(0, 24)}`;
    const existing = owned.find(v => v.id === id);
    if (!existing) owned.push({ id, name: appearanceVariantName(values), description: appearanceSummary(values), promptModifiers: '', appearanceFields: values, appearanceFingerprint: fingerprint });
    return id;
  };
  const boundStates = new Map<string, ShotAppearanceState[]>();
  const nextShots = shots.map(shot => ({ ...shot, ...(shot.appearance ? { appearance: { ...shot.appearance, states: shot.appearance.states.map(state => {
    if (state.decision !== 'accepted' || !appearanceOwner(project, state.assetId)) return state;
    const previous = state.continuity === 'continue' && state.inheritFromShotId ? boundStates.get(state.inheritFromShotId)?.find(s => s.assetId === state.assetId && s.decision === 'accepted') : undefined;
    const existingVariantId = state.existingVariantId || previous?.endVariantId || previous?.existingVariantId;
    const binding = { ...state, existingVariantId };
    const startVariantId = bind(binding, state.start);
    const endVariantId = bind(binding, state.end);
    if (endVariantId && startVariantId && endVariantId !== startVariantId) {
      const endVariant = forOwner(state.assetId).find(v => v.id === endVariantId)!;
      // Existing reference parents remain author-owned; new states can inherit a stable start.
      const startVariant = forOwner(state.assetId).find(v => v.id === startVariantId);
      if (!endVariant.referenceVariantId && (startVariant?.cleanReferenceImageUrl || startVariant?.boardImageUrl || startVariant?.imageUrl) && !appearanceOwner(project, state.assetId)?.variants?.some(v => v.id === endVariantId)) endVariant.referenceVariantId = startVariantId;
    }
    const next = { ...state, existingVariantId, startVariantId, endVariantId };
    boundStates.set(shot.id, [...(boundStates.get(shot.id) || []), next]);
    return next;
  }) } } : {}) }));
  return { shots: nextShots, characters: project.characters.map(owner => variants.has(owner.id) ? { ...owner, variants: variants.get(owner.id) } : owner), assets: project.assets.map(owner => variants.has(owner.id) ? { ...owner, variants: variants.get(owner.id) } : owner) };
}

/** Returns issues only for this shot, leaving unrelated scenes and media intact. */
export function appearanceIssues(project: Project, scene: Scene, shot: Shot, allShots: Shot[] = []) {
  return (shot.appearance?.states || []).filter(s => s.decision !== 'dismissed').flatMap(state => {
    const issues = [...state.issues];
    if (state.sourceHash !== appearanceSourceHash(scene)) issues.push('原文已修改，请复核此镜头的状态。');
    if (state.inheritFromShotId && state.inheritedFingerprint) {
      const previous = allShots.find(s => s.id === state.inheritFromShotId) as (Shot & { currentSourceHash?: string }) | undefined;
      const predecessor = previous?.appearance?.states.find(s => s.assetId === state.assetId && s.decision === 'accepted');
      if (previous?.currentSourceHash && predecessor?.sourceHash !== previous.currentSourceHash) issues.push('前序剧本已修改，需要先复核原状态。');
      if (!predecessor || appearanceFingerprint(predecessor.end) !== state.inheritedFingerprint) issues.push('前序状态已变化或无法读取，请复核承接。');
    }
    const variantId = appearanceSelectedVariantId(state);
    const owner = appearanceOwner(project, state.assetId);
    const variant = owner?.variants?.find(v => v.id === variantId);
    if (variantId && !variant) issues.push('使用的状态变体已被删除。');
    if (state.referenceNeed === 'image' && !appearanceReferenceImage(project, state)) issues.push('此状态缺少参考图；可以准备参考，也可明确选择仅用文字。');
    if (state.referenceNeed === 'image' && variant?.appearanceFields && appearanceFingerprint(variant.appearanceFields) !== appearanceFingerprint(appearanceSelectedFields(state))) issues.push('参考状态描述已修改，与本镜头采用的状态不同。');
    return [...new Set(issues)].map(message => ({ assetId: state.assetId, message: `${state.assetName}：${message}` }));
  });
}

export function appearancePrompt(shot: Shot, kind: 'image' | 'video') {
  const states = (shot.appearance?.states || []).filter(s => s.decision === 'accepted');
  if (!states.length) return '';
  return `【本镜头已采用外观状态】\n${states.map(s => kind === 'image'
    ? `${s.assetName}：画面选择${s.imageMoment === 'end' ? '变化后' : '变化前'}时刻。${appearanceSummary(appearanceSelectedFields(s))}`
    : `${s.assetName}：开始 ${appearanceSummary(s.start)}；变化 ${s.event || '无新增变化'}；结束 ${appearanceSummary(s.end)}。不得在动作发生前提前出现伤势或污损。`).join('\n')}\n保持未变化部位；状态变化不改变资产身份。`;
}

export const appearanceSourceShots = (episode: Episode, context: string): Shot[] => {
  let extra: Shot[] = [];
  try { const value = JSON.parse(context); extra = [...(value.previousSceneEnding || []), ...(value.appearanceHistory || [])].map(s => ({ ...s, id: s.id || s.shotId })); } catch { /* Old free-text contexts remain readable. */ }
  return [...extra, ...episode.scenes.filter(s => !(s as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary).flatMap(scene => (scene.shots || []).map(shot => ({ ...shot, currentSourceHash: appearanceSourceHash(scene) })))];
};

/** Author edits recompute dependent shots, preserving explicit deferrals. */
export function reviseShotAppearances(project: Project, scene: Scene, shots: Shot[], previousShots: Shot[] = []): Shot[] {
  const result: Shot[] = [];
  for (const shot of shots) {
    const raw = { appearance: shot.appearance ? { states: shot.appearance.states.map(state => ({ ...state, inheritFromShotId: state.inheritFromShotId === 'previous' ? [...result].reverse().find(s => s.appearance?.states.some(x => x.assetId === state.assetId && x.decision === 'accepted'))?.id : state.inheritFromShotId })) } : undefined };
    const next = normalizeShotAppearances(project, scene, [shot], [raw], [...previousShots, ...result])[0];
    next.appearance!.analysis = shot.appearance?.analysis || 'unreviewed';
    next.appearance!.states = next.appearance!.states.map((state, index) => {
      const old = shot.appearance!.states[index];
      return { ...state, decision: old.decision === 'dismissed' ? 'dismissed' : old.decision === 'pending' ? 'pending' : state.decision };
    });
    result.push(next);
  }
  return result;
}

export function appearanceAssetPatch(project: Project, shots: Shot[]) {
  const result = materializeAppearanceVariants(project, shots);
  return { ...result, assets: result.assets.map(asset => {
    const character = result.characters.find(c => asset.id === `char-${c.id}`);
    return character ? { ...asset, variants: character.variants } : asset;
  }) };
}

/** Resolve concrete references at the same moment as the visible generation prompt. */
export function appearanceBoards(project: Project, shots: Shot[], boards: import('./manualProductionAssets').ManualProductionAssetBoard[], kind: 'image' | 'video') {
  const states = shots.flatMap(shot => (shot.appearance?.states || []).filter(s => s.decision === 'accepted').map(state => ({ shot, state })));
  if (!states.length) return boards;
  const affected = new Set(states.map(item => item.state.assetId));
  const result = boards.filter(board => !affected.has(board.assetId));
  for (const { shot, state } of states) {
    const owner = appearanceOwner(project, state.assetId);
    if (!owner) continue;
    const assetType = project.characters.some(c => c.id === state.assetId) ? 'character' : project.assets.find(a => a.id === state.assetId)?.type === 'location' ? 'location' : 'prop';
    const moments = kind === 'video' && appearanceFingerprint(state.start) !== appearanceFingerprint(state.end) ? ['start', 'end'] as const : [kind === 'video' ? 'start' : state.imageMoment] as const;
    for (const moment of moments) {
      const variantId = moment === 'start' ? state.startVariantId : state.endVariantId;
      const variant = owner.variants?.find(v => v.id === variantId);
      const matching = boards.find(b => b.assetId === state.assetId && b.variantId === variantId);
      const base = boards.find(b => b.assetId === state.assetId && !b.variantId);
      const identityUrl = identityImage(owner) || base?.referenceImageUrl;
      const isBase = !variantId && !Object.keys(state[moment]).length;
      const url = variant?.cleanReferenceImageUrl || variant?.boardImageUrl || variant?.imageUrl || (variantId ? matching?.referenceImageUrl : isBase ? identityUrl : undefined);
      const referenceImageUrl = url || (state.referenceNeed === 'text' ? identityUrl : undefined);
      const boardItemId = `appearance:${state.assetId}:${variantId || 'base'}:${moment}:${appearanceFingerprint(state[moment])}:${sha256(appearancePrompt(shot, kind))}`;
      if (result.some(b => b.boardItemId === boardItemId)) continue;
      result.push({ boardItemId, assetId: state.assetId, assetType, assetName: state.assetName, variantId: url ? variantId : undefined,
        variantName: `${moment === 'start' ? '开始' : '结束'} · ${appearanceSummary(state[moment])}${url ? '' : '（仅基础身份参考，状态用文字）'}`,
        boardKind: 'variant_board', prompt: appearancePrompt(shot, kind), promptHash: appearanceFingerprint(state[moment]), referenceImageUrl,
        referenceSource: url && variantId ? 'variant' : referenceImageUrl ? 'canonical' : 'missing', referenceOrigin: referenceImageUrl ? 'existing' : 'missing',
        requiredDepartments: [], sourceDepartmentPackageIds: [], departmentBlockers: [], approvalState: 'confirmed', usageRefs: [],
      });
    }
  }
  return result;
}

export function requireAppearanceReady(project: Project, scene: Scene, shots: Shot[], history: Shot[], kind: 'image' | 'video') {
  for (const shot of shots) {
    const hash = kind === 'image' ? shot.imagePromptAppearanceHash : shot.videoPromptAppearanceHash;
    if (hash && hash !== appearanceContentHash(shot, kind)) throw new Error(`外观状态已修改，请重新生成或确认此镜头的${kind === 'image' ? '图片' : '视频'}提示词。`);
  }
  const errors = shots.flatMap(shot => {
    const accepted = { ...shot, appearance: { analysis: shot.appearance?.analysis || 'unreviewed' as const, states: shot.appearance?.states.filter(s => s.decision === 'accepted') || [] } };
    const moments = kind === 'video' ? ['start', 'end'] as const : [undefined];
    return moments.flatMap(moment => appearanceIssues(project, scene, moment ? { ...accepted, appearance: { ...accepted.appearance, states: accepted.appearance.states.map(s => ({ ...s, imageMoment: moment })) } } : accepted, history));
  });
  if (errors.length) throw new Error([...new Set(errors.map(e => e.message))].join('\n'));
}

export const appearanceContentHash = (shot: Shot, kind: 'image' | 'video') => sha256(appearancePrompt(shot, kind));
export function preserveAppearanceChoices(previous: Shot[], next: Shot[]) {
  const key = (s: ShotAppearanceState) => JSON.stringify([s.assetId, s.sourceHash, s.timelineKey, s.evidence, s.event, appearanceFingerprint(s.start), appearanceFingerprint(s.end)]);
  const existing = new Map(previous.flatMap(s => s.appearance?.states || []).map(s => [key(s), s]));
  return next.map(shot => ({ ...shot, ...(shot.appearance ? { appearance: { ...shot.appearance, states: shot.appearance.states.map(state => {
    const old = existing.get(key(state));
    return old ? { ...state, referenceNeed: old.referenceNeed, imageMoment: old.imageMoment, decision: state.issues.length ? 'pending' as const : old.decision } : state;
  }) } } : {}) }));
}

export const appearanceImageIsAfterChange = (appearance?: Shot['appearance']) => Boolean(appearance?.states.some(state => state.decision === 'accepted' && state.imageMoment === 'end' && appearanceFingerprint(state.start) !== appearanceFingerprint(state.end)));
