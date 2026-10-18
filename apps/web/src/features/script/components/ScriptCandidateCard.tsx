import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { ScriptCandidateView } from '../../../clients/scriptClient';
import type { ScriptProject } from '../../../../../../packages/script/src/schema';
import { applyWorkspacePatch,createWorkspacePatch } from '../../../../../../packages/script/src/workspacePatch';
import {anchorCurrent,outlineText} from '../../../../../../packages/script/src/outlineGuides';

const names: Record<string,string> = {scene_order:'场景顺序',sceneIds:'场景排列',outline_development:'大纲、结构与节拍',nodeLinks:'段落原文关联',beats:'关键节拍',change:'故事变化',quote:'原文',anchors:'原文依据',story_outline:'当前故事大纲',season_outline:'本季大纲',append_scene_body:'继续本场正文',structure:'幕／段落结构',structureNodes:'幕／段落目录',structureNodeId:'段落归属',generation:'续写进度',concept:'故事前提',theme:'主题与核心问题',audienceExperience:'风格与观众感受',constraints:'作者要求',bio:'人物简介',status:'确认状态',update_character:'修改人物资料',update_fact:'修改故事设定',outline:'故事总纲',summary:'大纲',purpose:'本场事件',location:'地点',timeOfDay:'时间',entryState:'进入状态',exitState:'离开状态',blocks:'正文',name:'姓名',desire:'目标',need:'内在需要',contradiction:'矛盾',arc:'变化',voice:'说话方式',text:'内容',title:'标题',scene_body:'本场正文',scene_plan:'本场规划',unit_outline:'本集大纲',project_outline:'故事总纲',plan_scenes:'分场',add_character:'人物资料',add_fact:'故事设定',replace_selection:'选中文字',replace_blocks:'所选段落',add_unit:'新一集'};
names.development='大纲交付记录';
function readable(value: unknown): string {
  if (typeof value === 'string') return value==='approved'?'已确认':value==='draft'?'待确认':value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value?'是':'否';
  if (Array.isArray(value)) return value.map(readable).filter(Boolean).join('\n\n');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value).filter(([key]) => names[key]).map(([key,item]) => `${names[key]}：${readable(item)}`).filter(line=>!line.endsWith('：')).join('\n');
}
function currentValue(project:ScriptProject,key:string,field?:string):unknown {
  const [kind,id,sceneId]=key.split('/');
  if(kind==='order'){const collection=project[id as 'characters'|'facts'|'units'];return collection?.map(item=>item.id);}
  if(kind==='sceneOrder')return project.units.find(item=>item.id===id)?.scenes.map(item=>item.id);
  const collection=kind==='storyOutline'?project.storyOutlines:(project as unknown as Record<string,unknown>)[kind];
  const value=kind==='project'?project[id as 'brief']:kind==='unit'?project.units.find(item=>item.id===id):
    kind==='scene'?project.units.find(item=>item.id===id)?.scenes.find(item=>item.id===sceneId):
    Array.isArray(collection)?collection.find(item=>item.id===id||item.scopeId===id):undefined;
  return field&&value&&typeof value==='object'?(value as unknown as Record<string,unknown>)[field]:value;
}

