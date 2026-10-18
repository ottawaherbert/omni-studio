import type { AssetVariant, Project, Shot } from '../../types/project';
import { appearanceFingerprint, appearanceSummary, appearanceVariantName } from './productionAppearance';

export type AppearanceRetirement = { assetId: string; variantId: string; fingerprint: string; replacementVariantId?: string };
const referenceKeys = ['existingVariantId', 'startVariantId', 'endVariantId'] as const;

/** Only untouched, unrendered machine-created records qualify. Author work is never discarded. */
export function isDisposableAppearanceVariant(v: AssetVariant) {
  if (!v.id.startsWith('appearance-') || !v.appearanceFields || v.appearanceFingerprint !== appearanceFingerprint(v.appearanceFields)) return false;
  const summary = appearanceSummary(v.appearanceFields);
  const allowed = new Set(['id', 'name', 'description', 'promptModifiers', 'appearanceFields', 'appearanceFingerprint']);
  if (Object.entries(v).some(([key, value]) => !allowed.has(key) && value != null && value !== '')) return false;
  return [appearanceVariantName(v.appearanceFields), Object.values(v.appearanceFields).join('·').slice(0, 72)].includes(v.name)
    && v.description === summary
    && ['', `保持人物身份、基本长相和未指定部位不变。当前完整可见状态：${summary}。`].includes(v.promptModifiers);
}

/** Prompt transcripts are self-contained history, not live foreign keys. Other
 * references, including unknown fields and media manifests inside audits, still pin. */
export function hasLiveAppearanceReference(value: unknown, id: string, path: string[] = []): boolean {
  const key = path[path.length - 1];
  const inAudit = path.includes('audit') || path.includes('batchAudits');
  if (typeof value === 'string') {
    if (inAudit && (key === 'confirmedPrompt' || (key === 'prompt' && path.includes('promptExecutions')))) return false;
    // Database JSON columns retain the same structural distinction.
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') return hasLiveAppearanceReference(parsed, id, path); } catch { /* Ordinary text. */ }
    return value.includes(id);
  }
  return Boolean(value && typeof value === 'object' && Object.entries(value).some(([key, item]) => hasLiveAppearanceReference(item, id, [...path, key])));
}

/** Full-project repair only. Opaque histories/candidates/media bindings pin referenced variants. */
export function cleanupAppearanceVariants(project: Project, shots: Shot[], otherRecords: unknown[] = [], reviewed: AppearanceRetirement[] = []) {
  const owners = [...project.characters, ...project.assets.filter(a => !project.characters.some(c => a.id === `char-${c.id}`))];
  const states = shots.flatMap(s => s.appearance?.states || []);
  const candidates: AppearanceRetirement[] = [];
  const skipped: Array<{ variantId: string; reason: string }> = [];
  for (const owner of owners) for (const variant of owner.variants || []) {
    const override = reviewed.find(r => r.assetId === owner.id && r.variantId === variant.id);
    const uses = states.filter(s => s.assetId === owner.id && referenceKeys.some(key => s[key] === variant.id));
    if (!override && (!uses.length || uses.some(s => s.referenceNeed !== 'text'))) continue;
    const copies = [...project.characters, ...project.assets].flatMap(o => o.variants || []).filter(v => v.id === variant.id);
    if (copies.some(v => !isDisposableAppearanceVariant(v))) { skipped.push({ variantId: variant.id, reason: '已有图片、手工编辑或其他资产数据' }); continue; }
    if (override && override.fingerprint !== variant.appearanceFingerprint) throw new Error(`外观已变化，停止迁移：${variant.id}`);
    if (override?.replacementVariantId && !owner.variants?.some(v => v.id === override.replacementVariantId && v.id !== variant.id)) throw new Error(`替代参考不属于同一资产：${variant.id}`);
    candidates.push(override || { assetId: owner.id, variantId: variant.id, fingerprint: variant.appearanceFingerprint! });
  }
  for (const item of reviewed) if (!owners.some(o => o.id === item.assetId && o.variants?.some(v => v.id === item.variantId))) throw new Error(`待迁移变体不存在：${item.variantId}`);
  const ids = new Set(candidates.map(c => c.variantId));
  // Remove only known, rewritable reference locations before searching all other content.
  // Keeping all other variant bodies here protects authored referenceVariantId relationships.
  const metadata = { ...project, characters: project.characters.map(o => ({ ...o, variants: o.variants?.filter(v => !ids.has(v.id)) })), assets: project.assets.map(o => ({ ...o, variants: o.variants?.filter(v => !ids.has(v.id)) })) };
  const opaqueShots = shots.map(s => ({ ...s, appearance: s.appearance && { ...s.appearance, states: s.appearance.states.map(state => {
    const result = { ...state }; referenceKeys.forEach(key => { if (candidates.some(c => c.assetId === state.assetId && c.variantId === state[key])) delete result[key]; }); return result;
  }) } }));
  const opaque = [metadata, opaqueShots, otherRecords];
  const pinned = new Set(candidates.filter(c => hasLiveAppearanceReference(opaque, c.variantId)).map(c => c.variantId));
  // A retained candidate may itself refer to another candidate. Propagate protection.
  for (const c of candidates) if (c.replacementVariantId) pinned.add(c.replacementVariantId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const owner of owners) for (const v of owner.variants || []) if (pinned.has(v.id)) {
      for (const c of candidates) if (v.id !== c.variantId && JSON.stringify(v).includes(c.variantId) && !pinned.has(c.variantId)) { pinned.add(c.variantId); changed = true; }
    }
  }
  const retired = candidates.filter(c => !pinned.has(c.variantId));
  candidates.filter(c => pinned.has(c.variantId)).forEach(c => skipped.push({ variantId: c.variantId, reason: '历史、候选、媒体或其他参考仍在使用' }));
  const byId = new Map(retired.map(c => [c.variantId, c]));
  const nextShots = shots.map(shot => ({ ...shot, ...(shot.appearance ? { appearance: { ...shot.appearance, states: shot.appearance.states.map(state => {
    const matches = referenceKeys.map(key => state[key] && byId.get(state[key]!)).filter(Boolean) as AppearanceRetirement[];
    if (!matches.some(c => c.assetId === state.assetId)) return state;
    const next = { ...state, referenceNeed: 'text' as const };
    for (const key of referenceKeys) {
      const retirement = state[key] && byId.get(state[key]!);
      if (retirement && retirement.assetId === state.assetId) next[key] = retirement.replacementVariantId;
    }
    next.existingVariantId ||= matches.find(c => c.replacementVariantId)?.replacementVariantId;
    return next;
  }) } } : {}) }));
  const nextOwners = <T extends { variants?: AssetVariant[] }>(items: T[]) => items.map(o => ({ ...o, variants: o.variants?.filter(v => !byId.has(v.id)) }));
  return { project: { ...project, characters: nextOwners(project.characters), assets: nextOwners(project.assets) }, shots: nextShots, retired, skipped };
}
