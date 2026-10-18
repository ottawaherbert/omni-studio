export interface LegacyDemoAssetRecord {
  ownerId: string;
  ownerType: "character" | "asset";
  field: "model3dUrl" | "panoramaUrl";
  url: string;
  source: "legacy_demo";
}

export type LegacyDemoQuarantinedProject<T> = T & {
  legacyDemoAssets?: LegacyDemoAssetRecord[];
};

const legacyDemoPatterns = [
  /KhronosGroup\/glTF-Sample-Models\/.*\/Duck\.glb(?:$|[?#])/i,
  /threejs\.org\/examples\/textures\/equirectangular\/royal_esplanade_1k\.hdr(?:$|[?#])/i,
];

export const isLegacyDemoAssetUrl = (value: unknown): value is string =>
  typeof value === "string" && legacyDemoPatterns.some((pattern) => pattern.test(value));

/**
 * Old builds returned two public sample files as if generation had succeeded.
 * They remain visible in the audit ledger, but are removed from usable asset
 * fields so downstream storyboards cannot mistake them for authored media.
 */
export const quarantineLegacyDemoProjectData = <T extends Record<string, any>>(
  project: T,
): LegacyDemoQuarantinedProject<T> => {
  const records: LegacyDemoAssetRecord[] = Array.isArray(project.legacyDemoAssets)
    ? [...project.legacyDemoAssets]
    : [];
  const seen = new Set(records.map((record) => `${record.ownerType}:${record.ownerId}:${record.field}:${record.url}`));
  const quarantine = (
    owner: Record<string, any>,
    ownerType: LegacyDemoAssetRecord["ownerType"],
  ) => {
    const next = { ...owner };
    (["model3dUrl", "panoramaUrl"] as const).forEach((field) => {
      const url = next[field];
      if (!isLegacyDemoAssetUrl(url)) return;
      const record: LegacyDemoAssetRecord = {
        ownerId: String(next.id || "unknown"),
        ownerType,
        field,
        url,
        source: "legacy_demo",
      };
      const key = `${record.ownerType}:${record.ownerId}:${record.field}:${record.url}`;
      if (!seen.has(key)) {
        records.push(record);
        seen.add(key);
      }
      delete next[field];
      if (ownerType === "asset") {
        next.tags = [...new Set([...(Array.isArray(next.tags) ? next.tags : []), "legacy_demo"])];
      }
    });
    return next;
  };

  const characters = Array.isArray(project.characters)
    ? project.characters.map((character: Record<string, any>) => quarantine(character, "character"))
    : project.characters;
  const assets = Array.isArray(project.assets)
    ? project.assets.map((asset: Record<string, any>) => quarantine(asset, "asset"))
    : project.assets;
  if (records.length === 0) return project;
  return {
    ...project,
    characters,
    assets,
    legacyDemoAssets: records,
  };
};
