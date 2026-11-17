import { GenerationError } from '../../../packages/domain/src/generation';
import type { AudioGenerationContext } from '../../../packages/domain/src/speech';
import { db } from '../db';
import { GenerationStore } from '../generation/store';
import { ProductionQuality } from '../productionQuality';

/** Sound previews are experiments; formal scene work uses the existing preparation check. */
export function assertAudioProductionRequest(input: Partial<AudioGenerationContext> & { projectId?: string }, mediaRoot: string) {
  if (input?.purpose === 'preview') {
    if (input.target !== undefined) throw new GenerationError('AUDIO_PURPOSE_INVALID', '试听或实验不能同时冒称正式场次执行。', 400);
    return;
  }
  const target = input?.target;
  if (input?.purpose !== 'production' || !target || !target.projectId || !target.episodeId || !target.sceneId
    || [target.projectId, target.episodeId, target.sceneId].some(id => typeof id !== 'string')
    || target.shotIds !== undefined && (!Array.isArray(target.shotIds) || !target.shotIds.length || target.shotIds.some(id => typeof id !== 'string'))
    || input.projectId !== undefined && input.projectId !== target.projectId) {
    throw new GenerationError('AUDIO_SCOPE_REQUIRED', '正式声音生成须提供项目、分集与场次范围；试听或实验须明确 purpose:preview。', 400);
  }
  new ProductionQuality(new GenerationStore(db), mediaRoot).assertAudioGeneration(target);
}
