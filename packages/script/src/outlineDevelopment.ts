import {sha256} from 'js-sha256';
import {hashValue} from '../../agent-core/src/identity';
import type {ScriptProject} from './schema';
import {anchorCurrent, assertOutlineGrant, getOutlineGuide, locateOutlineQuote, outlineGuideId, outlineHash, structureGrantHash, outlineText, replaceOutlineRange, type OutlineGrant, type OutlineGuide} from './outlineGuides';
import {updateUnitStructure,orderNodeIntervals} from './structure';

const string={type:'string'},nullable=(value:unknown)=>({anyOf:[value,{type:'null'}]});
const obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const outlineDevelopmentSchema=obj({summary:string,content:string,
  nodes:nullable({type:'array',maxItems:100,items:obj({id:nullable(string),localKey:string,parentLocalKey:nullable(string),title:string,purpose:string,quote:string,sceneIds:{type:'array',items:string}})}),
  beats:nullable({type:'array',maxItems:100,items:obj({id:nullable(string),localKey:string,title:string,change:string,quotes:{type:'array',minItems:1,items:string},unitIds:{type:'array',items:string}})})});
const fail=(reason:string):never=>{throw new Error(`大纲候选：${reason}`);};
const row=(value:unknown,keys:string[]):Record<string,any>=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())fail('字段不符合合同');return value as Record<string,any>;};
const text=(value:unknown,empty=false):string=>{if(typeof value!=='string'||value.length>200000||!empty&&!value.trim())fail('文本无效');return value as string;};
const same=(a:unknown,b:unknown)=>a===undefined||b===undefined?a===b:hashValue(a)===hashValue(b);
const generatedId=(candidateId:string,kind:string,key:unknown)=>{if(typeof key!=='string'||!/^[\w-]{1,80}$/.test(key))fail('本批稳定键无效');return `${kind}_${sha256(JSON.stringify([candidateId,kind,key])).slice(0,48)}`;};

