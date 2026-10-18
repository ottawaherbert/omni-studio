/** Gemini speech returns mono PCM, not a WAV file. Keep the actual sample rate. */
export function speechAudioDataUrl(data: string, mimeType: string): string {
  if (/^audio\/(wav|x-wav|wave)(;|$)/i.test(mimeType)) return `data:audio/wav;base64,${data}`;
  if (!/^audio\/(L16|pcm)(;|$)/i.test(mimeType)) throw new Error(`不支持的语音返回格式：${mimeType}`);
  const rate = Number(mimeType.match(/rate=(\d+)/i)?.[1] || 24000);
  if (!Number.isInteger(rate) || rate < 8000 || rate > 192000) throw new Error('语音采样率无效。');
  const raw = atob(data);
  if (!raw.length || raw.length % 2) throw new Error('语音 PCM 数据不完整。');
  const wav = new Uint8Array(44 + raw.length);
  const header = new DataView(wav.buffer);
  const tag = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i); };
  tag(0, 'RIFF'); header.setUint32(4, wav.length - 8, true); tag(8, 'WAVEfmt ');
  header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, rate, true); header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true); header.setUint16(34, 16, true); tag(36, 'data'); header.setUint32(40, raw.length, true);
  for (let i = 0; i < raw.length; i++) wav[44 + i] = raw.charCodeAt(i);
  const chunks: string[] = [];
  for (let i = 0; i < wav.length; i += 8192) chunks.push(String.fromCharCode(...wav.subarray(i, i + 8192)));
  return `data:audio/wav;base64,${btoa(chunks.join(''))}`;
}
