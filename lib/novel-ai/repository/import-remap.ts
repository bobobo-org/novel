import {
  RPG_FORMULA_V3,
  type ConversationMessage,
  type ConversationToolInvocation,
  type DomainRecord,
  type RpgTurnReceipt,
} from "../domain";
import {
  hasRpgChoiceStaleEvidenceIdentity,
  isRpgChoiceStaleEvidenceInvocation,
} from "../conversation/rpg-choice-stale-evidence";
import { CHARACTER_AGENT_STORES, CONVERSATION_STORES, DRAMA_STORES, LEGACY_REQUIRED_RESTORE_STORES, NOVEL_STORES, P24A_REQUIRED_RESTORE_STORES, P24B_RC5_REQUIRED_RESTORE_STORES, P24B_RC6_REQUIRED_RESTORE_STORES, REQUIRED_RESTORE_STORES, RPG_V3_STORES, type NovelStoreName } from "./contracts";

const FORBIDDEN_CONVERSATION_KEYS = new Set([
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
const CONVERSATION_CREDENTIAL_PATTERN = /\b(?:vcp|sbp|gh[pousr])_[A-Za-z0-9_-]{16,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/iu;
const CONVERSATION_HIDDEN_REASONING_PATTERN = /\b(?:chain[-_ ]?of[-_ ]?thought|raw[_-]?reasoning|system[_-]?prompt)\b/iu;

function normalizeSecurityKey(key: string) {
  return key.replace(/[_-]/gu, "").toLowerCase();
}

function containsForbiddenConversationData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenConversationData);
  if (!value || typeof value !== "object") {
    return typeof value === "string" && (CONVERSATION_CREDENTIAL_PATTERN.test(value) || CONVERSATION_HIDDEN_REASONING_PATTERN.test(value));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    FORBIDDEN_CONVERSATION_KEYS.has(normalizeSecurityKey(key))
    || containsForbiddenConversationData(item));
}

export function assertCompleteReplacePayload(payload: Record<string, unknown[]>) {
  const containsRpgV3Data = RPG_V3_STORES.some((store) => Object.hasOwn(payload, store));
  const containsConversationData = CONVERSATION_STORES.some((store) => Object.hasOwn(payload, store));
  const containsCharacterAgentData = CHARACTER_AGENT_STORES.some((store) => Object.hasOwn(payload, store));
  const containsDramaData = DRAMA_STORES.some((store) => Object.hasOwn(payload, store));
  const requiredStores = containsRpgV3Data
    ? REQUIRED_RESTORE_STORES
    : containsConversationData
      ? P24B_RC6_REQUIRED_RESTORE_STORES
    : containsCharacterAgentData
      ? P24B_RC5_REQUIRED_RESTORE_STORES
      : containsDramaData
        ? P24A_REQUIRED_RESTORE_STORES
        : LEGACY_REQUIRED_RESTORE_STORES;
  const missing = requiredStores.filter((store) => !Array.isArray(payload[store]));
  if (missing.length) throw new Error(`BACKUP_REQUIRED_STORE_MISSING:${missing.join(",")}`);
}

export function validateImportRecords(payload: Record<string, unknown[]>) {
  for (const [store, rows] of Object.entries(payload)) {
    if (!NOVEL_STORES.includes(store as NovelStoreName)) throw new Error("BACKUP_UNKNOWN_STORE");
    if (!Array.isArray(rows)) throw new Error("BACKUP_STORE_INVALID");
  }
  const projects = payload.projects;
  if (!Array.isArray(projects) || projects.length !== 1) throw new Error("BACKUP_PROJECT_MISSING");
  const project = projects[0] as DomainRecord;
  const sourceProjectId = project?.projectId || project?.id;
  if (!sourceProjectId || !project?.id) throw new Error("BACKUP_PROJECT_INVALID");
  for (const store of NOVEL_STORES) {
    const seenRecordIds = new Set<string>();
    for (const raw of payload[store] ?? []) {
      const row = raw as DomainRecord;
      if (!row || typeof row !== "object" || !row.id) throw new Error("BACKUP_RECORD_INVALID");
      if (seenRecordIds.has(row.id)) throw new Error(`BACKUP_DUPLICATE_ID:${store}:${row.id}`);
      seenRecordIds.add(row.id);
      if (row.projectId && row.projectId !== sourceProjectId) throw new Error("BACKUP_PROJECT_SCOPE_MISMATCH");
      if (!Number.isInteger(row.revision) || row.revision < 1) throw new Error("BACKUP_REVISION_INVALID");
      if (!row.schemaVersion || !row.createdAt || !row.updatedAt) throw new Error("BACKUP_REQUIRED_FIELD_MISSING");
    }
  }
  const ids = new Set(NOVEL_STORES.flatMap((store) => (payload[store] ?? []).map((raw) => (raw as DomainRecord).id)));
  const accepted = (payload.acceptedChoices ?? []) as Array<DomainRecord & { candidateId?: string; branchId?: string; chapterId?: string; acceptedChoiceId?: string; rpgTurnReceiptId?: string | null }>;
  const branches = (payload.storyBranches ?? []) as Array<DomainRecord & { branchId?: string; parentBranchId?: string | null; acceptedChoiceId?: string; sourceCandidateId?: string; chapterId?: string }>;
  for (const row of accepted) {
    if (!row.candidateId || !row.branchId || !row.chapterId || !ids.has(row.candidateId) || !ids.has(row.branchId) || !ids.has(row.chapterId)) throw new Error("BACKUP_ACCEPTED_CHOICE_REFERENCE_INVALID");
    if (row.acceptedChoiceId && row.acceptedChoiceId !== row.id) throw new Error("BACKUP_ACCEPTED_CHOICE_ID_MISMATCH");
  }
  const branchMap = new Map(branches.map((row) => [row.id, row]));
  for (const row of branches) {
    if ((row.branchId && row.branchId !== row.id) || !row.acceptedChoiceId || !row.sourceCandidateId || !row.chapterId || !ids.has(row.acceptedChoiceId) || !ids.has(row.sourceCandidateId) || !ids.has(row.chapterId)) throw new Error("BACKUP_STORY_BRANCH_REFERENCE_INVALID");
    if (row.parentBranchId && !branchMap.has(row.parentBranchId)) throw new Error("BACKUP_PARENT_BRANCH_MISSING");
    const seen = new Set<string>([row.id]); let parent = row.parentBranchId ?? null;
    while (parent) { if (seen.has(parent)) throw new Error("BACKUP_BRANCH_CYCLE"); seen.add(parent); parent = branchMap.get(parent)?.parentBranchId ?? null; }
  }
  const deltas = (payload.storyBibleDeltas ?? []) as Array<DomainRecord & { transactionId?: string; candidateId?: string; acceptedChoiceId?: string; chapterId?: string }>;
  const approvals = (payload.approvalTransactions ?? []) as Array<DomainRecord & { transactionId?: string; acceptedChoiceId?: string; branchId?: string; storyBibleDeltaId?: string; candidateId?: string; rpgTurnReceiptId?: string | null }>;
  const idempotency = (payload.idempotencyRecords ?? []) as Array<DomainRecord & { transactionId?: string; acceptedChoiceId?: string; branchId?: string; storyBibleDeltaId?: string; candidateId?: string; rpgTurnReceiptId?: string | null }>;
  const journals = (payload.operationJournal ?? []) as Array<DomainRecord & { operationId?: string; acceptedChoiceId?: string; rpgTurnReceiptId?: string | null }>;
  const rpgReceipts = (payload.rpgTurnReceipts ?? []) as RpgTurnReceipt[];
  for (const row of deltas) if (!row.transactionId || !row.candidateId || !row.acceptedChoiceId || !row.chapterId || !ids.has(row.transactionId) || !ids.has(row.candidateId) || !ids.has(row.acceptedChoiceId) || !ids.has(row.chapterId)) throw new Error("BACKUP_STORY_BIBLE_DELTA_REFERENCE_INVALID");
  for (const row of approvals) if (!row.transactionId || row.transactionId !== row.id || !row.acceptedChoiceId || !row.branchId || !row.storyBibleDeltaId || !row.candidateId || !ids.has(row.acceptedChoiceId) || !ids.has(row.branchId) || !ids.has(row.storyBibleDeltaId) || !ids.has(row.candidateId)) throw new Error("BACKUP_APPROVAL_TRANSACTION_REFERENCE_INVALID");
  for (const row of idempotency) if (!row.transactionId || !row.acceptedChoiceId || !row.branchId || !row.storyBibleDeltaId || !row.candidateId || !ids.has(row.transactionId) || !ids.has(row.acceptedChoiceId) || !ids.has(row.branchId) || !ids.has(row.storyBibleDeltaId) || !ids.has(row.candidateId)) throw new Error("BACKUP_IDEMPOTENCY_REFERENCE_INVALID");
  const receiptMap = new Map(rpgReceipts.map((row) => [row.id, row]));
  const acceptedMap = new Map(accepted.map((row) => [row.id, row]));
  const approvalMap = new Map(approvals.map((row) => [row.id, row]));
  const journalMap = new Map(journals.map((row) => [row.operationId ?? row.id, row]));
  for (const row of rpgReceipts) {
    if (
      row.receiptId !== row.id
      || !row.chapterId
      || !row.operationId
      || !row.acceptedChoiceId
      || !ids.has(row.chapterId)
      || !ids.has(row.operationId)
      || !ids.has(row.acceptedChoiceId)
      || !Number.isInteger(row.sourceRevision)
      || !Number.isInteger(row.resultingRevision)
      || row.sourceRevision < 0
      || row.resultingRevision <= row.sourceRevision
      || row.beforeSnapshot?.storyStateRevision !== row.sourceRevision
      || row.afterSnapshot?.storyStateRevision !== row.resultingRevision
      || row.formulaVersion !== RPG_FORMULA_V3
      || acceptedMap.get(row.acceptedChoiceId)?.rpgTurnReceiptId !== row.id
      || approvalMap.get(row.operationId)?.rpgTurnReceiptId !== row.id
      || (Object.hasOwn(payload, "operationJournal") && journalMap.get(row.operationId)?.rpgTurnReceiptId !== row.id)
      || !idempotency.some((record) => record.transactionId === row.operationId && record.rpgTurnReceiptId === row.id)
    ) throw new Error("BACKUP_RPG_TURN_RECEIPT_REFERENCE_INVALID");
  }
  for (const row of accepted) {
    if (row.rpgTurnReceiptId && receiptMap.get(row.rpgTurnReceiptId)?.acceptedChoiceId !== row.id) throw new Error("BACKUP_ACCEPTED_CHOICE_RPG_RECEIPT_INVALID");
  }
  for (const row of approvals) {
    if (row.rpgTurnReceiptId && receiptMap.get(row.rpgTurnReceiptId)?.operationId !== row.id) throw new Error("BACKUP_APPROVAL_RPG_RECEIPT_INVALID");
  }
  for (const row of idempotency) {
    if (row.rpgTurnReceiptId && receiptMap.get(row.rpgTurnReceiptId)?.operationId !== row.transactionId) throw new Error("BACKUP_IDEMPOTENCY_RPG_RECEIPT_INVALID");
  }
  for (const row of journals) {
    if (row.rpgTurnReceiptId && receiptMap.get(row.rpgTurnReceiptId)?.operationId !== (row.operationId ?? row.id)) throw new Error("BACKUP_JOURNAL_RPG_RECEIPT_INVALID");
  }
  const dramaProjects = (payload.dramaProjects ?? []) as Array<DomainRecord & { dramaProjectId?: string; seasonIds?: string[] }>;
  const canonLinks = (payload.narrativeCanonLinks ?? []) as Array<DomainRecord & { dramaProjectId?: string; episodeIds?: string[] }>;
  const dramaApprovals = (payload.dramaApprovals ?? []) as Array<DomainRecord & { dramaProjectId?: string; approvedEntityIds?: string[] }>;
  for (const row of dramaProjects) {
    if (row.dramaProjectId !== row.id || !row.seasonIds?.every((id) => ids.has(id))) throw new Error("BACKUP_DRAMA_PROJECT_REFERENCE_INVALID");
  }
  for (const row of canonLinks) {
    if (!row.dramaProjectId || !ids.has(row.dramaProjectId) || !row.episodeIds?.every((id) => ids.has(id))) throw new Error("BACKUP_DRAMA_CANON_LINK_REFERENCE_INVALID");
  }
  for (const row of dramaApprovals) {
    if (!row.dramaProjectId || !ids.has(row.dramaProjectId) || !row.approvedEntityIds?.every((id) => ids.has(id))) throw new Error("BACKUP_DRAMA_APPROVAL_REFERENCE_INVALID");
  }
  const profiles = (payload.characterAgentProfiles ?? []) as Array<DomainRecord & { profileId?: string; characterId?: string }>;
  const states = (payload.characterAgentStates ?? []) as Array<DomainRecord & { stateId?: string; characterId?: string; canonContextId?: string }>;
  const memories = (payload.characterMemories ?? []) as Array<DomainRecord & { memoryId?: string; characterId?: string; canonContextId?: string; sourceRevision?: number }>;
  const relationshipEvents = (payload.characterRelationshipEvents ?? []) as Array<DomainRecord & { eventId?: string; relationshipId?: string; evidenceIds?: string[]; idempotencyScope?: string; sourceEventScope?: string }>;
  const proposals = (payload.characterProposals ?? []) as Array<DomainRecord & { proposalId?: string; evaluationId?: string; characterIds?: string[] }>;
  const characterApprovals = (payload.characterAgentApprovals ?? []) as Array<DomainRecord & { approvalId?: string; proposalId?: string; canonicalEntityId?: string; idempotencyScope?: string }>;
  const profileCharacters = new Set(((payload.characters ?? []) as DomainRecord[]).map((row) => row.id));
  for (const row of profiles) {
    if (row.profileId !== row.id || !row.characterId || !profileCharacters.has(row.characterId)) throw new Error("BACKUP_CHARACTER_PROFILE_REFERENCE_INVALID");
  }
  for (const row of states) {
    if (row.stateId !== row.id || !row.characterId || !profileCharacters.has(row.characterId) || !row.canonContextId) throw new Error("BACKUP_CHARACTER_STATE_REFERENCE_INVALID");
  }
  for (const row of memories) {
    if (row.memoryId !== row.id || !row.characterId || !profileCharacters.has(row.characterId) || !row.canonContextId || !Number.isInteger(row.sourceRevision)) throw new Error("BACKUP_CHARACTER_MEMORY_REFERENCE_INVALID");
  }
  const relationshipIds = new Set(((payload.characterRelationships ?? []) as DomainRecord[]).map((row) => row.id));
  const eventIdempotencyScopes = new Set<string>();
  const eventSourceScopes = new Set<string>();
  for (const row of relationshipEvents) {
    if (row.eventId !== row.id || !row.relationshipId || !relationshipIds.has(row.relationshipId) || !row.evidenceIds?.length || !row.idempotencyScope || !row.sourceEventScope) throw new Error("BACKUP_CHARACTER_RELATIONSHIP_EVENT_REFERENCE_INVALID");
    if (eventIdempotencyScopes.has(row.idempotencyScope) || eventSourceScopes.has(row.sourceEventScope)) throw new Error("BACKUP_DUPLICATE_RELATIONSHIP_EVENT");
    eventIdempotencyScopes.add(row.idempotencyScope);
    eventSourceScopes.add(row.sourceEventScope);
  }
  for (const row of proposals) {
    if (row.proposalId !== row.id || !row.evaluationId || !ids.has(row.evaluationId) || !row.characterIds?.every((id) => profileCharacters.has(id))) throw new Error("BACKUP_CHARACTER_PROPOSAL_REFERENCE_INVALID");
  }
  const approvalScopes = new Set<string>();
  for (const row of characterApprovals) {
    if (row.approvalId !== row.id || !row.proposalId || !ids.has(row.proposalId) || !row.canonicalEntityId || !ids.has(row.canonicalEntityId) || !row.idempotencyScope) throw new Error("BACKUP_CHARACTER_APPROVAL_REFERENCE_INVALID");
    if (approvalScopes.has(row.idempotencyScope)) throw new Error("BACKUP_DUPLICATE_CHARACTER_APPROVAL");
    approvalScopes.add(row.idempotencyScope);
  }
  const sessions = (payload.conversationSessions ?? []) as Array<DomainRecord & {
    status?: string;
    activeChapterId?: string | null;
    parentSessionId?: string | null;
    branchedFromMessageId?: string | null;
    summaryDigest?: string | null;
  }>;
  const messages = (payload.conversationMessages ?? []) as Array<DomainRecord & {
    sessionId?: string;
    role?: string;
    content?: string;
    contentDigest?: string;
    status?: string;
    parentMessageId?: string | null;
    sourceMessageId?: string | null;
    candidateIds?: string[];
    toolInvocationIds?: string[];
    attachmentIds?: string[];
  }>;
  const toolInvocations = (payload.conversationToolInvocations ?? []) as Array<DomainRecord & {
    sessionId?: string;
    messageId?: string;
    taskId?: string;
    toolId?: string;
    taskType?: string;
    inputDigest?: string;
    contextDigest?: string;
    status?: string;
    canonicalMutationCount?: number;
    externalRequest?: boolean;
    dataLeftDevice?: boolean;
    actualExecutor?: string | null;
    modelId?: string | null;
    modelDigest?: string | null;
    executionReceipt?: {
      receiptId?: string;
      modelId?: string | null;
      modelDigest?: string | null;
      providerRunId?: string | null;
      contextDigest?: string;
      outputDigest?: string | null;
      externalRequest?: boolean;
      dataLeftDevice?: boolean;
      latencyMs?: number | null;
    } | null;
    safeProgress?: { percent?: number | null } | null;
    safeErrorCode?: string | null;
  }>;
  const attachments = (payload.conversationAttachments ?? []) as Array<DomainRecord & {
    sessionId?: string;
    safeSourceAlias?: string;
    contentHash?: string;
    rightsBasis?: string;
    rightsEvidenceHash?: string;
    userConfirmedRights?: boolean;
    rightsConfirmationSchemaVersion?: string;
    localAnalysisOnly?: boolean;
    rawContentRetained?: boolean;
  }>;
  const artifacts = (payload.conversationArtifacts ?? []) as Array<DomainRecord & {
    sessionId?: string;
    sourceMessageId?: string;
    targetStore?: string;
    targetRecordId?: string;
    sourceRevision?: number;
    candidateContent?: string;
    candidateDigest?: string;
    status?: string;
    approvedRevision?: number | null;
  }>;
  const summaries = (payload.conversationSummaries ?? []) as Array<DomainRecord & {
    sessionId?: string;
    sourceMessageIds?: string[];
    contentDigest?: string;
    canonRevisionDigest?: string;
  }>;
  const conversationApprovals = (payload.conversationApprovalTransactions ?? []) as Array<DomainRecord & {
    transactionId?: string;
    idempotencyScope?: string;
    sessionId?: string;
    sourceMessageId?: string;
    artifactId?: string;
    candidateDigest?: string;
    targetStore?: string;
    targetRecordId?: string;
    sourceRevision?: number;
    resultingRevision?: number;
    canonicalMutationCount?: number;
  }>;
  const learningImports = (payload.learningImportSessions ?? []) as Array<DomainRecord & {
    importSessionId?: string;
    sessionId?: string;
    attachmentIds?: string[];
    totalParts?: number;
    completedParts?: number;
    failedParts?: number;
    status?: string;
    mode?: string;
    manifestDigest?: string;
    stagingNamespace?: string;
  }>;
  const conversationPayload = Object.fromEntries(CONVERSATION_STORES.map((store) => [store, payload[store] ?? []]));
  if (containsForbiddenConversationData(conversationPayload)) throw new Error("BACKUP_CONVERSATION_PRIVATE_DATA_NOT_ALLOWED");
  const sessionMap = new Map(sessions.map((row) => [row.id, row]));
  const messageMap = new Map(messages.map((row) => [row.id, row]));
  const invocationMap = new Map(toolInvocations.map((row) => [row.id, row]));
  const attachmentMap = new Map(attachments.map((row) => [row.id, row]));
  const artifactMap = new Map(artifacts.map((row) => [row.id, row]));
  const digestPattern = /^[a-f0-9]{64}$/u;
  for (const session of sessions) {
    if (!session.status || !["active", "archived", "deleted"].includes(session.status)) throw new Error("BACKUP_CONVERSATION_SESSION_STATUS_INVALID");
    if (session.activeChapterId && !ids.has(session.activeChapterId)) throw new Error("BACKUP_CONVERSATION_ACTIVE_CHAPTER_INVALID");
    if (session.parentSessionId && !sessionMap.has(session.parentSessionId)) throw new Error("BACKUP_CONVERSATION_PARENT_SESSION_INVALID");
    if (session.branchedFromMessageId && !messageMap.has(session.branchedFromMessageId)) throw new Error("BACKUP_CONVERSATION_BRANCH_MESSAGE_INVALID");
    if (session.summaryDigest && !digestPattern.test(session.summaryDigest)) throw new Error("BACKUP_CONVERSATION_SUMMARY_DIGEST_INVALID");
    const seen = new Set<string>([session.id]);
    let parentSessionId = session.parentSessionId ?? null;
    while (parentSessionId) {
      if (seen.has(parentSessionId)) throw new Error("BACKUP_CONVERSATION_SESSION_CYCLE");
      seen.add(parentSessionId);
      parentSessionId = sessionMap.get(parentSessionId)?.parentSessionId ?? null;
    }
  }
  for (const message of messages) {
    if (!message.sessionId || !sessionMap.has(message.sessionId)) throw new Error("BACKUP_CONVERSATION_MESSAGE_SESSION_INVALID");
    if (!message.role || !["user", "assistant", "tool", "system_notice"].includes(message.role)) throw new Error("BACKUP_CONVERSATION_MESSAGE_ROLE_INVALID");
    if (!message.status || !["pending", "streaming", "completed", "failed", "cancelled"].includes(message.status)) throw new Error("BACKUP_CONVERSATION_MESSAGE_STATUS_INVALID");
    if (typeof message.content !== "string" || !message.contentDigest || !digestPattern.test(message.contentDigest)) throw new Error("BACKUP_CONVERSATION_MESSAGE_CONTENT_INVALID");
    if (message.parentMessageId && messageMap.get(message.parentMessageId)?.sessionId !== message.sessionId) throw new Error("BACKUP_CONVERSATION_PARENT_MESSAGE_INVALID");
    if (message.sourceMessageId && !messageMap.has(message.sourceMessageId)) throw new Error("BACKUP_CONVERSATION_SOURCE_MESSAGE_INVALID");
    if (!message.candidateIds?.every((id) => artifactMap.get(id)?.sessionId === message.sessionId)) throw new Error("BACKUP_CONVERSATION_MESSAGE_ARTIFACT_INVALID");
    if (!message.toolInvocationIds?.every((id) => invocationMap.get(id)?.sessionId === message.sessionId)) throw new Error("BACKUP_CONVERSATION_MESSAGE_TOOL_INVALID");
    if (!message.attachmentIds?.every((id) => attachmentMap.get(id)?.sessionId === message.sessionId)) throw new Error("BACKUP_CONVERSATION_MESSAGE_ATTACHMENT_INVALID");
    const seen = new Set<string>([message.id]);
    let parentMessageId = message.parentMessageId ?? null;
    while (parentMessageId) {
      if (seen.has(parentMessageId)) throw new Error("BACKUP_CONVERSATION_MESSAGE_CYCLE");
      seen.add(parentMessageId);
      parentMessageId = messageMap.get(parentMessageId)?.parentMessageId ?? null;
    }
  }
  const seenTaskIds = new Set<string>();
  for (const invocation of toolInvocations) {
    if (!invocation.sessionId || messageMap.get(invocation.messageId ?? "")?.sessionId !== invocation.sessionId) throw new Error("BACKUP_CONVERSATION_TOOL_MESSAGE_INVALID");
    if (!invocation.taskId || seenTaskIds.has(invocation.taskId)) throw new Error("BACKUP_CONVERSATION_TASK_ID_DUPLICATE");
    seenTaskIds.add(invocation.taskId);
    if (!invocation.toolId || !invocation.taskType || !invocation.inputDigest || !digestPattern.test(invocation.inputDigest) || !invocation.contextDigest || !digestPattern.test(invocation.contextDigest) || !invocation.status || !["pending", "running", "completed", "failed", "cancelled"].includes(invocation.status)) throw new Error("BACKUP_CONVERSATION_TOOL_CONTRACT_INVALID");
    if (invocation.status === "completed" && !invocation.executionReceipt) throw new Error("BACKUP_CONVERSATION_EXECUTION_RECEIPT_REQUIRED");
    if (invocation.status === "failed" && !invocation.safeErrorCode) throw new Error("BACKUP_CONVERSATION_SAFE_ERROR_CODE_REQUIRED");
    if (!Number.isInteger(invocation.canonicalMutationCount) || (invocation.canonicalMutationCount ?? -1) < 0 || (invocation.canonicalMutationCount ?? 2) > 1) throw new Error("BACKUP_CONVERSATION_CANONICAL_MUTATION_COUNT_INVALID");
    if (invocation.dataLeftDevice && !invocation.externalRequest) throw new Error("BACKUP_CONVERSATION_EXECUTION_TRUTH_INVALID");
    if (invocation.actualExecutor !== null && invocation.actualExecutor !== undefined && (!invocation.actualExecutor.trim() || invocation.actualExecutor.length > 120)) throw new Error("BACKUP_CONVERSATION_EXECUTOR_INVALID");
    if (invocation.actualExecutor && ["external-ai", "openai", "gemini", "grok", "claude"].includes(invocation.actualExecutor) && (!invocation.externalRequest || !invocation.dataLeftDevice)) throw new Error("BACKUP_CONVERSATION_EXTERNAL_EXECUTOR_TRUTH_INVALID");
    if (invocation.executionReceipt && (invocation.executionReceipt.externalRequest !== invocation.externalRequest || invocation.executionReceipt.dataLeftDevice !== invocation.dataLeftDevice)) throw new Error("BACKUP_CONVERSATION_RECEIPT_TRUTH_INVALID");
    if (invocation.executionReceipt && (
      !invocation.executionReceipt.receiptId?.trim()
      || invocation.executionReceipt.contextDigest !== invocation.contextDigest
      || !digestPattern.test(invocation.executionReceipt.contextDigest)
      || (invocation.executionReceipt.outputDigest !== null && (!invocation.executionReceipt.outputDigest || !digestPattern.test(invocation.executionReceipt.outputDigest)))
      || (invocation.executionReceipt.providerRunId !== null && !invocation.executionReceipt.providerRunId?.trim())
      || invocation.executionReceipt.latencyMs === undefined
      || (invocation.executionReceipt.latencyMs !== null && (!Number.isFinite(invocation.executionReceipt.latencyMs) || invocation.executionReceipt.latencyMs < 0))
      || (invocation.modelId !== null && invocation.executionReceipt.modelId !== invocation.modelId)
      || (invocation.modelDigest !== null && invocation.executionReceipt.modelDigest !== invocation.modelDigest)
    )) throw new Error("BACKUP_CONVERSATION_RECEIPT_IDENTITY_INVALID");
    if (invocation.safeProgress?.percent !== null && invocation.safeProgress?.percent !== undefined && (!Number.isFinite(invocation.safeProgress.percent) || invocation.safeProgress.percent < 0 || invocation.safeProgress.percent > 100)) throw new Error("BACKUP_CONVERSATION_PROGRESS_INVALID");
    if (invocation.safeErrorCode && !/^[A-Z0-9_.:-]{1,96}$/u.test(invocation.safeErrorCode)) throw new Error("BACKUP_CONVERSATION_SAFE_ERROR_CODE_INVALID");
    if (!messageMap.get(invocation.messageId ?? "")?.toolInvocationIds?.includes(invocation.id)) throw new Error("BACKUP_CONVERSATION_TOOL_BACK_REFERENCE_INVALID");
    if (hasRpgChoiceStaleEvidenceIdentity(invocation as ConversationToolInvocation)) {
      const markerMessage = messageMap.get(invocation.messageId ?? "") as ConversationMessage | undefined;
      if (
        !markerMessage
        || !isRpgChoiceStaleEvidenceInvocation(
          invocation as ConversationToolInvocation,
          markerMessage,
        )
      ) throw new Error("BACKUP_CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_INVALID");
    }
  }
  for (const attachment of attachments) {
    const legacyRightsConfirmationAbsent =
      attachment.userConfirmedRights === undefined
      && attachment.rightsConfirmationSchemaVersion === undefined;
    const rightsConfirmationVerified = attachment.userConfirmedRights === true
      && attachment.rightsConfirmationSchemaVersion
        === "conversation-attachment-rights-confirmation-v1";
    if (!attachment.sessionId || !sessionMap.has(attachment.sessionId)) throw new Error("BACKUP_CONVERSATION_ATTACHMENT_SESSION_INVALID");
    if (attachment.localAnalysisOnly !== true || attachment.rawContentRetained !== false) throw new Error("BACKUP_CONVERSATION_ATTACHMENT_RETENTION_INVALID");
    if (!attachment.rightsBasis?.trim() || attachment.rightsBasis.length > 120 || (!legacyRightsConfirmationAbsent && !rightsConfirmationVerified)) throw new Error("BACKUP_CONVERSATION_ATTACHMENT_RIGHTS_INVALID");
    if (!attachment.contentHash || !digestPattern.test(attachment.contentHash) || !attachment.rightsEvidenceHash || !digestPattern.test(attachment.rightsEvidenceHash)) throw new Error("BACKUP_CONVERSATION_ATTACHMENT_DIGEST_INVALID");
    if (!attachment.safeSourceAlias || /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home)\/)/u.test(attachment.safeSourceAlias)) throw new Error("BACKUP_CONVERSATION_ATTACHMENT_ALIAS_UNSAFE");
  }
  const canonicalConversationTargets = new Set(["chapters", "storyBibles", "characters", "relationships", "worldRules", "lore", "timeline", "storyStates", "dramaProjects", "dramaSeasons", "dramaEpisodes", "dramaScenes", "dramaBeats", "learningImportSessions"]);
  const approvedArtifactIds = new Set(conversationApprovals.map((approval) => approval.artifactId).filter((id): id is string => Boolean(id)));
  for (const artifact of artifacts) {
    if (!artifact.sessionId || messageMap.get(artifact.sourceMessageId ?? "")?.sessionId !== artifact.sessionId) throw new Error("BACKUP_CONVERSATION_ARTIFACT_MESSAGE_INVALID");
    if (!artifact.targetStore || ![...canonicalConversationTargets, "controlledLearning", "none"].includes(artifact.targetStore)) throw new Error("BACKUP_CONVERSATION_ARTIFACT_TARGET_INVALID");
    if (!artifact.targetRecordId || !Number.isInteger(artifact.sourceRevision) || (artifact.sourceRevision ?? -1) < 0 || typeof artifact.candidateContent !== "string" || !artifact.candidateDigest || !digestPattern.test(artifact.candidateDigest)) throw new Error("BACKUP_CONVERSATION_ARTIFACT_INVALID");
    if (!artifact.status || !["candidate", "approved", "rejected", "superseded"].includes(artifact.status)) throw new Error("BACKUP_CONVERSATION_ARTIFACT_STATUS_INVALID");
    if (!messageMap.get(artifact.sourceMessageId ?? "")?.candidateIds?.includes(artifact.id)) throw new Error("BACKUP_CONVERSATION_ARTIFACT_BACK_REFERENCE_INVALID");
    if (artifact.status === "approved" && (!canonicalConversationTargets.has(artifact.targetStore) || !ids.has(artifact.targetRecordId) || !Number.isInteger(artifact.approvedRevision) || !approvedArtifactIds.has(artifact.id))) throw new Error("BACKUP_CONVERSATION_APPROVED_ARTIFACT_TARGET_INVALID");
    if (artifact.status !== "approved" && approvedArtifactIds.has(artifact.id)) throw new Error("BACKUP_CONVERSATION_ARTIFACT_APPROVAL_STATE_INVALID");
  }
  for (const summary of summaries) {
    if (!summary.sessionId || !sessionMap.has(summary.sessionId) || !summary.sourceMessageIds?.length || !summary.sourceMessageIds.every((id) => messageMap.get(id)?.sessionId === summary.sessionId)) throw new Error("BACKUP_CONVERSATION_SUMMARY_SOURCE_INVALID");
    if (!summary.contentDigest || !digestPattern.test(summary.contentDigest) || !summary.canonRevisionDigest) throw new Error("BACKUP_CONVERSATION_SUMMARY_DIGEST_INVALID");
  }
  for (const session of sessions) {
    if (!session.summaryDigest) continue;
    const active = summaries.find((summary) => summary.sessionId === session.id && summary.contentDigest === session.summaryDigest);
    if (!active || (active as DomainRecord & { invalidatedAt?: string | null }).invalidatedAt) throw new Error("BACKUP_CONVERSATION_SESSION_SUMMARY_INVALID");
  }
  const conversationApprovalScopes = new Set<string>();
  for (const approval of conversationApprovals) {
    const artifact = artifactMap.get(approval.artifactId ?? "");
    if (approval.transactionId !== approval.id || !approval.idempotencyScope || conversationApprovalScopes.has(approval.idempotencyScope)) throw new Error("BACKUP_CONVERSATION_APPROVAL_IDEMPOTENCY_INVALID");
    conversationApprovalScopes.add(approval.idempotencyScope);
    if (!approval.sessionId || messageMap.get(approval.sourceMessageId ?? "")?.sessionId !== approval.sessionId || artifact?.sessionId !== approval.sessionId) throw new Error("BACKUP_CONVERSATION_APPROVAL_SCOPE_INVALID");
    if (!approval.targetStore || !canonicalConversationTargets.has(approval.targetStore) || !approval.targetRecordId || !ids.has(approval.targetRecordId)) throw new Error("BACKUP_CONVERSATION_APPROVAL_TARGET_INVALID");
    if (approval.candidateDigest !== artifact?.candidateDigest || approval.canonicalMutationCount !== 1 || !Number.isInteger(approval.sourceRevision) || !Number.isInteger(approval.resultingRevision) || (approval.resultingRevision ?? 0) <= (approval.sourceRevision ?? 0)) throw new Error("BACKUP_CONVERSATION_APPROVAL_RESULT_INVALID");
    if (artifact?.status !== "approved" || artifact.approvedRevision !== approval.resultingRevision) throw new Error("BACKUP_CONVERSATION_APPROVAL_ARTIFACT_STATE_INVALID");
  }
  for (const importSession of learningImports) {
    if (importSession.importSessionId !== importSession.id || !importSession.sessionId || !sessionMap.has(importSession.sessionId) || !importSession.attachmentIds?.every((id) => attachmentMap.get(id)?.sessionId === importSession.sessionId)) throw new Error("BACKUP_LEARNING_IMPORT_ATTACHMENT_INVALID");
    if (!Number.isInteger(importSession.totalParts) || !Number.isInteger(importSession.completedParts) || !Number.isInteger(importSession.failedParts) || (importSession.completedParts ?? 0) + (importSession.failedParts ?? 0) > (importSession.totalParts ?? -1)) throw new Error("BACKUP_LEARNING_IMPORT_PROGRESS_INVALID");
    if (!importSession.status || !["staging", "processing", "cancelled", "failed", "ready_to_finalize", "committed", "rolled_back"].includes(importSession.status) || !["atomic_document", "partial"].includes(importSession.mode ?? "") || !importSession.manifestDigest || !digestPattern.test(importSession.manifestDigest) || importSession.stagingNamespace !== `learning-import-staging:${importSession.id}`) throw new Error("BACKUP_LEARNING_IMPORT_CONTRACT_INVALID");
  }
  return { project, sourceProjectId };
}

