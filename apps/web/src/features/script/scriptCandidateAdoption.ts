import { hashValue } from '../../../../../packages/agent-core/src';
import { createWorkspacePatch, type WorkspacePatch } from '../../../../../packages/script/src/workspacePatch';
import type { ScriptProject } from '../../../../../packages/script/src/schema';

/** The chat's individual adoption button must never publish another draft's edits. */
export function candidateIsOnlyChange(base:ScriptProject,document:ScriptProject,patch:WorkspacePatch,applied:boolean):boolean {
  const delta=createWorkspacePatch(base,document);
  return applied?hashValue(delta)===hashValue(patch):delta.operations.length===0;
}
export function authorStillMatchesAdoption(project:ScriptProject,dirty:boolean,intent:{authorRevision:number;authorHash:string}):boolean {
  return !dirty&&project.revision===intent.authorRevision&&hashValue(project)===intent.authorHash;
}
