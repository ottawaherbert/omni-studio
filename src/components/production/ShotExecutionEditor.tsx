import type { Shot, ShotDirecting } from "../../clients/domainTypes";

const input = "w-full rounded-md border border-border-soft/40 bg-bg-primary px-2 py-1.5 text-xs text-text-primary";
const basic = [["visualAction", "可见动作"], ["shotSize", "景别"], ["cameraAngle", "机位"], ["cameraMovement", "运镜"], ["microExpression", "表演与反应"]] as const;
const extra = [["focalLength", "焦段"], ["composition", "构图"], ["blocking", "人物位置、视线与调度"], ["lighting", "光线"], ["continuityNote", "连续性与承接"], ["soundDesign", "声音设计"], ["editingNote", "剪辑说明"]] as const;
export function ShotExecutionEditor({ shot, onChange, extraOnly = false }: { shot: Shot; onChange: (shot: Shot) => void; extraOnly?: boolean }) {
  const directing: ShotDirecting = shot.directing || { dialogue: [], soundCues: [] };
  const changeDirection = (patch: Partial<ShotDirecting>) => onChange({ ...shot, directing: { ...directing, ...patch } });
  return <div className="space-y-3" aria-label="镜头拍法编辑">
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {[...(extraOnly ? [] : basic), ...extra.filter(([field]) => !extraOnly || field !== "lighting")].map(([field, label]) => <label key={field} className="text-xs text-text-secondary">{label}<textarea aria-label={label} className={input + " mt-1 min-h-16"} value={field === "lighting" ? shot.lighting ?? shot.lightingAtmo ?? "" : shot[field] || ""} onChange={e => onChange({ ...shot, [field]: e.target.value, ...(field === "lighting" ? { lightingAtmo: e.target.value } : {}) })} /></label>)}
      <label className="text-xs text-text-secondary">时长（秒）<input aria-label="镜头时长（秒）" className={input + " mt-1"} type="number" min="0.1" step="0.1" value={shot.duration || ""} onChange={e => onChange({ ...shot, duration: Number(e.target.value) })} /></label>
      <label className="text-xs text-text-secondary">转场<select aria-label="镜头转场" className={input + " mt-1"} value={shot.transition || "none"} onChange={e => onChange({ ...shot, transition: e.target.value as Shot["transition"] })}><option value="none">硬切</option><option value="fade">叠化</option><option value="black">黑场</option></select></label>
    </div>
    {!!shot.dialogueLines?.length && <details className="text-xs text-text-secondary"><summary className="cursor-pointer">逐句表演与进入时间</summary><div className="mt-2 space-y-3">{shot.dialogueLines.map((line, lineIndex) => {
      const current = directing.dialogue.find(item => item.lineIndex === lineIndex) || { lineIndex, instruction: "" };
      const update = (patch: Partial<typeof current>) => changeDirection({ dialogue: [...directing.dialogue.filter(item => item.lineIndex !== lineIndex), { ...current, ...patch }].sort((a, b) => a.lineIndex - b.lineIndex) });
      return <div key={lineIndex}><p>{lineIndex + 1}. {line.text}</p><label className="mt-1 block">表演要求<textarea className={input + " mt-1"} value={current.instruction} onChange={e => update({ instruction: e.target.value })} /></label><label className="mt-1 block">相对本镜进入时间（秒，留空沿用排布）<input type="number" step="0.1" className={input + " mt-1"} value={current.startSeconds ?? ""} onChange={e => update({ startSeconds: e.target.value === "" ? undefined : Number(e.target.value) })} /></label></div>;
    })}</div></details>}
    <details className="text-xs text-text-secondary"><summary className="cursor-pointer">音乐与音效事件（{directing.soundCues.length}）</summary>
      <p className="mt-2 leading-5 text-text-muted">时间相对本镜头开始，可跨镜头但不能超出本场。新增事件只安排声音，素材在摄影棚制作。</p>
      {directing.soundCues.map((cue, index) => {
        const update = (patch: Partial<typeof cue>) => changeDirection({ soundCues: directing.soundCues.map(item => item.id === cue.id ? { ...item, ...patch } : item) });
        return <div key={cue.id} className="mt-3 space-y-2 border-t border-border-soft/30 pt-2"><div className="flex items-center justify-between"><span>声音 {index + 1}</span><button className="text-text-muted" type="button" onClick={() => changeDirection({ soundCues: directing.soundCues.filter(item => item.id !== cue.id) })}>移除事件</button></div>
          <label className="block">类型<select className={input} value={cue.type} onChange={e => update({ type: e.target.value as "bgm" | "sfx", linkedAssetId: undefined })}><option value="bgm">音乐</option><option value="sfx">音效</option></select></label>
          <label className="block">内容<textarea className={input} value={cue.description} onChange={e => update({ description: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2"><label>进入（秒）<input className={input} type="number" step="0.1" value={cue.startSeconds} onChange={e => update({ startSeconds: Number(e.target.value) })} /></label><label>持续（秒）<input className={input} type="number" min="0.1" step="0.1" value={cue.durationSeconds} onChange={e => update({ durationSeconds: Number(e.target.value) })} /></label></div>
        </div>;
      })}
      <button type="button" className="mt-3 text-gold" onClick={() => changeDirection({ soundCues: [...directing.soundCues, { id: "cue-" + crypto.randomUUID(), type: "sfx", description: "", startSeconds: 0, durationSeconds: Math.max(0.1, shot.duration || 1) }] })}>添加声音事件</button>
    </details>
  </div>;
}