export function buildImportIdMap(payload: Record<string, unknown[]>, sourceProjectId: string, targetProjectId: string) {
  const idMap = new Map<string, string>([[sourceProjectId, targetProjectId]]);
  for (const store of NOVEL_STORES) for (const raw of payload[store] ?? []) {
    const row = raw as DomainRecord;
    if (row.id === sourceProjectId || store === "projects") idMap.set(row.id, targetProjectId);
    else idMap.set(row.id, crypto.randomUUID());
  }
  const collectCanonContextIds = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collectCanonContextIds);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if ((key === "canonContextId" || key === "sourceCanonContextId") && typeof item === "string" && item) {
        if (!idMap.has(item)) idMap.set(item, `canon-context:${crypto.randomUUID()}`);
      }
      collectCanonContextIds(item);
    }
  };
  collectCanonContextIds(payload);
  for (const raw of payload.conversationToolInvocations ?? []) {
    const taskId = (raw as { taskId?: unknown }).taskId;
    if (typeof taskId === "string" && taskId && !idMap.has(taskId)) idMap.set(taskId, `conversation-task:${crypto.randomUUID()}`);
  }
  return idMap;
}

const COMPOUND_ID_FIELDS = new Set(["idempotencyKey", "idempotencyScope", "sourceEventScope", "stagingNamespace"]);
const COPY_REVISION_FIELDS = new Set([
  "sourceRevision",
  "sourceCharacterRevision",
  "sourceStoryRevision",
  "sourceStoryBibleVersion",
  "expectedProposalRevision",
  "expectedSourceRevision",
  "expectedSourceStoryBibleVersion",
  "resultingCanonicalRevision",
]);

