import type {
  Episode,
  ProductionPreparationPromptExecutionAudit,
  ProductionPreparationStageRecord,
  Project,
  Scene,
  ScriptBreakdown,
} from "../../types/project";
import { assetIdentityReference, assetVisualDescription } from "./productionAssetDesign";
import { generateAIContent } from "../../clients/aiClient";
import { safeParseAIResponse } from "../../utils/aiParser";
import { manualFilmTeamSceneSource, manualFilmTeamScriptHash } from "./manualFilmTeam";
import { productionSourceDocumentForEpisode } from "./productionSourceDocuments";
import { productionWritingSourceContext } from "./writingSourceContext";

export interface ProductionBreakdownPromptMetadata {
  selectedSkillIds?: string[];
  selectedSkillTitles?: string[];
  selectedContextIds?: string[];
}

export interface ProductionBreakdownQaResult {
  score: number;
  verdict: "pass" | "revise";
  summary: string;
  checks?: Array<{
    checkId?: string;
    dimension: string;
    subject: string;
    status: "pass" | "blocking" | "warning" | "advisory";
    sourceEvidence: string;
    candidateEvidence: string;
    sourceRefs?: string[];
    coveredSubjects?: string[];
  }>;
  issues: Array<{
    severity: "blocking" | "warning" | "advisory";
    description: string;
    suggestion: string;
    checkIds?: string[];
  }>;
}

export interface ProductionBreakdownQaRequiredCheck {
  id: string;
  label: string;
  instruction: string;
}

export const projectProductionBreakdownRepairQa = (
  qa?: Pick<ProductionBreakdownQaResult, "summary" | "issues">,
) => qa ? ({
  summary: qa.summary,
  issues: qa.issues
    .filter((issue) => issue.severity !== "advisory")
    .map((issue) => ({
      severity: issue.severity,
      description: issue.description,
      suggestion: issue.suggestion,
    })),
}) : undefined;

export const PRODUCTION_BREAKDOWN_CURRENT_SCENE_QA_CHECKS: readonly ProductionBreakdownQaRequiredCheck[] = [
  {
    id: "source_scope",
    label: "本场来源范围",
    instruction: "逐项核对候选内容是否来自本场剧本或已确认的前序连续性；串入其他场内容、遗漏关键动作结果或补写无来源事实均为 warning。",
  },
  {
    id: "identity_stability",
    label: "稳定资产命名",
    instruction: "逐一核对地点、人物和道具名称是否沿用项目 canonical name，并保留完整物件类别中心词；可能产生重复资产身份的简称或同义改写均为 warning。",
  },
  {
    id: "media_containment",
    label: "媒介与现场边界",
    instruction: "逐一核对照片、屏幕、镜面或文件中的内容没有被误写成现场实体；媒介内可辨人物与承载物必须落在正确字段。",
  },
  {
    id: "action_object_inventory",
    label: "动作对象与状态",
    instruction: "清点被拿取、交接、拆分、消耗、遗留或改变状态的人物和物件，并核对当前持有人、连接关系和动作后的最终状态。",
  },
  {
    id: "asset_scope",
    label: "正式资产范围",
    instruction: "逐个核对 props 的 requiresAsset 与 assetReason；固定设施留在 location.state，普通一次性场内物件不得被过度提升为正式资产。",
  },
  {
    id: "time_and_av_causality",
    label: "时段与声画因果",
    instruction: "核对时段承接、可读数字或指示状态，以及 sfx、vfx、bgm、特殊器材是否具有明确剧本依据；不能因动作现实中可能发声而凭空补拟音。",
  },
];

export const productionBreakdownQaChecklistPrompt = (
  checks: readonly ProductionBreakdownQaRequiredCheck[],
) => {
  const requiredShape = Object.fromEntries(checks.map((check) => [check.id, {
    status: "pass、blocking、warning 或 advisory",
    sourceEvidence: "来源证据",
    candidateEvidence: "候选对应内容或缺失说明",
    sourceRefs: ["实际阅读的 SRC 编号；没有编号时返回空数组"],
    coveredSubjects: ["本项实际核对的对象"],
  }]));
  return [
    "【系统强制专项清单（结构由系统提供）】",
    "下面每个 id 都是独立、不可省略的检查，不要自行改名，也不要依赖 checks.subject 的措辞来表示已完成。逐项阅读来源和候选后，把结论写入 requiredChecks 对应 id；不得只复制检查说明或用总体印象代替证据。",
    JSON.stringify(checks, null, 2),
    "【必须额外返回的 JSON 结构】",
    JSON.stringify({ requiredChecks: requiredShape }, null, 2),
    "系统清单结论只写入 requiredChecks；checks 只用于额外检查，checks.checkId 必须唯一且不得复用 requiredChecks id。",
    "每个 blocking 或 warning 检查都必须在 issues 中有对应修正项；issues.checkIds 必须填写它所处理的 requiredChecks id 或 checks.checkId。",
  ].join("\n");
};

export const combineProductionBreakdownQaResults = (
  results: Array<{ label: string; qa: ProductionBreakdownQaResult }>,
): ProductionBreakdownQaResult => {
  if (!results.length) return { score: 0, verdict: "revise", summary: "未执行专业质检。", issues: [] };
  const checks = results.flatMap(({ label, qa }) => (qa.checks || []).map((check) => ({
    ...check,
    dimension: `【${label}】${check.dimension}`,
  })));
  const issues = results.flatMap(({ label, qa }) => qa.issues.map((issue) => ({
    ...issue,
    description: `【${label}】${issue.description}`,
  })));
  const score = Math.min(...results.map(({ qa }) => qa.score));
  return {
    score,
    verdict: results.every(({ qa }) => qa.verdict === "pass") && score >= 85 ? "pass" : "revise",
    summary: results.map(({ label, qa }) => `【${label}】${qa.summary}`).join("；"),
    checks,
    issues,
  };
};

