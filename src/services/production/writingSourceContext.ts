import type { EpisodeMeta, Project, Scene } from "../../types/project";
import { productionSourceDocumentForEpisode } from "./productionSourceDocuments";

const text = (value: unknown) => String(value || "").trim();
const deliveryContextLines = (source:NonNullable<Project['productionSourceSnapshot']>,unitId:string) => {
  if(source.sourceType!=='writing_export')return [];
  const delivery=source.package;
  return [
    delivery.aspectRatio && `作者画幅：${delivery.aspectRatio}`,
    delivery.language && `作者语言：${delivery.language}`,
    delivery.productionMethod && `作者制作方式：${delivery.productionMethod}`,
    ...(delivery.authorRequirements||[]).filter(Boolean).map(requirement=>`作者要求：${requirement}`),
    ...delivery.lore.filter(fact=>fact.category==='coreRule'&&(!fact.sourceUnitIds||fact.sourceUnitIds.includes(unitId)))
      .map(fact=>`已确认设定：${fact.definition}`),
    ...delivery.characters.filter(character=>character.bio&&(!character.sourceUnitIds||character.sourceUnitIds.includes(unitId)))
      .map(character=>`人物简介 ${character.name}：${character.bio}`),
  ].filter((line):line is string=>Boolean(line));
};

/**
 * Reads structured upstream Writing facts from the immutable import snapshot.
 * This is intentionally provenance-based: production never guesses a writing
 * scene from free text or writes changes back to the Writing project.
 */
export const productionWritingSourceContext = (
  project: Project,
  episode: Pick<EpisodeMeta, "title">,
  scene: Scene,
) => {
  const snapshot = project.productionSourceSnapshot;
  if (snapshot?.sourceType !== "writing_export" || !scene.sourceWritingUnitId) return "";

  const unit = snapshot.package.units.find((item) => item.id === scene.sourceWritingUnitId);
  if (!unit) return "";
  const sourceScene = scene.sourceWritingSceneId
    ? unit.scenes?.find((item) => item.id === scene.sourceWritingSceneId)
    : undefined;
  const unitLine = `上游${unit.kind === "sequence" ? "段落" : "分集"}：${unit.index} · ${unit.title}`;

  if (!sourceScene) {
    return [
      "【上游剧本结构化事实】",
      unitLine,
      ...deliveryContextLines(snapshot,unit.id),
      "当前制片场来自该单元正文；原始分场结构未随本场导入。",
    ].filter(Boolean).join("\n");
  }

  const beats = (sourceScene.beats || []).map((beat) => [
    `${beat.index}. ${text(beat.title) || text(beat.action) || "未命名节拍"}`,
    beat.durationSeconds ? `${beat.durationSeconds}秒` : "",
    text(beat.visibleChange),
  ].filter(Boolean).join("；")).filter(Boolean);
  return [
    "【上游剧本结构化事实】",
    unitLine,
    ...deliveryContextLines(snapshot,unit.id),
    `上游分场：${sourceScene.index} · ${sourceScene.title}`,
    text(sourceScene.locationText) && `地点事实：${text(sourceScene.locationText)}`,
    text(sourceScene.timeText) && `时间事实：${text(sourceScene.timeText)}`,
    sourceScene.characters.length && `本场人物：${sourceScene.characters.join("、")}`,
    sourceScene.sceneAssets?.length && `本场资产语义提示：${sourceScene.sceneAssets.join("、")}`,
    text(sourceScene.irreversibleChange) && `不可逆变化：${text(sourceScene.irreversibleChange)}`,
    text(sourceScene.continuityIn) && `入场连续性：${text(sourceScene.continuityIn)}`,
    text(sourceScene.continuityOut) && `离场连续性：${text(sourceScene.continuityOut)}`,
    beats.length ? `场内可见变化：\n${beats.map((beat) => `- ${beat}`).join("\n")}` : "",
    text(episode.title) && `当前制片单元：${episode.title}`,
  ].filter(Boolean).join("\n");
};

/**
 * Projects the immutable Writing unit and its structured scene references for
 * episode/segment-level department preparation. Production remains read-only.
 */
export const productionWritingUnitSourceContext = (
  project: Project,
  episode: Pick<EpisodeMeta, "title" | "sourceDocumentId">,
) => {
  const snapshot = project.productionSourceSnapshot;
  if (snapshot?.sourceType !== "writing_export") return "";
  const sourceDocument = productionSourceDocumentForEpisode(project, episode);
  const sourceWritingUnitId = sourceDocument?.sourceWritingUnitId;
  if (!sourceWritingUnitId) return "";
  const unit = snapshot.package.units.find((item) => item.id === sourceWritingUnitId);
  if (!unit) return "";

  const sceneReferences = (unit.scenes || []).map((scene) => [
    `${scene.index}. ${text(scene.title) || "未命名上游分场"}`,
    text(scene.purpose) && `意图：${text(scene.purpose)}`,
    text(scene.continuityIn) && `入场：${text(scene.continuityIn)}`,
    text(scene.continuityOut) && `出场：${text(scene.continuityOut)}`,
  ].filter(Boolean).join("；"));

  return [
    "【上游剧本结构化事实（只读）】",
    `上游${unit.kind === "sequence" ? "段落" : "分集"}：${unit.index} · ${unit.title}`,
    ...deliveryContextLines(snapshot,unit.id),
    text(unit.summary) && `单元摘要：${text(unit.summary)}`,
    sceneReferences.length ? `上游分场参考：\n${sceneReferences.map((item) => `- ${item}`).join("\n")}` : "",
    text(episode.title) && `当前制片单元：${episode.title}`,
  ].filter(Boolean).join("\n");
};
