import { parseTimelineItem, type TimelineItem } from './schema';
export type Interval = readonly [number,number];
export function unionIntervals(intervals: readonly Interval[]): [number,number][] {
  const sorted=intervals.map(([a,b])=>{
    if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<a) throw new Error('区间必须为非负整数毫秒，结束不得早于开始');
    return [a,b] as [number,number];
  }).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  const merged:[number,number][]=[];
  for(const [start,end] of sorted){const last=merged.at(-1); if(last && start<=last[1]) last[1]=Math.max(last[1],end); else merged.push([start,end]);}
  return merged;
}
const length=(ranges:readonly Interval[])=>unionIntervals(ranges).reduce((sum,[a,b])=>sum+b-a,0);
export function analyseTimeline(items:readonly TimelineItem[],targetMs:number,contentHash?:string,options:{includeCredits?:boolean;toleranceMs?:number}={}) {
  if(!Number.isSafeInteger(targetMs)||targetMs<0) throw new Error('目标必须为非负整数毫秒');
  const toleranceMs=options.toleranceMs??0;
  if(!Number.isSafeInteger(toleranceMs)||toleranceMs<0||toleranceMs>targetMs) throw new Error('允许偏差必须为非负整数毫秒，且不能超过目标');
  items.forEach((item,i)=>parseTimelineItem(item,`timeline[${i}]`));
  const included=items.filter(t=>t.included && t.kind!=='marker');
  const current=included.filter(t=>!contentHash || t.contentHash===contentHash);
  const allContents=current.filter(t=>t.kind==='content');
  const storyContents=allContents.filter(t=>t.scope!=='credits');
  const contents=options.includeCredits===false?storyContents:allContents;
  const ranges=(list:readonly TimelineItem[])=>list.map(t=>[t.startMs,t.endMs] as const);
  const spanMs=included.reduce((end,t)=>Math.max(end,t.endMs),0);
  const coverageMs=length(ranges(contents));
  const fullCoverageMs=length(ranges(allContents));
  const storyCoverageMs=length(ranges(storyContents));
  const tracks=Object.fromEntries([...new Set(included.map(t=>t.track))].map(track=>[track,length(ranges(contents.filter(t=>t.track===track)))]));
  const modalities={video:length(ranges(contents.filter(t=>t.modality==='video'))),audio:length(ranges(contents.filter(t=>t.modality==='audio')))};
  return {spanMs,coverageMs,fullCoverageMs,storyCoverageMs,tracks,modalities,gapToTargetMs:Math.max(0,targetMs-coverageMs),
    overTargetMs:Math.max(0,coverageMs-targetMs),
    rangeStatus:coverageMs<targetMs-toleranceMs?'under' as const:coverageMs>targetMs+toleranceMs?'over' as const:'within' as const,
    creditsCoverageMs:length(ranges(allContents.filter(t=>t.scope==='credits'))),
    placeholderMs:length(ranges(current.filter(t=>t.kind==='placeholder'))),explicitGapMs:length(ranges(current.filter(t=>t.kind==='gap'))),
    staleCount:included.length-current.length,uncoveredSpanMs:Math.max(0,spanMs-coverageMs),
    // Interval math is a plan, never media measurement or artistic acceptance.
    measured:false as const,creativeAccepted:false as const};
}
