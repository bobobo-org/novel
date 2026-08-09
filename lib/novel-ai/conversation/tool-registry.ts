import { STUDIO_CLOSED_AGENT_TOOL_IDS } from "../web/studio-closed-agent-tools";

export const CONVERSATION_LOCAL_TOOL_IDS = {
  attachmentParse: "manual-learning:batch-attachment-parse",
  atomicLearningImport: "manual-learning:atomic-document-import",
  backupCreate: "repository:backup-create",
  projectExport: "repository:project-export",
  backupRestoreGuide: "repository:backup-restore-guide",
  storyStateQuery: "repository:story-state-query",
  sessionSummaryExport: "repository:conversation-summary-export",
  localUserEdit: "conversation:local-user-edit",
  closedAgentPlan: "closed-agent-os:conversation-plan",
  rpgChoicePlan: "closed-agent-os:rpg-choice-plan",
  rpgTurn: "closed-agent-os:rpg-turn",
} as const;

export type ConversationLocalToolId =
  (typeof CONVERSATION_LOCAL_TOOL_IDS)[keyof typeof CONVERSATION_LOCAL_TOOL_IDS];
export type ConversationPlannerToolId =
  | (typeof STUDIO_CLOSED_AGENT_TOOL_IDS)[number]
  | ConversationLocalToolId;

export type ConversationToolDefinition = {
  id: ConversationLocalToolId;
  localOnly: true;
  projectBound: true;
  arbitraryFilesystem: false;
  arbitraryNetwork: false;
  canonicalMutationBeforeApproval: false;
};

export const CONVERSATION_LOCAL_TOOL_REGISTRY: readonly ConversationToolDefinition[] =
  Object.freeze(Object.values(CONVERSATION_LOCAL_TOOL_IDS).map((id) => Object.freeze({
    id,
    localOnly: true as const,
    projectBound: true as const,
    arbitraryFilesystem: false as const,
    arbitraryNetwork: false as const,
    canonicalMutationBeforeApproval: false as const,
  })));

const TOOL_ALLOWLIST = new Set<ConversationPlannerToolId>([
  ...STUDIO_CLOSED_AGENT_TOOL_IDS,
  ...CONVERSATION_LOCAL_TOOL_REGISTRY.map(({ id }) => id),
]);

export function isConversationPlannerToolAllowed(toolId: string): toolId is ConversationPlannerToolId {
  return TOOL_ALLOWLIST.has(toolId as ConversationPlannerToolId);
}

export function assertConversationPlannerToolAllowed(toolId: string) {
  if (!isConversationPlannerToolAllowed(toolId)) {
    throw Object.assign(new Error("CONVERSATION_TOOL_NOT_ALLOWLISTED"), {
      code: "CONVERSATION_TOOL_NOT_ALLOWLISTED",
    });
  }
}

export function conversationPlannerToolAllowlist() {
  return [...TOOL_ALLOWLIST];
}
