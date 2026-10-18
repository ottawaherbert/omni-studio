import { videoBeatDialogueLines, type VideoGenerationIntent } from '../../../packages/production/src/services/production/videoGenerationIntent';

const deliveryLabel = { on_screen: '画内对白', off_screen: '画外对白', voice_over: '旁白或广播', phone: '电话声音' };

export const externalVideoPrompt = (intent: VideoGenerationIntent, sceneScript: string) => [
  intent.directorIntent,
  `画幅：${intent.aspectRatio}；目标时长：${intent.durationSeconds} 秒。只制作以下镜头，不增添剧情或切镜。`,
  `起始状态：${intent.startState}\n结束状态：${intent.endState}`,
  `本次镜头与声音：\n${intent.timelineBeats.map((beat, index) => [
    `镜头 ${index + 1}，${beat.startSeconds}–${beat.endSeconds} 秒`,
    beat.visibleAction, beat.performance, beat.camera,
    ...videoBeatDialogueLines(beat).map(line => `${line.speakerName || intent.referenceBindings.find(ref => ref.semanticEntityId === line.characterId)?.displayName || '原文说话人'}（${deliveryLabel[line.delivery || 'on_screen']}）：${line.text}`),
    ...beat.soundCues,
    beat.continuityIn, beat.continuityOut,
  ].filter(Boolean).join('\n')).join('\n\n')}`,
  '画外音、广播及电话声音不要求说话人入镜，也不能给其他出镜人物安排嘴型。逐字保留对白、重复和先后顺序。保留作者要求的画内文字。',
  intent.referenceBindings.length ? `配套参考素材（请一并上传文件）：\n${intent.referenceBindings.map((ref, index) => `${index + 1}. ${ref.displayName || ref.sourceType}：${ref.description || ref.purpose}${ref.audioUsage === 'voice_timbre' ? '；只参考音色，不照搬原音频台词' : ref.audioUsage === 'full_copy' ? '；保留原声音内容' : ''}`).join('\n')}` : '',
  intent.visualStyleContract ? `视觉要求：\n${intent.visualStyleContract}` : '',
  `声音策略：${intent.audioPolicy.mode === 'post_dub' ? '保留配音空间，人物对白后期另配。' : '按本次镜头中的声音及对白要求制作。'}`,
  `场次背景原文（仅校对；不要将本次镜头以外的动作加入画面）：\n${sceneScript}`,
].filter(Boolean).join('\n\n');
