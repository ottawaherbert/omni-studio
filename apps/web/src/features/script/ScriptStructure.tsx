import { useState } from 'react';
import { Plus, Trash2, GitBranch, Calendar, Film } from 'lucide-react';
import { parseScriptProject, type DeliveryUnit, type ScriptProject, type Storyline } from '../../../../../packages/script/src/schema';
import { newId } from '../../../../../packages/script/src/project';
import { storylineDiagnostics, visibleInUnit, scopeOptions } from '../../../../../packages/script/src/continuity';
import { getOutlineGuide, ownerUnits, type OutlineOwner } from '../../../../../packages/script/src/outlineGuides';
import { beatsForStoryline, removeStoryline, setBeatStorylineLink, updateStoryline, visibleStorylinesForOutline } from '../../../../../packages/script/src/storylinePlanning';
import { Field, TextField } from './ScriptFields';

const laneColors: Record<string, string> = {
  A: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  B: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  C: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
};

export function ScriptStructure({
  project,
  unit,
  owner,
  onChange,
  onOpenScene,
  onOpenBeat,
}: {
  project: ScriptProject;
  unit: DeliveryUnit;
  owner?: OutlineOwner;
  onChange: (fn: (p: ScriptProject) => void) => void;
  onOpenScene: (id: string) => void;
  onOpenBeat?: (owner: OutlineOwner, beatId: string) => void;
}) {
  const [error, setError] = useState('');
  const selectedOwner = owner ?? { kind: 'unit' as const, id: unit.id };
  const lines = visibleStorylinesForOutline(project, selectedOwner);
  const units = ownerUnits(project, selectedOwner);
  const defaultScope = selectedOwner.kind === 'unit' ? unit.scopeId : selectedOwner.id;
  const seasons = (project.seasons ?? []).filter((season) =>
    selectedOwner.kind === 'season'
      ? season.id === selectedOwner.id
      : selectedOwner.kind === 'unit'
        ? season.id === unit.seasonId || season.id === unit.scopeId
        : selectedOwner.kind === 'story'
          ? units.length > 0 && units.every((member) => member.seasonId === season.id || member.scopeId === season.id)
          : false,
  );
  const allowedScopes = new Set([project.id, defaultScope, ...seasons.map((season) => season.id)]);
  const scopes = scopeOptions(project).filter((scope) => allowedScopes.has(scope.id));
  const guide = getOutlineGuide(project, selectedOwner);

  const apply = (fn: (project: ScriptProject) => ScriptProject) => {
    try {
      fn(project);
      setError('');
      onChange((p) => Object.assign(p, fn(p)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '这项修改未能保存，请核对现有关系。');
    }
  };

  const editLine = (id: string, patch: Partial<Pick<Storyline, 'scopeId' | 'lane' | 'title' | 'premise' | 'resolution'>>) =>
    apply((p) => updateStoryline(p, id, patch));

  return (
    <section aria-label="季与故事线规划" className="space-y-8 max-w-4xl mx-auto py-2">
      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-rose-500/10 text-rose-600 text-xs font-medium">
          {error}
        </div>
      )}

      {/* Season Planning */}
      {project.profile.organization === 'episodic' && (
        <section aria-label="季安排" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-primary" />
              <h2 className="text-base font-semibold text-text-primary tracking-tight">季安排</h2>
            </div>
            <button
              type="button"
              onClick={() =>
                onChange((p) => {
                  (p.seasons ??= []).push({
                    id: newId('season'),
                    title: '第 ' + ((p.seasons?.length ?? 0) + 1) + ' 季',
                    arc: '',
                  });
                })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-bg-surface hover:bg-bg-surface-hover text-text-primary shadow-xs transition-all cursor-pointer"
            >
              <Plus size={14} />
              添加季
            </button>
          </div>

          <div className="rounded-2xl bg-bg-surface p-4 shadow-xs">
            <Field label="当前集所属季">
              <select
                value={unit.seasonId ?? ''}
                onChange={(e) =>
                  apply((p) => {
                    const next = structuredClone(p),
                      target = next.units.find((u) => u.id === unit.id)!;
                    target.seasonId = e.target.value || undefined;
                    parseScriptProject(next);
                    if (storylineDiagnostics(next, target).length)
                      throw new Error('本集仍引用原季故事线，请先调整关联再更换所属季。');
                    return next;
                  })
                }
                className="w-full bg-bg-surface-soft rounded-xl px-3 py-2 text-sm text-text-primary outline-none cursor-pointer"
              >
                <option value="">不分季</option>
                {(project.seasons ?? []).map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {seasons.map((season) => {
            const used =
              project.units.some((u) => u.seasonId === season.id || u.scopeId === season.id) ||
              [...project.characters, ...project.facts, ...(project.storylines ?? []), ...(project.continuityTracks ?? [])].some(
                (item) => item.scopeId === season.id,
              ) ||
              project.outlineGuides?.some((item) => item.owner.kind === 'season' && item.owner.id === season.id);

            return (
              <article className="rounded-2xl bg-bg-surface p-5 shadow-xs space-y-4 transition-all" key={season.id}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <TextField
                    label="季名称"
                    value={season.title}
                    onChange={(value) =>
                      onChange((p) => {
                        p.seasons!.find((s) => s.id === season.id)!.title = value;
                      })
                    }
                  />
                  <TextField
                    label="季弧：主要选择与变化"
                    area
                    value={season.arc}
                    onChange={(value) =>
                      onChange((p) => {
                        p.seasons!.find((s) => s.id === season.id)!.arc = value;
                      })
                    }
                  />
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    disabled={Boolean(used)}
                    title={used ? '先调整本季的单元及设定范围，再删除分组' : '删除空季分组'}
                    onClick={() =>
                      onChange((p) => {
                        p.seasons = p.seasons?.filter((s) => s.id !== season.id);
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-text-muted hover:text-rose-500 hover:bg-rose-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} />
                    删除季分组
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {/* Main & Sub Storylines */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch size={16} className="text-primary" />
              <h2 className="text-base font-semibold text-text-primary tracking-tight">主线与副线</h2>
            </div>
            <p className="text-xs text-text-muted mt-1">
              A/B/C 是可选标记。当前显示本范围与共用故事线；关联节拍和场景分别保存。
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onChange((p) => {
                (p.storylines ??= []).push({
                  id: newId('storyline'),
                  scopeId: defaultScope,
                  lane: 'A',
                  title: '新故事线',
                  premise: '',
                  resolution: '',
                });
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium bg-text-primary text-bg-surface hover:opacity-90 active:scale-[0.98] shadow-xs transition-all cursor-pointer"
          >
            <Plus size={14} />
            添加故事线
          </button>
        </div>

        {!lines.length && (
          <div className="rounded-2xl bg-bg-surface p-8 text-center space-y-2 shadow-xs">
            <GitBranch className="mx-auto h-8 w-8 text-text-muted/60" />
            <p className="text-sm font-medium text-text-secondary">尚未创建故事线</p>
            <p className="text-xs text-text-muted">可从主角的主要问题开始，不要求每部作品都有三条线。</p>
          </div>
        )}

        {lines.map((line) => {
          const related = beatsForStoryline(project, selectedOwner, line.id);
          const allScenes = units.flatMap((member) =>
            member.scenes.filter((scene) => scene.storylineIds?.includes(line.id)).map((scene) => ({ unit: member, scene })),
          );
          const scenes = allScenes.filter(
            ({ unit: member }) => selectedOwner.kind !== 'season' || member.id === unit.id || member.scopeId === unit.scopeId,
          );

          return (
            <article
              className="rounded-2xl bg-bg-surface p-5 shadow-xs space-y-4 transition-all hover:shadow-sm"
              key={line.id}
              data-storyline-id={line.id}
            >
              {/* Lane Badge & Header Controls */}
              <div className="flex items-center gap-2 pb-1">
                <span
                  className={`inline-flex items-center justify-center w-7 h-7 rounded-xl font-bold text-xs ${
                    laneColors[line.lane] ?? 'bg-bg-surface-soft text-text-secondary'
                  }`}
                >
                  {line.lane}
                </span>
                <span className="text-sm font-semibold text-text-primary tracking-tight">
                  {line.title}
                </span>
              </div>

              {/* Form Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                <TextField
                  label="故事线名称"
                  value={line.title}
                  onChange={(value) => editLine(line.id, { title: value })}
                />
                <Field label="故事线标记">
                  <select
                    value={line.lane}
                    onChange={(e) => editLine(line.id, { lane: e.target.value as Storyline['lane'] })}
                    className="w-full bg-bg-surface-soft rounded-xl px-3 py-2 text-sm text-text-primary outline-none cursor-pointer"
                  >
                    {['A', 'B', 'C'].map((lane) => (
                      <option key={lane}>{lane}</option>
                    ))}
                  </select>
                </Field>
                <Field label="故事线范围">
                  <select
                    value={line.scopeId}
                    onChange={(e) => editLine(line.id, { scopeId: e.target.value })}
                    className="w-full bg-bg-surface-soft rounded-xl px-3 py-2 text-sm text-text-primary outline-none cursor-pointer"
                  >
                    {scopes.map((scope) => (
                      <option value={scope.id} key={scope.id}>
                        {scope.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <TextField
                    label="核心问题 / 推动力"
                    area
                    value={line.premise}
                    onChange={(value) => editLine(line.id, { premise: value })}
                  />
                  <TextField
                    label="计划走向 / 结局约束"
                    area
                    value={line.resolution}
                    onChange={(value) => editLine(line.id, { resolution: value })}
                  />
                </div>
              </div>

              {/* Relations Section */}
              <div className="script-storyline-relations rounded-xl bg-bg-surface-soft/50 p-4 space-y-3.5 text-xs">
                {/* Related Beats */}
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 font-semibold text-text-primary">
                    <strong>相关关键节拍 · {related.length}</strong>
                  </div>
                  {!related.length && <p className="text-text-muted">尚未关联关键节拍</p>}
                  {related.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {related.map(({ guide: relatedGuide, beat }) => (
                        <button
                          type="button"
                          className="script-storyline-link"
                          key={beat.id}
                          disabled={!onOpenBeat}
                          onClick={() => onOpenBeat?.(relatedGuide.owner, beat.id)}
                        >
                          {beat.title}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Beats check linking */}
                  {guide?.beats.length ? (
                    <fieldset className="pt-2 border-0 p-0 m-0 space-y-1.5">
                      <legend className="text-text-muted font-medium">关联当前大纲的节拍</legend>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {guide.beats.map((beat) => (
                          <label
                            key={beat.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-bg-surface hover:bg-bg-surface-hover cursor-pointer text-text-secondary has-[:checked]:bg-primary/10 has-[:checked]:text-primary transition-all shadow-2xs select-none"
                          >
                            <input
                              type="checkbox"
                              checked={beat.storylineIds?.includes(line.id) ?? false}
                              onChange={(e) =>
                                apply((p) => setBeatStorylineLink(p, selectedOwner, beat.id, line.id, e.target.checked))
                              }
                              className="rounded border-border-primary/40 text-primary focus:ring-primary/20 accent-primary"
                            />
                            {beat.title}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <p className="text-text-muted pt-1">当前大纲尚无关键节拍，可在关键节拍视图中整理。</p>
                  )}
                </div>

                {/* Related Scenes */}
                <div className="space-y-2 pt-2 border-t border-border-primary/10">
                  <div className="flex items-center gap-1.5 font-semibold text-text-primary">
                    <strong>承接场景 · {allScenes.length}</strong>
                  </div>
                  {!allScenes.length && <p className="text-text-muted">尚未关联场景</p>}
                  {allScenes.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {scenes.map(({ unit: member, scene }) => (
                        <span key={scene.id}>
                          {member.id === unit.id ? (
                            <button
                              type="button"
                              className="script-storyline-link"
                              onClick={() => onOpenScene(scene.id)}
                            >
                              {scene.title}
                            </button>
                          ) : (
                            <span className="text-text-muted px-2 py-1">
                              {member.title} · {scene.title}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {scenes.length < allScenes.length && (
                    <p className="text-text-muted">
                      本故事可见 {scenes.length} 场。其他故事的承接场景需进入对应故事查看。
                    </p>
                  )}
                </div>
              </div>

              {/* Delete Storyline Action */}
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        '删除故事线「' + line.title + '」及其节拍、场景关联？故事原文和正文会保留。',
                      )
                    )
                      apply((p) => removeStoryline(p, line.id));
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-text-muted hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                >
                  <Trash2 size={13} />
                  删除故事线
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {/* Scene to Storyline Mapping */}
      <section className="space-y-4 pt-4 border-t border-border-primary/10">
        <div className="flex items-center gap-2">
          <Film size={16} className="text-primary" />
          <h2 className="text-base font-semibold text-text-primary tracking-tight">
            {project.profile.organization === 'standalone' ? '本片场景关联' : '本集场景关联'}
          </h2>
        </div>

        {storylineDiagnostics(project, unit).map((issue) => (
          <p
            key={issue.sceneId + issue.message}
            className="p-3 rounded-xl bg-amber-500/10 text-amber-600 text-xs font-medium"
          >
            {issue.message}
          </p>
        ))}

        <div className="space-y-2.5">
          {unit.scenes.map((scene) => (
            <div
              className="rounded-2xl bg-bg-surface p-4 shadow-xs flex flex-wrap items-center justify-between gap-3"
              key={scene.id}
            >
              <button
                type="button"
                onClick={() => onOpenScene(scene.id)}
                className="text-sm font-semibold text-text-primary hover:text-primary transition-colors cursor-pointer"
              >
                {scene.title}
              </button>
              <div className="flex flex-wrap items-center gap-2">
                {lines
                  .filter((line) => visibleInUnit(line.scopeId, project, unit))
                  .map((line) => (
                    <label
                      key={line.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-bg-surface-soft hover:bg-bg-surface-hover cursor-pointer text-xs font-medium text-text-secondary has-[:checked]:bg-primary/10 has-[:checked]:text-primary transition-all select-none shadow-2xs"
                    >
                      <input
                        type="checkbox"
                        checked={scene.storylineIds?.includes(line.id) ?? false}
                        onChange={() =>
                          onChange((p) => {
                            const target = p.units
                              .find((u) => u.id === unit.id)!
                              .scenes.find((item) => item.id === scene.id)!;
                            target.storylineIds = target.storylineIds?.includes(line.id)
                              ? target.storylineIds.filter((id) => id !== line.id)
                              : [...(target.storylineIds ?? []), line.id];
                          })
                        }
                        className="rounded border-border-primary/40 text-primary focus:ring-primary/20 accent-primary"
                      />
                      {line.lane} · {line.title}
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
