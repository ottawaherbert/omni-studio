import type { ScriptProject } from '../../../../../packages/script/src/schema';
import { applyWorkspacePatch, createWorkspacePatch } from '../../../../../packages/script/src/workspacePatch';
import { stableJson } from '../../../../../packages/agent-core/src/identity';

export function sameScriptContent(a: ScriptProject, b: ScriptProject): boolean {
  const { revision: _ar, updatedAt: _at, ...left } = a;
  const { revision: _br, updatedAt: _bt, ...right } = b;
  return stableJson(left) === stableJson(right);
}

/** Reapply later local edits onto a committed current draft, with field-level conflict checks. */
export function mergeCurrentScript(base: ScriptProject, local: ScriptProject, committed: ScriptProject): ScriptProject {
  return applyWorkspacePatch(committed, createWorkspacePatch(base, local));
}

export function mergeAdoptedScript(base: ScriptProject, local: ScriptProject, saved: ScriptProject, committed: ScriptProject, baselineTrusted = false): ScriptProject {
  if (!baselineTrusted && sameScriptContent(base, local) && !sameScriptContent(local, saved)) {
    if (local.revision !== saved.revision) throw new Error('采用基线不明确，当前修改已保留');
    base = saved;
  }
  return mergeCurrentScript(base, local, committed);
}

export function currentScriptLoadPolicy(current: ScriptProject | null, saved: ScriptProject | null, projectId: string | null, editing: boolean): 'wait' | 'retain' | 'reload' {
  if (current?.id !== projectId) return 'reload';
  if (!editing) return 'wait';
  return saved && !sameScriptContent(current, saved) ? 'retain' : 'reload';
}

type SaveOptions = {
  read: () => ScriptProject | null;
  saved: () => ScriptProject | null;
  assertWritable: () => void;
  persist: (project: ScriptProject) => Promise<ScriptProject>;
  committed: (sent: ScriptProject, result: ScriptProject) => void;
  failed: (error: unknown, sent: ScriptProject) => void | Promise<void>;
  saving: (value: boolean) => void;
};

/** Autosave and AI save-before-action share one drain; only this editor instance receives its responses. */
export class ScriptSaveCoordinator {
  private running: Promise<ScriptProject | undefined> | null = null;
  private disposed = false;
  constructor(private readonly options: SaveOptions) {}
  dispose(): void { this.disposed = true; }
  flush(): Promise<ScriptProject | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    if (this.running) return this.running;
    const drain = async () => {
      let saving = false;
      try {
        while (!this.disposed) {
          this.options.assertWritable();
          const current = this.options.read(), saved = this.options.saved();
          if (!current || !saved || current.id !== saved.id) return undefined;
          if (sameScriptContent(current, saved)) return saved;
          if (!saving) { saving = true; this.options.saving(true); }
          const sent = structuredClone(current);
          let result: ScriptProject;
          try { result = await this.options.persist(sent); }
          catch (error) {
            if (this.disposed) return undefined;
            await this.options.failed(error, sent);
            throw error;
          }
          if (this.disposed) return undefined;
          this.options.committed(sent, result);
        }
        return undefined;
      } finally { if (saving && !this.disposed) this.options.saving(false); }
    };
    this.running = Promise.resolve().then(drain).finally(() => { this.running = null; });
    return this.running;
  }
}

/** Finish every local edit before a cross-workspace handoff exposes this script. */
export async function flushScriptForHandoff({
  projectId,
  readCurrent,
  readSaved,
  flush,
  canEdit,
}: {
  projectId: string;
  readCurrent: () => ScriptProject | null;
  readSaved: () => ScriptProject | null;
  flush: () => Promise<ScriptProject | undefined>;
  canEdit: boolean;
}): Promise<void> {
  const before = readCurrent();
  const baseline = readSaved();
  if (!before || !baseline || before.id !== projectId || baseline.id !== projectId) {
    throw new Error('剧本项目已切换，请重新选择要交付的作品。');
  }
  if (canEdit) {
    const result = await flush();
    if (!result || result.id !== projectId) throw new Error('剧本保存未完成，请留在当前页面重试。');
  } else if (!sameScriptContent(before, baseline)) {
    throw new Error('当前页面无法保存这份剧本，请在可编辑页面完成保存。');
  }
  const latest = readCurrent();
  const saved = readSaved();
  if (!latest || !saved || latest.id !== projectId || saved.id !== projectId || !sameScriptContent(latest, saved)) {
    throw new Error('剧本仍有未保存修改，请留在当前页面重试。');
  }
}
