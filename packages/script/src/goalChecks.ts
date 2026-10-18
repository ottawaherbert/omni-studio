import { sha256 } from 'js-sha256';
import { unitContentHash } from './project';
import type { ScriptBlock, ScriptProject } from './schema';
import { collectOutlineRequirements, outlineSourcesChanged, storyProgress, type StoryCoverageContract, type OutlineRequirement, type OutlineCoverageEntry } from './goalCoverage';

/** All offsets are UTF-16 string offsets, matching the editor's text selection
 * contract. Hashes bind the exact sent substring, not a model's coverage claim. */
export type BodyBlock = { unitId: string; sceneId: string; blockId: string; type: ScriptBlock['type']; text: string; blockHash: string; textHash: string; length: number };
export type BodyScene = { unitId: string; sceneId: string; sceneHash: string; blocks: BodyBlock[] };
export type BodyUnit = { unitId: string; unitHash: string; scenes: BodyScene[] };
export type GoalBodyManifest = { projectId: string; revision: number; targetUnitIds: string[]; units: BodyUnit[]; hash: string };
export type CheckSpan = { unitId: string; sceneId: string; blockId: string; blockHash: string; start: number; end: number; textHash: string };
export type CheckIndexEntry = { unitId: string; sceneId: string; blockId: string; blockHash: string; textHash: string; length: number };
export type CheckRequirement = { id: string; dependency: 'EXACT_BLOCKS' | 'WHOLE_MANUSCRIPT' };
export type GoalCheckContract = {
  revision: number;
  targetUnitIds: string[];
  /** Absent means the whole selected unit, including for historical contracts. */
  targetScenes?: Array<{unitId:string;sceneIds:string[]}>;
  localChecks: CheckRequirement[];
  globalChecks: CheckRequirement[];
  maxRawChars: number;
  maxIndexEntries?: number;
  maxRepairRounds: number;
  requireStructureAlignment?: boolean;
  /** New story goals bind planning evidence independently of existing scenes. */
  storyCoverage?: StoryCoverageContract;
  outlineRequirements?: OutlineRequirement[];
  outlineGaps?: string[];
};
export type CheckTask = {
  id: string; fingerprint: string; manifestHash: string; kind: 'LOCAL' | 'GLOBAL'; phase: 'RAW' | 'INDEX' | 'BOUNDARY_RAW' | 'SYNTHESIS';
  checkId: string; dependency: CheckRequirement['dependency']; requiredRaw: CheckSpan[]; requiredIndex: CheckIndexEntry[];
  requiredEvidenceTaskIds: string[];
  requiredOutline?: OutlineRequirement[];
};
export type CheckPlan = { id: string; manifestHash: string; contractRevision: number; targetUnitIds: string[]; tasks: CheckTask[] };
export type CheckFinding = { id: string; issue: string; suggestion: string; severity: 'BLOCKING' | 'ADVISORY'; basis: 'RAW' | 'INDEX';
  source: { unitId: string; sceneId: string; blockId: string; start?: number; end?: number }; uncertainty: string };
export type CheckReceipt = {
  id: string; taskId: string; taskFingerprint: string; manifestHash: string; validatedManifestHash?: string; carriedFromReceiptId?: string;
  status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; schemaValidated: boolean;
  /** The host constructs this from the frozen sent request and invocation.
   * Model output never supplies these fields. */
  input: { source: 'FROZEN_SENT_REQUEST'; contextRef: { id: string; digest: string }; invocationId: string; inputHash: string;
    raw: CheckSpan[]; index: CheckIndexEntry[]; omittedRaw: CheckSpan[]; omittedIndex: CheckIndexEntry[];
    outline?: OutlineRequirement[];
    evidence: Array<{ taskId: string; receiptId: string; receiptDigest: string; summary: string; findings: CheckFinding[];outlineCoverage?:OutlineCoverageEntry[] }> };
  findings: CheckFinding[]; summary: string; modelClaimedAll?: boolean;
  outlineCoverage?:OutlineCoverageEntry[];
};
export type FindingStatus = 'OPEN' | 'REVISED' | 'VERIFIED' | 'AUTHOR_ACCEPTED' | 'UNRESOLVED';
export type ReviewFinding = CheckFinding & { status: FindingStatus; manifestHash: string; revisedManifestHash?: string;
  repairRound?: number; verificationReceiptId?: string; authorAcceptance?: { commandId: string; contractRevision: number } };
