import Ajv, { type ValidateFunction } from 'ajv';

export class ModelOutputError extends Error {
  constructor(public readonly kind: 'SYNTAX' | 'SCHEMA' | 'CONTRACT', message: string) {
    super(message); this.name = 'ModelOutputError';
  }
}

// Shared by browser and server. No coercion, missing-value defaults, JSON repair,
// or extraction from explanatory prose is permitted at this boundary.
const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false, addUsedSchema: false });
const validators = new Map<string, ValidateFunction>();
function modelValidator(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  let validate = validators.get(key);
  if (!validate) {
    try { validate = ajv.compile(schema); }
    catch { throw new ModelOutputError('CONTRACT', '模型返回结构定义无效，请检查任务配置'); }
    if (validators.size >= 128) validators.delete(validators.keys().next().value!);
    validators.set(key, validate);
  }
  return validate;
}

export function assertModelSchema(schema: Record<string, unknown>): void { modelValidator(schema); }

export function validateModelSchema(value: unknown, schema: Record<string, unknown>): void {
  const validate = modelValidator(schema);
  if (!validate(value)) throw new ModelOutputError('SCHEMA', '模型返回字段不符合约定：' +
    (validate.errors || []).slice(0, 8).map(error => `${error.instancePath || '/'} ${error.message}`).join('；'));
}

/** Native strict schemas are a provider subset. Preserve the business schema
 * and use JSON mode plus local validation when it cannot be sent unchanged. */
export function jsonTransportMode(mode: 'prompt-json' | 'json-object' | 'json-schema', schema?: Record<string, unknown>) {
  if (schema?.type && schema.type !== 'object') return 'prompt-json';
  if (mode !== 'json-schema') return mode;
  const compatible = (value: any): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (['oneOf', 'allOf', 'not', 'if', 'then', 'else', 'patternProperties', 'dependentRequired'].some(key => key in value)) return false;
    if (value.type === 'object' || value.properties) {
      const properties = value.properties || {};
      if (value.additionalProperties !== false || !Array.isArray(value.required)
        || Object.keys(properties).some(key => !value.required.includes(key))) return false;
      if (!Object.values(properties).every(compatible)) return false;
    }
    return (!value.items || compatible(value.items)) && (!value.anyOf || value.anyOf.every(compatible))
      && (!value.$defs || Object.values(value.$defs).every(compatible));
  };
  return schema?.type === 'object' && !schema.anyOf && compatible(schema) ? 'json-schema' : 'json-object';
}

export function parseModelJson(raw: string, schema?: Record<string, unknown>): unknown {
  const text = raw.trim();
  const fence = text.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i);
  let value: unknown;
  try { value = JSON.parse(fence ? fence[1] : text); }
  catch { throw new ModelOutputError('SYNTAX', '模型返回不是完整有效的 JSON'); }
  if (schema) validateModelSchema(value, schema);
  return value;
}

export function jsonOutputInstruction(schema?: Record<string, unknown>): string {
  return '只返回一个完整 JSON 值，不使用 Markdown 代码块或解释性前后缀。' +
    (schema ? `字段、类型和必填项必须符合以下 JSON Schema：\n${JSON.stringify(schema)}` : '');
}

export const FORMAT_CORRECTION_INSTRUCTION = '上一条返回未通过 JSON 格式或字段校验。只纠正返回格式，保留原任务、原意和事实，不新增操作、目标、授权或完成声明，不猜测缺少的实体 ID。仍按原来的输出结构返回完整结果；这是唯一一次格式纠正。';

export function providerCompletionFailure(data: Record<string, any>): { kind: 'REFUSAL' | 'INCOMPLETE' | 'INVALID_RESPONSE'; code: string; message: string } | undefined {
  const finish = data.choices?.[0]?.finish_reason ?? data.candidates?.[0]?.finishReason ?? data.stop_reason;
  if (data.choices?.[0]?.message?.refusal || data.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'content_filter', 'refusal'].includes(finish))
    return { kind: 'REFUSAL', code: 'MODEL_REFUSED', message: '模型服务未提供本次内容，未自动重试' };
  if (['length', 'MAX_TOKENS', 'max_tokens'].includes(finish))
    return { kind: 'INCOMPLETE', code: 'MODEL_INCOMPLETE', message: '模型返回未完成，请缩小本次生成范围' };
  if (data.error || (finish != null && !['stop', 'STOP', 'end_turn', 'stop_sequence'].includes(finish)))
    return { kind: 'INVALID_RESPONSE', code: 'MODEL_RESPONSE_INVALID', message: '模型服务未正常完成本次返回，请核对服务商记录' };
}

export function assertProviderCompletion(data: Record<string, any>): void {
  const failure = providerCompletionFailure(data);
  if (failure) throw Object.assign(new Error(failure.message), { code: failure.code });
}