/** Present planning relationships in author terms instead of storage IDs and hashes. */
export function scriptChangeValue(project:ScriptProject,key:string,field:string|undefined,value:unknown):string {
  if(value===undefined||value===null)return '尚未填写';
  if((key.startsWith('order/')||key.startsWith('sceneOrder/'))&&Array.isArray(value))return value.map(id=>
    project.units.find(unit=>unit.id===id)?.title||project.units.flatMap(unit=>unit.scenes).find(scene=>scene.id===id)?.title||
    project.characters.find(character=>character.id===id)?.name||project.facts.find(fact=>fact.id===id)?.text||
    project.seasons?.find(season=>season.id===id)?.title||project.storylines?.find(storyline=>storyline.id===id)?.title||
    project.continuityTracks?.find(track=>track.id===id)?.label||'已移除项目').join(' → ')||'没有内容';
  const guide=project.outlineGuides?.find(item=>item.id===key.split('/')[1]);
  const original=guide?outlineText(project,guide.owner):'';
  const sceneName=(ref:{unitId:string;sceneId:string})=>{
    const unit=project.units.find(item=>item.id===ref.unitId),scene=unit?.scenes.find(item=>item.id===ref.sceneId);
    return scene?`${unit?.title} · ${scene.title}`:'场景已不存在';
  };
  if(key.startsWith('outlineGuides/')&&!field&&typeof value==='object'){
    const item=value as Record<string,unknown>;
    return ['nodeLinks','beats','overview','development'].filter(name=>item[name]!==undefined).map(name=>
      `${names[name]||'简短梗概'}\n${scriptChangeValue(project,key,name,item[name])}`).join('\n\n')||'没有大纲关联';
  }
  if(field==='structureNodeId'&&typeof value==='string')return project.units.flatMap(unit=>unit.structureNodes??[]).find(node=>node.id===value)?.title||'未归组';
  if(key.startsWith('outlineGuides/')&&field==='nodeLinks'&&Array.isArray(value))return value.map(link=>{
    const unit=project.units.find(item=>item.id===link.unitId),node=unit?.structureNodes?.find(item=>item.id===link.nodeId);
    return `${unit?.title||'当前作品'} · ${node?.title||'已移除段落'}${anchorCurrent(link.anchor,original)?'':' · 原文待复核'}\n${link.anchor.quote}`;
  }).join('\n\n')||'没有段落原文关联';
  if(key.startsWith('outlineGuides/')&&field==='beats'&&Array.isArray(value))return value.map(beat=>[
    `${beat.title}${beat.anchors.every((anchor:any)=>anchorCurrent(anchor,original))?'':' · 原文待复核'}`,
    `故事变化：${beat.change}`,`原文依据：${beat.anchors.map((anchor:any)=>anchor.quote).join('\n')}`,
    beat.sceneRefs.length?`承接场景：${beat.sceneRefs.map(sceneName).join('、')}`:'尚未关联场景',
    beat.storylineIds?.length?`关联故事线：${beat.storylineIds.map((id:string)=>project.storylines?.find(line=>line.id===id)?.title||'故事线已不存在').join('、')}`:'尚未关联故事线',
  ].join('\n')).join('\n\n')||'没有关键节拍';
  if(key.startsWith('outlineGuides/')&&field==='development'){
    const item=value as {nodes?:boolean;beats?:boolean;full?:boolean};
    return `${item.full?'整体大纲':'当前范围'}交付记录\n结构：${item.nodes?'已处理或无需新增':'未要求或待补充'}\n关键节拍：${item.beats?'已处理':'待补充'}`;
  }
  return readable(value)||(Array.isArray(value)&&!value.length?'没有内容':typeof value==='object'?'关联资料已更新':String(value));
}

export function scriptChangeLabel(project:ScriptProject,key:string,field?:string):string {
  const [kind,id,sceneId]=key.split('/');
  const unit=project.units.find(item=>item.id===id);
  const subject=kind==='scene'?unit?.scenes.find(item=>item.id===sceneId)?.title:
    kind==='unit'?unit?.title:kind==='characters'?project.characters.find(item=>item.id===id)?.name:
    kind==='storyOutline'?'当前故事完整大纲':kind==='outlineGuides'?'大纲关联':kind==='seasons'?project.seasons?.find(item=>item.id===id)?.title:kind==='facts'?'故事设定':kind==='order'||kind==='sceneOrder'?'排列顺序':undefined;
  return [subject,names[field||'']||(!subject?'作品内容':'')].filter(Boolean).join(' · ');
}

/** Compare the fields that will actually be saved, including blueprint and planning data. */
export function ScriptDocumentComparison({before,after}:{before:ScriptProject;after:ScriptProject}) {
  const changes=createWorkspacePatch(before,after).operations;
  return <div className="space-y-3" aria-label="本次采用的修改">
    {!changes.length&&<p>已保留作品中的内容，无需替换。</p>}
    {changes.map((change,index)=><div key={index}>
      <strong>{scriptChangeLabel(after,change.key,change.field)}</strong>
      <div className="sw-proposal-comparison">
        <div><strong>作品当前内容</strong><pre>{change.beforeHash!==null?scriptChangeValue(before,change.key,change.field,currentValue(before,change.key,change.field)):'尚未填写'}</pre></div>
        <div><strong>采用后</strong><pre>{change.after.present?scriptChangeValue(after,change.key,change.field,change.after.value):'删除此项'}</pre></div>
      </div>
    </div>)}
  </div>;
}