export type CoverageAssessment = { localComplete: boolean; globalComplete: boolean; missingTaskIds: string[]; invalidReceipts: Array<{ taskId: string; reason: string }> };
export type GoalArtifact = { kind: 'complete_candidate'|'stage_candidate'; projectId: string; revision: number; manifestHash: string; unitIds: string[] };
export type GoalCandidateAssessment = { complete: boolean; resultType: 'complete_candidate' | 'PARTIAL'; manifestHash: string; gaps: string[]; coverage: CoverageAssessment;storyProgress?:ReturnType<typeof storyProgress> };

const digest = (value: unknown) => sha256(JSON.stringify(value));
const fail = (message: string): never => { throw new Error(message); };
const required = (value: string, label: string) => { if (!value?.trim()) fail(`${label}不能为空`); };
const same = (a: unknown, b: unknown) => digest(a) === digest(b);

export function createGoalBodyManifest(project: ScriptProject, targetUnitIds: string[], targetScenes: GoalCheckContract['targetScenes'] = []): GoalBodyManifest {
  if (!targetUnitIds.length || new Set(targetUnitIds).size !== targetUnitIds.length) fail('目标单元必须存在且不能重复');
  if (new Set(targetScenes.map(item=>item.unitId)).size!==targetScenes.length||targetScenes.some(item=>!targetUnitIds.includes(item.unitId)||new Set(item.sceneIds).size!==item.sceneIds.length)) fail('检查场景范围无效');
  const units: BodyUnit[] = targetUnitIds.map(unitId => {
    const unit = project.units.find(item => item.id === unitId);
    if (!unit) fail(`目标单元不存在：${unitId}`);
    const selected=targetScenes.find(item=>item.unitId===unitId)?.sceneIds;
    if(selected?.some(sceneId=>!unit.scenes.some(scene=>scene.id===sceneId)))fail(`目标场景不存在：${unitId}`);
    return { unitId, unitHash: unitContentHash(project, unit), scenes: unit.scenes.filter(scene=>!selected||selected.includes(scene.id)).map(scene => {
      const blocks = scene.blocks.map(block => ({ unitId, sceneId: scene.id, blockId: block.id, type: block.type,
        text: block.text, blockHash: digest(block), textHash: sha256(block.text), length: block.text.length }));
      return { unitId, sceneId: scene.id, sceneHash: digest(scene), blocks };
    }) };
  });
  const basis = { projectId: project.id, revision: project.revision, targetUnitIds: [...targetUnitIds], units: units.map(unit => ({
    unitId: unit.unitId, unitHash: unit.unitHash, scenes: unit.scenes.map(scene => ({ sceneId: scene.sceneId, sceneHash: scene.sceneHash,
      blocks: scene.blocks.map(({ text: _text, ...block }) => block) })),
  })) };
  return { ...basis, units, hash: digest(basis) };
}

