const EPHEMERAL_BODY_STATE_TERMS = [
  "血",
  "血迹",
  "血滴",
  "血珠",
  "血洞",
  "伤口",
  "伤势",
  "伤痕",
  "创口",
  "裂伤",
  "烧伤",
  "烫伤",
  "腐蚀伤",
  "咬伤",
  "抓伤",
  "刀伤",
  "剑伤",
  "内伤",
  "外伤",
  "淤青",
  "病灶",
  "泪水",
  "眼泪",
  "汗水",
  "唾液",
];

const TANGIBLE_PROP_TERMS = [
  "绷带",
  "纱布",
  "创可贴",
  "药",
  "药膏",
  "药瓶",
  "药丸",
  "丹",
  "符",
  "针",
  "针管",
  "匕首",
  "刀",
  "剑",
  "枪",
  "锤",
  "鞭",
  "甲",
  "面具",
  "令",
  "玉",
  "炉",
  "靶",
];

export const isEphemeralBreakdownPropName = (name: string) => {
  const normalized = name.trim();
  if (!normalized) return true;

  const compact = normalized.replace(/\s+/g, "");
  const hasEphemeralBodyState = EPHEMERAL_BODY_STATE_TERMS.some((term) => compact.includes(term));
  if (!hasEphemeralBodyState) return false;

  const isPureBodyState =
    EPHEMERAL_BODY_STATE_TERMS.includes(compact) ||
    /的(血|血迹|血滴|血珠|血洞|伤口|伤势|伤痕|创口|裂伤|烧伤|烫伤|腐蚀伤|咬伤|抓伤|刀伤|剑伤|内伤|外伤|淤青|病灶|泪水|眼泪|汗水|唾液)$/.test(compact) ||
    /(黑气|魔气|毒气|毒素|腐蚀|灼烧|烧灼).*(伤口|伤势|伤痕|创口|裂伤|烧伤|烫伤|腐蚀伤|病灶)$/.test(compact);
  if (isPureBodyState) return true;

  return !TANGIBLE_PROP_TERMS.some((term) => compact.includes(term));
};

const TEMPORARY_CHARACTER_STATE_PREFIXES = [
  "受伤",
  "重伤",
  "轻伤",
  "昏迷",
  "倒地",
  "濒死",
  "中毒",
  "被困",
  "受惊",
  "虚弱",
  "血污",
  "落单",
  "逃跑",
  "被挟持",
  "被追杀",
  "被救下",
];

const EXTRA_ROLE_NAME_TERMS = [
  "弟子",
  "杂役",
  "守卫",
  "护卫",
  "侍卫",
  "路人",
  "行人",
  "村民",
  "镇民",
  "群众",
  "围观者",
  "观众",
  "侍从",
  "丫鬟",
  "仆役",
  "伙计",
  "士兵",
  "喽啰",
  "打手",
  "药童",
  "童子",
  "弟子甲",
  "弟子乙",
];

const GENERIC_IDENTITY_TERMS = [
  "魔修",
  "黑影",
  "器灵",
  "长老",
  "掌门",
  "执事",
  "真人",
  "师兄",
  "师姐",
  "师弟",
  "师妹",
  "护法",
  "亲传",
  "谷主",
  "管事",
  "老人",
  "妖兽",
];

export const normalizeTemporaryCharacterStateName = (name: string) => {
  const original = name.trim();
  if (!original) return original;

  let compact = original.replace(/\s+/g, "");
  compact = compact.replace(/[（(](无名|临时|群演|路人|未命名)[）)]/g, "");
  for (const prefix of TEMPORARY_CHARACTER_STATE_PREFIXES) {
    compact = compact.replace(new RegExp(`^${prefix}的?`), "");
  }

  return compact || original;
};

export const normalizeScriptCharacterCueName = (name: string) =>
  normalizeTemporaryCharacterStateName(
    name
      .trim()
      .replace(/[（(]\s*(O\.?S\.?|V\.?O\.?|OS|VO|画外|旁白|旁白音|内心|内心独白)\s*[）)]/gi, "")
      .replace(/\s+/g, " "),
  );