const text = (value: unknown) => String(value || "").trim();

export const finalizeProductionBreakdownQaResult = (
  input: ProductionBreakdownQaResult,
): ProductionBreakdownQaResult => {
  const checks = input.checks || [];
  const issues = input.issues || [];
  const checkIds = checks.map((check) => text(check.checkId));
  if (checkIds.some((checkId) => !checkId) || new Set(checkIds).size !== checkIds.length) {
    throw new Error("质检检查项缺少唯一 checkId，已拒绝采用。");
  }
  const knownCheckIds = new Set(checkIds);
  const invalidIssues = issues.filter((issue) => !text(issue.description)
    || !text(issue.suggestion)
    || !(issue.checkIds || []).length
    || (issue.checkIds || []).some((checkId) => !knownCheckIds.has(checkId)));
  if (invalidIssues.length) {
    throw new Error("质检问题缺少修改建议或没有关联有效 checkId，已拒绝采用。");
  }
  const hasMaterialFinding = issues.some((issue) => issue.severity !== "advisory")
    || checks.some((check) => check.status === "blocking" || check.status === "warning");
  const hasAdvisoryOnly = !hasMaterialFinding && (
    issues.some((issue) => issue.severity === "advisory")
    || checks.some((check) => check.status === "advisory")
  );
  const rawScore = Math.max(0, Math.min(100, Math.round(Number(input.score) || 0)));
  const score = hasMaterialFinding ? Math.min(rawScore, 84) : hasAdvisoryOnly ? Math.max(rawScore, 85) : rawScore;
  const verdict = (input.verdict === "pass" || hasAdvisoryOnly) && score >= 85 && !hasMaterialFinding
    ? "pass"
    : "revise";

  if (!text(input.summary)) {
    throw new Error("质检未返回有效摘要，已拒绝采用。");
  }
  const coveredMaterialCheckIds = new Set(
    issues.filter((issue) => issue.severity !== "advisory").flatMap((issue) => issue.checkIds || []),
  );
  const missingMaterialIssueIds = checks
    .filter((check) => check.status === "blocking" || check.status === "warning")
    .map((check) => text(check.checkId))
    .filter((checkId) => !coveredMaterialCheckIds.has(checkId));
  if (missingMaterialIssueIds.length) {
    throw new Error(`质检问题未覆盖全部 blocking/warning 检查：${missingMaterialIssueIds.join("、")}`);
  }
  if (verdict === "revise" && !issues.some((issue) => issue.severity !== "advisory")) {
    throw new Error("质检要求优化，但没有给出可执行的问题和修改建议，已拒绝采用。");
  }

  return { ...input, score, verdict, summary: text(input.summary), checks, issues };
};

const stringList = (source: Record<string, unknown>, key: string) =>
  Array.isArray(source[key]) ? (source[key] as unknown[]).map(text).filter(Boolean) : [];
const namedList = (source: Record<string, unknown>, key: string): ScriptBreakdown["characters"] => {
  if (!Array.isArray(source[key])) return [];
  return (source[key] as unknown[]).reduce<ScriptBreakdown["characters"]>((items, value) => {
    if (typeof value !== "object" || !value) {
      const name = text(value);
      if (name) items.push(name);
      return items;
    }
    const item = value as { name?: unknown; state?: unknown; assetId?: unknown };
    const name = text(item.name);
    if (!name) return items;
    const state = text(item.state);
    items.push({ name, ...(state ? { state } : {}), ...(text(item.assetId) ? { assetId: text(item.assetId) } : {}) });
    return items;
  }, []);
};

const propList = (source: Record<string, unknown>): ScriptBreakdown["props"] => {
  if (!Array.isArray(source.props)) return [];
  return (source.props as unknown[]).reduce<ScriptBreakdown["props"]>((items, value) => {
    if (typeof value !== "object" || !value) {
      const name = text(value);
      if (name) items.push(name);
      return items;
    }
    const item = value as { name?: unknown; state?: unknown; requiresAsset?: unknown; assetReason?: unknown; assetId?: unknown };
    const name = text(item.name);
    if (!name) return items;
    const state = text(item.state);
    const assetReason = text(item.assetReason);
    items.push({
      name,
      ...(state ? { state } : {}),
      ...(typeof item.requiresAsset === "boolean" ? { requiresAsset: item.requiresAsset } : {}),
      ...(assetReason ? { assetReason } : {}),
      ...(text(item.assetId) ? { assetId: text(item.assetId) } : {}),
    });
    return items;
  }, []);
};

export const productionBreakdownName = (value: unknown) =>
  typeof value === "object" && value && "name" in value
    ? text((value as { name?: string }).name)
    : text(value);

export const productionBreakdownPropRequiresAsset = (value: ScriptBreakdown["props"][number]) =>
  Boolean(typeof value === "object" && value && value.requiresAsset === true);

export interface ProductionBreakdownAssetBindingEntry {
  sceneId: string;
  breakdown: ScriptBreakdown;
}

export interface ProductionBreakdownAssetBindingResult {
  characters: Project["characters"];
  assets: Project["assets"];
  entries: ProductionBreakdownAssetBindingEntry[];
  createdCounts: { characters: number; locations: number; props: number };
}

const canonicalNameKey = (value: string) => Array.from(value.trim().toLocaleLowerCase())
  .filter((character) => character.trim())
  .join("");

