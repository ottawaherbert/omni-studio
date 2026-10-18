import toast from 'react-hot-toast';
import { parseModelJson } from '../../packages/model-output/src';

/**
 * Parse a complete model JSON result; only whole Markdown fences are removed.
 * The second argument is retained for existing generic type inference. Invalid
 * or empty output always throws, never becomes an empty successful result.
 */
export const safeParseAIResponse = <T>(
  responseText: string,
  _defaultValue: T,
  validator?: (data: T) => string[]
): T => {

  try {
    const parsedData = parseModelJson(responseText) as T;

    // Domain Validator Injection
    if (validator) {
      const warnings = validator(parsedData);
      if (warnings && warnings.length > 0) {
        console.warn("Domain Validation Warnings:", warnings);
        toast.error(`AI 生成结果有 ${warnings.length} 个可疑项: \n${warnings.slice(0,2).join('\n')}${warnings.length > 2 ? '...' : ''}`, { duration: 6000 });
      }
    }

    return parsedData;
  } catch (error) {
    console.error("Failed to parse AI response:", error);
    toast.error("AI 返回的数据格式有误，解析失败");
    throw new Error("AI 返回的数据格式有误，解析失败");
  }
};

/**
 * Extracts Midjourney-style parameters from a prompt string.
 */
export const extractVisualParameters = (prompt: string) => {
  const params: Record<string, string> = {};
  const regex = /--([a-z]+)\s+([^\s-]+)/g;
  let match;

  while ((match = regex.exec(prompt)) !== null) {
    params[match[1]] = match[2];
  }

  return params;
};
