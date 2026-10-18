import { useState } from "react";
import type { ProductionScenePlanCandidate, ProductionInteractivePrepProfile } from "../../../clients/domainTypes";
import type { ScriptExportScene } from "../../../../packages/domain/src/scriptDelivery";
import { validateProductionScenePlanSource } from "../../../clients/productionPreparationWorkflowClient";

type PlanningNode = ProductionInteractivePrepProfile["nodes"][number];
type Draft = ProductionScenePlanCandidate & { durationText: string };

type SourceScene = Pick<ScriptExportScene, "id" | "title" | "synopsis" | "purpose" | "continuityIn" | "continuityOut" | "targetDurationSeconds" | "targetDurationMinutes"> & {
  readonly blocks: ReadonlyArray<Pick<ScriptExportScene["blocks"][number], "type" | "content">>;
};
const evidenceFor = (scene: Pick<SourceScene, "blocks">) => scene.blocks.map((block) => block.content.trim()).filter(Boolean).join("\n");

export const initialManualScenePlan = (
  sourceText: string,
  sourceScenes: readonly SourceScene[],
  nodes: PlanningNode[],
  targetDurationMinutes?: number,
): ProductionScenePlanCandidate[] => {
  const headings = [...sourceText.matchAll(/^## [^\r\n]+/gm)];
  const canUseHeadings = headings.length === sourceScenes.length && !sourceText.slice(0, headings[0]?.index ?? 0).trim();
  const scenes = sourceScenes.map((scene, index): ProductionScenePlanCandidate => ({
    id: crypto.randomUUID(),
    order: index + 1,
    title: scene.title || `第 ${index + 1} 场`,
    description: scene.synopsis || scene.purpose || "",
    purpose: scene.purpose,
    sourceEvidence: canUseHeadings ? sourceText.slice(headings[index].index, headings[index + 1]?.index).trim() : evidenceFor(scene),
    scriptBlocks: scene.blocks.map((block) => ({ type: block.type === "prose" ? "action" as const : block.type, content: block.content.trim() })).filter((block) => block.content),
    continuityIn: scene.continuityIn,
    continuityOut: scene.continuityOut,
    targetDurationMinutes: scene.targetDurationSeconds ? scene.targetDurationSeconds / 60 : scene.targetDurationMinutes,
    interactiveNodeIds: nodes.filter((node) => (node.sourceSceneRefs?.length ? node.sourceSceneRefs : node.sourceSceneRef ? [node.sourceSceneRef] : [])
      .some((ref) => ref.artifactId.endsWith(`:${scene.id}`))).map((node) => node.nodeId),
  }));
  const missingDurations = scenes.filter((scene) => !scene.targetDurationMinutes);
  const remainingMinutes = (targetDurationMinutes || 0) - scenes.reduce((total, scene) => total + (scene.targetDurationMinutes || 0), 0);
  if (remainingMinutes > 0 && missingDurations.length) missingDurations.forEach((scene) => { scene.targetDurationMinutes = remainingMinutes / missingDurations.length; });
  try { return validateProductionScenePlanSource(sourceText, scenes); }
  catch {
    return [{
      id: crypto.randomUUID(), order: 1, title: "第 1 场", description: "", sourceEvidence: sourceText,
      targetDurationMinutes, interactiveNodeIds: nodes.map((node) => node.nodeId),
    }];
  }
};

export function ManualScenePlanEditor({ initialScenes, sourceText, nodes, targetDurationMinutes, onCancel, onConfirm }: {
  initialScenes: ProductionScenePlanCandidate[];
  sourceText: string;
  nodes: PlanningNode[];
  targetDurationMinutes?: number;
  onCancel: () => void;
  onConfirm: (scenes: ProductionScenePlanCandidate[]) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() => initialScenes.map((scene) => ({ ...scene, durationText: scene.targetDurationMinutes ? String(scene.targetDurationMinutes) : "" })));
  const [error, setError] = useState("");
  const field = (id: string, patch: Partial<Draft>) => { setError(""); setDrafts((current) => current.map((scene) => scene.id === id ? { ...scene, ...patch } : scene)); };
  const submit = () => {
    const scenes: ProductionScenePlanCandidate[] = drafts.map(({ durationText, ...scene }, index) => ({
      ...scene, order: index + 1, title: scene.title.trim(), description: scene.description.trim(),
      sourceEvidence: scene.sourceEvidence.trim(),
      // A changed excerpt must not retain blocks from the old source scene.
      scriptBlocks: scene.scriptBlocks && initialScenes.find((initial) => initial.id === scene.id)?.sourceEvidence.trim() === scene.sourceEvidence.trim() ? scene.scriptBlocks : undefined,
      targetDurationMinutes: durationText.trim() ? Number(durationText) : undefined,
    }));
    if (scenes.some((scene) => !scene.title || !scene.description)) { setError("每场都需要标题和内容概述。"); return; }
    if (scenes.some((scene) => !Number.isFinite(scene.targetDurationMinutes) || (scene.targetDurationMinutes || 0) <= 0)) { setError("每场都需要大于 0 的目标时长。"); return; }
    const duration = scenes.reduce((total, scene) => total + (scene.targetDurationMinutes || 0), 0);
    if (targetDurationMinutes && Math.abs(duration - targetDurationMinutes) >= 0.01) { setError(`场次时长总和需与来源的 ${targetDurationMinutes} 分钟一致。`); return; }
    const covered = new Set(scenes.flatMap((scene) => scene.interactiveNodeIds || []));
    if (nodes.some((node) => !covered.has(node.nodeId))) { setError("每个互动内容节点都需要至少一个对应场次。"); return; }
    try { onConfirm(validateProductionScenePlanSource(sourceText, scenes)); }
    catch (cause) { setError(cause instanceof Error
      ? cause.message.replace("请让模型保留场次方案，补齐各场原文后重新回填。", "请补齐各场原文后再预览。")
      : "原文覆盖不完整。"); }
  };
  return <div className="space-y-4">
    <p className="text-xs leading-relaxed text-text-secondary">逐场核对正式来源。原文依据合起来必须按顺序覆盖整篇剧本；修改场次边界时，可在相邻场次之间移动原文。</p>
    {drafts.map((scene, index) => <article key={scene.id} className="rounded-2xl bg-bg-surface-soft p-4 space-y-3">
      <div className="flex items-center justify-between"><strong className="text-xs text-text-primary">第 {index + 1} 场</strong><button type="button" className="text-xs text-text-muted hover:text-text-primary" disabled={drafts.length === 1} onClick={() => setDrafts((current) => current.filter((item) => item.id !== scene.id))}>删除</button></div>
      <label className="block text-xs text-text-secondary">场次标题<input aria-label={`第 ${index + 1} 场标题`} value={scene.title} onChange={(event) => field(scene.id, { title: event.target.value })} className="mt-1 w-full rounded-xl bg-bg-surface px-3 py-2 text-text-primary outline-none" /></label>
      <label className="block text-xs text-text-secondary">内容概述<textarea aria-label={`第 ${index + 1} 场内容概述`} value={scene.description} onChange={(event) => field(scene.id, { description: event.target.value })} rows={2} className="mt-1 w-full rounded-xl bg-bg-surface px-3 py-2 text-text-primary outline-none" /></label>
      <div className="grid grid-cols-2 gap-3"><label className="block text-xs text-text-secondary">戏剧目的<input value={scene.purpose || ""} onChange={(event) => field(scene.id, { purpose: event.target.value })} className="mt-1 w-full rounded-xl bg-bg-surface px-3 py-2 text-text-primary outline-none" /></label><label className="block text-xs text-text-secondary">目标时长（分钟）<input aria-label={`第 ${index + 1} 场目标时长`} type="number" min="0.01" step="0.01" value={scene.durationText} onChange={(event) => field(scene.id, { durationText: event.target.value })} className="mt-1 w-full rounded-xl bg-bg-surface px-3 py-2 text-text-primary outline-none" /></label></div>
      {nodes.length > 0 && <fieldset className="text-xs text-text-secondary"><legend>对应互动节点</legend><div className="mt-2 flex flex-wrap gap-3">{nodes.map((node) => <label key={node.nodeId} className="flex items-center gap-1.5"><input type="checkbox" checked={scene.interactiveNodeIds?.includes(node.nodeId) || false} onChange={(event) => field(scene.id, { interactiveNodeIds: event.target.checked ? [...new Set([...(scene.interactiveNodeIds || []), node.nodeId])] : (scene.interactiveNodeIds || []).filter((id) => id !== node.nodeId) })} />{node.title}</label>)}</div></fieldset>}
      <label className="block text-xs text-text-secondary">完整原文依据<textarea aria-label={`第 ${index + 1} 场原文依据`} value={scene.sourceEvidence} onChange={(event) => field(scene.id, { sourceEvidence: event.target.value })} rows={Math.min(12, Math.max(4, scene.sourceEvidence.split("\n").length))} className="mt-1 w-full rounded-xl bg-bg-surface px-3 py-2 font-mono text-text-primary outline-none" /></label>
    </article>)}
    <button type="button" className="rounded-xl bg-bg-surface-soft px-4 py-2 text-xs font-bold text-text-primary hover:bg-bg-surface-hover" onClick={() => setDrafts((current) => [...current, { id: crypto.randomUUID(), order: current.length + 1, title: "", description: "", sourceEvidence: "", durationText: "", interactiveNodeIds: [] }])}>新增场次</button>
    {error && <p role="alert" className="text-xs text-accent-amber">{error}</p>}
    <div className="flex justify-end gap-2 border-t border-border-soft/20 pt-4"><button type="button" onClick={onCancel} className="rounded-xl bg-bg-surface-soft px-4 py-2 text-xs font-bold text-text-primary">取消</button><button type="button" onClick={submit} className="btn-primary rounded-xl px-4 py-2 text-xs font-bold">预览场次方案</button></div>
  </div>;
}
