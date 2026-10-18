import React, { useRef, useState } from 'react';
import { Sparkles, Edit3, ChevronDown, Film, Layers } from 'lucide-react';
import type { ScriptProject } from '../../../../../../packages/script/src/schema';
import {
  anchorCurrent,
  getOutlineGuide,
  outlineText,
  ownerKey,
  ownerUnits,
  setBeatSceneLink,
  type OutlineGuide,
  type OutlineOwner,
  type StoryBeat,
} from '../../../../../../packages/script/src/outlineGuides';
import { updateBeatText } from '../../../../../../packages/script/src/storylinePlanning';
import type { AssistantRequest } from '../scriptAssistantShortcuts';

type BeatText = { title: string; change: string };
const ownerLabels = { unit: '本集大纲', season: '季大纲', project: '整体大纲', story: '故事大纲' };
const sameOwner = (owner: OutlineOwner | undefined, target: OutlineOwner) =>
  Boolean(owner && ownerKey(owner) === ownerKey(target));

/** Derive the most specific containing node for each quote and unit. Scene
 * membership and similar titles do not establish an outline relationship. */
export function outlineNodesForBeat(
  project: ScriptProject,
  guide: OutlineGuide,
  beat: StoryBeat,
): Array<{ unitId: string; nodeId: string }> {
  let original: string;
  try {
    original = outlineText(project, guide.owner);
  } catch {
    return [];
  }
  if (!beat.anchors.length || !beat.anchors.every((anchor) => anchorCurrent(anchor, original))) return [];
  const nodes = new Map<string, { unitId: string; nodeId: string }>();
  for (const unit of ownerUnits(project, guide.owner)) {
    const links = guide.nodeLinks.filter(
      (link) =>
        link.unitId === unit.id &&
        anchorCurrent(link.anchor, original) &&
        unit.structureNodes?.some((node) => node.id === link.nodeId),
    );
    for (const anchor of [...beat.anchors].sort((left, right) => left.start - right.start)) {
      const link = links
        .filter((link) => anchor.start >= link.anchor.start && anchor.end <= link.anchor.end)
        .sort((left, right) => {
          const width = left.anchor.end - left.anchor.start - (right.anchor.end - right.anchor.start);
          if (width) return width;
          const leftChild = Boolean(unit.structureNodes?.find((node) => node.id === left.nodeId)?.parentId),
            rightChild = Boolean(unit.structureNodes?.find((node) => node.id === right.nodeId)?.parentId);
          return Number(rightChild) - Number(leftChild);
        })[0];
      if (link) nodes.set(`${unit.id}:${link.nodeId}`, { unitId: unit.id, nodeId: link.nodeId });
    }
  }
  return [...nodes.values()];
}

/** An explicitly selected owner and current anchors are both needed before
 * offering a story edit. The selected beat is also a frozen write allowlist. */
export function outlineBeatChangeRequest(
  project: ScriptProject,
  guide: OutlineGuide,
  beat: StoryBeat,
  unitId: string,
  editableOwner?: OutlineOwner,
): AssistantRequest | undefined {
  if (!sameOwner(editableOwner, guide.owner)) return;
  const liveGuide = getOutlineGuide(project, guide.owner),
    liveBeat = liveGuide?.beats.find((item) => item.id === beat.id);
  const unit = project.units.find((unit) => unit.id === (guide.owner.kind === 'unit' ? guide.owner.id : unitId));
  if (!unit || liveGuide?.id !== guide.id || !liveBeat) return;
  if (guide.owner.kind !== 'project' && !ownerUnits(project, guide.owner).some((item) => item.id === unit.id)) return;
  let original: string;
  try {
    original = outlineText(project, guide.owner);
  } catch {
    return;
  }
  if (!liveBeat.anchors.length || !liveBeat.anchors.every((anchor) => anchorCurrent(anchor, original))) return;
  const start = Math.min(...liveBeat.anchors.map((anchor) => anchor.start)),
    end = Math.max(...liveBeat.anchors.map((anchor) => anchor.end));
  return {
    id: Date.now(),
    label: `修改关键变化：${liveBeat.title}`,
    unitId: unit.id,
    stage: 'OUTLINE',
    draftOperation: 'outline_development',
    operation: guide.owner.kind === 'unit' ? 'unit_outline' : 'outline',
    ...(guide.owner.kind !== 'unit'
      ? { scopeId: guide.owner.id, ...(guide.owner.kind === 'season' ? { seasonId: guide.owner.id } : {}) }
      : {}),
    outlineStructure: false,
    outlineSceneOrder: false,
    outlineBeatIds: [liveBeat.id],
    outlineRange: { start, end, text: original.slice(start, end) },
    text: `请仅修改关键变化「${liveBeat.title}」及其本次获准的大纲原文，提出候选供我审阅。当前变化：${liveBeat.change}。保留这条节拍的稳定身份、涉及集、故事线与场景关联；保留其他节拍、范围外原文、目录、场序及正文，不增加或删除场景。引用多个片段时，保留中间未涉及的原文。仅获准修改这一条节拍，不因原文区间重叠改写其他条目。\n本次原文：\n${original.slice(start, end)}`,
  };
}

