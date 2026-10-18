export interface VoiceSettings {
  modelConfigId?: string;
  voice: string;
  language?: string;
  instructions?: string;
  speed?: number;
}

export interface SpeechRequest {
  text: string;
  voice: string;
  modelConfigId?: string;
  language?: string;
  instructions?: string;
  speed?: number;
  projectId?: string;
}

export const QWEN_TTS_MODEL = 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit';
export const QWEN_VOICES = ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'];
export const QWEN_LANGUAGES = ['Auto', 'Chinese', 'English', 'Japanese', 'Korean', 'German', 'French', 'Russian', 'Portuguese', 'Spanish', 'Italian'];
export const isQwenCustomVoice = (modelId = '') => /Qwen3-TTS.*CustomVoice/i.test(modelId);
// Qwen emits 12.5 audio frames/second. Leave generous headroom for pauses,
// while preventing a two-character line from running for several minutes.
export const qwenSpeechTokenBudget = (text: string) => Math.min(4096, Math.max(256, Array.from(text.trim()).length * 12 + 128));
export const speechCapabilities = (modelId = '') => ({
  instructions: !/Qwen3-TTS.*0\.6B|^tts-1(?:-hd)?$/i.test(modelId),
  speed: /^(tts-1(?:-hd)?|gpt-4o-mini-tts(?:-.*)?)$/i.test(modelId),
});

export const speechProviderBody = (model: string, input: SpeechRequest): {
  model: string; input: string; voice: string; response_format: 'wav';
  lang_code?: string; instruct?: string; instructions?: string; speed?: number; max_tokens?: number;
} => {
  if (!input.text?.trim() || input.text.length > 4000) throw new Error('请输入 1–4000 字的单段配音文本；长对白请分段生成。');
  if (!input.voice?.trim()) throw new Error('请选择角色音色。');
  const capabilities = speechCapabilities(model);
  if (input.instructions?.trim() && !capabilities.instructions) throw new Error('当前模型不支持表演指令，请选择 Qwen3-TTS 1.7B CustomVoice 等支持该能力的模型。');
  if (input.speed !== undefined && (!Number.isFinite(input.speed) || input.speed < 0.25 || input.speed > 4)) throw new Error('语速须在 0.25–4 之间。');
  if (input.speed !== undefined && input.speed !== 1 && !capabilities.speed) throw new Error('当前模型不支持数值语速；支持表演指令的模型可用文字描述快慢。');
  if (isQwenCustomVoice(model)) {
    if (!QWEN_VOICES.some(voice => voice.toLowerCase() === input.voice.toLowerCase())) throw new Error('当前本地模型不支持这个音色，请在角色声音设置中重新选择。');
    if (input.language && !QWEN_LANGUAGES.some(language => language.toLowerCase() === input.language!.toLowerCase())) throw new Error('当前本地模型不支持所选语言。');
    return { model, input: input.text, voice: input.voice, lang_code: (input.language || 'Auto').toLowerCase(), instruct: input.instructions || undefined, response_format: 'wav', max_tokens: qwenSpeechTokenBudget(input.text) };
  }
  return { model, input: input.text, voice: input.voice, instructions: capabilities.instructions ? [input.language && input.language !== 'Auto' ? `Language: ${input.language}` : '', input.instructions].filter(Boolean).join('\n') || undefined : undefined, ...(capabilities.speed && input.speed !== undefined ? { speed: input.speed } : {}), response_format: 'wav' };
};
