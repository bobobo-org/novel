import {
  KNOWLEDGE_INSTRUCTION_BOUNDARY_VERSION,
  assertKnowledgeCannotGrantAuthority,
  type KnowledgeBoundaryResult,
  type KnowledgeSourceType,
} from "./knowledge-instruction-boundary";
import { detectPromptInjection } from "./prompt-injection-detector";
import { stripToolInstructions } from "./tool-instruction-stripper";

export type KnowledgeSanitizationMetadata = {
  sourceId?: string | null;
  chunkId?: string | null;
  sourceRevision?: string | null;
  sourceType?: KnowledgeSourceType;
  storyId?: string | null;
  storyRevision?: string | null;
};

export function sanitizeRetrievedKnowledge(
  text: string,
  metadata: KnowledgeSanitizationMetadata = {},
): KnowledgeBoundaryResult {
  const findings = detectPromptInjection(text);
  const sanitizedText = stripToolInstructions(text, findings);
  const blocking = findings.some((finding) => finding.severity === "blocking");
  const result: KnowledgeBoundaryResult = {
    schemaVersion: KNOWLEDGE_INSTRUCTION_BOUNDARY_VERSION,
    trust: "untrusted_data",
    sourceId: metadata.sourceId ?? null,
    chunkId: metadata.chunkId ?? null,
    sourceRevision: metadata.sourceRevision ?? null,
    sourceType: metadata.sourceType ?? "unknown",
    storyId: metadata.storyId ?? null,
    storyRevision: metadata.storyRevision ?? null,
    originalText: text,
    sanitizedText,
    sanitizationStatus: blocking ? "quarantined" : sanitizedText === text ? "unchanged" : "sanitized",
    findings,
    detectedInjectionSignals: [...new Set(findings.map((finding) => finding.code))],
    allowedUsage: ["citation", "retrieval_context", "semantic_reference", "user_visible_warning"],
    blockedUsage: [
      "system_instruction",
      "permission_grant",
      "tool_authorization",
      "tool_arguments",
      "external_transfer_consent",
      "approval_action",
      "canonical_mutation",
      "provider_selection_override",
    ],
    mayGrantAuthority: false,
    mayInvokeTools: false,
    mayMutateCanonical: false,
    maySelectProvider: false,
    mayAuthorizeExternalTransfer: false,
  };
  assertKnowledgeCannotGrantAuthority(result);
  return result;
}
