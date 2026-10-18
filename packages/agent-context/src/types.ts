import type { ResourceRef } from '../../agent-core/src';

/** EXACT tracks immutable content; CURRENT/COLLECTION also track the live pointer. */
export type Dependency = { ref: ResourceRef; freshness: 'EXACT' | 'CURRENT' | 'COLLECTION' };
export type ContextAccess = { ownerId: string; scopeId: string; branch: string };
export type MemoryKind = 'AUTHOR_PREFERENCE' | 'COLLABORATION' | 'NAVIGATION' | 'EXECUTION_INDEX' | 'DOMAIN_DERIVED';
export type MemoryRecord = ContextAccess & {
  id: string; key: string; revision: number; kind: MemoryKind;
  origin: 'AUTHOR_STATED' | 'MODEL_DERIVED'; review: 'AUTO_ACCEPTED' | 'HUMAN_REVIEWED';
  status: 'ACTIVE' | 'DISABLED' | 'STALE' | 'DELETED';
  content: { label: string; value: string } | null; dependencies: Dependency[];
  reason: string | null; expiresAt: number | null;
};
export type ContextRef = { id: string; digest: string };
export type SourceValidator = (dependency: Dependency, access: ContextAccess) => boolean;
export type ContextSection = {
  id: string; text: string; required: boolean; priority: number; dependencies: Dependency[];
};
export type FrozenSkill = {
  id: string; title: string; version: string; content: string;
  variables: Record<string, string>; configuration: Record<string, unknown>;
  overflow: 'ERROR' | 'SKIP'; contentHash: string; snapshotHash: string;
};
export type SkillTrace = {
  id: string; version: string; snapshotHash: string; contentHash: string;
  status: 'APPLIED' | 'SKIPPED'; reason: string | null; renderedText: string;
};
export type ContextBundle = {
  schemaVersion: 1; prompt: string; systemInstruction: string; outputSchema?: Record<string, unknown>; tools?: unknown[];
  sections: ContextSection[]; dependencies: Dependency[];
  skills: FrozenSkill[]; skillTrace: SkillTrace[];
  payloadHash: string;
};