export const getScriptCharacterNameCandidates = (name: string) => {
  const normalized = normalizeScriptCharacterCueName(name);
  const parenAliases = Array.from(name.matchAll(/[（(]\s*([^（）()]+?)\s*[）)]/g))
    .map((match) => normalizeScriptCharacterCueName(match[1]))
    .filter(Boolean);
  const withoutParen = normalizeScriptCharacterCueName(name.replace(/[（(][^（）()]+[）)]/g, ""));
  return [normalized, withoutParen, ...parenAliases]
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
};

export const inferDiscoveredCharacterRoleType = (name: string): "supporting" | "extra" => {
  const normalized = normalizeTemporaryCharacterStateName(name);
  return EXTRA_ROLE_NAME_TERMS.some((term) => normalized.includes(term)) ? "extra" : "supporting";
};

export const areDiscoveredCharacterNamesEquivalent = (left: string, right: string) =>
  normalizeScriptCharacterCueName(left) === normalizeScriptCharacterCueName(right);

const isGenericDiscoveredCharacterDescriptor = (name: string) => {
  const normalized = normalizeTemporaryCharacterStateName(name);
  return EXTRA_ROLE_NAME_TERMS.some((term) => normalized.includes(term)) ||
    GENERIC_IDENTITY_TERMS.some((term) => normalized.includes(term));
};

export const plannedCharacterCoversDiscoveredName = (
  plannedCharacter: { name?: string; brief?: string },
  discoveredName: string,
) => {
  const normalizedDiscovered = normalizeTemporaryCharacterStateName(discoveredName);
  const normalizedPlanned = normalizeTemporaryCharacterStateName(plannedCharacter.name || "");
  if (!normalizedDiscovered || !normalizedPlanned) return false;
  if (normalizedDiscovered === normalizedPlanned) return true;
  if (normalizedPlanned.includes(normalizedDiscovered) || normalizedDiscovered.includes(normalizedPlanned)) {
    return Math.min(normalizedDiscovered.length, normalizedPlanned.length) >= 2;
  }
  if (!isGenericDiscoveredCharacterDescriptor(normalizedDiscovered)) return false;
  const searchableBrief = (plannedCharacter.brief || "").replace(/\s+/g, "");
  return normalizedDiscovered.length >= 2 && searchableBrief.includes(normalizedDiscovered);
};

export const normalizeLocationCandidateName = (name: string) =>
  name
    .trim()
    .replace(/^场景[:：]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[。；;，,、]+$/g, "")
    .trim();

export const splitLocationCandidateNames = (name: string) => {
  const normalized = normalizeLocationCandidateName(name);
  if (!normalized) return [];

  return normalized
    .split(/[\/／|、，,；;]+|\s+(?:和|与)\s+/g)
    .map(normalizeLocationCandidateName)
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
};

export const extractScriptSceneHeadingLocationName = (heading: string) => {
  const withoutSetting = heading
    .trim()
    .replace(/^\s*(?:INT\.?\s*\/\s*EXT\.?|INT\/EXT\.?|INT\.?|EXT\.?|内景|外景|内外景)\s*/i, "");
  const withoutTime = withoutSetting
    .replace(/\s+[-–—]\s*(?:DAY|NIGHT|DAWN|DUSK|CONTINUOUS|MORNING|AFTERNOON|EVENING|LATER|SAME TIME|白天|夜晚|清晨|黎明|黄昏|傍晚|夜|日|连续|稍后|同一时间)\s*$/i, "")
    .replace(/\s+[-–—]\s*[^-–—]{1,24}\s*$/u, "");
  return normalizeLocationCandidateName(withoutTime);
};

export const getBreakdownLocationCandidateNames = (location: unknown) => {
  if (!location) return [];
  const rawName = typeof location === "object" && "name" in location
    ? String((location as { name?: unknown }).name || "")
    : String(location);
  return splitLocationCandidateNames(rawName);
};
