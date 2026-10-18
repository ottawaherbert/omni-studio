import { DirectorUsagePreview } from "./DirectorUsagePreview";
import { useEffect, useState } from "react";
import { Clapperboard, Palette, Plus, Search, Settings2 } from "lucide-react";
import toast from "react-hot-toast";
import { flushDebouncedProjectSave, useProjectStore, useSkillStore } from "../../clients/stateClient";
import type { CreativeDirectionBindings, CreativeSkillBinding, Episode, EpisodeMeta, Project, Scene, Shot, SkillDTO } from "../../clients/domainTypes";
import { applyCreativeVisualBinding, productionCreativeScopes, resolveCreativeRole, snapshotCreativeSkill, visualBindingPrompt, directorPlanStatus } from "../../clients/creativeDirectionClient";
import { Modal } from "../ui/Modal";
import { CreativeSkillComposer } from "./CreativeSkillComposer";

type Scope = "project" | "episode" | "scene" | "shot" | "asset" | "object";
type Role = "director" | "visual";
const scopeNames: Record<Scope, string> = { project: "全剧", episode: "本集", scene: "本场", shot: "本镜", asset: "当前资产", object: "本镜指定对象" };
const inputClass = "w-full rounded-md border border-border-soft bg-bg-primary px-3 py-2 text-sm text-text-primary";
export function ProductionCreativeControls({ project, episode, scene, shot, assetId, compact = false, visualOnly = false, shotIds }: {
  project: Project;
  episode?: Episode | EpisodeMeta;
  scene?: Scene;
  shot?: Shot;
  assetId?: string;
  compact?: boolean;
  visualOnly?: boolean;
  shotIds?: string[];
}) {
  const { skills, fetchSkills } = useSkillStore();
  const [role, setRole] = useState<Role | null>(null);
  const defaultScope: Scope = assetId ? "asset" : shot || shotIds?.length ? "shot" : scene ? "scene" : "project";
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [binding, setBinding] = useState<CreativeSkillBinding>({ mode: "inherit" });
  const [query, setQuery] = useState("");
  const [objectId, setObjectId] = useState("");
  const [composer, setComposer] = useState<{ kind: "director"; initial?: SkillDTO } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const owner = project.characters.find(item => item.id === assetId) || project.assets.find(item => item.id === assetId);
  const scopes = productionCreativeScopes(project, { episode, scene, shot });
  if (owner) scopes.push({ label: "当前资产", bindings: owner.creativeDirection });
  const resolvedDirector = resolveCreativeRole(scopes, "director");
  const resolvedVisual = resolveCreativeRole(scopes, "visual");
  const fallback = project.visualStyleLock?.stylePrompt || project.visualStyleLock?.visualImplementation?.appearance.descriptors[0] || project.creativeVision?.visualStyle || "未设置";
  const objectIds = Array.from(new Set([...(shot?.characterIdsInShot || []), ...(shot?.propIds || []), shot?.locationId].filter(Boolean))) as string[];
  const objectName = (id: string) => project.characters.find(item => item.id === id)?.name || project.assets.find(item => item.id === id)?.name || id;
  const scopeBinding = (nextScope: Scope, nextRole: Role, id = objectId): CreativeSkillBinding => {
    const source = nextScope === "project" ? project : nextScope === "episode" ? episode : nextScope === "scene" ? scene : nextScope === "asset" ? owner : shot;
    const current = nextScope === "object" ? shot?.creativeDirection?.objects?.[id] : source?.creativeDirection?.[nextRole];
    if (nextRole === "visual") return {
      mode: current?.mode || (nextScope === "project" ? "replace" : "inherit"),
      stylePrompt: current ? current.mode === "inherit" || current.mode === "off" ? "" : visualBindingPrompt(current) : nextScope === "project" ? project.visualStyleLock?.stylePrompt || project.visualStyleLock?.treatment?.directives?.join("\n") || project.creativeVision?.visualStyle || "" : "",
    };
    return structuredClone(current || { mode: nextScope === "project" ? "off" : "inherit" });
  };
  const open = (next: Role) => {
    setScope(defaultScope); setBinding(scopeBinding(defaultScope, next)); setQuery(""); setError(""); setRole(next);
    if (next === "director") void fetchSkills(true);
  };
  useEffect(() => { setRole(null); setComposer(null); }, [project.id, episode?.id, scene?.id, shot?.id, assetId]);
  const selectScope = (next: Scope) => {
    const id = objectId || objectIds[0] || "";
    setObjectId(id); setScope(next); setBinding(scopeBinding(next, role!, id)); setError("");
  };
  const chooseSkill = (skill: SkillDTO) => setBinding(current => ({ ...current, mode: current.mode === "adjust" ? "adjust" : "replace", skill: snapshotCreativeSkill(skill) }));
  const save = async () => {
    if (!role) return;
    if (scope === "object" && !objectId) { setError("请选择要修改的对象。"); return; }
    if (role === "director" && binding.mode === "replace" && !binding.skill && !binding.notes?.trim()) { setError("请选择导演 Skill 或填写自定义要求。"); return; }
    setSaving(true); setError("");
    try {
      const state = useProjectStore.getState();
      const latest = state.currentProject;
      if (!latest || latest.id !== project.id) throw new Error("项目已切换，请在当前项目重新打开设置。");
      const chosenBinding: CreativeSkillBinding = role === "visual"
        ? { mode: binding.stylePrompt?.trim() ? "replace" : scope === "project" ? "off" : "inherit", stylePrompt: binding.stylePrompt?.trim() || "" }
        : binding;
      const changes = (current?: CreativeDirectionBindings) => ({ ...current, [role]: structuredClone(chosenBinding) });
      if (scope === "project") {
        await state.updateProject({
          creativeDirection: changes(latest.creativeDirection),
          ...(role === "visual" ? { visualStyleLock: chosenBinding.mode === "off" && latest.visualStyleLock ? { ...latest.visualStyleLock, humanApprovalState: "rejected" as const } : applyCreativeVisualBinding(latest.visualStyleLock, chosenBinding) } : {}),
        }, { expectedProjectId: project.id });
      } else if (scope === "asset") {
        const isCharacter = latest.characters.some(item => item.id === assetId);
        const list = isCharacter ? latest.characters : latest.assets;
        const current = list.find(item => item.id === assetId);
        if (!current) throw new Error("资产已移除");
        const versions = [...(current.creativeStyleVersions || [])];
        const versionId = crypto.randomUUID();
        versions.push({ id: versionId, title: binding.stylePrompt?.trim().slice(0, 40) || binding.skill?.title || "风格提示词", binding: structuredClone(chosenBinding), createdAt: Date.now() });
        const updated = list.map(item => item.id !== assetId ? item : {
          ...item, creativeDirection: changes(item.creativeDirection),
          creativeStyleVersions: versions, activeCreativeStyleVersionId: versionId,
        });
        await state.updateProject(isCharacter ? { characters: updated as Project["characters"] } : { assets: updated as Project["assets"] }, { expectedProjectId: project.id });
      } else {
        const currentEpisode = state.activeEpisode;
        if (!episode || currentEpisode?.id !== episode.id) throw new Error("当前集已切换，请重新打开设置。");
        if (scope === "episode") await state.updateEpisode(episode.id, { creativeDirection: changes(currentEpisode.creativeDirection) }, { expectedProjectId: project.id, expectedEpisodeId: episode.id });
        else {
          const currentScene = currentEpisode.scenes.find(item => item.id === scene?.id);
          if (!currentScene) throw new Error("当前场已切换，请重新打开设置。");
          if (scope === "scene") await state.updateScene(currentScene.id, { creativeDirection: changes(currentScene.creativeDirection) }, episode.id, { expectedProjectId: project.id });
          else {
            const selected = new Set(shotIds?.length ? shotIds : [shot?.id]);
            if (![...selected].every(id => currentScene.shots?.some(item => item.id === id))) throw new Error("所选镜头已变化，请重新选择。");
            await state.updateScene(currentScene.id, { shots: currentScene.shots!.map(item => !selected.has(item.id) ? item : {
              ...item, creativeDirection: scope === "object"
                ? { ...item.creativeDirection, objects: { ...item.creativeDirection?.objects, [objectId]: structuredClone(chosenBinding) } }
                : changes(item.creativeDirection),
            }) }, episode.id, { expectedProjectId: project.id });
          }
        }
      }
      await flushDebouncedProjectSave(project.id);
      toast.success(scopeNames[scope] + (role === "director" ? "导演已保存，重新设计分镜时采用新设置" : "画风已保存，后续生成采用新设置"));
      setRole(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  const matches = skills.filter(skill => (skill.kind === "director") && (!query.trim() || (skill.title + " " + skill.content).toLowerCase().includes(query.trim().toLowerCase())));
  const titleFor = (target: Role) => {
    const value = target === "director" ? resolvedDirector : resolvedVisual;
    return (target === "visual" ? value.notes.join("；") || value.skill?.title : value.skill?.title) || (value.enabled ? "自定义" : value.source !== "未设置" ? target === "visual" ? "未设置" : "已停用" : target === "visual" ? fallback : "不使用 Skill");
  };
  return <>
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="production-creative-controls">
      {!visualOnly && !assetId && <button type="button" onClick={() => open("director")} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border-soft/40 px-2.5 py-1.5 text-xs text-text-secondary hover:border-gold" title={"来源：" + resolvedDirector.source}>
        <Clapperboard className="h-3.5 w-3.5 shrink-0" /><span className={"truncate " + (compact ? "max-w-36" : "max-w-64")}>导演 · {titleFor("director")}</span><Settings2 className="h-3 w-3 shrink-0" />
      </button>}
      <button type="button" onClick={() => open("visual")} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border-soft/40 px-2.5 py-1.5 text-xs text-text-secondary hover:border-gold" title={"来源：" + resolvedVisual.source}>
        <Palette className="h-3.5 w-3.5 shrink-0" /><span className={"truncate " + (compact ? "max-w-36" : "max-w-64")}>画风 · {titleFor("visual")}{Object.values(shot?.creativeDirection?.objects || {}).some(item => item.mode !== "inherit") ? " · 含局部" : ""}</span><Settings2 className="h-3 w-3 shrink-0" />
      </button>
      {shotIds?.length ? <span className="text-xs text-text-muted">应用到选中 {shotIds.length} 镜</span> : null}
    </div>
    <Modal isOpen={!!role && !composer} onClose={() => { if (!saving) setRole(null); }} title={role === "director" ? "导演方法" : "风格提示词"} size="lg"
      footer={<div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-text-muted">保存到{scopeNames[scope]} · 已有媒体保留</span><button className="rounded-md bg-gold px-4 py-2 text-sm font-bold text-black disabled:opacity-50" onClick={() => void save()} disabled={saving}>{saving ? "保存中…" : "应用设置"}</button></div>}>
      <div className="space-y-4">
        <div className={role === "director" ? "grid grid-cols-2 gap-3" : ""}>
          <label className="text-xs text-text-muted">作用范围<select aria-label="创作设置作用范围" className={inputClass + " mt-1"} value={scope} onChange={e => selectScope(e.target.value as Scope)}>
            {!assetId && <option value="project">全剧</option>}{episode && !assetId && <option value="episode">本集</option>}{scene && !assetId && <option value="scene">本场</option>}{(shot || shotIds?.length) && <option value="shot">{shotIds?.length ? "选中镜头" : "本镜"}</option>}{assetId && <option value="asset">当前资产</option>}{shot && role === "visual" && objectIds.length > 0 && <option value="object">本镜指定对象</option>}
          </select></label>
          {role === "director" && <label className="text-xs text-text-muted">使用方式<select aria-label="创作设置继承方式" className={inputClass + " mt-1"} value={binding.mode} onChange={e => setBinding(current => ({ ...current, mode: e.target.value as CreativeSkillBinding["mode"] }))}>
            {scope !== "project" && <option value="inherit">跟随上级</option>}<option value="replace">选择导演方法 / 自定义</option><option value="adjust">在当前基础上补充</option><option value="off">不使用导演 Skill</option>
          </select></label>}
        </div>
        {scope === "object" && <select aria-label="画风作用对象" className={inputClass} value={objectId} onChange={e => { setObjectId(e.target.value); setBinding(scopeBinding("object", "visual", e.target.value)); }}>{objectIds.map(id => <option key={id} value={id}>{objectName(id)}</option>)}</select>}
        {owner?.creativeStyleVersions?.length ? <label className="block text-xs text-text-muted">从已保存的画风配置恢复<select aria-label="资产画风配置历史" className={inputClass + " mt-1"} defaultValue="" onChange={e => { const version = owner.creativeStyleVersions?.find(item => item.id === e.target.value); if (version) setBinding({ mode: version.binding.mode, stylePrompt: version.binding.mode === "inherit" || version.binding.mode === "off" ? "" : visualBindingPrompt(version.binding) }); }}><option value="">选择历史配置（保留现有图片）</option>{owner.creativeStyleVersions.map(version => <option key={version.id} value={version.id}>{version.title} · {new Date(version.createdAt).toLocaleString()}</option>)}</select></label> : null}
        <p className="text-xs leading-5 text-text-muted">{role === "director" ? "导演 Skill 为可选项。选中后按工作分类提供指导，画风独立设置。已有分镜可直接编辑，也可重新设计并采用新候选。" : scope === "object" ? "只改变此对象的表现，其他人物和背景继续使用原画风。" : "直接填写风格名称或描述，后续生成会原样带入。例如：宫崎骏风格、赛博朋克风格。"}</p>
        {role === "director" && scene?.manualStoryboard?.directorPlan && <p className="text-xs leading-5 text-text-secondary">已有镜头采用：{scene.manualStoryboard.directorPlan.skillTitle}。{directorPlanStatus(project, { episode, scene, shot }) === "current" ? "与当前选择一致。" : "当前选择或依据有变化，可在分镜页重新设计本场。"}</p>}
        {(role === "visual" || (binding.mode !== "inherit" && binding.mode !== "off")) && <>
          {role === "visual" ? <label className="block text-xs text-text-muted">风格提示词<textarea aria-label="风格提示词" className={inputClass + " mt-1 min-h-32"} value={binding.stylePrompt || ""} placeholder="例如：宫崎骏风格；赛博朋克风格；写实背景中加入卡通角色。" onChange={e => setBinding(current => ({ ...current, stylePrompt: e.target.value }))} /><span className="mt-2 block leading-5">{scope === "project" ? "作为全剧默认风格；留空则不指定。" : scope === "object" ? "只用于此对象；留空则沿用对象原有风格。" : "填写后仅用于此范围；留空则跟随上级风格。"}</span></label> : <>
          <div className="flex items-center gap-2"><Search className="h-4 w-4 text-text-muted" /><input aria-label="搜索导演 Skill" className={inputClass} placeholder="搜索导演或作品" value={query} onChange={e => setQuery(e.target.value)} /><button aria-label="新建当前类型 Skill" title="新建 Skill" className="rounded-md border border-border-soft p-2" onClick={() => setComposer({ kind: "director" })}><Plus className="h-4 w-4" /></button></div>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border-soft/30">
            {matches.map(skill => <button key={skill.id} type="button" onClick={() => chooseSkill(skill)} className={"block w-full border-b border-border-soft/20 px-3 py-2 text-left last:border-b-0 " + (binding.skill?.id === skill.id ? "bg-gold/10" : "hover:bg-bg-surface-soft")}><span className="block text-sm text-text-primary">{skill.title}</span><span className="block truncate text-xs text-text-muted">{skill.content.slice(0, 140)}</span></button>)}
            {!matches.length && <p className="p-3 text-sm text-text-muted">没有匹配项，可以直接新建或填写自定义要求。</p>}
          </div>
          {binding.skill && <div className="text-xs text-text-muted">已选：{binding.skill.title} · v{binding.skill.revision || 1}<button className="ml-3 text-gold" onClick={() => setComposer({ kind: "director", initial: { ...binding.skill!, source: "manual", createdAt: 0, updatedAt: 0, builtin: true } })}>编辑 / 转换方法副本</button><button className="ml-3" onClick={() => setBinding(current => ({ ...current, skill: undefined }))}>清除</button></div>}
          <label className="block text-xs text-text-muted">本范围的分镜补充要求<textarea aria-label="导演或画风自定义要求" className={inputClass + " mt-1 min-h-24"} value={binding.notes || ""} placeholder={"例如：本场不移动摄影机，重点保留听者的反应。只用于分镜规划；各部门可复用规则请在 Skill 中分类编辑。"} onChange={e => setBinding(current => ({ ...current, notes: e.target.value }))} /></label>
          <details className="text-xs text-text-muted"><summary className="cursor-pointer">查看选中规则</summary><pre className="mt-2 whitespace-pre-wrap break-words">{binding.skill?.content || "按自定义要求执行"}</pre></details>
          </>}
        </>}
        {role === "director" && <DirectorUsagePreview role={resolveCreativeRole([
          ...scopes.slice(0, Math.max(0, scopes.findIndex(item => item.label === scopeNames[scope]))),
          { label: scopeNames[scope], bindings: { director: binding } },
        ], "director")} />}
        {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      </div>
    </Modal>
    {composer && <CreativeSkillComposer {...composer} onClose={() => setComposer(null)} onSaved={skill => { chooseSkill(skill); setComposer(null); }} />}
  </>;
}