const uniqueIds = (values: Array<string | undefined>) => Array.from(new Set(values.filter((value): value is string => Boolean(value))));

const isCollectiveBackgroundCharacter = (name: string) =>
  /(?:人群|群众|群体|众人|们)$/.test(name.trim())
  || /^(?:一群|一众|众多|若干|数名|数十|数百|数千|许多)/.test(name.trim());

const sourceDeclaresCharacterProfile = (project: Project, name: string) => {
  const key = canonicalNameKey(name);
  if (!key) return false;
  return (project.productionSourceDocuments || []).some((document) => document.content
    .split(/\r?\n/)
    .some((line) => {
      const trimmed = line.trim();
      if (!canonicalNameKey(trimmed).startsWith(key)) return false;
      const suffix = trimmed.slice(name.trim().length).trimStart();
      return /^[（(][^）)]+[）)]\s*[：:]/.test(suffix);
    }));
};

export const bindProductionBreakdownAssetsToCanonicalRegistry = (
  project: Project,
  entries: ProductionBreakdownAssetBindingEntry[],
): ProductionBreakdownAssetBindingResult => {
  const characters = project.characters.map(c => ({ ...c }));
  const assets = project.assets.map(a => ({ ...a }));
  const usedIds = new Set([
    ...characters.map((item) => item.id),
    ...assets.map((item) => item.id),
  ]);
  const characterIdByName = new Map(characters.flatMap(item => [item.name, ...(item.aliases || [])].map(name => [canonicalNameKey(name), item.id] as const)));
  const locationIdByName = new Map(assets.filter(item => item.type === "location").flatMap(item => [item.name, ...(item.aliases || [])].map(name => [canonicalNameKey(name), item.id] as const)));
  const propIdByName = new Map(assets.filter(item => item.type === "prop").flatMap(item => [item.name, ...(item.aliases || [])].map(name => [canonicalNameKey(name), item.id] as const)));
  const plannedCharacterIdByName = new Map((project.plannedCharacters || []).map((item) => [canonicalNameKey(item.name), item.id]));
  const plannedLocationIdByName = new Map((project.plannedLocations || []).map((item) => [canonicalNameKey(item.name), item.id]));
  const plannedPropIdByName = new Map((project.plannedProps || []).map((item) => [canonicalNameKey(item.name), item.id]));
  const legacyCharacterAssetIdByName = new Map(assets.filter((item) => item.type === "character").map((item) => [canonicalNameKey(item.name), item.id]));
  const createdCounts = { characters: 0, locations: 0, props: 0 };

  const availableId = (preferredId: string | undefined, prefix: string) => {
    if (preferredId && !usedIds.has(preferredId)) {
      usedIds.add(preferredId);
      return preferredId;
    }
    const id = `${prefix}-${crypto.randomUUID()}`;
    usedIds.add(id);
    return id;
  };

  const ensureCharacter = (name: string) => {
    const key = canonicalNameKey(name);
    const existingId = characterIdByName.get(key);
    if (existingId) return existingId;
    const id = availableId(plannedCharacterIdByName.get(key) || legacyCharacterAssetIdByName.get(key), "prod-character");
    characters.push({ id, name: name.trim() });
    characterIdByName.set(key, id);
    createdCounts.characters += 1;
    return id;
  };

  const ensureAsset = (name: string, type: "location" | "prop") => {
    const key = canonicalNameKey(name);
    const idByName = type === "location" ? locationIdByName : propIdByName;
    const existingId = idByName.get(key);
    if (existingId) return existingId;
    const plannedId = type === "location" ? plannedLocationIdByName.get(key) : plannedPropIdByName.get(key);
    const id = availableId(plannedId, `prod-${type}`);
    assets.push({
      id,
      type,
      name: name.trim(),
      description: "",
    });
    idByName.set(key, id);
    createdCounts[type === "location" ? "locations" : "props"] += 1;
    return id;
  };

  const reuseIdentity = <T extends string | { name: string; assetId?: string }>(item: T, kind: 'character' | 'location' | 'prop'): T => {
    const owners = kind === 'character' ? characters : assets.filter(a => a.type === kind);
    const map = kind === 'character' ? characterIdByName : kind === 'location' ? locationIdByName : propIdByName;
    const name = productionBreakdownName(item);
    const explicitId = typeof item === 'object' ? item.assetId : undefined;
    const owner = explicitId ? owners.find(o => o.id === explicitId) : owners.find(o => o.id === map.get(canonicalNameKey(name)));
    if (explicitId && !owner) throw new Error(`拆解引用的资产 ID 不属于本项目或类型不符：${name}`);
    if (!owner) return item;
    const conflictingId = map.get(canonicalNameKey(name));
    if (conflictingId && conflictingId !== owner.id) throw new Error(`资产名称与 ID 指向不同身份，请核对：${name}`);
    if (name !== owner.name && !owner.aliases?.includes(name)) owner.aliases = [...(owner.aliases || []), name];
    map.set(canonicalNameKey(name), owner.id);
    return (typeof item === 'string' ? owner.name : { ...(item as { name: string; assetId?: string }), name: owner.name, assetId: owner.id }) as T;
  };
  const boundEntries = entries.map((originalEntry) => {
    const entry = { ...originalEntry, breakdown: { ...originalEntry.breakdown,
      characters: originalEntry.breakdown.characters.map(i => reuseIdentity(i, 'character')),
      location: reuseIdentity(originalEntry.breakdown.location, 'location'),
      props: originalEntry.breakdown.props.map(i => reuseIdentity(i, 'prop')),
    } };
    const characterIds = uniqueIds([
      ...(entry.breakdown.characterIds || []).filter((id) => characters.some((item) => item.id === id)),
      ...entry.breakdown.characters.map((item) => {
        const name = productionBreakdownName(item);
        if (!name) return undefined;
        const key = canonicalNameKey(name);
        const existingId = characterIdByName.get(key);
        if (existingId) return existingId;
        // Adopting a breakdown is sufficient to register each individual role.
        // Plain scripts need no cast-list format or earlier planning pass. This
        // creates an identity, not an image-generation requirement. Only unnamed
        // background collectives remain descriptive unless already authored as
        // a project role; an individual "年轻弟子" must keep its own usable ID.
        if (
          isCollectiveBackgroundCharacter(name)
          && !plannedCharacterIdByName.has(key)
          && !legacyCharacterAssetIdByName.has(key)
          && !sourceDeclaresCharacterProfile(project, name)
        ) return undefined;
        return ensureCharacter(name);
      }),
    ]);
    const locationName = productionBreakdownName(entry.breakdown.location);
    const locationId = locationName
      ? ensureAsset(locationName, "location")
      : assets.some((item) => item.type === "location" && item.id === entry.breakdown.locationId)
        ? entry.breakdown.locationId
        : undefined;
    const propIds = uniqueIds([
      ...(entry.breakdown.propIds || []).filter((id) => assets.some((item) => item.type === "prop" && item.id === id)),
      ...entry.breakdown.props.map((item) => {
        const name = productionBreakdownName(item);
        if (!name) return undefined;
        const key = canonicalNameKey(name);
        const existingId = propIdByName.get(key);
        if (existingId) return existingId;
        if (!productionBreakdownPropRequiresAsset(item)) return undefined;
        return ensureAsset(name, "prop");
      }),
    ]);
    for (const fact of entry.breakdown.assetVisualFacts || []) {
      const owners = fact.assetType === 'character' ? characters : assets.filter(a => a.type === fact.assetType);
      const map = fact.assetType === 'character' ? characterIdByName : fact.assetType === 'location' ? locationIdByName : propIdByName;
      const id = fact.assetId || map.get(canonicalNameKey(fact.name));
      const owner = owners.find(o => o.id === id);
      if (!owner || ![...characterIds, locationId, ...propIds].includes(owner.id)) throw new Error(`外观依据没有对应的本场资产：${fact.name}`);
      const known = owner.visualFacts || [];
      const next = { sceneId: entry.sceneId, description: fact.description, evidence: fact.evidence, scope: fact.scope };
      if (known.some(f => JSON.stringify(f) === JSON.stringify(next))) continue;
      if (fact.scope === 'identity' && !known.some(f => f.scope === 'identity' && f.description === fact.description)
        && (assetVisualDescription(owner) || assetIdentityReference(owner))) owner.visualDesignNeedsReview = true;
      owner.visualFacts = [...known, next];
    }
    return {
      ...entry,
      breakdown: { ...entry.breakdown, characterIds, locationId, propIds },
    };
  });

  return { characters, assets, entries: boundEntries, createdCounts };
};