const allBlocks = (manifest: GoalBodyManifest) => manifest.units.flatMap(unit => unit.scenes.flatMap(scene => scene.blocks));
const allScenes = (manifest: GoalBodyManifest) => manifest.units.flatMap(unit => unit.scenes);
const indexOf = (block: BodyBlock): CheckIndexEntry => ({ unitId: block.unitId, sceneId: block.sceneId, blockId: block.blockId, blockHash: block.blockHash, textHash: block.textHash, length: block.length });
function splitBlock(block: BodyBlock, maxRawChars: number): CheckSpan[] {
  const spans: CheckSpan[] = [];
  for (let start = 0; start < block.length;) {
    let end = Math.min(block.length, start + maxRawChars);
    // Do not split a surrogate pair between adjacent model inputs.
    if (end < block.length && end > start && /[\uD800-\uDBFF]/.test(block.text[end - 1]) && /[\uDC00-\uDFFF]/.test(block.text[end])) end--;
    if (end === start) end = Math.min(block.length, start + 2);
    spans.push({ unitId: block.unitId, sceneId: block.sceneId, blockId: block.blockId, blockHash: block.blockHash,
      start, end, textHash: sha256(block.text.slice(start, end)) });
    start = end;
  }
  return spans;
}
function batches<T>(items: T[], weight: (item: T) => number, limit: number): T[][] {
  const result: T[][] = []; let current: T[] = [], size = 0;
  for (const item of items) {
    const length = weight(item);
    if (current.length && size + length > limit) { result.push(current); current = []; size = 0; }
    current.push(item); size += length;
  }
  if (current.length) result.push(current);
  return result;
}
function checkTask(manifest: GoalBodyManifest, kind: CheckTask['kind'], phase: CheckTask['phase'], requirement: CheckRequirement, ordinal: number,
  requiredRaw: CheckSpan[], requiredIndex: CheckIndexEntry[], requiredEvidenceTaskIds: string[] = [],requiredOutline?:OutlineRequirement[]): CheckTask {
  const basis = { kind, phase, checkId: requirement.id, dependency: requirement.dependency, ordinal, requiredRaw, requiredIndex, requiredEvidenceTaskIds,...(requiredOutline?{requiredOutline}:{}) };
  const fingerprint = digest(basis);
  return { id: `check_${fingerprint.slice(0, 24)}`, fingerprint, manifestHash: manifest.hash, kind, phase,
    checkId: requirement.id, dependency: requirement.dependency, requiredRaw, requiredIndex, requiredEvidenceTaskIds,...(requiredOutline?{requiredOutline}:{}) };
}

export function createCheckPlan(manifest: GoalBodyManifest, contract: GoalCheckContract): CheckPlan {
  if (!same(manifest.targetUnitIds, contract.targetUnitIds)) fail('检查合同的目标单元与正文快照不一致');
  for(const target of contract.targetScenes??[]){
    const actual=manifest.units.find(unit=>unit.unitId===target.unitId)?.scenes.map(scene=>scene.sceneId).sort();
    if(!same(actual,[...target.sceneIds].sort()))fail('检查合同的场景范围与正文快照不一致');
  }
  if (!Number.isSafeInteger(contract.maxRawChars) || contract.maxRawChars < 2 || !Number.isSafeInteger(contract.maxRepairRounds) || contract.maxRepairRounds < 0) fail('检查批次或返修上限无效');
  const maxIndexEntries = contract.maxIndexEntries ?? 100;
  if (!Number.isSafeInteger(maxIndexEntries) || maxIndexEntries < 2) fail('索引及综合批次上限无效');
  if (!contract.localChecks.length || !contract.globalChecks.length) fail('必须分别声明局部与全局检查');
  const names = [...contract.localChecks, ...contract.globalChecks].map(item => item.id);
  if (names.some(item => !item?.trim()) || new Set(names).size !== names.length) fail('检查类型标识无效或重复');
  const blocks = allBlocks(manifest), raw = blocks.flatMap(block => splitBlock(block, contract.maxRawChars));
  const tasks: CheckTask[] = [];
  for (const requirement of contract.localChecks) {
    const chunks = batches(raw, span => span.end - span.start, contract.maxRawChars);
    (chunks.length ? chunks : [[]]).forEach((chunk, index) => tasks.push(checkTask(manifest, 'LOCAL', 'RAW', requirement, index, chunk, [])));
  }
  const index = blocks.map(indexOf), scenes = allScenes(manifest);
  const boundaryBlocks: BodyBlock[] = [];
  if (scenes.length) {
    const first = scenes[0].blocks.find(block => block.length > 0), last = [...scenes.at(-1)!.blocks].reverse().find(block => block.length > 0);
    if (first) boundaryBlocks.push(first);
    if (last) boundaryBlocks.push(last);
  }
  for (let i = 1; i < scenes.length; i++) {
    const before = [...scenes[i - 1].blocks].reverse().find(block => block.length > 0), after = scenes[i].blocks.find(block => block.length > 0);
    if (before) boundaryBlocks.push(before);
    if (after) boundaryBlocks.push(after);
  }
  const uniqueBoundary = [...new Map(boundaryBlocks.map(block => [block.blockId, block])).values()];
  const boundaryRaw = uniqueBoundary.flatMap(block => splitBlock(block, contract.maxRawChars));
  for (const requirement of contract.globalChecks) {
    const outline=requirement.id==='story_coverage'&&contract.storyCoverage?contract.outlineRequirements??[]:undefined;
    const leaves: CheckTask[] = [];
    const pages = batches(index, () => 1, maxIndexEntries);
    (pages.length ? pages : [[]]).forEach((page, pageIndex) => leaves.push(checkTask(manifest, 'GLOBAL', 'INDEX', requirement, pageIndex, [], page,[],outline)));
    // Global review must receive its own complete body evidence. Reusing the
    // local receipts would let local coverage masquerade as global review.
    const rawPages = batches(raw, span => span.end - span.start, contract.maxRawChars);
    (rawPages.length ? rawPages : [[]]).forEach((page, pageIndex) => leaves.push(checkTask(manifest, 'GLOBAL', 'RAW', requirement, pageIndex, page, [],[],outline)));
    batches(boundaryRaw, span => span.end - span.start, contract.maxRawChars)
      .forEach((chunk, chunkIndex) => leaves.push(checkTask(manifest, 'GLOBAL', 'BOUNDARY_RAW', requirement, chunkIndex, chunk, [],[],outline)));
    tasks.push(...leaves);
    // Each synthesis consumes bounded, source-bound reports. The final root
    // therefore depends transitively on every global raw/index/boundary page.
    let level = leaves, ordinal = 0;
    do {
      const next = batches(level, () => 1, maxIndexEntries).map(group =>
        checkTask(manifest, 'GLOBAL', 'SYNTHESIS', requirement, ordinal++, [], [], group.map(item => item.id),outline));
      tasks.push(...next); level = next;
    } while (level.length > 1);
  }
  return { id: `plan_${digest({ manifestHash: manifest.hash, contract, tasks: tasks.map(task => task.fingerprint) }).slice(0, 24)}`,
    manifestHash: manifest.hash, contractRevision: contract.revision, targetUnitIds: [...manifest.targetUnitIds], tasks };
}

