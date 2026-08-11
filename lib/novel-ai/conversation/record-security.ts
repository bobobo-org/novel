import { sha256Hex } from "../closed-ai-cache";
import type {
  ConversationArtifact,
  ConversationAttachment,
  ConversationMessage,
  ConversationSession,
  ConversationSummary,
  ConversationToolInvocation,
  DomainRecord,
  LearningImportSession,
} from "../domain";
import { hasValidConversationClosedAgentCacheOriginProof } from "./closed-agent-cache-origin-proof";
import {
  CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE,
  parseClosedAgentFailureEvidence,
} from "../closed-agent-os/safe-runtime-diagnostics";
import { CONVERSATION_LOCAL_TOOL_IDS } from "./tool-registry";

const CONVERSATION_STORE_PREFIX = "conversation";
const MAX_PERSISTED_CONVERSATION_TEXT = 262_144;
const ARTIFACT_TARGET_STORES = new Set(["chapters", "storyBibles", "characters", "relationships", "worldRules", "lore", "timeline", "storyStates", "dramaProjects", "dramaSeasons", "dramaEpisodes", "dramaScenes", "dramaBeats", "learningImportSessions", "controlledLearning", "none"]);
const CREDENTIAL_PATTERN = /\b(?:vcp|sbp|gh[pousr])_[A-Za-z0-9_-]{16,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b|\b(?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|cookie)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}/iu;
const HIDDEN_REASONING_PATTERN = /\b(?:chain[-_ ]?of[-_ ]?thought|raw[_-]?reasoning|system[_-]?prompt)\b/iu;
const FORBIDDEN_KEYS = new Set([
  "authorization",
  "cookie",
  "token",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "pairingsecret",
  "systemprompt",
  "chainofthought",
  "rawreasoning",
  "rawcontent",
  "rawbytes",
  "arraybuffer",
  "fulltext",
  "parsedtext",
]);

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function normalizedKey(key: string) {
  return key.replace(/[_-]/gu, "").toLowerCase();
}

function containsForbiddenData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenData);
  if (typeof value === "string") return CREDENTIAL_PATTERN.test(value) || HIDDEN_REASONING_PATTERN.test(value);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    FORBIDDEN_KEYS.has(normalizedKey(key)) || containsForbiddenData(item));
}

