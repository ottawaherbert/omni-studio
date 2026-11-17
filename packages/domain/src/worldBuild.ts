import type { PrevisWorldPlan, PrevisVector } from './previs';
export type WorldBuildMode='api'|'external';
export type WorldBuildStatus='generating'|'awaiting_result'|'compiling'|'ready'|'failed'|'applied';
export type WorldBuildPart={kind:'box'|'cylinder'|'stairs'|'kit';kit?:string;size:PrevisVector;position:PrevisVector;rotation?:PrevisVector;color?:string};
export type WorldBlueprint={
 version?:'world-blueprint.v1';
 summary:string;
 worldBrief:NonNullable<PrevisWorldPlan['worldBrief']>;
 locations:PrevisWorldPlan['locations'];
 objects:Array<Omit<PrevisWorldPlan['objects'][number],'modelId'> & {modelId?:string;repeat?:{count:number;step:PrevisVector}} >;
 viewpoints:NonNullable<PrevisWorldPlan['viewpoints']>;
 routes?:PrevisWorldPlan['routes'];connections?:PrevisWorldPlan['connections'];
 reuse?:Array<{studioId:string;revision:number;instanceId:string;origin:PrevisVector;locationIds?:string[]}>;
 modelRecipes?:Array<{id:string;name:string;parts:WorldBuildPart[]}>;
};
export type WorldBuildTask={
 id:string;projectId:string;commandId:string;mode:WorldBuildMode;modelId?:string;sourceTaskId?:string;instructions:string;status:WorldBuildStatus;
 sourceHash:string;worldRevision:number;createdAt:number;updatedAt:number;summary?:string;error?:string;
 prompt:string;candidate?:PrevisWorldPlan;resultHash?:string;rawResult?:string;appliedRevision?:number;
 producer?:{provider:string;modelId:string};changes?:{locationsAdded:number;locationsChanged:number;objectsAdded:number;objectsChanged:number};
};
export const worldBuildStatusLabels:Record<WorldBuildStatus,string>={generating:'AI 正在设计世界',awaiting_result:'等待外部 AI 返回',compiling:'正在构建三维场景',ready:'候选已就绪，待查看',failed:'构建未完成',applied:'已应用到本剧'};