const spanKey = (span: Pick<CheckSpan, 'unitId' | 'sceneId' | 'blockId'>) => `${span.unitId}\0${span.sceneId}\0${span.blockId}`;
function covers(requiredSpan: CheckSpan, actual: CheckSpan[]): boolean {
  let cursor = requiredSpan.start;
  for (const span of actual.filter(item => spanKey(item) === spanKey(requiredSpan) && item.blockHash === requiredSpan.blockHash)
    .sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (span.start > cursor) break;
    if (span.end > cursor) cursor = span.end;
    if (cursor >= requiredSpan.end) return true;
  }
  return cursor >= requiredSpan.end;
}
function linkedEvidence(receipt: CheckReceipt, available: CheckReceipt[], seen = new Set<string>(), receiptDigest=digest): { raw: CheckSpan[]; index: CheckIndexEntry[] } {
  if (seen.has(receipt.id)) return { raw: [], index: [] };
  const next = new Set(seen); next.add(receipt.id);
  const linked = (receipt.input.evidence ?? []).flatMap(link => {
    const source = available.find(item => item.id === link.receiptId && item.taskId === link.taskId && receiptDigest(item) === link.receiptDigest);
    return source ? [linkedEvidence(source, available, next, receiptDigest)] : [];
  });
  return { raw: [...receipt.input.raw, ...linked.flatMap(item => item.raw)], index: [...receipt.input.index, ...linked.flatMap(item => item.index)] };
}

export function validateCheckReceipt(manifest: GoalBodyManifest, plan: CheckPlan, receipt: CheckReceipt,
  availableReceipts: CheckReceipt[] = [], visiting: Set<string> = new Set()): { valid: boolean; reasons: string[] } {
  return checkReceipt(manifest,plan,receipt,availableReceipts,visiting,receiptValidationInputs(manifest));
}
/** Pure input indexes live only for one validation/coverage call. Permission
 * checks remain in the repository; modified receipts are rehashed next call. */