function digestPattern(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export async function assertConversationRecordSafe(store: string, record: DomainRecord) {
  if (!store.startsWith(CONVERSATION_STORE_PREFIX) && store !== "learningImportSessions") return;
  if (containsForbiddenData(record)) fail("CONVERSATION_PRIVATE_DATA_NOT_ALLOWED");
  if (store === "conversationApprovalTransactions") {
    fail("CONVERSATION_APPROVAL_DIRECT_WRITE_NOT_ALLOWED");
  }
  if (store === "conversationSessions") {
    const session = record as ConversationSession;
    if (!session.title.trim() || session.title.length > 120 || !["active", "archived", "deleted"].includes(session.status)) {
      fail("CONVERSATION_SESSION_RECORD_INVALID");
    }
  }
  if (store === "conversationMessages") {
    const message = record as ConversationMessage;
    if (
      !message.sessionId
      || typeof message.content !== "string"
      || message.content.length > MAX_PERSISTED_CONVERSATION_TEXT
      || !["user", "assistant", "tool", "system_notice"].includes(message.role)
      || !["pending", "streaming", "completed", "failed", "cancelled"].includes(message.status)
      || !Array.isArray(message.candidateIds)
      || !Array.isArray(message.toolInvocationIds)
      || !Array.isArray(message.attachmentIds)
      || !digestPattern(message.contentDigest)
      || await sha256Hex(message.content.normalize("NFKC")) !== message.contentDigest
    ) fail("CONVERSATION_MESSAGE_DIGEST_INVALID");
  }
  if (store === "conversationArtifacts") {
    const artifact = record as ConversationArtifact;
    if (artifact.status === "approved") fail("CONVERSATION_ARTIFACT_DIRECT_APPROVAL_NOT_ALLOWED");
    if (
      !artifact.sessionId
      || typeof artifact.candidateContent !== "string"
      || artifact.candidateContent.length > MAX_PERSISTED_CONVERSATION_TEXT
      || !ARTIFACT_TARGET_STORES.has(artifact.targetStore)
      || !artifact.targetRecordId
      || !Number.isInteger(artifact.sourceRevision)
      || artifact.sourceRevision < 0
      || !["candidate", "rejected", "superseded"].includes(artifact.status)
      || !digestPattern(artifact.candidateDigest)
      || await sha256Hex(artifact.candidateContent.normalize("NFKC")) !== artifact.candidateDigest
    ) fail("CONVERSATION_ARTIFACT_DIGEST_INVALID");
  }
  if (store === "conversationSummaries") {
    const summary = record as ConversationSummary;
    if (
      !summary.sessionId
      || typeof summary.content !== "string"
      || summary.content.length > MAX_PERSISTED_CONVERSATION_TEXT
      || !summary.sourceMessageIds.length
      || !digestPattern(summary.contentDigest)
      || await sha256Hex(summary.content.normalize("NFKC")) !== summary.contentDigest
    ) fail("CONVERSATION_SUMMARY_DIGEST_INVALID");
  }
  if (store === "conversationAttachments") {
    const attachment = record as ConversationAttachment;
    const warnings = attachment.warnings ?? [];
    const legacyRightsConfirmationAbsent =
      attachment.userConfirmedRights === undefined
      && attachment.rightsConfirmationSchemaVersion === undefined;
    const rightsConfirmationVerified =
      attachment.userConfirmedRights === true
      && attachment.rightsConfirmationSchemaVersion
        === "conversation-attachment-rights-confirmation-v1";
    if (
      !attachment.sessionId
      || typeof attachment.rightsBasis !== "string"
      || !attachment.rightsBasis.trim()
      || attachment.rightsBasis.length > 120
      || (!legacyRightsConfirmationAbsent && !rightsConfirmationVerified)
      || attachment.localAnalysisOnly !== true
      || attachment.rawContentRetained !== false
      || !["txt", "markdown", "html", "json", "pdf", "docx"].includes(attachment.format)
      || !["pending", "parsing", "completed", "failed", "cancelled", "ocr_required"].includes(attachment.parsingStatus)
      || !Number.isInteger(attachment.byteLength)
      || attachment.byteLength < 0
      || !digestPattern(attachment.contentHash)
      || !digestPattern(attachment.rightsEvidenceHash)
      || /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home)\/)/u.test(attachment.safeSourceAlias)
      || !Array.isArray(warnings)
      || warnings.length > 32
      || warnings.some((warning) => (
        typeof warning !== "string"
        || warning.length === 0
        || warning.length > 1_024
        || /(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\|\/(?:Users|home)\/)/u.test(warning)
      ))
    ) fail("CONVERSATION_ATTACHMENT_RECORD_INVALID");
  }
  if (store === "conversationToolInvocations") {
    const invocation = record as ConversationToolInvocation;
    const receipt = invocation.executionReceipt;
    const failureEvidence = invocation.safeProgress?.stage
      === CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE
      ? parseClosedAgentFailureEvidence(invocation.safeProgress.message)
      : null;
    const hasAnyClosedProof = Boolean(receipt) && (
      receipt!.closedAgentSchemaVersion !== undefined
      || receipt!.closedAgentBackendId !== undefined
      || receipt!.normalizationReceiptId !== undefined
      || receipt!.traditionalChineseNormalizerVersion !== undefined
      || receipt!.closedAgentCacheOrigin !== undefined
    );
    const closedCacheProof = receipt?.closedAgentCacheOrigin;
    const closedProofInvalid = hasAnyClosedProof && (
      receipt?.closedAgentSchemaVersion !== "closed-agent-os-v2"
      || !["browser-ai", "local-ollama", "private-ai-hub"]
        .includes(receipt?.closedAgentBackendId ?? "")
      || !/^traditional-chinese-integrity:[a-f0-9]{64}$/u.test(
        receipt?.normalizationReceiptId ?? "",
      )
      || receipt?.traditionalChineseNormalizerVersion
        !== "opencc-js-1.4.1-cn-to-tw-single-pass-v1"
      || (closedCacheProof !== undefined && (
        invocation.actualExecutor !== "not_executed"
        || receipt?.providerRunId !== null
        || !hasValidConversationClosedAgentCacheOriginProof(closedCacheProof)
      ))
      || (closedCacheProof === undefined && (
        invocation.actualExecutor === "not_executed"
        || receipt?.providerRunId !== invocation.taskId
      ))
    );
    if (
      !invocation.sessionId
      || !digestPattern(invocation.inputDigest)
      || !digestPattern(invocation.contextDigest)
      || !Number.isInteger(invocation.canonicalMutationCount)
      || !["pending", "running", "completed", "failed", "cancelled"].includes(invocation.status)
      || (invocation.status === "completed" && !invocation.executionReceipt)
      || (invocation.status === "failed" && !invocation.safeErrorCode)
      || (invocation.status === "failed"
        && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
        && invocation.safeErrorCode !== "CONVERSATION_RELOAD_INTERRUPTED"
        && invocation.safeProgress?.stage !== CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE)
      || (invocation.safeProgress?.stage === CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE && (
        invocation.status !== "failed"
        || invocation.safeProgress.percent !== 100
        || !failureEvidence
        || failureEvidence.safeCode !== invocation.safeErrorCode
      ))
      || invocation.canonicalMutationCount < 0
      || invocation.canonicalMutationCount > 1
      || (invocation.dataLeftDevice && !invocation.externalRequest)
      || (receipt !== null && (
        !receipt.receiptId.trim()
        || !digestPattern(receipt.contextDigest)
        || receipt.contextDigest !== invocation.contextDigest
        || (receipt.outputDigest !== null && !digestPattern(receipt.outputDigest))
        || (receipt.providerRunId !== null && !receipt.providerRunId.trim())
        || receipt.externalRequest !== invocation.externalRequest
        || receipt.dataLeftDevice !== invocation.dataLeftDevice
        || (receipt.modelId !== null && invocation.modelId !== receipt.modelId)
        || (receipt.modelDigest !== null && invocation.modelDigest !== receipt.modelDigest)
        || (receipt.latencyMs !== null && (!Number.isFinite(receipt.latencyMs) || receipt.latencyMs < 0))
        || closedProofInvalid
      ))
    ) fail("CONVERSATION_TOOL_RECORD_INVALID");
  }
  if (store === "learningImportSessions") {
    const session = record as LearningImportSession;
    if (
      !session.sessionId
      || session.importSessionId !== session.id
      || !["staging", "processing", "cancelled", "failed", "ready_to_finalize", "committed", "rolled_back"].includes(session.status)
      || !["atomic_document", "partial"].includes(session.mode)
      || !digestPattern(session.manifestDigest)
      || session.stagingNamespace !== `learning-import-staging:${session.id}`
      || !Number.isInteger(session.totalParts)
      || !Number.isInteger(session.completedParts)
      || !Number.isInteger(session.failedParts)
      || session.totalParts < 1
      || session.completedParts < 0
      || session.failedParts < 0
      || session.completedParts + session.failedParts > session.totalParts
    ) fail("LEARNING_IMPORT_SESSION_RECORD_INVALID");
  }
}