export const normalizeProductionBreakdown = (value: unknown): ScriptBreakdown => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const location = source.location && typeof source.location === "object"
    ? { name: text((source.location as { name?: string }).name), state: (source.location as { state?: string }).state, ...(text((source.location as { assetId?: unknown }).assetId) ? { assetId: text((source.location as { assetId?: unknown }).assetId) } : {}) }
    : text(source.location);
  return {
    ...(Array.isArray(source.assetVisualFacts) ? { assetVisualFacts: source.assetVisualFacts.flatMap((raw: any) => {
      if (!raw || !['character', 'location', 'prop'].includes(raw.assetType) || !['identity', 'scene'].includes(raw.scope) || !text(raw.name) || !text(raw.description) || !text(raw.evidence)) return [];
      return [{ assetType: raw.assetType, name: text(raw.name), ...(text(raw.assetId) ? { assetId: text(raw.assetId) } : {}), description: text(raw.description), evidence: text(raw.evidence), scope: raw.scope }];
    }) } : {}),
    setting: source.setting === "EXT." || source.setting === "INT./EXT." ? source.setting : "INT.",
    location,
    time: source.time === "NIGHT" || source.time === "DAWN" || source.time === "DUSK" || source.time === "CONTINUOUS" ? source.time : "DAY",
    characters: namedList(source, "characters"),
    props: propList(source),
    vfx: stringList(source, "vfx"),
    sfx: stringList(source, "sfx"),
    wardrobe: stringList(source, "wardrobe"),
    makeupHair: stringList(source, "makeupHair"),
    vehicles: stringList(source, "vehicles"),
    extrasAtmosphere: stringList(source, "extrasAtmosphere"),
    specialEquipment: stringList(source, "specialEquipment"),
    bgm: Array.isArray(source.bgm) ? source.bgm as ScriptBreakdown["bgm"] : [],
  };
};

const productionBreakdownBasePromptVariables = (project: Project) => ({
  existingCharacters: project.characters.map((item) => item.name).join("、"),
  existingLocations: project.assets.filter((item) => item.type === "location").map((item) => item.name).join("、"),
  existingProps: project.assets.filter((item) => item.type === "prop").map((item) => item.name).join("、"),
  inspirationContext: "",
});