function receiptValidationInputs(manifest:GoalBodyManifest){
  const digests=new WeakMap<CheckReceipt,string>(),indexes=new WeakMap<CheckIndexEntry,string>();
  return {blocks:new Map(allBlocks(manifest).map(block=>[spanKey(block),block])),indexIdentity:(entry:CheckIndexEntry)=>{
    const cached=indexes.get(entry);if(cached!==undefined)return cached;
    const value=JSON.stringify(entry);indexes.set(entry,value);return value;
  },receiptDigest:(receipt:CheckReceipt)=>{
    const cached=digests.get(receipt);if(cached!==undefined)return cached;
    const value=digest(receipt);digests.set(receipt,value);return value;
  }};
}
function checkReceipt(manifest:GoalBodyManifest,plan:CheckPlan,receipt:CheckReceipt,availableReceipts:CheckReceipt[],visiting:Set<string>,
  inputs:ReturnType<typeof receiptValidationInputs>):{valid:boolean;reasons:string[]}{
  const {blocks,receiptDigest}=inputs;
  const matchingIndex=(a:CheckIndexEntry,b:CheckIndexEntry)=>inputs.indexIdentity(a)===inputs.indexIdentity(b);
  const reasons: string[] = [], task = plan.tasks.find(item => item.id === receipt.taskId);
  if (!task) return { valid: false, reasons: ['检查任务不存在'] };
  if (visiting.has(task.id)) return { valid: false, reasons: ['综合检查证据存在循环'] };
  const ancestors = new Set(visiting); ancestors.add(task.id);
  if (plan.manifestHash !== manifest.hash || task.manifestHash !== plan.manifestHash || task.fingerprint !== receipt.taskFingerprint) reasons.push('任务或正文快照不匹配');
  if (receipt.manifestHash !== plan.manifestHash && receipt.validatedManifestHash !== plan.manifestHash) reasons.push('回执未绑定当前正文快照');
  if (receipt.status !== 'SUCCEEDED' || !receipt.schemaValidated) reasons.push('检查未成功或结果定位格式无效');
  if (!receipt.summary?.trim()) reasons.push('检查结果缺少可供综合复核的摘要');
  if (receipt.input.source !== 'FROZEN_SENT_REQUEST' || !receipt.input.contextRef?.id || !receipt.input.contextRef.digest || !receipt.input.invocationId || !receipt.input.inputHash) reasons.push('缺少实际发送的上下文或调用证据');
  if (receipt.input.omittedRaw.length || receipt.input.omittedIndex.length) reasons.push('必需输入存在排除或裁剪');
  for (const span of receipt.input.raw) {
    const block = blocks.get(spanKey(span));
    if (!block || span.blockHash !== block.blockHash || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end > block.length || span.start >= span.end || sha256(block.text.slice(span.start, span.end)) !== span.textHash) reasons.push('实际 raw 区间与正文原文不一致');
  }
  for (const entry of receipt.input.index) {
    const block = blocks.get(spanKey(entry));
    if (!block || !matchingIndex(entry, indexOf(block))) reasons.push('实际来源索引与正文不一致');
  }
  if (task.requiredRaw.some(span => !covers(span, receipt.input.raw))) reasons.push('必需原文区间未被实际 raw 输入完整覆盖');
  if (task.requiredIndex.some(entry => !receipt.input.index.some(sent => matchingIndex(entry, sent)))) reasons.push('必需来源索引未实际发送');
  const links = receipt.input.evidence ?? [];
  if (links.length !== task.requiredEvidenceTaskIds.length ||
    links.some(link => !task.requiredEvidenceTaskIds.includes(link.taskId)) ||
    new Set(links.map(link => link.taskId)).size !== links.length) reasons.push('综合检查缺少必需的上游回执来源');
  for (const taskId of task.requiredEvidenceTaskIds) {
    const link = links.find(item => item.taskId === taskId);
    const source = link && availableReceipts.find(item => item.taskId === taskId && item.id === link.receiptId && receiptDigest(item) === link.receiptDigest &&
      item.summary === link.summary && same(item.findings, link.findings)&&same(item.outlineCoverage??null,link.outlineCoverage??null));
    if (!source || !checkReceipt(manifest, plan, source, availableReceipts, ancestors, inputs).valid) reasons.push('综合检查的上游回执无效或未实际发送');
  }
  const evidence = linkedEvidence(receipt, availableReceipts, new Set(), receiptDigest);
  if(task.requiredOutline){
    if(!same(task.requiredOutline,receipt.input.outline))reasons.push('必需大纲范围未实际发送');
    const entries=receipt.outlineCoverage;
    if(!Array.isArray(entries)||entries.length!==task.requiredOutline.length||new Set(entries.map(item=>item.requirementId)).size!==entries.length)reasons.push('大纲覆盖结果遗漏或重复范围');
    for(const entry of entries??[]){
      const requirement=task.requiredOutline.find(item=>item.id===entry.requirementId);
      if(!requirement||!['UNEXPANDED','PLANNED','PARTIAL','DRAFT_READY'].includes(entry.status)||!entry.reason?.trim()||!Array.isArray(entry.evidence)){reasons.push('大纲覆盖结果结构或目标无效');continue;}
      if(entry.status==='DRAFT_READY'&&!entry.evidence.length)reasons.push('大纲成稿声明缺少正文证据');
      for(const source of entry.evidence){
        const block=blocks.get(spanKey({unitId:requirement.unitId,...source}));
        if(!block||block.type==='note'||!Number.isSafeInteger(source.start)||!Number.isSafeInteger(source.end)||source.start<0||source.end>block.length||source.start>=source.end||
          !covers({unitId:requirement.unitId,...source,blockHash:block.blockHash,textHash:sha256(block.text.slice(source.start,source.end))},evidence.raw))reasons.push('大纲覆盖引用的正文未被实际读取');
      }
    }
  }else if(receipt.outlineCoverage!==undefined)reasons.push('非结构检查不得附加大纲完成声明');
  for (const finding of receipt.findings) {
    const source = finding.source, block = blocks.get(spanKey(source));
    if (!finding.id?.trim() || !finding.issue?.trim() || !finding.suggestion?.trim() || !block) { reasons.push('问题缺少有效定位或说明'); continue; }
    if (finding.basis === 'RAW') {
      if (!Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end) || source.start! < 0 || source.end! > block.length || source.start! >= source.end! ||
        !covers({ ...source, blockHash: block.blockHash, textHash: sha256(block.text.slice(source.start, source.end)) } as CheckSpan, evidence.raw)) reasons.push('问题声称的原文依据未实际读取');
    } else if (finding.basis === 'INDEX') {
      if (!finding.uncertainty?.trim() || !evidence.index.some(entry => matchingIndex(entry, indexOf(block)))) reasons.push('索引推断缺少来源或不确定性');
    } else reasons.push('问题依据类型无效');
  }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export function assessCheckCoverage(manifest: GoalBodyManifest, plan: CheckPlan, receipts: CheckReceipt[]): CoverageAssessment {
  const missingTaskIds: string[] = [], invalidReceipts: CoverageAssessment['invalidReceipts'] = [];
  let localComplete = true, globalComplete = true;
  const inputs=receiptValidationInputs(manifest);
  for (const task of plan.tasks) {
    const candidates = receipts.filter(receipt => receipt.taskId === task.id);
    const checks = candidates.map(receipt => checkReceipt(manifest, plan, receipt, receipts, new Set(), inputs));
    if (!checks.some(check => check.valid)) {
      if (!candidates.length) missingTaskIds.push(task.id);
      else invalidReceipts.push({ taskId: task.id, reason: checks.flatMap(check => check.reasons).join('；') });
      if (task.kind === 'LOCAL') localComplete = false; else globalComplete = false;
    }
  }
  return { localComplete, globalComplete, missingTaskIds, invalidReceipts };
}