/** The model quotes the proposed original. Only the host computes offsets. */
export function buildOutlineDevelopment(current:ScriptProject,grant:OutlineGrant,unitId:string,candidateId:string,result:Record<string,unknown>):ScriptProject{
  row(result,['summary','content','nodes','beats']);text(result.summary);
  if(grant.owner.kind==='season'&&result.nodes!==null)fail('季大纲不包含当前集结构修改');
  if(grant.outlineBeatIds&&result.nodes!==null)fail('单条节拍请求不包含结构关联写权');
  let next=replaceOutlineRange(current,grant,text(result.content));
  const value=outlineText(next,grant.owner),old=getOutlineGuide(current,grant.owner);
  const guide:OutlineGuide=structuredClone(getOutlineGuide(next,grant.owner)??{id:outlineGuideId(grant.owner),owner:grant.owner,nodeLinks:[],beats:[]});
  const unit=next.units.find(unit=>unit.id===unitId);if(!unit)fail('目标单元不存在');
  const local=Boolean(grant.nodeId)||Boolean(grant.outlineBeatIds)||grant.start>0||grant.end<outlineText(current,grant.owner).length,limitEnd=grant.start+String(result.content).length;
  const locate=(quote:unknown)=>{const anchor=locateOutlineQuote(value,text(quote));if(anchor.start<grant.start||anchor.end>limitEnd)fail('引用越过本次原文');return anchor;};
  if(result.nodes!==null){
    if(!Array.isArray(result.nodes)||(result.nodes as unknown[]).length>100)fail('结构列表无效');
    if(local){
      if((result.nodes as unknown[]).length!==1)fail('局部改纲只更新当前节点的原文关联');
      const item=row(result.nodes[0],['id','localKey','parentLocalKey','title','purpose','quote','sceneIds']),node=unit.structureNodes?.find(node=>node.id===grant.nodeId);
      if(!node||item.id!==node.id||item.title!==node.title||item.purpose!==node.purpose||!same(item.sceneIds,unit.scenes.filter(scene=>scene.structureNodeId===node.id).map(scene=>scene.id)))fail('局部原文授权不允许改动结构或场景归属');
      guide.nodeLinks=guide.nodeLinks.filter(link=>link.nodeId!==node.id);guide.nodeLinks.push({unitId,nodeId:node.id,anchor:locate(item.quote)});
    }else if((result.nodes as unknown[]).length||grant.allowStructure){
      if(!grant.allowStructure)fail('本次未授权结构修改');
      const keys=new Map<string,string>(),claimed=new Set<string>(),membership:Record<string,string|null>={};
      const rows=(result.nodes as unknown[]).map(item=>row(item,['id','localKey','parentLocalKey','title','purpose','quote','sceneIds']));
      for(const item of rows){const id=item.id===null?generatedId(candidateId,'node',item.localKey):text(item.id);if(item.id!==null&&!unit.structureNodes?.some(node=>node.id===id)||keys.has(item.localKey)||[...keys.values()].includes(id))fail('结构标识未知或重复');keys.set(item.localKey,id);}
      const nodes=rows.map(item=>{const id=keys.get(item.localKey)!,parentId=item.parentLocalKey===null?undefined:keys.get(item.parentLocalKey);if(item.parentLocalKey!==null&&!parentId)fail('父段不存在');if(!Array.isArray(item.sceneIds))fail('场景归属无效');for(const sceneId of item.sceneIds){if(!unit.scenes.some(scene=>scene.id===sceneId)||claimed.has(sceneId))fail('场景不存在或重复归组');claimed.add(sceneId);membership[sceneId]=id;}return {id,title:text(item.title),purpose:text(item.purpose,true),...(parentId?{parentId}:{})};});
      for(const scene of unit.scenes)if(!claimed.has(scene.id))membership[scene.id]=null;
      // Reordering containers also reorders their existing scene intervals.
      const plannedUnit={...unit,scenes:unit.scenes.map(scene=>({...scene,structureNodeId:membership[scene.id]??undefined}))};
      const sceneOrder=orderNodeIntervals(plannedUnit,nodes).map(scene=>scene.id);
      if(!grant.allowSceneOrder&&!same(sceneOrder,unit.scenes.map(scene=>scene.id)))fail('调整目录需要同时获准调整场序');
      // Old links to removed containers must be removed before schema validation.
      next.outlineGuides=next.outlineGuides?.map(g=>({...g,nodeLinks:g.nodeLinks.filter(link=>link.unitId!==unitId||nodes.some(node=>node.id===link.nodeId))}));
      next=updateUnitStructure(next,unitId,{nodes,sceneOrder,sceneMembership:membership});
      guide.nodeLinks=guide.nodeLinks.filter(link=>link.unitId!==unitId);
      guide.nodeLinks.push(...rows.map(item=>({unitId,nodeId:keys.get(item.localKey)!,anchor:locate(item.quote)})));
    }
  }
  if(result.beats!==null){
    if(!Array.isArray(result.beats)||result.beats.length>100)fail('节拍列表无效');
    const inRange=(beat:OutlineGuide['beats'][number])=>beat.anchors.every(anchor=>anchorCurrent(anchor,outlineText(current,grant.owner))&&anchor.start>=grant.start&&anchor.end<=grant.end);
    const editable=(old?.beats??[]).filter(beat=>grant.outlineBeatIds?grant.outlineBeatIds.includes(beat.id)&&inRange(beat):!local||inRange(beat));
    const beats=(result.beats as unknown[]).map(item=>{const r=row(item,['id','localKey','title','change','quotes','unitIds']),previous=r.id===null?undefined:editable.find(beat=>beat.id===r.id);if(grant.outlineBeatIds&&r.id===null||r.id!==null&&!previous)fail('节拍不在获准目标内');if(!Array.isArray(r.quotes)||!r.quotes.length||!Array.isArray(r.unitIds))fail('节拍引用无效');return {id:previous?.id??generatedId(candidateId,'beat',r.localKey),title:text(r.title),change:text(r.change),anchors:r.quotes.map(locate),unitIds:r.unitIds,sceneRefs:previous?.sceneRefs??[],...(previous?.storylineIds!==undefined?{storylineIds:structuredClone(previous.storylineIds)}:{})};});
    guide.beats=grant.outlineBeatIds?guide.beats.flatMap(beat=>editable.some(item=>item.id===beat.id)?beats.filter(item=>item.id===beat.id):[beat]):[...guide.beats.filter(beat=>local&&!editable.some(item=>item.id===beat.id)),...beats];
  }
  guide.development={sourceHash:outlineHash(value),unitId,full:!local,nodeId:grant.nodeId??null,nodes:!grant.outlineBeatIds&&(result.nodes!==null||!grant.allowStructure&&!grant.nodeId),beats:result.beats!==null,beatIds:guide.beats.filter(beat=>grant.outlineBeatIds?grant.outlineBeatIds.includes(beat.id):!local||beat.anchors.every(a=>anchorCurrent(a,value)&&a.start>=grant.start&&a.end<=limitEnd)).map(beat=>beat.id)};
  next.outlineGuides=next.outlineGuides?.some(g=>g.id===guide.id)?next.outlineGuides.map(g=>g.id===guide.id?guide:g):[...(next.outlineGuides??[]),guide];
  assertOutlineDevelopment(current,next,grant,unitId);
  return next;
}