const productionWritingCanonicalEvidence = (project: Project, episode: Episode) => {
  const snapshot = project.productionSourceSnapshot;
  if (snapshot?.sourceType !== "writing_export") return undefined;
  const sourceDocument = productionSourceDocumentForEpisode(project, episode);
  const sourceUnit = snapshot.package.units.find((unit) => unit.id === sourceDocument?.sourceWritingUnitId);
  if (!sourceUnit) return undefined;

  const sourceScenes = sourceUnit.scenes || [];
  const sceneCharacterNames = new Set(sourceScenes.flatMap((scene) => [...scene.characters]));
  const sourceEvidenceText = JSON.stringify({
    title: sourceUnit.title,
    summary: sourceUnit.summary,
    prose: sourceUnit.prose,
    scenes: sourceScenes,
  });
  const relevantToUnit = (name: string, sourceUnitIndex?: number) =>
    sourceUnitIndex === sourceUnit.index || Boolean(name && sourceEvidenceText.includes(name));
  const inScope = (entry:{sourceUnitIds?:readonly string[];sourceUnitIndex?:number},name:string,global=false) =>
    entry.sourceUnitIds ? entry.sourceUnitIds.includes(sourceUnit.id)
      : global && entry.sourceUnitIndex===undefined ? true : relevantToUnit(name,entry.sourceUnitIndex);

  return {
    source: "immutable_writing_export",
    unit: { index: sourceUnit.index, title: sourceUnit.title },
    deliveryRequirements: {
      aspectRatio: snapshot.package.aspectRatio,
      language: snapshot.package.language,
      productionMethod: snapshot.package.productionMethod,
      authorRequirements: snapshot.package.authorRequirements || [],
    },
    characters: snapshot.package.characters
      .filter((character) => inScope(character,character.name) && (character.sourceUnitIds || sceneCharacterNames.has(character.name) || relevantToUnit(character.name, character.sourceUnitIndex)))
      .map((character) => ({
        name: character.name,
        role: character.role,
        bio: character.bio,
        fixedAppearanceFacts: character.manualLockedFields,
      })),
    lore: snapshot.package.lore
      .filter((entry) => inScope(entry,entry.term,entry.category==='coreRule'))
      .map((entry) => ({ term: entry.term, category: entry.category, definition: entry.definition })),
    criticalEntityStates: (snapshot.package.memoryDigest?.criticalEntityStates || [])
      .filter((state) => state.unitId === sourceUnit.id || state.parentUnitId === sourceUnit.id || relevantToUnit(state.name))
      .map((state) => ({
        type: state.type,
        name: state.name,
        status: state.status,
        position: state.position,
        properties: state.properties,
        lockedFacts: state.lockedFacts,
        evidence: state.evidence,
      })),
    sceneEvidence: sourceScenes.map((scene) => ({
      order: scene.index,
      title: scene.title,
      location: scene.locationText,
      time: scene.timeText,
      characters: scene.characters,
      assetHints: scene.sceneAssets || [],
      continuityIn: scene.continuityIn,
      continuityOut: scene.continuityOut,
      performanceNotes: scene.performanceNotes,
    })),
  };
};

export const productionBreakdownCanonicalAssetContext = (
  project: Project,
  episode: Episode,
  breakdowns: ScriptBreakdown[] = [],
) => JSON.stringify({
  instruction: [
    "已有身份请在人物、地点、道具条目返回对应 assetId，名字沿用登记名称；别名可依确切证据关联同一个 ID。不能凭同名或相似名字合并不同实体，无法确定时保留待核对。新一集不重复设计、创建已有基础资产或既有变体。",
    "额外返回 assetVisualFacts：逐项写 assetType、name、已有 assetId（新资产省略）、description（仅原文明示的可见外观）、evidence（原文摘录）、scope（identity 基础身份线索或 scene 本场状态）。没有依据则省略，不在拆解阶段补设计。一次换装、受伤和泥污写 scene；心理、目标不属于外观。",
    "先根据项目资产登记、上游结构化事实和前序连续性证据判断同一身份、别名与状态演进，再为每个身份选用最具体且稳定的 canonical name。",
    "命名优先级：已采用的项目资产名称最高；其次是上游 lore 中 category=keyEntity 的项目级稳定名称；scene assetHints 和场内对白可能只是同一资产的临时称呼、阶段称呼或别名。语义上属于同一实体时，name 必须使用高优先级稳定名称，低优先级称呼只能写入 state 或审计说明。",
    "结构化场次 assetHints 是语义提示，不是可机械照抄的最终分类；同一物件的泛称、阶段称呼和完整身份必须合并，状态留在 state。",
    "前序候选只提供连续性证据，不能证明资产出现在当前场；若前序候选与更高优先级来源事实冲突，必须按来源事实修正。",
  ],
  projectRegistry: {
    characters: project.characters.map((item) => ({ id: item.id, name: item.name, aliases: item.aliases || [], appearance: assetVisualDescription(item), variants: (item.variants || []).map(v => ({ id: v.id, name: v.name, description: v.description })) })),
    locations: project.assets.filter((item) => item.type === "location").map((item) => ({ id: item.id, name: item.name, aliases: item.aliases || [], appearance: assetVisualDescription(item), variants: (item.variants || []).map(v => ({ id: v.id, name: v.name, description: v.description })) })),
    props: project.assets.filter((item) => item.type === "prop").map((item) => ({ id: item.id, name: item.name, aliases: item.aliases || [], appearance: assetVisualDescription(item), variants: (item.variants || []).map(v => ({ id: v.id, name: v.name, description: v.description })) })),
    plannedCharacters: (project.plannedCharacters || []).map((item) => ({ name: item.name, brief: item.brief })),
    plannedLocations: (project.plannedLocations || []).map((item) => ({ name: item.name, brief: item.brief })),
    plannedProps: (project.plannedProps || []).map((item) => ({ name: item.name, brief: item.brief })),
  },
  upstreamWritingEvidence: productionWritingCanonicalEvidence(project, episode) || null,
  priorSceneCandidates: breakdowns.map((breakdown, index) => ({
    order: index + 1,
    time: breakdown.time,
    location: breakdown.location,
    characters: breakdown.characters,
    props: breakdown.props,
    wardrobe: breakdown.wardrobe || [],
    makeupHair: breakdown.makeupHair || [],
  })),
}, null, 2);