/** A local receipt can be carried only when its exact block dependencies and
 * frozen task fingerprint are unchanged. Global evidence always reruns. */
export function carryForwardUnchangedLocalReceipts(previousManifest: GoalBodyManifest, previousPlan: CheckPlan, nextManifest: GoalBodyManifest,
  nextPlan: CheckPlan, receipts: CheckReceipt[]): CheckReceipt[] {
  const previousTasks = new Map(previousPlan.tasks.map(task => [task.fingerprint, task]));
  return nextPlan.tasks.filter(task => task.kind === 'LOCAL' && task.dependency === 'EXACT_BLOCKS').flatMap(task => {
    const old = previousTasks.get(task.fingerprint);
    if (!old || old.kind !== 'LOCAL' || old.dependency !== 'EXACT_BLOCKS') return [];
    const receipt = receipts.find(item => item.taskId === old.id && validateCheckReceipt(previousManifest, previousPlan, item).valid);
    if (!receipt) return [];
    const carried: CheckReceipt = { ...receipt, id: `${receipt.id}:carry:${nextManifest.hash.slice(0, 12)}`, taskId: task.id,
      taskFingerprint: task.fingerprint, validatedManifestHash: nextManifest.hash, carriedFromReceiptId: receipt.id };
    return validateCheckReceipt(nextManifest, nextPlan, carried).valid ? [carried] : [];
  });
}

