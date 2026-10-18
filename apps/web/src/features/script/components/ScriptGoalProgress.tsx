import type {ScriptGoalProgressView} from '../../../clients/scriptClient';
import type {ScriptProject} from '../../../../../../packages/script/src/schema';
const labels={UNEXPANDED:'未展开',PLANNED:'已分场',PARTIAL:'正文未完',DRAFT_READY:'初稿齐备'};
export function ScriptGoalProgress({review,project,sceneScope}:{review:ScriptGoalProgressView['review']|undefined;project:ScriptProject;sceneScope:Record<string,string[]|null>}){
  const progress=review?.storyProgress||[];
  const partialScenes=project.units.filter(unit=>Object.hasOwn(sceneScope,unit.id)).flatMap(unit=>unit.scenes.filter(scene=>scene.generation?.status==='partial'&&(sceneScope[unit.id]===null||sceneScope[unit.id].includes(scene.id))).map(scene=>({unit,scene})));
  const checksDone=Boolean(review?.coverage.localComplete&&review.coverage.globalComplete&&!review.coverage.missingTaskIds.length&&!review.coverage.invalidReceipts.length);
  if(!progress.length&&!partialScenes.length&&!review?.outlineGaps?.length)return null;
  const complete=progress.length>0&&progress.every(item=>item.status==='DRAFT_READY')&&!partialScenes.length;
  return <section aria-label="本次故事交付进度" className="text-xs space-y-2 border-y border-border-primary/20 py-3">
    <p className="font-medium">{complete?'初稿齐备':'当前范围仍有待完成内容'}{checksDone?' · 所需检查完成':''}</p>
    {progress.length>0&&<p className="text-text-muted">{Object.entries(labels).map(([status,label])=>`${label} ${progress.filter(item=>item.status===status).length}`).join(' · ')}</p>}
    {review?.outlineGaps?.map((gap,index)=><p key={index} className="text-accent-amber">{gap}</p>)}
    {partialScenes.map(({unit,scene})=><p key={scene.id} className="text-text-secondary">恢复位置：{unit.title} / {scene.title}，已保存 {scene.blocks.filter(block=>block.type!=='note'&&block.text.trim()).length} 段。下次从最后一个已保存段落后继续。</p>)}
    {progress.length>0&&<details><summary className="cursor-pointer text-text-secondary">查看大纲逐项覆盖与剩余内容</summary><ol className="pt-2 space-y-2">{progress.map(item=><li key={item.id}><strong>{labels[item.status]}</strong> · <span className="whitespace-pre-wrap">{item.text}</span>{item.reason&&<p className="text-text-muted">{item.reason}</p>}</li>)}</ol></details>}
  </section>;
}
