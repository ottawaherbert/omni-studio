import type { Asset, Character, Scene, Shot } from "../../../../types/project";
import type {
  ProductionDepartmentFinding,
  ProductionQAIssue,
  ProductionStageType,
} from "../../../../types/production";
import type { ProductionCoordinationSnapshot } from "../../productionCoordination";
import type {
  SceneVisualPack,
  SceneVisualPackCharacter,
  SceneVisualPackProp,
} from "../../videoStoryboardArtifacts";
import { validateSceneVisualPack } from "../../videoStoryboardArtifacts";
import { collectProductionCoordinationArtifacts } from "../artifacts";
import {
  asArray,
  compact,
  coordinationIssue,
  departmentFindingFromIssues,
  refsForSnapshot,
} from "../shared";
import { videoStoryboardIssueToProductionIssue } from "../videoStoryboardIssues";

const scenePackStageTypes = new Set<ProductionStageType>([
  "asset_sync",
  "storyboard",
  "prompt",
  "expensive_generation_planning",
]);

const unique = (items: Array<string | undefined>) =>
  Array.from(new Set(items.map((item) => compact(item)).filter(Boolean)));

const sceneExpectedVisualRefs = (scene: Scene) => {
  const shots = asArray<Shot>(scene.shots);
  return {
    characterIds: unique([
      ...asArray<string>(scene.breakdown?.characterIds),
      ...shots.flatMap((shot) => asArray<string>(shot.characterIdsInShot)),
    ]),
    propIds: unique([
      ...asArray<string>(scene.breakdown?.propIds),
      ...shots.flatMap((shot) => asArray<string>(shot.propIds)),
    ]),
    locationIds: unique([
      scene.breakdown?.locationId,
      ...shots.map((shot) => shot.locationId),
    ]),
  };
};

const packCoversScene = (pack: SceneVisualPack, sceneId: string) =>
  asArray<string>(pack.sourceSceneIds).includes(sceneId) || asArray<string>(pack.linkedSceneIds).includes(sceneId);