export function ScriptCandidateCard({candidate,project,handled,busy,onAdopt,onAdoptOutline,partial,onContinue}: {candidate:ScriptCandidateView;project:ScriptProject;handled:boolean;busy:boolean;onAdopt:()=>void;onAdoptOutline?:()=>void;partial?:boolean;onContinue?:()=>void}) {
  const label=names[candidate.request?.operation||'']||'本次结果';
  const patch=candidate.candidate?.patch;
  const proposedProject=useMemo(()=>{
    // Plain text/body values are displayed directly from the candidate. Only
    // relationship labels need a projected document (new scene names, outline
    // anchors or structure membership). Adoption still validates the full patch.
    const needsRelationships=patch?.operations.some(item=>item.key.startsWith('outlineGuides/')||item.field==='structureNodeId'||
      (item.key.startsWith('sceneOrder/')&&candidate.request?.operation==='scene_order'));
    try{return patch&&needsRelationships?applyWorkspacePatch(project,patch):project;}catch{return project;}
  },[project,patch,candidate.request?.operation]);
  return <article className="script-chat-candidate rounded-2xl bg-bg-surface-soft p-3.5 space-y-2.5 text-xs" aria-label={`${label}候选`}>
    <div className="flex items-center justify-between pb-1">
      <div className="flex items-center gap-1.5 font-medium text-text-primary text-xs">
        <Sparkles size={12} className="text-text-secondary" />
        <span>{label}</span>
      </div>
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${handled ? 'bg-bg-surface text-text-muted' : 'bg-text-primary/10 text-text-primary font-medium'}`}>
        {handled ? '已处理' : partial?'部分采用':'待采用'}
      </span>
    </div>
    {candidate.error&&<p role="alert" className="text-accent-red">{candidate.error}</p>}
    {candidate.candidate&&<>
      {candidate.request?.operation==='outline_development'&&(Boolean(candidate.candidate.delivery?.missing.length))&&<p role="status">部分完成：{candidate.candidate.delivery?.missing.includes('nodes')?'结构尚未交付。':''}{candidate.candidate.delivery?.missing.includes('beats')?'关键节拍尚未交付。':''}可保留大纲，继续补充剩余内容。</p>}
      {Boolean(candidate.candidate.result.summary)&&<p className="text-text-secondary leading-relaxed">{String(candidate.candidate.result.summary)}</p>}
      {candidate.candidate.patch.operations.filter(item=>!item.key.startsWith('order/')&&(!item.key.startsWith('sceneOrder/')||candidate.request?.operation==='scene_order')).map((item,index)=><div key={index} className="space-y-1.5 pt-1">
        <div className="text-[11px] font-medium text-text-secondary">{names[item.field||'']||label}</div>
        {!handled&&<details className="text-[11px] text-text-muted"><summary className="cursor-pointer hover:text-text-secondary transition-colors">查看页面现有内容</summary><p className="whitespace-pre-wrap p-2 rounded-xl bg-bg-surface mt-1">{scriptChangeValue(project,item.key,item.field,currentValue(project,item.key,item.field))}</p></details>}
        <div className="max-h-80 overflow-auto whitespace-pre-wrap break-words select-text p-2.5 rounded-xl bg-bg-surface text-text-primary leading-relaxed">{item.after.present?scriptChangeValue(proposedProject,item.key,item.field,item.after.value):'删除此项'}</div>
      </div>)}
    </>}
    {candidate.status==='VALID'&&!handled&&<button type="button" disabled={busy} className="w-full mt-1.5 py-2 px-3 rounded-xl text-xs font-semibold bg-text-primary text-bg-surface hover:opacity-90 disabled:opacity-30 transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer border-none outline-none" onClick={onAdopt}>{partial?'继续比较剩余修改':'采用到作品'}</button>}
    {onAdoptOutline&&!handled&&!partial&&candidate.status==='VALID'&&<button type="button" disabled={busy} className="w-full underline" onClick={onAdoptOutline}>先采用大纲，保留结构与节拍候选</button>}
    {onContinue&&<button type="button" disabled={busy} className="w-full underline" onClick={onContinue}>继续补齐缺项</button>}
    {handled&&<p className="text-[11px] text-text-muted">此结果已处理，当前内容以作品页面为准。</p>}
  </article>;
}
