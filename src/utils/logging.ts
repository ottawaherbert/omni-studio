export const redactLogText = (value: unknown, maxLength = 300) => {
  const raw = typeof value === 'string' ? value : value instanceof Error ? value.message : JSON.stringify(value ?? '');
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[redacted]"')
    .replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"[redacted]"')
    .replace(/"prompt"\s*:\s*"[^"]+"/gi, '"prompt":"[redacted]"')
    .replace(/"contents?"\s*:\s*"[^"]+"/gi, '"content":"[redacted]"')
    .slice(0, maxLength);
};

export const summarizeUnknownError = (error: unknown, maxLength = 300) => ({
  name: error instanceof Error ? error.name : typeof error,
  message: redactLogText(error, maxLength) || 'Unknown error',
});

export const summarizeGeneratedText = (text: string) => {
  const trimmed = text.trim();
  return {
    chars: text.length,
    startsWithJson: trimmed.startsWith('{') || trimmed.startsWith('['),
  };
};