export const runAssetCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => {
  const bundle = collectProductionCoordinationArtifacts(snapshot.operatorArtifacts);
  const issues: ProductionQAIssue[] = [];
  const characterIds = new Set(asArray<Character>(snapshot.project.characters).map((character) => character.id));
  const assets = asArray<Asset>(snapshot.project.assets);
  const assetIds = new Set(assets.map((asset) => asset.id));
  const locationIds = new Set(assets.filter((asset) => asset.type === "location").map((asset) => asset.id));
  const propIds = new Set(assets.filter((asset) => asset.type === "prop").map((asset) => asset.id));

  if (!characterIds.size) {
    issues.push(coordinationIssue(
      "project.characters",
      "项目缺少角色资产，后续资产统筹无法建立角色板。",
      "warning",
      undefined,
      { issueType: "asset_coordination" },
    ));
  }
  if (!assetIds.size) {
    issues.push(coordinationIssue(
      "project.assets",
      "项目缺少地点/道具资产，后续场景视觉包可能无法复用。",
      "warning",
      undefined,
      { issueType: "asset_coordination" },
    ));
  }
  if (snapshot.stageType && scenePackStageTypes.has(snapshot.stageType) && bundle.sceneVisualPacks.length === 0) {
    issues.push(coordinationIssue(
      "operatorArtifacts.scene_visual_pack",
      "当前阶段建议具备 scene_visual_pack，避免从全项目资产池抓参考导致角色、服化道或道具污染。",
      "warning",
      "在 asset_sync 阶段为当前场生成 scene_visual_pack；相同 visualFingerprint 的场次应复用，不要重复创建。",
      { issueType: "asset_coordination" },
    ));
  }

  for (const pack of bundle.sceneVisualPacks) {
    issues.push(...validateSceneVisualPack(pack, bundle.sceneVisualPacks, snapshot.project)
      .map((item) => videoStoryboardIssueToProductionIssue(item, "asset_coordination")));
  }

  for (const scene of snapshot.scenes) {
    const expected = sceneExpectedVisualRefs(scene);
    const packs = bundle.sceneVisualPacks.filter((pack) => packCoversScene(pack, scene.id));
    if (packs.length === 0 && (expected.characterIds.length || expected.propIds.length || expected.locationIds.length)) {
      issues.push(coordinationIssue(
        `episodes.scenes.${scene.id}.sceneVisualPack`,
        `场景 ${scene.title || scene.id} 已声明角色/地点/道具，但没有对应 scene_visual_pack。`,
        "warning",
        "为该场建立或复用 scene_visual_pack，并把当前场的角色变体、地点状态、道具状态写入 pack。",
        { issueType: "asset_coordination" },
      ));
      continue;
    }
    for (const pack of packs) {
      const packCharacters = new Set(asArray<SceneVisualPackCharacter>(pack.characters).map((character) => character.characterId).filter(Boolean));
      const packProps = new Set(asArray<SceneVisualPackProp>(pack.props).map((prop) => prop.assetId).filter(Boolean));
      for (const characterId of expected.characterIds) {
        if (!packCharacters.has(characterId)) {
          issues.push(coordinationIssue(
            `sceneVisualPack.${pack.id}.characters`,
            `场景 ${scene.title || scene.id} 需要角色 ${characterId}，但视觉包未包含该角色状态。`,
            "warning",
            "把该角色的当前服装、发妆、伤势、情绪基线补入 scene_visual_pack.characters。",
            { issueType: "asset_coordination" },
          ));
        }
      }
      for (const propId of expected.propIds) {
        if (!packProps.has(propId)) {
          issues.push(coordinationIssue(
            `sceneVisualPack.${pack.id}.props`,
            `场景 ${scene.title || scene.id} 需要道具 ${propId}，但视觉包未包含该道具状态。`,
            "warning",
            "把该道具的持有人、使用状态和连续性状态补入 scene_visual_pack.props。",
            { issueType: "asset_coordination" },
          ));
        }
      }
      for (const characterId of Array.from(packCharacters)) {
        if (expected.characterIds.length && !expected.characterIds.includes(characterId)) {
          issues.push(coordinationIssue(
            `sceneVisualPack.${pack.id}.characters.${characterId}`,
            `视觉包包含场景未声明的角色 ${characterId}，可能造成参考图污染。`,
            "warning",
            "确认该角色是否确实入场；若不是当前场所需，应移出本场 scene_visual_pack。",
            { issueType: "asset_coordination" },
          ));
        }
      }
    }
  }

  for (const shot of snapshot.shots) {
    for (const characterId of asArray<string>(shot.characterIdsInShot)) {
      if (characterId && !characterIds.has(characterId)) {
        issues.push(coordinationIssue(
          `shots.${shot.id}.characterIdsInShot`,
          `镜头引用了不存在的角色资产：${characterId}。`,
          "blocking",
          "先修复镜头角色引用或补齐角色资产，再进入故事板/提示词。",
          { issueType: "asset_coordination", retryable: true },
        ));
      }
    }
    if (shot.locationId && !locationIds.has(shot.locationId)) {
      issues.push(coordinationIssue(
        `shots.${shot.id}.locationId`,
        `镜头引用了不存在的地点资产：${shot.locationId}。`,
        "blocking",
        "先修复镜头地点引用或补齐地点资产，再进入故事板/提示词。",
        { issueType: "asset_coordination", retryable: true },
      ));
    }
    for (const propId of asArray<string>(shot.propIds)) {
      if (propId && !propIds.has(propId)) {
        issues.push(coordinationIssue(
          `shots.${shot.id}.propIds`,
          `镜头引用了不存在的道具资产：${propId}。`,
          "blocking",
          "先修复镜头道具引用或补齐道具资产，再进入故事板/提示词。",
          { issueType: "asset_coordination", retryable: true },
        ));
      }
    }
  }

  return departmentFindingFromIssues({
    department: "asset",
    issues,
    passedMessage: "资产统筹未发现当前范围的结构性缺口。",
    target: "coordination.asset",
    ownerAgentId: "linear.asset_sync.scene_visual_pack_planner",
    suggestedStageType: "asset_sync",
    evidenceRefs: refsForSnapshot(snapshot),
  });
};
