import type { ScriptProject } from '../../../../../packages/script/src/schema';
import { scopeOptions } from '../../../../../packages/script/src/continuity';
import { Field } from './ScriptFields';
export function ScriptScope({project,value,label,onChange}:{project:ScriptProject;value:string;label:string;onChange:(id:string)=>void}){
  return <Field label={label}><select value={value} onChange={e=>onChange(e.target.value)}>{scopeOptions(project).map(scope=><option key={scope.id} value={scope.id}>{scope.label}</option>)}</select></Field>;
}
