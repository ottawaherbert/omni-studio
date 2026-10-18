/** Read the complete PCM/IEEE-float WAV emitted by the local Qwen server. */
export function pcmWavDurationSeconds(audio: Buffer): number | undefined {
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return undefined;
  let rate = 0, blockAlign = 0, dataBytes = 0;
  for (let at = 12; at + 8 <= audio.length;) {
    const size = audio.readUInt32LE(at + 4), start = at + 8;
    if (start + size > audio.length) return undefined;
    const tag = audio.toString('ascii', at, at + 4);
    if (tag === 'fmt ') {
      if (size < 16 || ![1, 3].includes(audio.readUInt16LE(start))) return undefined;
      rate = audio.readUInt32LE(start + 4);
      blockAlign = audio.readUInt16LE(start + 12);
    }
    if (tag === 'data') dataBytes += size;
    at = start + size + (size % 2);
  }
  return rate && blockAlign && dataBytes % blockAlign === 0 ? dataBytes / (rate * blockAlign) : undefined;
}
