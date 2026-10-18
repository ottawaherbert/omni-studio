import type { Shot, AudioTrack } from '../types/project';

export const splitTimelineShot = (shot: Shot, offset: number, id: string): Shot[] => {
  if (!(offset > 0 && offset < shot.duration)) throw new Error('分割点必须在片段内部。');
  return [
    { ...shot, duration: offset },
    { ...shot, id, duration: shot.duration - offset, sourceStartSeconds: (shot.sourceStartSeconds || 0) + offset, transition: 'none' },
  ];
};

export const splitTimelineAudio = (track: AudioTrack, offset: number, id: string): AudioTrack[] => {
  if (!(offset > 0 && offset < track.duration)) throw new Error('分割点必须在音轨内部。');
  return [
    { ...track, duration: offset },
    { ...track, id, startTime: track.startTime + offset, duration: track.duration - offset, sourceStartSeconds: (track.sourceStartSeconds || 0) + offset, shotId: undefined },
  ];
};

/** Operates on the drag-start snapshot, so repeated pointer events cannot accumulate trims. */
export const trimTimelineShot = (shots: Shot[], index: number, edge: 'left' | 'right', time: number, roll = false): Shot[] => {
  const shot = shots[index];
  if (!shot) return shots;
  const start = shots.slice(0, index).reduce((sum, item) => sum + item.duration, 0);
  const next = shots[index + 1];
  const previous = shots[index - 1];
  const min = 0.1;
  if (edge === 'right') {
    const delta = roll && next
      ? Math.max(-Math.min(shot.duration - min, next.sourceStartSeconds || 0), Math.min(time - start - shot.duration, next.duration - min))
      : Math.max(min - shot.duration, time - start - shot.duration);
    return shots.map((item, i) => i === index ? { ...item, duration: item.duration + delta }
      : roll && next && i === index + 1 ? { ...item, duration: item.duration - delta, sourceStartSeconds: (item.sourceStartSeconds || 0) + delta } : item);
  }
  const delta = Math.max(-(shot.sourceStartSeconds || 0), previous ? min - previous.duration : 0,
    Math.min(time - start, shot.duration - min));
  return shots.map((item, i) => i === index ? { ...item, duration: item.duration - delta, sourceStartSeconds: (item.sourceStartSeconds || 0) + delta }
    : previous && i === index - 1 ? { ...item, duration: item.duration + delta } : item);
};
