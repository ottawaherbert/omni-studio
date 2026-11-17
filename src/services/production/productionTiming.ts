import type { Shot } from '../../types/project';
import type { GenerationIssue, ProductionTimingReview } from '../../../packages/domain/src/generation';

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
/** Read-only editorial evidence. Presence of a note is never a creative approval. */
export function reviewProductionTiming(sceneShots: Shot[], selectedIds: string[]): ProductionTimingReview {
  const selected = sceneShots.filter(shot => selectedIds.includes(shot.id));
  const issues: GenerationIssue[] = [];
  const warn = (code: string, message: string) => issues.push({ code, message, field: 'duration', blocking: false });
  const shots = selected.map(shot => {
    const action = text(shot.visualAction || shot.visualSummary);
    const dialogue = (shot.dialogueLines || []).map(line => text(line.text)).filter(Boolean);
    const purpose = text(shot.motivation), timingAndCut = text(shot.editingNote);
    const missing = [!action && !dialogue.length && '动作/对白', !purpose && '新增信息或情绪目的', !timingAndCut && '估时与切出依据'].filter(Boolean);
    if (missing.length) warn('TIMING_BASIS_MISSING', `镜头 ${shot.id}（${shot.duration ?? '未填'} 秒）缺少${missing.join('、')}。在分镜中按实际内容估时；默认值和模型上限不是叙事依据。`);
    return { shotId: shot.id, plannedSeconds: Number(shot.duration || 0), action, dialogue, purpose, timingAndCut, basisStatus: missing.length ? 'incomplete' as const : 'described' as const };
  });
  // Inspect the whole scene even for a single-shot request. Equal durations can be intentional.
  if (selected.length && sceneShots.length >= 3 && sceneShots.every(s => Number.isFinite(s.duration) && Number(s.duration) > 0 && s.duration === sceneShots[0].duration)) {
    warn('TIMING_UNIFORM_SCENE', `本场 ${sceneShots.length} 镜均为 ${sceneShots[0].duration} 秒。核对是否套用生成时长；有意等长可保留，不必制造长短差异。`);
  }
  const moves = sceneShots.map(s => text(s.cameraMovement));
  if (selected.length && moves.length >= 3 && moves.every(m => m === moves[0]) && /慢|slow/i.test(moves[0])) {
    warn('TIMING_REPEATED_SLOW_CAMERA', '本场统一使用缓慢运镜。核对每镜是否有表达目的，不用缓推或停留填满请求时长。');
  }
  return { shots, issues, creativeStatus: 'not_assessed', instruction: '先按动作、对白、反应与切点估时；editingNote 写估时及切出依据，motivation 写本镜作用。字段齐全只表示已描述，不能证明节奏合格。按项目制作约定粗审，非阻塞提示不是反复补表或检查的理由；仅明显大问题在约定返工范围内修正，其余交作者精审。宫格不等分时间。请求可含模型档位/剪辑余量，实际成片按动作、声音和相邻切点取舍；可修订原估时，不用空停顿凑片长。' };
}