export interface ProductionBreakdownSourceEvidenceEntry {
  ref: string;
  type: string;
  text: string;
  requiredForQa: boolean;
}

const BREAKDOWN_QA_REQUIRED_BLOCK_TYPES = new Set(["scene_heading", "action", "character"]);
const BREAKDOWN_QA_EVIDENCE_WINDOW_MAX_CHARS = 1600;

const productionBreakdownEvidenceWindows = (
  segments: Array<{ type: string; text: string; requiredForQa: boolean }>,
) => {
  const windows: Array<{ type: string; text: string; requiredForQa: boolean }> = [];
  let lines: string[] = [];
  let requiredForQa = false;
  let length = 0;
  const flush = () => {
    if (!lines.length) return;
    windows.push({ type: "source_window", text: lines.join("\n"), requiredForQa });
    lines = [];
    requiredForQa = false;
    length = 0;
  };
  segments.forEach((segment) => {
    const line = `[${segment.type}] ${segment.text}`;
    if (lines.length && length + line.length + 1 > BREAKDOWN_QA_EVIDENCE_WINDOW_MAX_CHARS) flush();
    lines.push(line);
    length += line.length + 1;
    requiredForQa ||= segment.requiredForQa;
  });
  flush();
  return windows;
};

export const productionBreakdownSourceEvidenceLedger = (
  scene: Scene,
): ProductionBreakdownSourceEvidenceEntry[] => {
  const blocks = (scene.scriptBlocks || [])
    .map((block) => ({
      type: block.type,
      text: block.content.trim(),
      requiredForQa: BREAKDOWN_QA_REQUIRED_BLOCK_TYPES.has(block.type),
    }))
    .filter((entry) => entry.text);
  const segments = blocks.length ? blocks : manualFilmTeamSceneSource(scene).text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: "source_line", text: line, requiredForQa: true }));
  return productionBreakdownEvidenceWindows(segments).map((entry, index) => ({
    ...entry,
    ref: `SRC-${String(index + 1).padStart(3, "0")}`,
  }));
};

export const productionBreakdownRequiredSourceRefs = (scene: Scene) =>
  productionBreakdownSourceEvidenceLedger(scene).filter((entry) => entry.requiredForQa);

export const productionBreakdownPromptContext = (project: Project, episode: Episode, scene: Scene) => {
  const source = manualFilmTeamSceneSource(scene);
  const sourceEvidenceLedger = productionBreakdownSourceEvidenceLedger(scene);
  const sourceWritingContext = productionWritingSourceContext(project, episode, scene);
  const sceneLabel = [scene.sceneNumber, scene.title].filter(Boolean).join(" ");
  const scriptContent = [
    `【当前制片场次】\n${sceneLabel}`,
    `【本场原文依据（唯一拆解范围）】\n${source.text}`,
  ].filter(Boolean).join("\n\n");
  return {
    source,
    sourceWritingContext,
    variables: {
      scriptContent,
      sourceEvidenceLedger: JSON.stringify(sourceEvidenceLedger, null, 2),
      sourceWritingContext,
      batchCanonicalAssets: productionBreakdownCanonicalAssetContext(project, episode),
      workflowStage: "GENERATE",
      qaFocus: "生成阶段：按模板合同生成完整拆解，并在内部完成基础自检。",
      currentBreakdown: scene.breakdown ? JSON.stringify(scene.breakdown, null, 2) : "",
      qaContext: "",
      ...productionBreakdownBasePromptVariables(project),
    },
  };
};

export const productionBreakdownContextEntityScope = (project: Project, scene: Scene) => {
  const projectCharacterIds = new Set(project.characters.map((character) => character.id));
  const characterIds = new Set(scene.breakdown?.characterIds || []);
  const assetIds = new Set([
    ...(scene.breakdown?.propIds || []),
    ...(scene.breakdown?.locationId ? [scene.breakdown.locationId] : []),
  ]);
  const registerLinkedId = (id?: string) => {
    if (!id) return;
    if (projectCharacterIds.has(id)) characterIds.add(id);
    else assetIds.add(id);
  };

  (scene.scriptBlocks || []).forEach((block) => {
    registerLinkedId(block.linkedAssetId);
    registerLinkedId(block.locationId);
    (block.propIds || []).forEach(registerLinkedId);
  });
  (scene.shots || []).forEach((shot) => {
    (shot.characterIdsInShot || []).forEach((id) => characterIds.add(id));
    registerLinkedId(shot.locationId);
    (shot.propIds || []).forEach(registerLinkedId);
  });

  return {
    characterIds: [...characterIds],
    assetIds: [...assetIds],
  };
};