export function markFindingRevised(finding: ReviewFinding, input: { baselineManifestHash: string; revisedManifestHash: string; repairRound: number; maxRepairRounds: number }): ReviewFinding {
  if (!['OPEN', 'UNRESOLVED'].includes(finding.status) || finding.manifestHash !== input.baselineManifestHash || input.baselineManifestHash === input.revisedManifestHash) fail('返修必须引用当前未解决问题及其旧稿基线');
  if (!Number.isSafeInteger(input.repairRound) || input.repairRound < 1 || input.repairRound > input.maxRepairRounds) fail('返修轮数已用尽');
  return { ...finding, status: 'REVISED', revisedManifestHash: input.revisedManifestHash, repairRound: input.repairRound, verificationReceiptId: undefined };
}
export function verifyFinding(finding: ReviewFinding, manifest: GoalBodyManifest, plan: CheckPlan, receipt: CheckReceipt): ReviewFinding {
  if (finding.status !== 'REVISED' || finding.revisedManifestHash !== manifest.hash || !validateCheckReceipt(manifest, plan, receipt).valid ||
    !receipt.input.raw.some(span => span.sceneId === finding.source.sceneId && span.blockId === finding.source.blockId) ||
    receipt.findings.some(item => item.id === finding.id)) fail('修订问题缺少绑定新稿与原定位的有效复查，或复查仍报告相同问题');
  return { ...finding, status: 'VERIFIED', manifestHash: manifest.hash, verificationReceiptId: receipt.id };
}
export function acceptFindingByAuthor(finding: ReviewFinding, input: { authorCommandId: string; contractRevision: number }): ReviewFinding {
  required(input.authorCommandId, '作者接受命令');
  if (!Number.isSafeInteger(input.contractRevision) || input.contractRevision < 1 || finding.status === 'VERIFIED') fail('问题不能由模型或无效合同自动标记为作者接受');
  return { ...finding, status: 'AUTHOR_ACCEPTED', authorAcceptance: { commandId: input.authorCommandId, contractRevision: input.contractRevision } };
}