/** Reconstruct the permitted delta; reading neighbouring content grants no write access. */
export function assertOutlineDevelopment(before:ScriptProject,after:ScriptProject,grant:OutlineGrant,unitId:string){
  assertOutlineGrant(before,after,grant);
  if(grant.allowStructure&&(grant.structureUnitId!==unitId||structureGrantHash(before.units.find(unit=>unit.id===unitId)!)!==grant.structureHash))fail('结构成员或场序基线已变化');
  const value=outlineText(after,grant.owner),suffix=outlineText(before,grant.owner).length-grant.end;
  const expected=replaceOutlineRange(before,grant,value.slice(grant.start,suffix?value.length-suffix:undefined));
  const old=getOutlineGuide(expected,grant.owner),guide=getOutlineGuide(after,grant.owner);
  if(guide){
    if(guide.development&&(guide.development.unitId!==unitId||guide.development.sourceHash!==outlineHash(value)||guide.development.nodeId!==(grant.nodeId??null)||guide.development.full!==(grant.start===0&&grant.end===outlineText(before,grant.owner).length&&!grant.nodeId&&!grant.outlineBeatIds)))fail('交付依据与本次原文不一致');
    if(grant.outlineBeatIds){
      if(grant.allowStructure||grant.allowSceneOrder||grant.nodeId||guide.development?.nodes)fail('节拍目标没有结构或场序写权');
      const targets=new Set(grant.outlineBeatIds),previous=getOutlineGuide(before,grant.owner)?.beats??[];
      for(const beat of old?.beats??[])if(!targets.has(beat.id)&&!same(beat,guide.beats.find(item=>item.id===beat.id)))fail('不得修改未选中的节拍');
      if(guide.beats.some(beat=>!previous.some(item=>item.id===beat.id)))fail('节拍目标不包含新增节拍写权');
    }
    if(grant.nodeId||grant.outlineBeatIds||grant.start>0||grant.end<outlineText(before,grant.owner).length){
      if(!same(old?.nodeLinks.filter(link=>link.nodeId!==grant.nodeId)??[],guide.nodeLinks.filter(link=>link.nodeId!==grant.nodeId)))fail('不得修改其他段定位');
      const original=getOutlineGuide(before,grant.owner),outside=(original?.beats??[]).filter(beat=>grant.outlineBeatIds?!grant.outlineBeatIds.includes(beat.id):!beat.anchors.every(a=>anchorCurrent(a,outlineText(before,grant.owner))&&a.start>=grant.start&&a.end<=grant.end));
      for(const beat of outside)if(!same(old?.beats.find(b=>b.id===beat.id),guide.beats.find(b=>b.id===beat.id)))fail('不得修改段外节拍');
      const insideEnd=value.length-suffix;
      for(const link of guide.nodeLinks.filter(link=>link.nodeId===grant.nodeId))if(!same(old?.nodeLinks.find(item=>item.nodeId===link.nodeId),link)&&(link.anchor.start<grant.start||link.anchor.end>insideEnd||!anchorCurrent(link.anchor,value)))fail('本段原文定位越过替换区间');
      for(const beat of guide.beats.filter(beat=>!outside.some(b=>b.id===beat.id)))if(!same(old?.beats.find(item=>item.id===beat.id),beat)&&beat.anchors.some(a=>a.start<grant.start||a.end>insideEnd||!anchorCurrent(a,value)))fail('节拍引用越过授权段');
    }
    if(guide.development?.beats){
      const local=Boolean(grant.nodeId)||Boolean(grant.outlineBeatIds)||grant.start>0||grant.end<outlineText(before,grant.owner).length;
      const prior=getOutlineGuide(before,grant.owner),source=outlineText(before,grant.owner);
      const outside=new Set((prior?.beats??[]).filter(beat=>grant.outlineBeatIds?!grant.outlineBeatIds.includes(beat.id):local&&!beat.anchors.every(a=>anchorCurrent(a,source)&&a.start>=grant.start&&a.end<=grant.end)).map(beat=>beat.id));
      const delivered=guide.beats.filter(beat=>!outside.has(beat.id));
      if(delivered.some(beat=>beat.anchors.some(a=>!anchorCurrent(a,value)||a.start<grant.start||a.end>value.length-suffix))
        ||!same(guide.development.beatIds,delivered.map(beat=>beat.id)))fail('节拍交付记录未对应本次有效引用');
    }
    if(guide.development?.nodes&&grant.nodeId&&!guide.nodeLinks.some(link=>link.nodeId===grant.nodeId&&link.unitId===unitId&&anchorCurrent(link.anchor,value)))fail('当前段落尚未关联有效原文');
    if(!grant.allowStructure&&!grant.nodeId&&!same(old?.nodeLinks??[],guide.nodeLinks))fail('本次没有结构关联写权');
    if(grant.owner.kind==='season'){
      const previous=getOutlineGuide(before,grant.owner);
      for(const beat of [...(previous?.beats??[]),...guide.beats]){
        const prior=previous?.beats.find(item=>item.id===beat.id),proposed=guide.beats.find(item=>item.id===beat.id);
        if(!same(prior?.unitIds.filter(id=>id!==unitId)??[],proposed?.unitIds.filter(id=>id!==unitId)??[]))fail('季大纲不得修改其他集的节拍归属');
      }
    }
    for(const beat of getOutlineGuide(before,grant.owner)?.beats??[])if((beat.sceneRefs.length||beat.storylineIds?.length)&&!guide.beats.some(b=>b.id===beat.id))fail('移除节拍需要先明确解除已有场景关联或故事线关联');
    if(!same(old?.overview,guide.overview))fail('不得同时改写概览梗概');
    // Scene relationships survive text edits; they have a separate permission.
    for(const beat of guide.beats)if(!same(getOutlineGuide(before,grant.owner)?.beats.find(b=>b.id===beat.id)?.sceneRefs??[],beat.sceneRefs))fail('本次没有场景关联写权');
    for(const beat of guide.beats)if(!same(getOutlineGuide(before,grant.owner)?.beats.find(b=>b.id===beat.id)?.storylineIds,beat.storylineIds))fail('本次没有故事线关联写权');
    expected.outlineGuides=expected.outlineGuides?.some(g=>g.id===guide.id)?expected.outlineGuides.map(g=>g.id===guide.id?structuredClone(guide):g):[...(expected.outlineGuides??[]),structuredClone(guide)];
  }
  if(grant.allowStructure&&!grant.nodeId){const target=expected.units.find(u=>u.id===unitId),actual=after.units.find(u=>u.id===unitId);if(!target||!actual)fail('单元不存在');target.structureNodes=structuredClone(actual.structureNodes);
    for(const scene of target.scenes){const proposed=actual.scenes.find(s=>s.id===scene.id);if(!proposed)fail('结构修改不能删除场景');if(proposed.structureNodeId)scene.structureNodeId=proposed.structureNodeId;else delete scene.structureNodeId;}
    if(grant.allowSceneOrder){if(actual.scenes.length!==target.scenes.length)fail('结构修改不能新增场景');target.scenes=actual.scenes.map(s=>target.scenes.find(old=>old.id===s.id)??fail('未知场景'));}
  }
  if(!same(expected,after))fail('修改包含获准原文、关系与结构以外的内容');
}
