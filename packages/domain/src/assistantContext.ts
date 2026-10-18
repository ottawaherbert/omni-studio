import type {
  AssistantConversationCheckpoint,
  AssistantMessage,
  AssistantPageFocus,
  AssistantProjectRef,
} from "./assistantCore";
import type { AssistantRun } from "./assistantRuntime";

export interface AssistantContextSnapshot {
  id: string;
  threadId: string;
  projectRef?: AssistantProjectRef;
  pageFocus?: AssistantPageFocus;
  projectSummary: Record<string, unknown>;
  latestCheckpoint?: AssistantConversationCheckpoint;
  recentMessages: AssistantMessage[];
  activeRuns: AssistantRun[];
  estimatedTokens: number;
  sourceHash: string;
  createdAt: number;
}
