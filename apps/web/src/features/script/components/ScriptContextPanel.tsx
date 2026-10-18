import {Clock,Radar,Sparkles} from 'lucide-react';
import type {ScriptProject,DeliveryUnit,Scene,Character} from '../../../../../../packages/script/src/schema';
import {ScriptDiscussion} from './ScriptDiscussion';
interface Props {project:ScriptProject;unit:DeliveryUnit;scene:Scene;characters:Character[];onUpdateScene?:(scene:Scene)=>void;onOpenTiming?:()=>void;onOpenRadar?:()=>void;onRequestDiscussion:(question:string)=>void}
export function ScriptContextPanel({project,unit,scene,onOpenTiming,onOpenRadar,onRequestDiscussion}:Props){
  return <aside className="w-80 h-full flex flex-col bg-bg-surface border-l border-border-primary/20 shrink-0">
    <div className="h-12 px-4 border-b border-border-primary/20 flex items-center gap-2 shrink-0 text-xs"><Sparkles size={13}/><strong>故事讨论</strong><span className="text-text-muted truncate">{unit.title} · 第 {unit.scenes.findIndex(item=>item.id===scene.id)+1} 场</span></div>
    <div className="p-3 flex gap-2 border-b border-border-primary/20 text-xs"><button onClick={onOpenTiming} className="flex items-center gap-1 rounded-lg border border-border-primary/30 p-2"><Clock size={13}/>时长估算</button><button onClick={onOpenRadar} className="flex items-center gap-1 rounded-lg border border-border-primary/30 p-2"><Radar size={13}/>连续性检查</button></div>
    <ScriptDiscussion project={project} sceneId={scene.id} onRequest={onRequestDiscussion}/>
  </aside>;
}
