const errorText = (error: unknown) => error instanceof Error
  ? error.message
  : typeof error === 'string'
    ? error
    : '';

export const creatorFacingInteractiveAiError = (
  error: unknown,
  fallback = 'AI 服务暂时不可用，请稍后重试；现有白板和试玩内容不会丢失。',
) => {
  const message = errorText(error);
  if (/insufficient balance|"status":402|status.?402/i.test(message)) {
    return 'AI 服务额度不足，暂时不能继续生成；你仍可审阅白板或试玩已有内容。';
  }
  if (/key_missing|model_missing|not configured|api key/i.test(message)) {
    return 'AI 服务尚未配置完成；你仍可审阅白板或试玩已有内容。';
  }
  return message.trim() || fallback;
};