export function OutlineBeatTextEditor({
  beat,
  onCommit,
}: {
  beat: StoryBeat;
  onCommit: (value: BeatText, baseline: BeatText) => void;
}) {
  const form = useRef<HTMLFormElement>(null),
    details = useRef<HTMLDetailsElement>(null),
    baseline = useRef<BeatText>({ title: beat.title, change: beat.change });
  const [error, setError] = useState('');
  const close = () => {
    if (details.current) {
      details.current.open = false;
      details.current.querySelector('summary')?.focus();
    }
  };
  return (
    <details
      ref={details}
      data-beat-text-editor={beat.id}
      className="group rounded-xl bg-bg-surface-soft/50 p-2.5 text-xs transition-colors"
      onToggle={(event) => {
        if (event.currentTarget.open) {
          baseline.current = { title: beat.title, change: beat.change };
          form.current?.reset();
          setError('');
        }
      }}
    >
      <summary className="cursor-pointer font-medium text-text-secondary hover:text-text-primary flex items-center gap-1.5 select-none py-0.5">
        <Edit3 size={13} className="text-text-muted group-hover:text-text-primary transition-colors" />
        编辑节拍文字
      </summary>
      <form
        ref={form}
        aria-label={`编辑节拍文字：${beat.title}`}
        className="space-y-3 pt-3 pb-1"
        onInvalid={() => setError('请填写节拍标题和具体变化。')}
        onSubmit={(event) => {
          event.preventDefault();
          const title = (event.currentTarget.elements.namedItem('beat-title') as HTMLInputElement | null)?.value.trim() ?? '';
          const change = (event.currentTarget.elements.namedItem('beat-change') as HTMLTextAreaElement | null)?.value ?? '';
          if (!title || !change.trim()) {
            setError('请填写节拍标题和具体变化。');
            return;
          }
          if (title.length > 20000 || change.length > 20000) {
            setError('节拍文字过长，请缩短后保存。');
            return;
          }
          try {
            onCommit({ title, change }, baseline.current);
            setError('');
            close();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '节拍文字未保存，请重试。');
          }
        }}
      >
        <label className="block text-xs font-medium text-text-secondary space-y-1">
          <span>节拍标题</span>
          <input
            name="beat-title"
            aria-label={`${beat.title}的节拍标题`}
            required
            maxLength={20000}
            defaultValue={beat.title}
            className="block w-full min-w-0 rounded-lg border-0 bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:ring-2 focus:ring-primary/20 outline-none transition-shadow"
          />
        </label>
        <label className="block text-xs font-medium text-text-secondary space-y-1">
          <span>具体变化</span>
          <textarea
            name="beat-change"
            aria-label={`${beat.title}的具体变化`}
            required
            maxLength={20000}
            rows={3}
            defaultValue={beat.change}
            className="block w-full min-w-0 rounded-lg border-0 bg-bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:ring-2 focus:ring-primary/20 outline-none transition-shadow"
          />
        </label>
        <p className="text-xs text-text-muted">这里只改节拍文字。需要改变故事时，用 AI 提出大纲原文候选。</p>
        {error && <p role="alert" className="text-xs text-rose-500 font-medium">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="submit"
            className="px-3.5 py-1.5 rounded-lg bg-text-primary text-bg-surface font-medium text-xs hover:opacity-90 active:scale-[0.98] transition-all shadow-xs cursor-pointer"
          >
            保存节拍文字
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg bg-bg-surface hover:bg-bg-surface-hover text-text-secondary text-xs transition-colors"
            onClick={() => {
              form.current?.reset();
              setError('');
              close();
            }}
          >
            取消
          </button>
        </div>
      </form>
    </details>
  );
}

