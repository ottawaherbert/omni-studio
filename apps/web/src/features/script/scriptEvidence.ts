import type {OutlineOwner} from '../../../../../packages/script/src/outlineGuides';
export type SceneEvidenceSource={kind:'SCENE_PLAN'|'BODY_BLOCK';field?:string;blockId?:string;quote?:string};
export type OutlineEvidenceSource={owner:OutlineOwner;start:number;end:number;nodeId?:string;beatId?:string;tab?:'outline'|'beats'};
export type AnalysisEvidenceLocation={scene?:SceneEvidenceSource;outline?:OutlineEvidenceSource};
