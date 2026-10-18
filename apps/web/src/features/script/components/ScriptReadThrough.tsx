import {useState} from 'react';
import type {ScriptProject} from '../../../../../../packages/script/src/schema';
import {blocksToScreenplayText} from '../../../../../../packages/script/src/fountainAdapter';
import {unitCharacters} from '../../../../../../packages/script/src/continuity';

export function ScriptReadThrough({project,initialUnitId,dirty,onOpenScene}:{project:ScriptProject;initialUnitId:string;dirty:boolean;onOpenScene?:(unitId:string,sceneId:string)=>void}){
  const [unitId,setUnitId]=useState(initialUnitId);
  const unit=project.units.find(unit=>unit.id===unitId)||project.units[0];
  return <div className="space-y-5">
    <label className="block text-sm">阅读单元<select aria-label="阅读单元" value={unit.id} onChange={event=>setUnitId(event.target.value)} className="ml-3 rounded border border-border-primary/30 bg-bg-surface-soft px-2 py-1">{project.units.map(unit=><option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
    <p className="text-xs text-text-muted">{dirty?'包含当前未保存的编辑':'当前已保存稿'} · 可以连贯检查前后衔接，空白场景保留位置。</p>
    <h2 className="text-lg font-semibold">{project.title} · {unit.title}</h2>
    {unit.scenes.map((scene,index)=><article key={scene.id} className="space-y-3 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{index+1}. {scene.title}{[scene.location,scene.timeOfDay].filter(Boolean).length>0&&<span className="text-text-muted"> · {[scene.location,scene.timeOfDay].filter(Boolean).join(' / ')}</span>}</h3>{onOpenScene&&<button type="button" className="text-sm underline" onClick={()=>onOpenScene(unit.id,scene.id)} aria-label={`编辑第 ${index+1} 场：${scene.title}`}>编辑这一场</button>}</div>
      <pre className="whitespace-pre-wrap break-words text-sm leading-7 font-sans select-text">{blocksToScreenplayText(scene.blocks,unitCharacters(project,unit))||'本场尚未写正文'}</pre>
    </article>)}
  </div>;
}