export function OutlineBeats({
  project,
  guides,
  unitId,
  sceneId,
  editableOwner,
  onChange,
  onLocate,
  onOpenScene,
  onOpenOwner,
  onRequestChange,
}: {
  project: ScriptProject;
  guides: OutlineGuide[];
  unitId: string;
  sceneId?: string;
  editableOwner?: OutlineOwner;
  onChange: (fn: (p: ScriptProject) => void) => void;
  onLocate?: (guide: OutlineGuide, start: number) => void;
  onOpenScene?: (unitId: string, sceneId: string) => void;
  onOpenOwner?: (owner: OutlineOwner, beatId: string) => void;
  onRequestChange?: (request: AssistantRequest) => void;
}) {
  const entries = guides
    .flatMap((guide) => {
      let original: string | undefined;
      try {
        original = outlineText(project, guide.owner);
      } catch {
        /* Keep removed-owner evidence readable. */
      }
      return guide.beats
        .map((beat, index) => ({
          guide,
          beat,
          index,
          start:
            original !== undefined && beat.anchors.length && beat.anchors.every((anchor) => anchorCurrent(anchor, original!))
              ? Math.min(...beat.anchors.map((anchor) => anchor.start))
              : Infinity,
        }))
        .sort((left, right) => left.start - right.start || left.index - right.index);
    }),
    unit = project.units.find((unit) => unit.id === unitId)!;

  return (
    <section className="script-beat-list space-y-4" aria-label="关键节拍">
      {!entries.length && (
        <div className="rounded-2xl bg-bg-surface p-8 text-center space-y-2 shadow-xs">
          <Layers className="mx-auto h-8 w-8 text-text-muted/60" />
          <p className="text-text-muted text-sm">
            尚未提出关键节拍。可以让 AI 从大纲中的关键选择和变化整理；短作品也可以直接规划场景。
          </p>
        </div>
      )}
      {entries.map(({ guide, beat }) => {
        let original: string | undefined;
        try {
          original = outlineText(project, guide.owner);
        } catch {
          /* A removed owner cannot acquire write access. */
        }
        const current =
          original !== undefined &&
          Boolean(beat.anchors.length) &&
          beat.anchors.every((anchor) => anchorCurrent(anchor, original!)),
          editable = sameOwner(editableOwner, guide.owner);
        const allowedUnits = ownerUnits(project, guide.owner),
          detailUnits =
            guide.owner.kind === 'season'
              ? allowedUnits.filter((relatedUnit) => relatedUnit.id === unitId || relatedUnit.scopeId === unit.scopeId)
              : allowedUnits;
        const relatedScenes = beat.sceneRefs.flatMap((ref) => {
          const relatedUnit = detailUnits.find((unit) => unit.id === ref.unitId),
            scene = relatedUnit?.scenes.find((scene) => scene.id === ref.sceneId);
          return scene && relatedUnit ? [{ unit: relatedUnit, scene }] : [];
        });
        const restrictedScenes = beat.sceneRefs.some(
          (ref) =>
            !detailUnits.some((unit) => unit.id === ref.unitId) &&
            allowedUnits.some((unit) => unit.id === ref.unitId && unit.scenes.some((scene) => scene.id === ref.sceneId)),
        );
        const nodeNames = outlineNodesForBeat(project, guide, beat)
          .filter((ref) => detailUnits.some((unit) => unit.id === ref.unitId))
          .map((ref) => {
            const relatedUnit = detailUnits.find((unit) => unit.id === ref.unitId)!,
              node = relatedUnit.structureNodes!.find((node) => node.id === ref.nodeId)!,
              parent = relatedUnit.structureNodes?.find((parent) => parent.id === node.parentId);
            return [relatedUnit.id === unitId ? '' : relatedUnit.title, parent?.title, node.title]
              .filter(Boolean)
              .join(' / ');
          });
        const request = outlineBeatChangeRequest(project, guide, beat, unitId, editableOwner);
        const edit = (value: BeatText, baseline: BeatText) => {
          const update = (p: ScriptProject) => {
            const actual = getOutlineGuide(p, guide.owner)?.beats.find((item) => item.id === beat.id);
            if (!sameOwner(editableOwner, guide.owner) || !actual)
              throw new Error('请先打开这条节拍所属的大纲，再修改文字。');
            if (actual.title !== baseline.title || actual.change !== baseline.change)
              throw new Error('这条节拍的文字已更新，未覆盖最新内容。请取消后重新编辑。');
            return updateBeatText(p, guide.owner, beat.id, value);
          };
          update(project);
          onChange((p) => Object.assign(p, update(p)));
        };

        return (
          <article
            key={beat.id}
            data-outline-beat={beat.id}
            tabIndex={-1}
            className="rounded-2xl bg-bg-surface p-5 shadow-xs transition-all hover:shadow-sm space-y-3.5 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {/* Header info */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <strong className="text-base font-semibold text-text-primary tracking-tight break-words">
                  {beat.title}
                </strong>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-bg-surface-soft text-text-secondary">
                  {ownerLabels[guide.owner.kind]}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  关联 {relatedScenes.length} 场
                </span>
                {!current && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">
                    原文待复核
                  </span>
                )}
              </div>
            </div>

            {/* Change content */}
            <div className="rounded-xl bg-bg-surface-soft/60 p-3.5 text-sm text-text-primary leading-relaxed whitespace-pre-wrap break-words">
              {beat.change}
            </div>

            {/* Node path */}
            <div className="text-xs text-text-muted flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-text-secondary">所属段落：</span>
              <span>{!current ? '待复核' : nodeNames.length ? nodeNames.join('；') : '尚未关联'}</span>
            </div>

            {/* Editable or owner notice */}
            {editable ? (
              <OutlineBeatTextEditor beat={beat} onCommit={edit} />
            ) : (
              <p className="text-xs text-text-muted">
                {onOpenOwner ? (
                  <button
                    type="button"
                    className="text-primary hover:underline font-medium inline-flex items-center gap-1"
                    onClick={() => onOpenOwner(guide.owner, beat.id)}
                  >
                    打开{ownerLabels[guide.owner.kind]}
                  </button>
                ) : (
                  <>打开{ownerLabels[guide.owner.kind]}</>
                )}
                后可编辑节拍文字。
              </p>
            )}

            {/* AI Action button */}
            <div className="pt-1">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                disabled={!request || !onRequestChange}
                title={
                  !editable
                    ? `先打开${ownerLabels[guide.owner.kind]}，再修改这一变化`
                    : !current
                      ? '原文关联待复核，请先核对引用'
                      : !onRequestChange
                        ? '当前视图尚未接入大纲修改'
                        : undefined
                }
                onClick={() => {
                  const next = outlineBeatChangeRequest(project, guide, beat, unitId, editableOwner);
                  if (next && onRequestChange) onRequestChange(next);
                }}
              >
                <Sparkles size={14} />
                与 AI 修改这一变化
              </button>
            </div>

            {/* Quotes */}
            {beat.anchors.length > 0 && (
              <div className="space-y-1.5">
                {beat.anchors.map((anchor, i) => (
                  <button
                    type="button"
                    key={i}
                    disabled={!current || !onLocate}
                    className="script-beat-quote w-full text-left p-2.5 rounded-xl bg-bg-surface-soft text-xs text-text-secondary italic hover:text-text-primary border-l-2 border-primary/40 hover:border-primary transition-all disabled:opacity-50"
                    onClick={() => onLocate?.(guide, anchor.start)}
                  >
                    {anchor.quote}
                  </button>
                ))}
              </div>
            )}

            {/* Related scenes */}
            {relatedScenes.length > 0 && (
              <div className="flex flex-wrap gap-2 py-1 text-sm">
                {relatedScenes.map(({ unit: relatedUnit, scene }) => (
                  <button
                    type="button"
                    key={`${relatedUnit.id}:${scene.id}`}
                    disabled={!onOpenScene}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-surface-soft hover:bg-bg-surface-hover text-xs text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
                    onClick={() => onOpenScene?.(relatedUnit.id, scene.id)}
                  >
                    <Film size={12} className="text-text-muted" />
                    查看场景：{relatedUnit.id !== unitId ? `${relatedUnit.title} · ` : ''}{scene.title}
                  </button>
                ))}
              </div>
            )}

            {restrictedScenes && <p className="text-xs text-text-muted">另有当前范围外的承接安排。</p>}
            {!beat.sceneRefs.length && <p className="text-xs text-text-muted">尚未展开为场景</p>}

            {/* Scene linking accordion */}
            <details className="group rounded-xl bg-bg-surface-soft/40 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-text-secondary hover:text-text-primary flex items-center justify-between select-none py-0.5">
                <span>{sceneId ? '关联当前场景' : '查看／关联本集场景'}</span>
                <ChevronDown size={14} className="text-text-muted transition-transform group-open:rotate-180" />
              </summary>
              <div className="pt-2.5 space-y-2">
                <p className="text-xs text-text-muted">关联说明由这些场景承接这一变化，是否在正文兑现仍需检查。</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                  {unit.scenes
                    .filter((scene) => !sceneId || scene.id === sceneId)
                    .map((scene) => (
                      <label
                        key={scene.id}
                        className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-bg-surface-hover/60 transition-colors cursor-pointer select-none text-xs text-text-primary"
                      >
                        <input
                          type="checkbox"
                          checked={beat.sceneRefs.some((ref) => ref.unitId === unitId && ref.sceneId === scene.id)}
                          onChange={(e) =>
                            onChange((p) =>
                              Object.assign(
                                p,
                                setBeatSceneLink(p, guide.id, beat.id, unitId, scene.id, e.target.checked),
                              ),
                            )
                          }
                          className="rounded border-border-primary/40 text-primary focus:ring-primary/20 accent-primary"
                        />
                        <span className="truncate">{scene.title}</span>
                      </label>
                    ))}
                </div>
              </div>
            </details>
          </article>
        );
      })}
    </section>
  );
}
