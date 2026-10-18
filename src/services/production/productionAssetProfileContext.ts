import type {
  Asset,
  Character,
  Episode,
  ManualFilmTeamDepartment,
  Project,
  Scene,
} from "../../types/project";

export interface ProductionAssetProfileContextOption {
  id: string;
  label: string;
  value: string;
}

export interface ProductionAssetProfileTarget {
  id: string;
  name: string;
  kind: "character" | "location" | "prop";
}

const characterDepartments = new Set<ManualFilmTeamDepartment>([
  "directing",
  "cinematography",
  "lighting",
  "wardrobe",
  "makeup_hair",
  "performance_directing",
  "continuity",
  "sound_music",
]);

const locationDepartments = new Set<ManualFilmTeamDepartment>([
  "directing",
  "production_coordination",
  "cinematography",
  "lighting",
  "production_design",
  "continuity",
  "sound_music",
]);

const propDepartments = new Set<ManualFilmTeamDepartment>([
  "directing",
  "production_coordination",
  "cinematography",
  "production_design",
  "action_choreography",
  "props",
  "continuity",
]);

const relevantDepartments = (kind: ProductionAssetProfileTarget["kind"]) =>
  kind === "character" ? characterDepartments : kind === "location" ? locationDepartments : propDepartments;

const namedEntityName = (entity: string | { name: string }) =>
  typeof entity === "string" ? entity : entity.name;

const sceneUsesTarget = (scene: Scene, target: ProductionAssetProfileTarget) => {
  const breakdown = scene.breakdown;
  if (!breakdown) return Boolean(target.name.trim() && [scene.script, scene.sourceEvidence].some(text => text?.includes(target.name.trim())));
  if (target.kind === "character") {
    return scene.shots?.some(shot => shot.characterIdsInShot?.includes(target.id))
      || Boolean(target.name.trim() && scene.script?.includes(target.name.trim()))
      || breakdown.characterIds?.includes(target.id)
      || breakdown.characters.some((item) => namedEntityName(item) === target.name);
  }
  if (target.kind === "location") {
    return breakdown.locationId === target.id || namedEntityName(breakdown.location) === target.name;
  }
  return breakdown.propIds?.includes(target.id)
    || breakdown.props.some((item) => namedEntityName(item) === target.name);
};

const targetBreakdownFor = (scene: Scene, target: ProductionAssetProfileTarget) => {
  const breakdown = scene.breakdown;
  if (!breakdown) return undefined;
  const namedTarget = (items: Array<string | { name: string; state?: string }>) => items.filter((item) =>
    namedEntityName(item) === target.name
  );
  return {
    setting: breakdown.setting,
    time: breakdown.time,
    ...(target.kind === "character" ? {
      characters: namedTarget(breakdown.characters),
      wardrobe: breakdown.wardrobe || [],
      makeupHair: breakdown.makeupHair || [],
    } : target.kind === "location" ? {
      location: namedEntityName(breakdown.location) === target.name ? breakdown.location : undefined,
    } : {
      props: namedTarget(breakdown.props),
    }),
  };
};

const sourceTextFor = (scene: Scene, target: ProductionAssetProfileTarget) => [
  scene.sourceEvidence && scene.sourceEvidence !== scene.script ? `【来源证据】\n${scene.sourceEvidence}` : "",
  scene.script ? `【正式场次剧本】\n${scene.script}` : `【场次描述】\n${scene.description}`,
  scene.breakdown ? `【与当前资产相关的拆解参考，以原文为准】\n${JSON.stringify(targetBreakdownFor(scene, target), null, 2)}` : "",
].filter(Boolean).join("\n\n");

export const productionAssetProfileTarget = (target: Character | Asset): ProductionAssetProfileTarget => ({
  id: target.id,
  name: target.name,
  kind: "type" in target
    ? target.type === "location" ? "location" : "prop"
    : "character",
});

