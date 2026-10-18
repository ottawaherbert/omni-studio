export const TEXT_OUTPUT_MODES = ['auto', 'prompt-json', 'json-object', 'json-schema'] as const;
export type TextOutputMode = typeof TEXT_OUTPUT_MODES[number];
export type TextOutputProfile = {
  mode: Exclude<TextOutputMode, 'auto'>;
  source: 'configured' | 'endpoint-default';
  maxFormatCorrections: 1;
};

/** Resolve against the selected endpoint AND model configuration, not its display
 * name. Unknown proxy endpoints use the portable prompt contract by default. */
export function resolveTextOutputProfile(input: { provider: string; endpoint: string; modelId: string; mode?: TextOutputMode }): TextOutputProfile {
  let mode = input.mode || 'auto';
  if (!TEXT_OUTPUT_MODES.includes(mode)) throw new Error('文本模型返回模式无效');
  const source = mode === 'auto' ? 'endpoint-default' : 'configured';
  if (mode === 'auto') {
    const host = new URL(input.endpoint).hostname;
    mode = input.provider === 'openai' && host === 'api.openai.com' ? 'json-schema'
      : input.provider === 'gemini' && host === 'generativelanguage.googleapis.com' ? 'json-object' : 'prompt-json';
  }
  if (input.provider === 'minimax' && mode !== 'prompt-json') throw new Error('当前 MiniMax 文本适配器仅支持提示词约定返回格式');
  if (input.provider === 'gemini' && mode === 'json-schema') throw new Error('当前 Gemini 适配器支持 JSON 模式；严格 Schema 模式尚未启用');
  return { mode, source, maxFormatCorrections: 1 };
}