export const generateProductionBreakdownCandidate = async (
  finalPrompt: string,
  currentBreakdown?: ScriptBreakdown,
) => {
  const { Type } = await import("../../clients/aiSchemaClient");
  const namedEntitySchema = {
    type: Type.OBJECT,
    properties: { name: { type: Type.STRING }, state: { type: Type.STRING }, assetId: { type: Type.STRING } },
    required: ["name", "state"],
  };
  const propSchema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING },
      state: { type: Type.STRING },
      requiresAsset: { type: Type.BOOLEAN },
      assetReason: { type: Type.STRING },
      assetId: { type: Type.STRING },
    },
    required: ["name", "state", "requiresAsset", "assetReason"],
  };
  const response = await generateAIContent({
    prompt: finalPrompt,
    requireJson: true,
    schema: {
      type: Type.OBJECT,
      properties: {
        assetVisualFacts: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
          assetType: { type: Type.STRING }, name: { type: Type.STRING }, assetId: { type: Type.STRING },
          description: { type: Type.STRING }, evidence: { type: Type.STRING }, scope: { type: Type.STRING },
        }, required: ['assetType', 'name', 'description', 'evidence', 'scope'] } },
        setting: { type: Type.STRING },
        location: namedEntitySchema,
        time: { type: Type.STRING },
        characters: { type: Type.ARRAY, items: namedEntitySchema },
        props: { type: Type.ARRAY, items: propSchema },
        vfx: { type: Type.ARRAY, items: { type: Type.STRING } }, sfx: { type: Type.ARRAY, items: { type: Type.STRING } },
        wardrobe: { type: Type.ARRAY, items: { type: Type.STRING } }, makeupHair: { type: Type.ARRAY, items: { type: Type.STRING } },
        vehicles: { type: Type.ARRAY, items: { type: Type.STRING } }, extrasAtmosphere: { type: Type.ARRAY, items: { type: Type.STRING } },
        specialEquipment: { type: Type.ARRAY, items: { type: Type.STRING } },
        bgm: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { prompt: { type: Type.STRING }, description: { type: Type.STRING } },
            required: ["prompt"],
          },
        },
      },
      required: [
        "setting",
        "location",
        "time",
        "characters",
        "props",
        "vfx",
        "sfx",
        "bgm",
        "wardrobe",
        "makeupHair",
        "vehicles",
        "extrasAtmosphere",
        "specialEquipment",
      ],
    },
  });
  const next = normalizeProductionBreakdown(safeParseAIResponse(response, {}));
  if (!next.characters.length && !next.props.length && !productionBreakdownName(next.location)) {
    throw new Error("模型未返回可采用的场次拆解。");
  }
  return { ...currentBreakdown, ...next } as ScriptBreakdown;
};

export interface ParseProductionBreakdownQaOptions {
  requiredSourceRefs?: string[];
  requiredChecks?: readonly ProductionBreakdownQaRequiredCheck[];
}

export const parseProductionBreakdownQaResult = (
  value: unknown,
  options: ParseProductionBreakdownQaOptions = {},
): ProductionBreakdownQaResult => {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const requiredChecks = options.requiredChecks || [];
  const normalizeCheckStatus = (status: unknown) =>
    status === "pass" || status === "blocking" || status === "advisory" ? status : "warning";
  const rawModelChecks = Array.isArray(source.checks) ? source.checks : [];
  const modelChecks = rawModelChecks.map((item) => {
    const check = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      checkId: text(check.checkId),
      dimension: text(check.dimension),
      subject: text(check.subject),
      status: normalizeCheckStatus(check.status),
      sourceEvidence: text(check.sourceEvidence),
      candidateEvidence: text(check.candidateEvidence),
      sourceRefs: stringList(check, "sourceRefs"),
      coveredSubjects: stringList(check, "coveredSubjects"),
    } as NonNullable<ProductionBreakdownQaResult["checks"]>[number];
  }).filter((check) => check.checkId && check.dimension && check.subject && check.sourceEvidence && check.candidateEvidence);
  if (modelChecks.length !== rawModelChecks.length) {
    throw new Error("质检逐项证据不完整：每项检查都必须包含唯一编号、维度、对象、来源证据和候选证据。");
  }
  const requiredCheckSource = source.requiredChecks && typeof source.requiredChecks === "object"
    ? source.requiredChecks as Record<string, unknown>
    : {};
  const missingRequiredChecks: string[] = [];
  const checklistChecks = requiredChecks.flatMap((definition) => {
    const item = requiredCheckSource[definition.id];
    if (!item || typeof item !== "object") {
      missingRequiredChecks.push(definition.label);
      return [];
    }
    const check = item as Record<string, unknown>;
    const sourceEvidence = text(check.sourceEvidence);
    const candidateEvidence = text(check.candidateEvidence);
    if (!sourceEvidence || !candidateEvidence) {
      missingRequiredChecks.push(`${definition.label}（证据不完整）`);
      return [];
    }
    return [{
      checkId: definition.id,
      dimension: "系统强制专项",
      subject: definition.label,
      status: normalizeCheckStatus(check.status),
      sourceEvidence,
      candidateEvidence,
      sourceRefs: stringList(check, "sourceRefs"),
      coveredSubjects: stringList(check, "coveredSubjects"),
    } as NonNullable<ProductionBreakdownQaResult["checks"]>[number]];
  });
  if (missingRequiredChecks.length) {
    throw new Error(`质检未完成系统专项清单：${missingRequiredChecks.join("、")}`);
  }
  const checks = [...checklistChecks, ...modelChecks];
  if (!checks.length) {
    throw new Error("质检未返回逐项证据，已拒绝无证据结论。");
  }
  const coveredSourceRefs = new Set(checks.flatMap((check) => check.sourceRefs || []));
  const missingSourceRefs = (options.requiredSourceRefs || []).filter((ref) => !coveredSourceRefs.has(ref));
  if (missingSourceRefs.length) {
    throw new Error(`质检证据覆盖不完整：${missingSourceRefs.join("、")}`);
  }
  const issues = (Array.isArray(source.issues) ? source.issues : []).map((item) => {
    const issue = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      severity: issue.severity === "blocking" || issue.severity === "advisory" ? issue.severity : "warning",
      description: text(issue.description),
      suggestion: text(issue.suggestion),
      checkIds: stringList(issue, "checkIds"),
    } as ProductionBreakdownQaResult["issues"][number];
  });
  return finalizeProductionBreakdownQaResult({
    score: Math.max(0, Math.min(100, Math.round(Number(source.score) || 0))),
    verdict: source.verdict === "pass" ? "pass" : "revise",
    summary: text(source.summary),
    checks,
    issues,
  });
};