export const buildProductionAssetProfileContext = (
  project: Project,
  target: ProductionAssetProfileTarget,
  episodes: Episode[],
): { options: ProductionAssetProfileContextOption[]; defaultIds: string[] } => {
  const usages = episodes.flatMap((episode) => episode.scenes
    .filter((scene) => sceneUsesTarget(scene, target))
    .map((scene) => ({ episode, scene })));
  const options: ProductionAssetProfileContextOption[] = [];
  const optionalSourceIds = new Set<string>();

  if (usages.length) {
    const id = `ctx_productionAssetSource_${target.id}`;
    const scenes = usages.map(({ episode, scene }) => [
      `【使用场次 · ${episode.title} / ${scene.title}】`,
      sourceTextFor(scene, target),
    ].join("\n")).join("\n\n");
    options.push({
      id,
      label: `相关场次剧本与拆解参考：${target.name}`,
      value: [
        `<production_asset_source targetName="${target.name}" targetKind="${target.kind}">`,
        "事实优先级：来源原文与作者明确决定优先；拆解和部门方案需与原文核对，不因带有【剧本事实】标签就视为事实。不得用建议覆盖剧本事实。",
        scenes,
        "</production_asset_source>",
      ].filter(Boolean).join("\n\n"),
    });
  }
  {
    // Newly registered identities have no adopted scene bindings yet. Keep
    // source documents available without inventing a confirmed usage or QA.
    const documents = project.productionSourceDocuments || [];
    for (const document of documents) {
      const id = `ctx_productionAssetImportedSource_${target.id}_${document.id}`;
      const nameAppears = target.name.trim() && document.content.includes(target.name.trim());
      if (documents.length > 1 && !nameAppears) optionalSourceIds.add(id);
      options.push({
        id,
        label: `导入原文：${document.title}`,
        value: [
          `<production_asset_unbound_source targetName="${target.name}" targetKind="${target.kind}" sourceId="${document.id}">`,
          `${usages.length ? "场次绑定不代表已覆盖全部原文。" : "当前资产尚无已确认场次绑定。"}以下是完整导入来源，不代表本资产在其中每场出现；请依据正文判断当前角色或物件的事实、基础身份与场次状态。不要将尚未采用的拆解或部门草稿当作已确认事实。`,
          document.content,
          "</production_asset_unbound_source>",
        ].join("\n\n"),
      });
    }
  }

  const usageSceneIds = new Set(usages.map(({ scene }) => scene.id));
  const departments = relevantDepartments(target.kind);
  const departmentResults = usages.flatMap(({ episode }) => episode.productionTeam?.outputs || [])
    .filter((output, index, outputs) =>
      output.status === "confirmed"
      && departments.has(output.department)
      && outputs.findIndex((candidate) => candidate.department === output.department && candidate.sourceScriptHash === output.sourceScriptHash) === index
    )
    .map((output) => ({
      department: output.department,
      scenePlans: (output.scenePlans || [])
        .filter((plan) => usageSceneIds.has(plan.sceneId))
        .map((plan) => ({
          sceneTitle: plan.sceneTitle,
          summary: plan.summary,
          executionNotes: plan.executionNotes,
          assetNeeds: plan.assetNeeds,
          continuityNotes: plan.continuityNotes,
          handoffNotes: plan.handoffNotes,
        })),
    }))
    .filter((result) => result.scenePlans.length > 0);

  if (departmentResults.length) {
    const id = `ctx_productionAssetDepartments_${target.id}`;
    options.push({
      id,
      label: `已采用部门连续性：${target.name}`,
      value: [
        `<production_asset_departments targetName="${target.name}">`,
        "以下是已采用的专业部门结果。标为【剧本事实】的内容仍需与原文核对；带【部门建议】的内容只能作为候选设计，采用前不得伪装成既定事实。",
        JSON.stringify(departmentResults, null, 2),
        "</production_asset_departments>",
      ].join("\n\n"),
    });
  }

  return { options, defaultIds: options.filter((option) => !optionalSourceIds.has(option.id)).map((option) => option.id) };
};