const NON_PORTABLE_CONVERSATION_ARTIFACT_TYPES = new Set([
  "learning_rule",
  "rpg",
]);

function remapCompoundIdentity(value: string, idMap: Map<string, string>) {
  return [...idMap.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .reduce((result, [sourceId, targetId]) => result.replaceAll(sourceId, targetId), value);
}

function remapValue(value: unknown, idMap: Map<string, string>, fieldName = ""): unknown {
  if (typeof value === "string") {
    const exact = idMap.get(value);
    if (exact) return exact;
    return COMPOUND_ID_FIELDS.has(fieldName) ? remapCompoundIdentity(value, idMap) : value;
  }
  if (Array.isArray(value)) return value.map((item) => remapValue(item, idMap, fieldName));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const mappedKey = idMap.get(key) ?? key;
      if (key === "sourceCharacterRevisions" && item && typeof item === "object" && !Array.isArray(item)) {
        return [mappedKey, Object.fromEntries(Object.keys(item as Record<string, unknown>).map((characterId) => [idMap.get(characterId) ?? characterId, 1]))];
      }
      if (COPY_REVISION_FIELDS.has(key) && typeof item === "number") return [mappedKey, 1];
      return [mappedKey, remapValue(item, idMap, key)];
    });
    const mapped = Object.fromEntries(entries);
    if (typeof mapped.canonContextId === "string" && typeof mapped.novelRevision === "number" && typeof mapped.storyBibleVersion === "number") {
      mapped.novelRevision = 1;
      mapped.storyBibleVersion = 1;
      if (typeof mapped.dramaAdaptationRevision === "number") mapped.dramaAdaptationRevision = 1;
    }
    return mapped;
  }
  return value;
}