export function assessGoalCandidate(input: { project: ScriptProject; contract: GoalCheckContract; manifest: GoalBodyManifest; plan: CheckPlan;
  receipts: CheckReceipt[]; findings: ReviewFinding[]; artifact: GoalArtifact | null; repairRoundsUsed: number;
  unresolvedUnknown: boolean; outOfScopeWrites: boolean; structureAlignment?: { aligned: boolean; evidenceHash: string } }): GoalCandidateAssessment {
  const { project, contract, manifest, plan } = input, gaps: string[] = [];
  let current: GoalBodyManifest | null = null;
  try { current = createGoalBodyManifest(project, contract.targetUnitIds, contract.targetScenes); }
  catch { gaps.push('目标单元不存在或不完整'); }
  if (!current || current.hash !== manifest.hash || project.revision !== manifest.revision || plan.manifestHash !== manifest.hash || plan.contractRevision !== contract.revision) gaps.push('最终正文 manifest 或检查计划已过期');
  try {
    if (!same(plan, createCheckPlan(manifest, contract))) gaps.push('检查计划缺少冻结合同要求的任务或已被改写');
  } catch { gaps.push('检查计划无法从冻结合同重建'); }
  for (const unit of manifest.units) {
    if (!unit.scenes.length) gaps.push(`目标单元 ${unit.unitId} 没有正文场景`);
    for (const scene of unit.scenes) if (!scene.blocks.some(block => block.type !== 'note' && block.text.trim())) gaps.push(`场景 ${scene.sceneId} 仍是空壳或笔记`);
    for(const scene of unit.scenes)if(project.units.find(item=>item.id===unit.unitId)?.scenes.find(item=>item.id===scene.sceneId)?.generation?.status==='partial')gaps.push(`场景 ${scene.sceneId} 正文未完，须从已保存检查点续写`);
  }
  const coverage = assessCheckCoverage(manifest, plan, input.receipts);
  if (!coverage.localComplete) gaps.push('必需局部原文检查未完整覆盖');
  if (!coverage.globalComplete) gaps.push('必需全局检查未完成，局部覆盖不能替代');
  for (const receipt of input.receipts) {
    if (!validateCheckReceipt(manifest, plan, receipt, input.receipts).valid) continue;
    for (const finding of receipt.findings) if (!input.findings.some(review => review.id === finding.id &&
      same({ issue: review.issue, suggestion: review.suggestion, severity: review.severity, basis: review.basis, source: review.source, uncertainty: review.uncertainty },
        { issue: finding.issue, suggestion: finding.suggestion, severity: finding.severity, basis: finding.basis, source: finding.source, uncertainty: finding.uncertainty }))) {
      gaps.push(`检查问题 ${finding.id} 未进入 ReviewSet`);
    }
  }
  if (input.findings.some(finding => finding.severity === 'BLOCKING' && finding.status !== 'VERIFIED' && !(finding.status === 'AUTHOR_ACCEPTED' && finding.authorAcceptance?.contractRevision === contract.revision))) gaps.push('存在未解决阻断问题');
  if (input.findings.some(finding => finding.status === 'VERIFIED' && (finding.manifestHash !== manifest.hash ||
    !input.receipts.some(receipt => receipt.id === finding.verificationReceiptId && validateCheckReceipt(manifest, plan, receipt, input.receipts).valid)))) {
    gaps.push('问题复查回执已失效或不属于最终正文');
  }
  if (input.findings.some(finding => finding.status === 'REVISED' && finding.revisedManifestHash === manifest.hash)) gaps.push('修订尚未经新稿复查');
  if (input.unresolvedUnknown || input.receipts.some(receipt => receipt.status === 'UNKNOWN')) gaps.push('仍有未核对的模型请求或检查结果');
  if (input.outOfScopeWrites) gaps.push('存在目标范围外写入');
  if (input.repairRoundsUsed > contract.maxRepairRounds) gaps.push('返修轮数超出冻结合同');
  let progress:ReturnType<typeof storyProgress>|undefined;
  if(contract.storyCoverage){
    const currentOutline=collectOutlineRequirements(project,contract.storyCoverage.targets);
    if(outlineSourcesChanged(contract.outlineRequirements??[],currentOutline.items))gaps.push('约定大纲来源已变化，须重新核对授权范围');
    gaps.push(...currentOutline.gaps);
    gaps.push(...contract.outlineGaps??[]);
    if(!contract.outlineRequirements?.length)gaps.push('约定的大纲范围尚未建立，不能以现有场景代替全部故事');
    const roots=plan.tasks.filter(task=>task.checkId==='story_coverage'&&task.phase==='SYNTHESIS'&&!plan.tasks.some(other=>other.requiredEvidenceTaskIds.includes(task.id)));
    const final=roots.length===1?[...input.receipts].reverse().find(receipt=>receipt.taskId===roots[0].id&&validateCheckReceipt(manifest,plan,receipt,input.receipts).valid):undefined;
    progress=storyProgress(project,contract.outlineRequirements??[],final?.outlineCoverage);
    if(!final)gaps.push('大纲与正文覆盖尚无完整、有效的综合证据');
    for(const item of progress)if(item.status!=='DRAFT_READY')gaps.push(`大纲范围 ${item.id} 尚未成稿：${item.reason}`);
  }else if (contract.requireStructureAlignment && (!input.structureAlignment?.aligned || !input.structureAlignment.evidenceHash)) gaps.push('大纲与分场交付范围尚未核对');
  if (!input.artifact || input.artifact.kind !== 'complete_candidate' || input.artifact.projectId !== project.id || input.artifact.revision !== project.revision ||
    input.artifact.manifestHash !== manifest.hash || !same(input.artifact.unitIds, contract.targetUnitIds)) gaps.push('交付引用未绑定最终候选版本和目标单元');
  return { complete: gaps.length === 0, resultType: gaps.length ? 'PARTIAL' : 'complete_candidate', manifestHash: manifest.hash, gaps, coverage,...(progress?{storyProgress:progress}:{}) };
}
