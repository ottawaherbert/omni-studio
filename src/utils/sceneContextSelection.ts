import type { ContextOption } from "../components/PromptEditorModal";
import type { Project, Scene } from "../types/project";
import { collectProjectAssetsForContext } from "./projectAssetContext";

const normalizeText = (value?: string) => (value || "").trim();

const buildSceneText = (scene: Partial<Scene>, extraText = "") =>
  [
    scene.title,
    scene.description,
    scene.sceneGoal,
    scene.sceneAssets,
    scene.hook,
    scene.cliffhanger,
    extraText,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join("\n");

export const inferSceneMentionedContextIds = (
  project: Project,
  scene: Partial<Scene>,
  extraText = "",
) => {
  const sceneText = buildSceneText(scene, extraText);
  const characterIds = new Set<string>();
  const assetIds = new Set<string>();

  (project.characters || []).forEach((character) => {
    if (character.name && sceneText.includes(character.name)) {
      characterIds.add(character.id);
    }
  });

  collectProjectAssetsForContext(project).forEach((asset) => {
    if (asset.name && sceneText.includes(asset.name)) {
      assetIds.add(asset.id);
    }
  });

  return { characterIds, assetIds };
};

export const createSceneScopedContextSelection = (
  project: Project,
  contextOptions: ContextOption[],
  defaultSelectedContextIds: string[],
  scene: Partial<Scene>,
  extraText = "",
) => {
  const { characterIds, assetIds } = inferSceneMentionedContextIds(project, scene, extraText);
  if (characterIds.size === 0 && assetIds.size === 0) {
    return { contextOptions, defaultSelectedContextIds };
  }

  const filteredRelationships = (project.relationships || []).filter(
    (relationship: any) => characterIds.has(relationship.sourceId) && characterIds.has(relationship.targetId),
  );
  const scopedContextOptions = contextOptions.map((option) => {
    if (option.id !== "ctx_relationships") return option;
    if (filteredRelationships.length === 0) {
      return {
        ...option,
        value: "",
      };
    }
    const relsStr = filteredRelationships
      .map((relationship: any) => {
        const sourceChar = project.characters?.find((character: any) => character.id === relationship.sourceId);
        const targetChar = project.characters?.find((character: any) => character.id === relationship.targetId);
        const dynamicsStr =
          relationship.dynamics && Object.keys(relationship.dynamics).length > 0
            ? ` [动态维度: ${JSON.stringify(relationship.dynamics)}]`
            : "";
        if (!sourceChar?.name || !targetChar?.name) return "";
        return `- ${sourceChar.name} -> ${targetChar.name}: [${relationship.type}] ${relationship.description}${dynamicsStr}`;
      })
      .filter(Boolean)
      .join("\n");
    return {
      ...option,
      value: `<relationships>\n${relsStr}\n</relationships>`,
    };
  });

  const scopedDefaultIds = defaultSelectedContextIds.filter((id) => {
    if (id.startsWith("ctx_char_")) {
      return characterIds.has(id.replace("ctx_char_", ""));
    }
    if (id.startsWith("ctx_asset_")) {
      return assetIds.has(id.replace("ctx_asset_", ""));
    }
    if (id === "ctx_relationships") {
      return filteredRelationships.length > 0;
    }
    return true;
  });

  return {
    contextOptions: scopedContextOptions,
    defaultSelectedContextIds: scopedDefaultIds,
  };
};