export function remapImportedRecord(raw: DomainRecord, targetProjectId: string, idMap: Map<string, string>, copy: boolean) {
  if (!copy) return structuredClone({ ...raw, projectId: targetProjectId }) as DomainRecord;
  const mapped = remapValue(raw, idMap) as Record<string, unknown>;
  const now = new Date().toISOString();
  if (mapped.conversationSchemaVersion === "conversation-session-v1") mapped.summaryDigest = null;
  if (mapped.conversationSchemaVersion === "conversation-summary-v1") mapped.invalidatedAt = now;
  if (mapped.conversationSchemaVersion === "conversation-artifact-v1" && mapped.status === "approved") {
    mapped.sourceRevision = 0;
    mapped.approvedRevision = 1;
  }
  if (
    mapped.conversationSchemaVersion === "conversation-artifact-v1"
    && mapped.status === "candidate"
    && typeof mapped.artifactType === "string"
    && NON_PORTABLE_CONVERSATION_ARTIFACT_TYPES.has(mapped.artifactType)
  ) {
    // These two candidate kinds depend on state outside the canonical
    // repository: Sovereign Learning staging or the Closed Agent candidate
    // cache.  Copy restore intentionally does not clone either private,
    // transient namespace.  Preserve the card as history, but make it
    // explicitly non-actionable instead of exposing a candidate that can
    // never pass its approval boundary.
    mapped.status = "superseded";
    mapped.approvedAt = null;
    mapped.approvedRevision = null;
  }
  if (
    mapped.learningImportSchemaVersion === "learning-import-session-v1"
    && mapped.status !== "committed"
    && mapped.status !== "rolled_back"
  ) {
    // copySovereignLearningBackupSnapshot deliberately excludes staging, so
    // a copied import cannot be resumed or finalized.  Record that truth in
    // the canonical import ledger as well.
    mapped.status = "rolled_back";
    mapped.completedParts = 0;
    mapped.failedParts = 0;
    mapped.retryablePartIndexes = [];
    mapped.completedAt = now;
  }
  if (mapped.conversationSchemaVersion === "conversation-approval-transaction-v1") {
    mapped.sourceRevision = 0;
    mapped.resultingRevision = 1;
  }
  if (mapped.receiptId === mapped.id && mapped.formulaVersion === "novel-rpg-unified-v3") {
    mapped.sourceRevision = 0;
    mapped.resultingRevision = 1;
    if (mapped.beforeSnapshot && typeof mapped.beforeSnapshot === "object") {
      (mapped.beforeSnapshot as Record<string, unknown>).storyStateRevision = 0;
    }
    if (mapped.afterSnapshot && typeof mapped.afterSnapshot === "object") {
      (mapped.afterSnapshot as Record<string, unknown>).storyStateRevision = 1;
    }
  }
  return {
    ...mapped,
    id: idMap.get(raw.id)!,
    projectId: targetProjectId,
    revision: 1,
    parentRevision: null,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: now,
    migrationVersion: "p24b-rc6-backup-import-v4",
  } as DomainRecord;
}