export const reviewProductionBreakdownCandidate = async (
  finalPrompt: string,
  options: ParseProductionBreakdownQaOptions = {},
): Promise<ProductionBreakdownQaResult> => {
  const { Type } = await import("../../clients/aiSchemaClient");
  const requiredChecks = options.requiredChecks || [];
  const evidenceCheckSchema = {
    type: Type.OBJECT,
    properties: {
      status: { type: Type.STRING, enum: ["pass", "blocking", "warning", "advisory"] },
      sourceEvidence: { type: Type.STRING },
      candidateEvidence: { type: Type.STRING },
      sourceRefs: { type: Type.ARRAY, items: { type: Type.STRING } },
      coveredSubjects: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["status", "sourceEvidence", "candidateEvidence", "sourceRefs", "coveredSubjects"],
  };
  const response = await generateAIContent({
    prompt: finalPrompt,
    requireJson: true,
    schema: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER },
        verdict: { type: Type.STRING },
        summary: { type: Type.STRING },
        checks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              checkId: { type: Type.STRING },
              dimension: { type: Type.STRING },
              subject: { type: Type.STRING },
              status: { type: Type.STRING },
              sourceEvidence: { type: Type.STRING },
              candidateEvidence: { type: Type.STRING },
              sourceRefs: { type: Type.ARRAY, items: { type: Type.STRING } },
              coveredSubjects: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["checkId", "dimension", "subject", "status", "sourceEvidence", "candidateEvidence", "sourceRefs", "coveredSubjects"],
          },
        },
        issues: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              severity: { type: Type.STRING },
              description: { type: Type.STRING },
              suggestion: { type: Type.STRING },
              checkIds: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ["severity", "description", "suggestion", "checkIds"],
          },
        },
        ...(requiredChecks.length ? {
          requiredChecks: {
            type: Type.OBJECT,
            properties: Object.fromEntries(requiredChecks.map((check) => [check.id, evidenceCheckSchema])),
            required: requiredChecks.map((check) => check.id),
          },
        } : {}),
      },
      required: [
        "score",
        "verdict",
        "summary",
        "checks",
        "issues",
        ...(requiredChecks.length ? ["requiredChecks"] : []),
      ],
    },
  });
  return parseProductionBreakdownQaResult(safeParseAIResponse(response, {}), options);
};

export const productionBreakdownExecutionAudit = ({
  action,
  prompt,
  result,
  metadata,
  templateId = "breakdown",
  status = "succeeded",
  error,
  now = Date.now(),
}: {
  action: ProductionPreparationPromptExecutionAudit["action"];
  prompt: string;
  result?: unknown;
  metadata?: ProductionBreakdownPromptMetadata;
  templateId?: string;
  status?: ProductionPreparationPromptExecutionAudit["status"];
  error?: string;
  now?: number;
}): ProductionPreparationPromptExecutionAudit => ({
  action,
  prompt,
  status,
  error,
  templateId,
  promptHash: manualFilmTeamScriptHash(prompt),
  resultHash: result === undefined ? undefined : manualFilmTeamScriptHash(JSON.stringify(result)),
  selectedSkillIds: metadata?.selectedSkillIds || [],
  selectedSkillTitles: metadata?.selectedSkillTitles || [],
  selectedContextIds: metadata?.selectedContextIds || [],
  createdAt: now,
  completedAt: now,
});

export const productionBreakdownAdoptionUpdates = ({
  scene,
  breakdown,
  prompt,
  metadata,
  qa,
  qaPrompt,
  promptExecutions,
  templateId = "breakdown",
  now = Date.now(),
}: {
  scene: Scene;
  breakdown: ScriptBreakdown;
  prompt: string;
  metadata?: ProductionBreakdownPromptMetadata;
  qa?: ProductionBreakdownQaResult;
  qaPrompt?: string;
  promptExecutions?: ProductionPreparationPromptExecutionAudit[];
  templateId?: string;
  now?: number;
}): Partial<Scene> => {
  // Adoption is an author decision. Preserve QA advice without turning it into approval.
  const promptAudit = {
    templateId,
    promptHash: manualFilmTeamScriptHash(prompt),
    selectedSkillIds: metadata?.selectedSkillIds || [],
    selectedSkillTitles: metadata?.selectedSkillTitles || [],
    selectedContextIds: metadata?.selectedContextIds || [],
    createdAt: now,
  };
  const qaRecord: ProductionPreparationStageRecord["qa"] = qa ? {
    ...qa,
    audit: {
      ...promptAudit,
      promptHash: manualFilmTeamScriptHash(qaPrompt || prompt),
    },
    reviewedAt: now,
  } : undefined;
  return {
    breakdown,
    productionPreparation: {
      ...(scene.productionPreparation || { schemaVersion: "production-preparation.v1", sceneId: scene.id }),
      breakdown: {
        status: "confirmed",
        sourceHash: manualFilmTeamScriptHash(manualFilmTeamSceneSource(scene).text),
        promptAudit,
        promptExecutions,
        qa: qaRecord,
        confirmedAt: now,
      },
      updatedAt: now,
    },
  };
};
