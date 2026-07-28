export const KNOWLEDGE_INSTRUCTION_BOUNDARY_VERSION = "p23-knowledge-boundary-v1" as const;

export const KNOWLEDGE_AUTHORITY_ORDER = [
  "system_policy",
  "user_approved_configuration",
  "current_user_task",
  "approved_story_bible_constraints",
  "retrieved_knowledge_untrusted",
] as const;

export type KnowledgeSourceType =
  | "user_document"
  | "web_content"
  | "story_canonical"
  | "story_candidate"
  | "system_defined"
  | "unknown";

export type KnowledgeAllowedUsage =
  | "citation"
  | "retrieval_context"
  | "semantic_reference"
  | "user_visible_warning";

export type KnowledgeBlockedUsage =
  | "system_instruction"
  | "permission_grant"
  | "tool_authorization"
  | "tool_arguments"
  | "external_transfer_consent"
  | "approval_action"
  | "canonical_mutation"
  | "provider_selection_override";

export type KnowledgeBoundaryFinding = {
  code:
    | "INSTRUCTION_OVERRIDE"
    | "CROSS_SCOPE_ACCESS"
    | "TOOL_INVOCATION"
    | "SECRET_EXFILTRATION"
    | "CANONICAL_MUTATION"
    | "ROLE_IMPERSONATION"
    | "HIDDEN_INSTRUCTION"
    | "UNICODE_OBFUSCATION"
    | "EXTERNAL_TRANSFER"
    | "PRIVILEGE_ESCALATION"
    | "STRUCTURED_TOOL_PAYLOAD"
    | "SUSPICIOUS_BASE64";
  start: number;
  end: number;
  severity: "warning" | "blocking";
  matchedText?: string;
};

export type KnowledgeBoundaryResult = {
  schemaVersion: typeof KNOWLEDGE_INSTRUCTION_BOUNDARY_VERSION;
  trust: "untrusted_data";
  sourceId: string | null;
  chunkId: string | null;
  sourceRevision: string | null;
  sourceType: KnowledgeSourceType;
  storyId: string | null;
  storyRevision: string | null;
  originalText: string;
  sanitizedText: string;
  sanitizationStatus: "unchanged" | "sanitized" | "quarantined";
  findings: KnowledgeBoundaryFinding[];
  detectedInjectionSignals: KnowledgeBoundaryFinding["code"][];
  allowedUsage: KnowledgeAllowedUsage[];
  blockedUsage: KnowledgeBlockedUsage[];
  mayGrantAuthority: false;
  mayInvokeTools: false;
  mayMutateCanonical: false;
  maySelectProvider: false;
  mayAuthorizeExternalTransfer: false;
};

export function assertKnowledgeCannotGrantAuthority(result: KnowledgeBoundaryResult) {
  if (
    result.mayGrantAuthority
    || result.mayInvokeTools
    || result.mayMutateCanonical
    || result.maySelectProvider
    || result.mayAuthorizeExternalTransfer
  ) {
    throw Object.assign(new Error("Retrieved knowledge cannot grant authority."), {
      code: "KNOWLEDGE_AUTHORITY_ESCALATION_BLOCKED",
    });
  }
}
