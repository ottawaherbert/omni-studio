import type { SpeechRequest } from '../../../../packages/domain/src/speech';
export const speechClient = {
  async generate(input: SpeechRequest): Promise<{ url: string }> {
    const response = await fetch('/api/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '语音生成失败');
    return result;
  },
};
