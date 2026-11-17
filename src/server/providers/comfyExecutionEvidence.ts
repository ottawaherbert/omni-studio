import { execFile } from 'node:child_process';
import { isDeepStrictEqual, promisify } from 'node:util';
import type { ComfyAPIGraph } from '../../../packages/domain/src/comfyWorkflow';

export interface ComfyExecutionEvidence {
  // This checks output metadata, not GPU kernels or creative quality.
  status: 'matched' | 'mismatch' | 'unavailable';
  changedFields: string[];
}

const run = promisify(execFile);
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const graph = (value: unknown): value is ComfyAPIGraph => record(value) && !!Object.keys(value).length && Object.values(value).every(node => record(node) && typeof node.class_type === 'string' && record(node.inputs));

export async function readComfyVideoPrompt(file: string): Promise<unknown> {
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format_tags=prompt,PROMPT', '-of', 'json', file], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    const tags = JSON.parse(stdout).format?.tags;
    const value = tags?.prompt ?? tags?.PROMPT;
    return typeof value === 'string' ? JSON.parse(value) : undefined;
  } catch { return undefined; }
}

export function compareComfyVideoPrompt(expected: unknown, embedded: unknown): ComfyExecutionEvidence {
  const actual = graph(embedded) ? embedded : record(embedded) && graph(embedded.prompt) ? embedded.prompt : undefined;
  if (!actual || !graph(expected)) return { status: 'unavailable', changedFields: [] };
  const changedFields: string[] = [];
  for (const [id, node] of Object.entries(expected)) {
    const other = actual[id];
    if (!other) { changedFields.push(`${id}.node`); continue; }
    if (node.class_type !== other.class_type) changedFields.push(`${id}.class_type`);
    for (const key of new Set([...Object.keys(node.inputs), ...Object.keys(other.inputs)])) {
      // Comfy adds this cache fingerprint after accepting LoadImage inputs.
      if (key === 'is_changed') continue;
      if (!isDeepStrictEqual(node.inputs[key], other.inputs[key])) changedFields.push(`${id}.inputs.${key}`);
    }
  }
  return { status: changedFields.length ? 'mismatch' : 'matched', changedFields };
}
