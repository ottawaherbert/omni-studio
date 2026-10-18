import type {
  ProductionAssetCandidate,
  ProductionImportedScene,
  ProductionImportedScriptBlock,
  ProductionImportedScriptProject,
  ProductionSceneBreakdown,
  ProductionScriptPrepPackage,
  ProductionStoryboardBeat,
} from "../../domains/production";

const unique = <T,>(items: T[]) => [...new Set(items.filter(Boolean))];

const sceneLocation = (scene: ProductionImportedScene) => {
  const heading = scene.scriptBlocks.find((block) => block.type === "scene_heading")?.content || scene.title;
  return heading.replace(/^(INT\.|EXT\.|内景|外景|内外景)\s*/i, "").split(/[-—]/)[0].trim() || scene.title;
};

const sceneCharacters = (scene: ProductionImportedScene) =>
  unique([
    ...scene.characters,
    ...scene.scriptBlocks
      .filter((block) => block.type === "character")
      .map((block) => block.content.replace(/\(.*?\)/g, "").trim()),
  ]);

const sceneProps = (scene: ProductionImportedScene) => {
  const text = scene.sourceText;
  const bracketTerms = Array.from(text.matchAll(/《([^》]{1,24})》/g)).map((match) => match[1]);
  const quotedTerms = Array.from(text.matchAll(/“([^”]{1,16})”/g)).map((match) => match[1]);
  return unique([...bracketTerms, ...quotedTerms]);
};

const collectScenes = (project: ProductionImportedScriptProject) =>
  project.episodes.flatMap((episode) => episode.scenes.map((scene) => ({ episodeId: episode.id, scene })));

const breakdownForScene = (episodeId: string, scene: ProductionImportedScene): ProductionSceneBreakdown => ({
  sceneId: scene.id,
  episodeId,
  characters: sceneCharacters(scene),
  location: sceneLocation(scene),
  props: sceneProps(scene),
  productionNotes: [
    scene.synopsis ? `Scene purpose: ${scene.synopsis}` : "",
    scene.sourceSceneId ? `Imported from source scene ${scene.sourceSceneId}` : "",
  ].filter(Boolean),
});

const assetCandidates = (breakdowns: ProductionSceneBreakdown[]): ProductionAssetCandidate[] => {
  const buckets = new Map<string, ProductionAssetCandidate>();
  const add = (kind: ProductionAssetCandidate["kind"], name: string, sceneId: string, rationale: string) => {
    const key = `${kind}:${name}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.sourceSceneIds = unique([...existing.sourceSceneIds, sceneId]);
      return;
    }
    buckets.set(key, { id: `asset_${kind}_${buckets.size + 1}`, kind, name, sourceSceneIds: [sceneId], rationale });
  };
  breakdowns.forEach((item) => {
    item.characters.forEach((name) => add("character", name, item.sceneId, "角色出现在导入剧本场次中"));
    if (item.location) add("location", item.location, item.sceneId, "场次标题或空间描述需要制片场地");
    item.props.forEach((name) => add("prop", name, item.sceneId, "正文中出现可追踪道具或概念物"));
  });
  return [...buckets.values()];
};

const beatType = (block: ProductionImportedScriptBlock): ProductionStoryboardBeat["beatType"] => {
  if (block.type === "scene_heading") return "establishing";
  if (block.type === "dialogue" || block.type === "character") return "dialogue";
  if (block.type === "transition") return "transition";
  if (block.type === "parenthetical") return "reaction";
  return "action";
};

const shotSize = (type: ProductionStoryboardBeat["beatType"]): ProductionStoryboardBeat["suggestedShotSize"] =>
  type === "establishing" ? "wide" : type === "dialogue" || type === "reaction" ? "close" : "medium";

const storyboardForScene = (scene: ProductionImportedScene): ProductionStoryboardBeat[] =>
  scene.scriptBlocks
    .filter((block) => block.content.trim())
    .map((block, index) => {
      const type = beatType(block);
      return {
        id: `beat_${scene.id}_${index + 1}`,
        sceneId: scene.id,
        sourceBlockId: block.id,
        index: index + 1,
        beatType: type,
        text: block.content,
        suggestedShotSize: shotSize(type),
        productionIntent: type === "dialogue" ? "保留人物关系和潜台词" : "保留动作因果和场面调度",
      };
    });

export const prepareProductionScript = (
  project: ProductionImportedScriptProject,
  generatedAt = Date.now(),
): ProductionScriptPrepPackage => {
  const scenes = collectScenes(project);
  const breakdowns = scenes.map(({ episodeId, scene }) => breakdownForScene(episodeId, scene));
  return {
    projectId: project.id,
    generatedAt,
    breakdowns,
    assetCandidates: assetCandidates(breakdowns),
    storyboardBeats: scenes.flatMap(({ scene }) => storyboardForScene(scene)),
  };
};
