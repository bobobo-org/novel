import { sha256Hex, stableStringify } from "../closed-ai-cache";
import {
  makeRecord,
  type ConversationArtifact,
  type ConversationArtifactTargetStore,
  type ConversationAttachment,
  type ConversationCanonicalTargetStore,
  type ConversationExecutionReceipt,
  type ConversationMessage,
  type ConversationMessageRole,
  type ConversationMessageStatus,
  type ConversationSession,
  type ConversationSummary,
  type ConversationToolInvocation,
  type DomainRecord,
  type NovelProject,
} from "../domain";
import { createProjectBackup } from "../repository/backup";
import type { SovereignLearningRepository } from "../sovereign-learning/repository";
import {
  RepositoryOperationError,
  type ApproveConversationArtifactTransactionInput,
  type ApproveConversationArtifactTransactionResult,
  type MarkConversationArtifactApprovedFromExternalCommitInput,
  type NovelRepository,
} from "../repository/contracts";
import {
  assertStoryWorkspaceConversationApprovalTarget,
  conversationContentDigest,
} from "./approval-transaction";
import { hasValidConversationClosedAgentCacheOriginProof } from "./closed-agent-cache-origin-proof";
import { CONVERSATION_LOCAL_TOOL_IDS } from "./tool-registry";
import {
  hasRpgChoiceStaleEvidenceIdentity,
  isRpgChoiceStaleEvidenceInvocation,
  RPG_CHOICE_STALE_EVIDENCE_MESSAGE,
  RPG_CHOICE_STALE_EVIDENCE_STAGE,
  RPG_CHOICE_STALE_EVIDENCE_TASK_TYPE,
  RPG_CHOICE_STALE_EVIDENCE_TOOL_ID,
  rpgChoiceCardContextRevisionDigest,
  rpgChoiceStaleEvidenceId,
} from "./rpg-choice-stale-evidence";
import { isRpgLogicalTurnProviderTaskId } from "./rpg-logical-turn";
import {
  CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE,
  parseClosedAgentFailureEvidence,
} from "../closed-agent-os/safe-runtime-diagnostics";

const MAX_MESSAGE_CHARACTERS = 262_144;
const SHA256_DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const DEFAULT_SESSION_TITLE = "新對話";
const CONVERSATION_CREDENTIAL_PATTERN = /\b(?:vcp|sbp|gh[pousr])_[A-Za-z0-9_-]{16,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b|\b(?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|cookie)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}/iu;
const TERMINAL_MESSAGE_STATUSES = new Set<ConversationMessageStatus>([
  "completed",
  "failed",
  "cancelled",
]);
const TERMINAL_TOOL_STATUSES = new Set<ConversationToolInvocation["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

const MESSAGE_STATUS_TRANSITIONS: Record<ConversationMessageStatus, ReadonlySet<ConversationMessageStatus>> = {
  pending: new Set(["pending", "streaming", "completed", "failed", "cancelled"]),
  streaming: new Set(["streaming", "completed", "failed", "cancelled"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  cancelled: new Set(["cancelled"]),
};

const TOOL_STATUS_TRANSITIONS: Record<ConversationToolInvocation["status"], ReadonlySet<ConversationToolInvocation["status"]>> = {
  pending: new Set(["pending", "running", "completed", "failed", "cancelled"]),
  running: new Set(["running", "completed", "failed", "cancelled"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  cancelled: new Set(["cancelled"]),
};

function assertMessageStatusTransition(
  current: ConversationMessageStatus,
  next: ConversationMessageStatus,
) {
  if (!MESSAGE_STATUS_TRANSITIONS[current].has(next)) {
    throw new RepositoryOperationError(
      TERMINAL_MESSAGE_STATUSES.has(current)
        ? "CONVERSATION_MESSAGE_TERMINAL_STATUS_IMMUTABLE"
        : "CONVERSATION_MESSAGE_STATUS_TRANSITION_INVALID",
    );
  }
}

function assertToolStatusTransition(
  current: ConversationToolInvocation["status"],
  next: ConversationToolInvocation["status"],
) {
  if (!TOOL_STATUS_TRANSITIONS[current].has(next)) {
    throw new RepositoryOperationError(
      TERMINAL_TOOL_STATUSES.has(current)
        ? "CONVERSATION_TOOL_TERMINAL_STATUS_IMMUTABLE"
        : "CONVERSATION_TOOL_STATUS_TRANSITION_INVALID",
    );
  }
}

function cleanTitle(value: string) {
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized.slice(0, 120) || DEFAULT_SESSION_TITLE;
}

function assertSafeMessageContent(content: string) {
  if (content.length > MAX_MESSAGE_CHARACTERS) {
    throw new RepositoryOperationError("CONVERSATION_MESSAGE_TOO_LARGE");
  }
  if (/\b(?:chain[-_ ]?of[-_ ]?thought|raw[_-]?reasoning|system[_-]?prompt)\b/iu.test(content)) {
    throw new RepositoryOperationError("CONVERSATION_HIDDEN_REASONING_NOT_ALLOWED");
  }
  if (CONVERSATION_CREDENTIAL_PATTERN.test(content)) {
    throw new RepositoryOperationError("CONVERSATION_CREDENTIAL_NOT_ALLOWED");
  }
}

function assertExecutionTruth(input: {
  actualExecutor: ConversationToolInvocation["actualExecutor"];
  executionReceipt: ConversationExecutionReceipt | null;
  externalRequest: boolean;
  dataLeftDevice: boolean;
}) {
  if (input.dataLeftDevice && !input.externalRequest) {
    throw new RepositoryOperationError("CONVERSATION_EXECUTION_TRUTH_INVALID");
  }
  const externalExecutor = Boolean(input.actualExecutor && (
    ["external-ai", "openai", "gemini", "grok", "claude"].includes(input.actualExecutor)
    || input.actualExecutor.startsWith("external-api:")
  ));
  if (externalExecutor && (!input.externalRequest || !input.dataLeftDevice)) {
    throw new RepositoryOperationError("CONVERSATION_EXTERNAL_EXECUTOR_TRUTH_INVALID");
  }
  if (input.executionReceipt && (
    input.executionReceipt.externalRequest !== input.externalRequest
    || input.executionReceipt.dataLeftDevice !== input.dataLeftDevice
  )) {
    throw new RepositoryOperationError("CONVERSATION_RECEIPT_TRUTH_INVALID");
  }
}

function assertSafeToolMetadata(input: {
  taskId: string;
  toolId: string;
  taskType: string;
  modelId: string | null;
  modelDigest: string | null;
  contextDigest: string;
  executionReceipt: ConversationExecutionReceipt | null;
  safeProgress: ConversationToolInvocation["safeProgress"];
  safeErrorCode: string | null;
  status: ConversationToolInvocation["status"];
  actualExecutor: ConversationToolInvocation["actualExecutor"];
  rpgProviderRunIdVerified?: boolean;
}) {
  const percent = input.safeProgress?.percent;
  if (percent !== null && percent !== undefined && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
    throw new RepositoryOperationError("CONVERSATION_PROGRESS_INVALID");
  }
  if (input.safeErrorCode && !/^[A-Z0-9_.:-]{1,96}$/u.test(input.safeErrorCode)) {
    throw new RepositoryOperationError("CONVERSATION_SAFE_ERROR_CODE_INVALID");
  }
  if (
    input.status === "failed"
    && input.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
    && input.safeErrorCode !== "CONVERSATION_RELOAD_INTERRUPTED"
    && input.safeProgress?.stage !== CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE
  ) {
    throw new RepositoryOperationError("CONVERSATION_FAILURE_EVIDENCE_REQUIRED");
  }
  if (input.safeProgress?.stage === CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE) {
    const evidence = parseClosedAgentFailureEvidence(input.safeProgress.message);
    if (
      input.status !== "failed"
      || input.safeProgress.percent !== 100
      || !evidence
      || evidence.safeCode !== input.safeErrorCode
    ) {
      throw new RepositoryOperationError("CONVERSATION_FAILURE_EVIDENCE_INVALID");
    }
  }
  const closedProof = input.executionReceipt;
  const hasAnyClosedProof = Boolean(closedProof) && (
    closedProof!.closedAgentSchemaVersion !== undefined
    || closedProof!.closedAgentBackendId !== undefined
    || closedProof!.normalizationReceiptId !== undefined
    || closedProof!.traditionalChineseNormalizerVersion !== undefined
    || closedProof!.closedAgentCacheOrigin !== undefined
  );
  const closedCacheProof = closedProof?.closedAgentCacheOrigin;
  const closedProofInvalid = hasAnyClosedProof && (
    closedProof?.closedAgentSchemaVersion !== "closed-agent-os-v2"
    || !["browser-ai", "local-ollama", "private-ai-hub"]
      .includes(closedProof?.closedAgentBackendId ?? "")
    || !/^traditional-chinese-integrity:[a-f0-9]{64}$/u.test(
      closedProof?.normalizationReceiptId ?? "",
    )
    || closedProof?.traditionalChineseNormalizerVersion
      !== "opencc-js-1.4.1-cn-to-tw-single-pass-v1"
    || (closedCacheProof !== undefined && (
      input.actualExecutor !== "not_executed"
      || closedProof?.providerRunId !== null
      || !hasValidConversationClosedAgentCacheOriginProof(closedCacheProof)
    ))
    || (closedCacheProof === undefined && (
      input.actualExecutor === "not_executed"
      || (
        closedProof?.providerRunId !== input.taskId
        && !input.rpgProviderRunIdVerified
      )
    ))
  );
  if (input.executionReceipt && (
    !input.executionReceipt.receiptId.trim()
    || !SHA256_DIGEST_PATTERN.test(input.executionReceipt.contextDigest)
    || input.executionReceipt.contextDigest !== input.contextDigest
    || (input.executionReceipt.outputDigest !== null && !SHA256_DIGEST_PATTERN.test(input.executionReceipt.outputDigest))
    || (input.executionReceipt.providerRunId !== null && !input.executionReceipt.providerRunId.trim())
    || (input.executionReceipt.latencyMs !== null && (!Number.isFinite(input.executionReceipt.latencyMs) || input.executionReceipt.latencyMs < 0))
    || (input.modelId !== null && input.executionReceipt.modelId !== input.modelId)
    || (input.modelDigest !== null && input.executionReceipt.modelDigest !== input.modelDigest)
    || closedProofInvalid
  )) {
    throw new RepositoryOperationError("CONVERSATION_RECEIPT_IDENTITY_INVALID");
  }
  if (input.status === "completed" && !input.executionReceipt) {
    throw new RepositoryOperationError("CONVERSATION_EXECUTION_RECEIPT_REQUIRED");
  }
  if (input.status === "failed" && !input.safeErrorCode) {
    throw new RepositoryOperationError("CONVERSATION_SAFE_ERROR_CODE_REQUIRED");
  }
  assertSafeMessageContent(JSON.stringify(input));
}

function messageSort(left: ConversationMessage, right: ConversationMessage) {
  const created = Date.parse(left.createdAt) - Date.parse(right.createdAt);
  return created || left.id.localeCompare(right.id);
}

function nextMessageTimestamp(lastMessageAt: string | null) {
  const now = Date.now();
  const previous = lastMessageAt ? Date.parse(lastMessageAt) : Number.NaN;
  return new Date(Number.isFinite(previous) ? Math.max(now, previous + 1) : now).toISOString();
}

export type CreateConversationSessionInput = {
  projectId: string;
  title?: string;
  activeChapterId?: string | null;
  sessionId?: string;
  parentSessionId?: string | null;
  branchedFromMessageId?: string | null;
};

export type AppendConversationMessageInput = {
  projectId: string;
  sessionId: string;
  role: ConversationMessageRole;
  content: string;
  status?: ConversationMessageStatus;
  messageId?: string;
  parentMessageId?: string | null;
  sourceMessageId?: string | null;
  candidateIds?: string[];
  toolInvocationIds?: string[];
  attachmentIds?: string[];
};

export type SaveConversationArtifactInput = {
  projectId: string;
  sessionId: string;
  sourceMessageId: string;
  artifactId?: string;
  artifactType: ConversationArtifact["artifactType"];
  targetStore: ConversationArtifactTargetStore;
  targetRecordId: string;
  sourceRevision: number;
  candidateContent: string;
};

export type SaveConversationToolInvocationInput = {
  projectId: string;
  sessionId: string;
  messageId: string;
  invocationId?: string;
  taskId: string;
  toolId: string;
  taskType: string;
  inputDigest: string;
  contextDigest: string;
  status?: ConversationToolInvocation["status"];
  actualExecutor?: ConversationToolInvocation["actualExecutor"];
  modelId?: string | null;
  modelDigest?: string | null;
  executionReceipt?: ConversationExecutionReceipt | null;
  externalRequest?: boolean;
  dataLeftDevice?: boolean;
  canonicalMutationCount?: number;
  safeProgress?: ConversationToolInvocation["safeProgress"];
  safeErrorCode?: string | null;
};

export class ConversationRepositoryService {
  readonly repository: NovelRepository;
  readonly learningRepository?: SovereignLearningRepository;

  constructor(repository: NovelRepository, learningRepository?: SovereignLearningRepository) {
    this.repository = repository;
    this.learningRepository = learningRepository;
  }

  private async requireProject(projectId: string) {
    const project = await this.repository.get<NovelProject>("projects", projectId);
    if (!project || project.deletedAt) throw new RepositoryOperationError("CONVERSATION_PROJECT_NOT_FOUND");
    return project;
  }

  private async requireSession(projectId: string, sessionId: string, includeDeleted = false) {
    const session = await this.repository.get<ConversationSession>("conversationSessions", sessionId);
    if (!session || session.projectId !== projectId) {
      throw new RepositoryOperationError("CONVERSATION_SESSION_SCOPE_MISMATCH");
    }
    if (!includeDeleted && (session.status === "deleted" || session.deletedAt)) {
      throw new RepositoryOperationError("CONVERSATION_SESSION_DELETED");
    }
    return session;
  }

  private async copyMessageAttachments(input: {
    projectId: string;
    sourceSessionId: string;
    targetSessionId: string;
    attachmentIds: readonly string[];
    attachmentIdMap: Map<string, string>;
    createdAttachmentIds: string[];
  }) {
    const copiedIds: string[] = [];
    for (const sourceAttachmentId of [...new Set(input.attachmentIds)]) {
      const existingCopyId = input.attachmentIdMap.get(sourceAttachmentId);
      if (existingCopyId) {
        copiedIds.push(existingCopyId);
        continue;
      }
      const source = await this.repository.get<ConversationAttachment>(
        "conversationAttachments",
        sourceAttachmentId,
      );
      if (
        !source
        || source.projectId !== input.projectId
        || source.sessionId !== input.sourceSessionId
        || source.deletedAt
        || source.localAnalysisOnly !== true
        || source.rawContentRetained !== false
      ) {
        throw new RepositoryOperationError("CONVERSATION_BRANCH_ATTACHMENT_SCOPE_MISMATCH");
      }
      const copiedAt = new Date().toISOString();
      const copyId = crypto.randomUUID();
      const copy = await this.repository.put<ConversationAttachment>(
        "conversationAttachments",
        {
          ...source,
          id: copyId,
          sessionId: input.targetSessionId,
          createdAt: copiedAt,
          updatedAt: copiedAt,
          revision: 1,
          parentRevision: null,
          deletedAt: null,
          provenance: {
            ...source.provenance,
            actor: "author",
            createdAt: copiedAt,
          },
        },
      );
      input.attachmentIdMap.set(sourceAttachmentId, copy.id);
      input.createdAttachmentIds.push(copy.id);
      copiedIds.push(copy.id);
    }
    return copiedIds;
  }

  async createSession(input: CreateConversationSessionInput) {
    await this.requireProject(input.projectId);
    const id = input.sessionId ?? crypto.randomUUID();
    const replay = await this.repository.get<ConversationSession>("conversationSessions", id);
    if (replay) {
      if (
        replay.projectId !== input.projectId
        || replay.parentSessionId !== (input.parentSessionId ?? null)
        || replay.branchedFromMessageId !== (input.branchedFromMessageId ?? null)
      ) {
        throw new RepositoryOperationError("CONVERSATION_SESSION_IDEMPOTENCY_MISMATCH");
      }
      return replay;
    }
    if (input.activeChapterId) {
      const chapter = await this.repository.get<DomainRecord>("chapters", input.activeChapterId);
      if (!chapter || chapter.projectId !== input.projectId) {
        throw new RepositoryOperationError("CONVERSATION_ACTIVE_CHAPTER_SCOPE_MISMATCH");
      }
    }
    if (input.parentSessionId) await this.requireSession(input.projectId, input.parentSessionId);
    const base = makeRecord(input.projectId, "user");
    const session: ConversationSession = {
      ...base,
      id,
      conversationSchemaVersion: "conversation-session-v1",
      title: cleanTitle(input.title ?? DEFAULT_SESSION_TITLE),
      status: "active",
      activeChapterId: input.activeChapterId ?? null,
      lastMessageAt: null,
      summaryDigest: null,
      parentSessionId: input.parentSessionId ?? null,
      branchedFromMessageId: input.branchedFromMessageId ?? null,
    };
    return this.repository.put("conversationSessions", session);
  }

  async listSessions(projectId: string, options: { includeArchived?: boolean; includeDeleted?: boolean } = {}) {
    await this.requireProject(projectId);
    return (await this.repository.list<ConversationSession>("conversationSessions", projectId))
      .filter((session) => options.includeDeleted || (session.status !== "deleted" && !session.deletedAt))
      .filter((session) => options.includeArchived || session.status !== "archived")
      .sort((left, right) => Date.parse(right.lastMessageAt ?? right.updatedAt) - Date.parse(left.lastMessageAt ?? left.updatedAt));
  }

  async renameSession(projectId: string, sessionId: string, title: string, expectedRevision: number) {
    const session = await this.requireSession(projectId, sessionId);
    return this.repository.put("conversationSessions", { ...session, title: cleanTitle(title) }, expectedRevision);
  }

  async archiveSession(projectId: string, sessionId: string, expectedRevision: number) {
    const session = await this.requireSession(projectId, sessionId);
    return this.repository.put("conversationSessions", { ...session, status: "archived" }, expectedRevision);
  }

  async deleteSession(projectId: string, sessionId: string, expectedRevision: number) {
    const session = await this.requireSession(projectId, sessionId);
    const now = new Date().toISOString();
    return this.repository.put("conversationSessions", {
      ...session,
      status: "deleted",
      deletedAt: now,
    }, expectedRevision);
  }

  async listMessages(projectId: string, sessionId: string) {
    await this.requireSession(projectId, sessionId, true);
    return (await this.repository.list<ConversationMessage>("conversationMessages", projectId))
      .filter((message) => message.sessionId === sessionId && !message.deletedAt)
      .sort(messageSort);
  }

  async listArtifacts(projectId: string, sessionId: string) {
    await this.requireSession(projectId, sessionId, true);
    return (await this.repository.list<ConversationArtifact>("conversationArtifacts", projectId))
      .filter((artifact) => artifact.sessionId === sessionId && !artifact.deletedAt);
  }

  async listToolInvocations(projectId: string, sessionId: string) {
    await this.requireSession(projectId, sessionId, true);
    return (await this.repository.list<ConversationToolInvocation>("conversationToolInvocations", projectId))
      .filter((invocation) => invocation.sessionId === sessionId && !invocation.deletedAt);
  }

  async listAttachments(projectId: string, sessionId: string) {
    await this.requireSession(projectId, sessionId, true);
    return (await this.repository.list<ConversationAttachment>("conversationAttachments", projectId))
      .filter((attachment) => attachment.sessionId === sessionId && !attachment.deletedAt);
  }

  async appendMessage(input: AppendConversationMessageInput) {
    const session = await this.requireSession(input.projectId, input.sessionId);
    assertSafeMessageContent(input.content);
    const contentDigest = await conversationContentDigest(input.content);
    const id = input.messageId ?? crypto.randomUUID();
    const replay = await this.repository.get<ConversationMessage>("conversationMessages", id);
    if (replay) {
      if (
        replay.projectId !== input.projectId
        || replay.sessionId !== input.sessionId
        || replay.role !== input.role
        || replay.contentDigest !== contentDigest
        || replay.parentMessageId !== (input.parentMessageId ?? null)
        || replay.sourceMessageId !== (input.sourceMessageId ?? null)
        || !(input.candidateIds ?? []).every((candidateId) => replay.candidateIds.includes(candidateId))
        || !(input.toolInvocationIds ?? []).every((invocationId) => replay.toolInvocationIds.includes(invocationId))
        || !(input.attachmentIds ?? []).every((attachmentId) => replay.attachmentIds.includes(attachmentId))
      ) {
        throw new RepositoryOperationError("CONVERSATION_MESSAGE_IDEMPOTENCY_MISMATCH");
      }
      return replay;
    }
    if (input.parentMessageId) {
      const parent = await this.repository.get<ConversationMessage>("conversationMessages", input.parentMessageId);
      if (!parent || parent.projectId !== input.projectId || parent.sessionId !== input.sessionId) {
        throw new RepositoryOperationError("CONVERSATION_PARENT_MESSAGE_SCOPE_MISMATCH");
      }
    }
    if (input.sourceMessageId) {
      const source = await this.repository.get<ConversationMessage>("conversationMessages", input.sourceMessageId);
      if (!source || source.projectId !== input.projectId) {
        throw new RepositoryOperationError("CONVERSATION_SOURCE_MESSAGE_SCOPE_MISMATCH");
      }
    }
    for (const attachmentId of input.attachmentIds ?? []) {
      const attachment = await this.repository.get<ConversationAttachment>("conversationAttachments", attachmentId);
      if (!attachment || attachment.projectId !== input.projectId || attachment.sessionId !== input.sessionId) {
        throw new RepositoryOperationError("CONVERSATION_ATTACHMENT_SCOPE_MISMATCH");
      }
    }
    const now = nextMessageTimestamp(session.lastMessageAt);
    const status = input.status ?? "completed";
    const base = makeRecord(input.projectId, input.role === "user" ? "user" : "ai_candidate");
    const message: ConversationMessage = {
      ...base,
      id,
      createdAt: now,
      updatedAt: now,
      provenance: { ...base.provenance, createdAt: now },
      conversationSchemaVersion: "conversation-message-v1",
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      contentDigest,
      status,
      parentMessageId: input.parentMessageId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      candidateIds: [...new Set(input.candidateIds ?? [])],
      toolInvocationIds: [...new Set(input.toolInvocationIds ?? [])],
      attachmentIds: [...new Set(input.attachmentIds ?? [])],
      completedAt: ["completed", "failed", "cancelled"].includes(status) ? now : null,
    };
    const saved = await this.repository.put("conversationMessages", message);
    try {
      await this.repository.put("conversationSessions", {
        ...session,
        lastMessageAt: saved.createdAt,
      }, session.revision);
    } catch {
      await this.repository.remove("conversationMessages", saved.id);
      throw new RepositoryOperationError("CONVERSATION_MESSAGE_SESSION_UPDATE_FAILED");
    }
    return saved;
  }

  async updateMessageStatus(input: {
    projectId: string;
    sessionId: string;
    messageId: string;
    expectedRevision: number;
    status: ConversationMessageStatus;
    content?: string;
    candidateIds?: string[];
    toolInvocationIds?: string[];
  }) {
    await this.requireSession(input.projectId, input.sessionId);
    const message = await this.repository.get<ConversationMessage>("conversationMessages", input.messageId);
    if (!message || message.projectId !== input.projectId || message.sessionId !== input.sessionId) {
      throw new RepositoryOperationError("CONVERSATION_MESSAGE_SCOPE_MISMATCH");
    }
    assertMessageStatusTransition(message.status, input.status);
    const content = input.content ?? message.content;
    assertSafeMessageContent(content);
    return this.repository.put("conversationMessages", {
      ...message,
      content,
      contentDigest: await conversationContentDigest(content),
      status: input.status,
      candidateIds: input.candidateIds ? [...new Set(input.candidateIds)] : message.candidateIds,
      toolInvocationIds: input.toolInvocationIds ? [...new Set(input.toolInvocationIds)] : message.toolInvocationIds,
      completedAt: ["completed", "failed", "cancelled"].includes(input.status)
        ? new Date().toISOString()
        : null,
    }, input.expectedRevision);
  }

  private async linkMessageReference(
    projectId: string,
    sessionId: string,
    messageId: string,
    field: "candidateIds" | "toolInvocationIds",
    referenceId: string,
  ) {
    const message = await this.repository.get<ConversationMessage>("conversationMessages", messageId);
    if (!message || message.projectId !== projectId || message.sessionId !== sessionId) {
      throw new RepositoryOperationError("CONVERSATION_MESSAGE_SCOPE_MISMATCH");
    }
    if (message[field].includes(referenceId)) return message;
    return this.repository.put("conversationMessages", {
      ...message,
      [field]: [...message[field], referenceId],
    }, message.revision);
  }

  async saveToolInvocation(input: SaveConversationToolInvocationInput) {
    if (hasRpgChoiceStaleEvidenceIdentity(input)) {
      throw new RepositoryOperationError("CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_RESERVED");
    }
    return this.persistToolInvocation(input, false);
  }

  async saveRpgChoiceStaleEvidence(input: {
    projectId: string;
    sessionId: string;
    choiceCardMessageId: string;
  }) {
    await this.requireSession(input.projectId, input.sessionId);
    const choiceCard = await this.repository.get<ConversationMessage>(
      "conversationMessages",
      input.choiceCardMessageId,
    );
    const contextRevisionDigest = choiceCard
      ? rpgChoiceCardContextRevisionDigest(choiceCard.content)
      : null;
    if (
      !choiceCard
      || choiceCard.projectId !== input.projectId
      || choiceCard.sessionId !== input.sessionId
      || choiceCard.role !== "assistant"
      || choiceCard.status !== "completed"
      || !contextRevisionDigest
    ) {
      throw new RepositoryOperationError("CONVERSATION_RPG_CHOICE_STALE_CARD_INVALID");
    }

    const [messages, artifacts] = await Promise.all([
      this.listMessages(input.projectId, input.sessionId),
      this.listArtifacts(input.projectId, input.sessionId),
    ]);
    const attemptIds = new Set(messages
      .filter((message) => (
        message.role === "user"
        && message.sourceMessageId === choiceCard.id
      ))
      .map((message) => message.id));
    const responseIds = new Set(messages
      .filter((message) => (
        message.role === "assistant"
        && Boolean(message.parentMessageId)
        && attemptIds.has(message.parentMessageId!)
      ))
      .map((message) => message.id));
    const settled = artifacts.some((artifact) => (
      artifact.artifactType === "rpg"
      && ["candidate", "approved"].includes(artifact.status)
      && responseIds.has(artifact.sourceMessageId)
    ));
    if (settled) {
      throw new RepositoryOperationError("CONVERSATION_RPG_CHOICE_ALREADY_SETTLED");
    }

    // A copied project remaps every record identity, including this immutable
    // evidence marker.  Its imported id therefore cannot equal a fresh digest
    // of the remapped session/card ids.  Prefer one already-linked marker only
    // after validating the complete evidence contract against the copied card;
    // otherwise recovery would create a second marker for the same card.
    const linkedInvocations = (await Promise.all(choiceCard.toolInvocationIds.map((id) => (
      this.repository.get<ConversationToolInvocation>("conversationToolInvocations", id)
    )))).filter((invocation): invocation is ConversationToolInvocation => Boolean(invocation));
    const linkedStaleIdentities = linkedInvocations.filter(hasRpgChoiceStaleEvidenceIdentity);
    if (linkedStaleIdentities.length > 0) {
      if (
        linkedStaleIdentities.length !== 1
        || !isRpgChoiceStaleEvidenceInvocation(linkedStaleIdentities[0]!, choiceCard)
      ) {
        throw new RepositoryOperationError("CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_MISMATCH");
      }
      return linkedStaleIdentities[0]!;
    }

    const invocationId = await rpgChoiceStaleEvidenceId({
      sessionId: input.sessionId,
      choiceCardMessageId: choiceCard.id,
      contextRevisionDigest,
    });
    const existing = await this.repository.get<ConversationToolInvocation>(
      "conversationToolInvocations",
      invocationId,
    );
    if (existing) {
      if (
        !isRpgChoiceStaleEvidenceInvocation(existing)
        || existing.projectId !== input.projectId
        || existing.sessionId !== input.sessionId
        || existing.messageId !== choiceCard.id
        || existing.inputDigest !== choiceCard.contentDigest
        || existing.contextDigest !== contextRevisionDigest
      ) {
        throw new RepositoryOperationError("CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_MISMATCH");
      }
      // Persisting an invocation and its message backlink spans two repository
      // writes.  If the tab closes between them, the deterministic marker is
      // already valid but the card is not yet closed.  Repair that exact
      // crash state idempotently instead of trapping every later retry in a
      // permanent mismatch loop.
      const linkedChoiceCard = await this.linkMessageReference(
        input.projectId,
        input.sessionId,
        choiceCard.id,
        "toolInvocationIds",
        existing.id,
      );
      if (!isRpgChoiceStaleEvidenceInvocation(existing, linkedChoiceCard)) {
        throw new RepositoryOperationError("CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_MISMATCH");
      }
      return existing;
    }

    const saved = await this.persistToolInvocation({
      projectId: input.projectId,
      sessionId: input.sessionId,
      messageId: choiceCard.id,
      invocationId,
      taskId: invocationId,
      toolId: RPG_CHOICE_STALE_EVIDENCE_TOOL_ID,
      taskType: RPG_CHOICE_STALE_EVIDENCE_TASK_TYPE,
      inputDigest: choiceCard.contentDigest,
      contextDigest: contextRevisionDigest,
      status: "failed",
      actualExecutor: null,
      modelId: null,
      modelDigest: null,
      executionReceipt: null,
      externalRequest: false,
      dataLeftDevice: false,
      canonicalMutationCount: 0,
      safeProgress: {
        stage: RPG_CHOICE_STALE_EVIDENCE_STAGE,
        percent: 100,
        message: RPG_CHOICE_STALE_EVIDENCE_MESSAGE,
      },
      safeErrorCode: "RPG_CHAT_CHOICES_STALE",
    }, true);
    const linkedChoiceCard = await this.repository.get<ConversationMessage>(
      "conversationMessages",
      choiceCard.id,
    );
    if (!linkedChoiceCard || !isRpgChoiceStaleEvidenceInvocation(saved, linkedChoiceCard)) {
      throw new RepositoryOperationError("CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_MISMATCH");
    }
    return saved;
  }

  private async persistToolInvocation(
    input: SaveConversationToolInvocationInput,
    allowRpgChoiceStaleEvidence: boolean,
  ) {
    await this.requireSession(input.projectId, input.sessionId);
    if (
      hasRpgChoiceStaleEvidenceIdentity(input)
      && !allowRpgChoiceStaleEvidence
    ) {
      throw new RepositoryOperationError("CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_RESERVED");
    }
    // A running invocation may not know its composed context yet. Persist the
    // input digest as a non-secret provisional value and replace it atomically
    // with the receipt's verified context digest on completion.
    const contextDigest = input.contextDigest === "pending" ? input.inputDigest : input.contextDigest;
    if (
      !input.taskId.trim()
      || !input.toolId.trim()
      || !input.taskType.trim()
      || !SHA256_DIGEST_PATTERN.test(input.inputDigest)
      || !SHA256_DIGEST_PATTERN.test(contextDigest)
    ) {
      throw new RepositoryOperationError("CONVERSATION_TOOL_CONTRACT_INVALID");
    }
    const message = await this.repository.get<ConversationMessage>("conversationMessages", input.messageId);
    if (!message || message.projectId !== input.projectId || message.sessionId !== input.sessionId) {
      throw new RepositoryOperationError("CONVERSATION_TOOL_MESSAGE_SCOPE_MISMATCH");
    }
    const rpgProviderRunIdVerified = input.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
      && Boolean(message.parentMessageId)
      && await isRpgLogicalTurnProviderTaskId(
        message.parentMessageId ?? "",
        input.executionReceipt?.providerRunId,
      );
    const id = input.invocationId ?? crypto.randomUUID();
    const replay = await this.repository.get<ConversationToolInvocation>("conversationToolInvocations", id);
    if (replay) {
      if (
        replay.projectId !== input.projectId
        || replay.sessionId !== input.sessionId
        || replay.messageId !== input.messageId
        || replay.taskId !== input.taskId
        || replay.toolId !== input.toolId
        || replay.taskType !== input.taskType
        || replay.inputDigest !== input.inputDigest
        || replay.contextDigest !== contextDigest
      ) {
        throw new RepositoryOperationError("CONVERSATION_TOOL_IDEMPOTENCY_MISMATCH");
      }
      return replay;
    }
    const duplicateTask = (await this.repository.list<ConversationToolInvocation>("conversationToolInvocations"))
      .find((invocation) => invocation.taskId === input.taskId);
    if (duplicateTask) throw new RepositoryOperationError("CONVERSATION_TASK_ID_ALREADY_EXISTS");
    const mutationCount = input.canonicalMutationCount ?? 0;
    if (!Number.isInteger(mutationCount) || mutationCount < 0 || mutationCount > 1) {
      throw new RepositoryOperationError("CONVERSATION_CANONICAL_MUTATION_COUNT_INVALID");
    }
    assertExecutionTruth({
      actualExecutor: input.actualExecutor ?? null,
      executionReceipt: input.executionReceipt ?? null,
      externalRequest: input.externalRequest ?? false,
      dataLeftDevice: input.dataLeftDevice ?? false,
    });
    assertSafeToolMetadata({
      taskId: input.taskId,
      toolId: input.toolId,
      taskType: input.taskType,
      modelId: input.modelId ?? null,
      modelDigest: input.modelDigest ?? null,
      contextDigest,
      executionReceipt: input.executionReceipt ?? null,
      safeProgress: input.safeProgress ?? null,
      safeErrorCode: input.safeErrorCode ?? null,
      status: input.status ?? "pending",
      actualExecutor: input.actualExecutor ?? null,
      rpgProviderRunIdVerified,
    });
    const now = new Date().toISOString();
    const base = makeRecord(input.projectId, "system");
    const invocation: ConversationToolInvocation = {
      ...base,
      id,
      conversationSchemaVersion: "conversation-tool-invocation-v1",
      sessionId: input.sessionId,
      messageId: input.messageId,
      taskId: input.taskId,
      toolId: input.toolId,
      taskType: input.taskType,
      inputDigest: input.inputDigest,
      contextDigest,
      status: input.status ?? "pending",
      startedAt: now,
      completedAt: ["completed", "failed", "cancelled"].includes(input.status ?? "pending") ? now : null,
      actualExecutor: input.actualExecutor ?? null,
      modelId: input.modelId ?? null,
      modelDigest: input.modelDigest ?? null,
      executionReceipt: input.executionReceipt ?? null,
      externalRequest: input.externalRequest ?? false,
      dataLeftDevice: input.dataLeftDevice ?? false,
      canonicalMutationCount: mutationCount,
      safeProgress: input.safeProgress ?? null,
      safeErrorCode: input.safeErrorCode ?? null,
    };
    const saved = await this.repository.put("conversationToolInvocations", invocation);
    try {
      await this.linkMessageReference(input.projectId, input.sessionId, input.messageId, "toolInvocationIds", saved.id);
    } catch (error) {
      await this.repository.remove("conversationToolInvocations", saved.id);
      throw error;
    }
    return saved;
  }

  async updateToolInvocationStatus(input: {
    projectId: string;
    sessionId: string;
    invocationId: string;
    expectedRevision: number;
    status: ConversationToolInvocation["status"];
    actualExecutor?: ConversationToolInvocation["actualExecutor"];
    modelId?: string | null;
    modelDigest?: string | null;
    contextDigest?: string;
    executionReceipt?: ConversationExecutionReceipt | null;
    externalRequest?: boolean;
    dataLeftDevice?: boolean;
    canonicalMutationCount?: number;
    safeProgress?: ConversationToolInvocation["safeProgress"];
    safeErrorCode?: string | null;
  }) {
    await this.requireSession(input.projectId, input.sessionId);
    const invocation = await this.repository.get<ConversationToolInvocation>("conversationToolInvocations", input.invocationId);
    if (!invocation || invocation.projectId !== input.projectId || invocation.sessionId !== input.sessionId) {
      throw new RepositoryOperationError("CONVERSATION_TOOL_SCOPE_MISMATCH");
    }
    const message = await this.repository.get<ConversationMessage>(
      "conversationMessages",
      invocation.messageId,
    );
    if (!message || message.projectId !== input.projectId || message.sessionId !== input.sessionId) {
      throw new RepositoryOperationError("CONVERSATION_TOOL_MESSAGE_SCOPE_MISMATCH");
    }
    if (hasRpgChoiceStaleEvidenceIdentity(invocation)) {
      throw new RepositoryOperationError("CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_IMMUTABLE");
    }
    assertToolStatusTransition(invocation.status, input.status);
    const mutationCount = input.canonicalMutationCount ?? invocation.canonicalMutationCount;
    if (
      !Number.isInteger(mutationCount)
      || mutationCount < invocation.canonicalMutationCount
      || mutationCount > 1
    ) {
      throw new RepositoryOperationError("CONVERSATION_CANONICAL_MUTATION_COUNT_INVALID");
    }
    const completedAt = ["completed", "failed", "cancelled"].includes(input.status)
      ? new Date().toISOString()
      : null;
    const executionReceipt = input.executionReceipt ?? invocation.executionReceipt;
    const contextDigest = input.contextDigest
      ?? input.executionReceipt?.contextDigest
      ?? invocation.contextDigest;
    if (!SHA256_DIGEST_PATTERN.test(contextDigest)) {
      throw new RepositoryOperationError("CONVERSATION_CONTEXT_DIGEST_INVALID");
    }
    const rpgProviderRunIdVerified = invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.rpgTurn
      && Boolean(message.parentMessageId)
      && await isRpgLogicalTurnProviderTaskId(
        message.parentMessageId ?? "",
        executionReceipt?.providerRunId,
      );
    assertExecutionTruth({
      actualExecutor: input.actualExecutor ?? invocation.actualExecutor,
      executionReceipt,
      externalRequest: input.externalRequest ?? invocation.externalRequest,
      dataLeftDevice: input.dataLeftDevice ?? invocation.dataLeftDevice,
    });
    assertSafeToolMetadata({
      taskId: invocation.taskId,
      toolId: invocation.toolId,
      taskType: invocation.taskType,
      modelId: input.modelId ?? invocation.modelId,
      modelDigest: input.modelDigest ?? invocation.modelDigest,
      contextDigest,
      executionReceipt,
      safeProgress: input.safeProgress ?? invocation.safeProgress,
      safeErrorCode: input.safeErrorCode ?? invocation.safeErrorCode,
      status: input.status,
      actualExecutor: input.actualExecutor ?? invocation.actualExecutor,
      rpgProviderRunIdVerified,
    });
    return this.repository.put("conversationToolInvocations", {
      ...invocation,
      status: input.status,
      completedAt,
      actualExecutor: input.actualExecutor ?? invocation.actualExecutor,
      modelId: input.modelId ?? invocation.modelId,
      modelDigest: input.modelDigest ?? invocation.modelDigest,
      contextDigest,
      executionReceipt,
      externalRequest: input.externalRequest ?? invocation.externalRequest,
      dataLeftDevice: input.dataLeftDevice ?? invocation.dataLeftDevice,
      canonicalMutationCount: mutationCount,
      safeProgress: input.safeProgress ?? invocation.safeProgress,
      safeErrorCode: input.safeErrorCode ?? invocation.safeErrorCode,
    }, input.expectedRevision);
  }

  /**
   * A retry never rewrites terminal evidence. It creates a new assistant
   * message and a new invocation/task attempt linked back to the failed or
   * cancelled source message, leaving the original terminal records intact.
   */
  async prepareToolInvocationRetry(input: {
    projectId: string;
    sessionId: string;
    sourceMessageId: string;
    sourceInvocationId: string;
    expectedMessageRevision: number;
    expectedInvocationRevision: number;
    messageId?: string;
    invocationId?: string;
    taskId?: string;
  }) {
    const session = await this.requireSession(input.projectId, input.sessionId);
    const [sourceMessage, sourceInvocation] = await Promise.all([
      this.repository.get<ConversationMessage>("conversationMessages", input.sourceMessageId),
      this.repository.get<ConversationToolInvocation>("conversationToolInvocations", input.sourceInvocationId),
    ]);
    if (
      !sourceMessage
      || sourceMessage.projectId !== input.projectId
      || sourceMessage.sessionId !== input.sessionId
      || !["assistant", "tool"].includes(sourceMessage.role)
    ) {
      throw new RepositoryOperationError("CONVERSATION_RETRY_MESSAGE_SCOPE_MISMATCH");
    }
    if (
      !sourceInvocation
      || sourceInvocation.projectId !== input.projectId
      || sourceInvocation.sessionId !== input.sessionId
      || sourceInvocation.messageId !== sourceMessage.id
      || !sourceMessage.toolInvocationIds.includes(sourceInvocation.id)
    ) {
      throw new RepositoryOperationError("CONVERSATION_RETRY_TOOL_SCOPE_MISMATCH");
    }
    if (
      sourceMessage.revision !== input.expectedMessageRevision
      || sourceInvocation.revision !== input.expectedInvocationRevision
    ) {
      throw new RepositoryOperationError("CONVERSATION_RETRY_SOURCE_STALE");
    }
    if (
      !["failed", "cancelled"].includes(sourceMessage.status)
      || !["failed", "cancelled"].includes(sourceInvocation.status)
    ) {
      throw new RepositoryOperationError("CONVERSATION_RETRY_SOURCE_NOT_RETRYABLE");
    }

    const messageId = input.messageId ?? crypto.randomUUID();
    const invocationId = input.invocationId ?? crypto.randomUUID();
    const taskId = input.taskId ?? crypto.randomUUID();
    if (
      messageId === sourceMessage.id
      || invocationId === sourceInvocation.id
      || taskId === sourceInvocation.taskId
    ) {
      throw new RepositoryOperationError("CONVERSATION_RETRY_ID_REUSE_NOT_ALLOWED");
    }
    const [existingMessage, existingInvocation, duplicateTask] = await Promise.all([
      this.repository.get<ConversationMessage>("conversationMessages", messageId),
      this.repository.get<ConversationToolInvocation>("conversationToolInvocations", invocationId),
      this.repository.list<ConversationToolInvocation>("conversationToolInvocations")
        .then((rows) => rows.find((row) => row.taskId === taskId) ?? null),
    ]);
    if (existingMessage || existingInvocation || duplicateTask) {
      throw new RepositoryOperationError("CONVERSATION_RETRY_ID_ALREADY_EXISTS");
    }

    let message: ConversationMessage | null = null;
    try {
      message = await this.appendMessage({
        projectId: input.projectId,
        sessionId: input.sessionId,
        messageId,
        role: sourceMessage.role,
        content: "",
        status: "streaming",
        parentMessageId: sourceMessage.parentMessageId,
        sourceMessageId: sourceMessage.id,
        attachmentIds: sourceMessage.attachmentIds,
      });
      const invocation = await this.saveToolInvocation({
        projectId: input.projectId,
        sessionId: input.sessionId,
        messageId: message.id,
        invocationId,
        taskId,
        toolId: sourceInvocation.toolId,
        taskType: sourceInvocation.taskType,
        inputDigest: sourceInvocation.inputDigest,
        contextDigest: sourceInvocation.contextDigest,
        status: "running",
        canonicalMutationCount: 0,
        safeProgress: {
          stage: "retry",
          percent: 0,
          message: "Retry started with a new execution attempt.",
        },
      });
      return {
        sourceMessage,
        sourceInvocation,
        message: await this.repository.get<ConversationMessage>("conversationMessages", message.id) ?? message,
        invocation,
        taskId,
        invocationId,
      };
    } catch (error) {
      const createdInvocation = await this.repository.get<ConversationToolInvocation>(
        "conversationToolInvocations",
        invocationId,
      );
      if (
        createdInvocation
        && createdInvocation.messageId === message?.id
        && createdInvocation.taskId === taskId
      ) {
        await this.repository.remove("conversationToolInvocations", invocationId).catch(() => undefined);
      }
      const createdMessage = message
        ? await this.repository.get<ConversationMessage>("conversationMessages", message.id)
        : null;
      if (createdMessage?.sourceMessageId === sourceMessage.id) {
        await this.repository.remove("conversationMessages", createdMessage.id).catch(() => undefined);
      }
      const currentSession = await this.repository.get<ConversationSession>("conversationSessions", session.id);
      if (currentSession && message && currentSession.lastMessageAt === message.createdAt) {
        const recoverySession = currentSession;
        await this.repository.put<ConversationSession>("conversationSessions", {
          ...recoverySession,
          lastMessageAt: session.lastMessageAt,
        }, recoverySession.revision).catch(() => undefined);
      }
      throw error;
    }
  }

  async saveArtifact(input: SaveConversationArtifactInput) {
    await this.requireSession(input.projectId, input.sessionId);
    const sourceMessage = await this.repository.get<ConversationMessage>("conversationMessages", input.sourceMessageId);
    if (!sourceMessage || sourceMessage.projectId !== input.projectId || sourceMessage.sessionId !== input.sessionId) {
      throw new RepositoryOperationError("CONVERSATION_ARTIFACT_MESSAGE_SCOPE_MISMATCH");
    }
    if (!Number.isInteger(input.sourceRevision) || input.sourceRevision < 0) {
      throw new RepositoryOperationError("CONVERSATION_ARTIFACT_SOURCE_REVISION_INVALID");
    }
    assertSafeMessageContent(input.candidateContent);
    const candidateDigest = await conversationContentDigest(input.candidateContent);
    const id = input.artifactId ?? crypto.randomUUID();
    const replay = await this.repository.get<ConversationArtifact>("conversationArtifacts", id);
    if (replay) {
      if (
        replay.projectId !== input.projectId
        || replay.sessionId !== input.sessionId
        || replay.sourceMessageId !== input.sourceMessageId
        || replay.artifactType !== input.artifactType
        || replay.targetStore !== input.targetStore
        || replay.targetRecordId !== input.targetRecordId
        || replay.sourceRevision !== input.sourceRevision
        || replay.candidateDigest !== candidateDigest
      ) {
        throw new RepositoryOperationError("CONVERSATION_ARTIFACT_IDEMPOTENCY_MISMATCH");
      }
      return replay;
    }
    const base = makeRecord(input.projectId, "ai_candidate");
    const artifact: ConversationArtifact = {
      ...base,
      id,
      conversationSchemaVersion: "conversation-artifact-v1",
      sessionId: input.sessionId,
      sourceMessageId: input.sourceMessageId,
      artifactType: input.artifactType,
      targetStore: input.targetStore,
      targetRecordId: input.targetRecordId,
      sourceRevision: input.sourceRevision,
      candidateContent: input.candidateContent,
      candidateDigest,
      status: "candidate",
      approvedAt: null,
      approvedRevision: null,
    };
    const saved = await this.repository.put("conversationArtifacts", artifact);
    try {
      await this.linkMessageReference(input.projectId, input.sessionId, input.sourceMessageId, "candidateIds", saved.id);
    } catch (error) {
      await this.repository.remove("conversationArtifacts", saved.id);
      throw error;
    }
    return saved;
  }

  async rejectArtifact(projectId: string, sessionId: string, artifactId: string, expectedRevision: number) {
    await this.requireSession(projectId, sessionId);
    const artifact = await this.repository.get<ConversationArtifact>("conversationArtifacts", artifactId);
    if (!artifact || artifact.projectId !== projectId || artifact.sessionId !== sessionId) {
      throw new RepositoryOperationError("CONVERSATION_ARTIFACT_SCOPE_MISMATCH");
    }
    if (artifact.status === "rejected") return artifact;
    if (artifact.status !== "candidate") throw new RepositoryOperationError("CONVERSATION_ARTIFACT_ALREADY_DECIDED");
    return this.repository.put("conversationArtifacts", {
      ...artifact,
      status: "rejected",
    }, expectedRevision);
  }

  async approveArtifact(input: ApproveConversationArtifactTransactionInput) {
    // Conversation is a story surface. Canon setting records are edited only
    // from the project home, so even persisted legacy or forged candidates
    // must fail before a backup or any canonical write is attempted.
    assertStoryWorkspaceConversationApprovalTarget(input.targetStore);
    // Capture the recoverable pre-mutation state first. If backup creation
    // fails, no Canon/artifact/ledger write has occurred.
    await createProjectBackup(this.repository, input.projectId, "safety", {
      sovereignLearningRepository: this.learningRepository,
    });
    return this.repository.approveConversationArtifactTransaction(input);
  }

  async approveChapterArtifact(input: Omit<ApproveConversationArtifactTransactionInput, "targetStore" | "nextCanonicalRecord"> & {
    applicationMode: "append" | "replace" | "summary";
  }) {
    return this.approveArtifact({ ...input, targetStore: "chapters" });
  }

  async markArtifactApprovedFromExternalCommit(
    input: MarkConversationArtifactApprovedFromExternalCommitInput,
  ) {
    assertStoryWorkspaceConversationApprovalTarget(input.targetStore);
    // External coordinators must capture their safety backup before their
    // canonical commit.  A backup created here would necessarily describe a
    // partial state (Canon committed, Conversation artifact still pending)
    // and could resurrect that split-brain state after marker compensation.
    return this.repository.markConversationArtifactApprovedFromExternalCommit(input);
  }

  async upsertSummary(input: {
    projectId: string;
    sessionId: string;
    sourceMessageIds: string[];
    content: string;
    canonRevisionDigest: string;
  }) {
    const session = await this.requireSession(input.projectId, input.sessionId);
    assertSafeMessageContent(input.content);
    const messages = await this.listMessages(input.projectId, input.sessionId);
    const messageIds = new Set(messages.map((message) => message.id));
    if (!input.sourceMessageIds.length || input.sourceMessageIds.some((id) => !messageIds.has(id))) {
      throw new RepositoryOperationError("CONVERSATION_SUMMARY_SOURCE_INVALID");
    }
    const contentDigest = await conversationContentDigest(input.content);
    const existing = (await this.repository.list<ConversationSummary>("conversationSummaries", input.projectId))
      .find((summary) => summary.sessionId === input.sessionId && !summary.invalidatedAt);
    const base = existing ?? makeRecord(input.projectId, "system");
    const summary: ConversationSummary = {
      ...base,
      conversationSchemaVersion: "conversation-summary-v1",
      sessionId: input.sessionId,
      sourceMessageIds: [...new Set(input.sourceMessageIds)],
      content: input.content,
      contentDigest,
      canonRevisionDigest: input.canonRevisionDigest,
      invalidatedAt: null,
    };
    const saved = await this.repository.put("conversationSummaries", summary, existing?.revision);
    try {
      await this.repository.put("conversationSessions", {
        ...session,
        summaryDigest: contentDigest,
      }, session.revision);
    } catch (error) {
      if (!existing) await this.repository.remove("conversationSummaries", saved.id);
      throw error;
    }
    return saved;
  }

  async invalidateSummariesForCanonChange(projectId: string, canonRevisionDigest: string) {
    const now = new Date().toISOString();
    const summaries = await this.repository.list<ConversationSummary>("conversationSummaries", projectId);
    const invalidated: ConversationSummary[] = [];
    for (const summary of summaries) {
      if (summary.invalidatedAt || summary.canonRevisionDigest === canonRevisionDigest) continue;
      invalidated.push(await this.repository.put("conversationSummaries", {
        ...summary,
        invalidatedAt: now,
      }, summary.revision));
      const session = await this.repository.get<ConversationSession>("conversationSessions", summary.sessionId);
      if (session && session.projectId === projectId && session.summaryDigest === summary.contentDigest) {
        await this.repository.put("conversationSessions", { ...session, summaryDigest: null }, session.revision);
      }
    }
    return invalidated;
  }

  async branchSession(input: {
    projectId: string;
    sourceSessionId: string;
    fromMessageId: string;
    title?: string;
    branchSessionId?: string;
  }) {
    const sourceSession = await this.requireSession(input.projectId, input.sourceSessionId);
    const sourceMessages = await this.listMessages(input.projectId, input.sourceSessionId);
    const endIndex = sourceMessages.findIndex((message) => message.id === input.fromMessageId);
    if (endIndex < 0) throw new RepositoryOperationError("CONVERSATION_BRANCH_SOURCE_NOT_FOUND");
    const branch = await this.createSession({
      projectId: input.projectId,
      sessionId: input.branchSessionId,
      title: input.title ?? `${sourceSession.title} · 分支`,
      activeChapterId: sourceSession.activeChapterId,
      parentSessionId: sourceSession.id,
      branchedFromMessageId: input.fromMessageId,
    });
    const createdMessageIds: string[] = [];
    const createdAttachmentIds: string[] = [];
    const messageIdMap = new Map<string, string>();
    const attachmentIdMap = new Map<string, string>();
    try {
      for (const source of sourceMessages.slice(0, endIndex + 1)) {
        const messageId = crypto.randomUUID();
        const attachmentIds = await this.copyMessageAttachments({
          projectId: input.projectId,
          sourceSessionId: sourceSession.id,
          targetSessionId: branch.id,
          attachmentIds: source.attachmentIds,
          attachmentIdMap,
          createdAttachmentIds,
        });
        const copied = await this.appendMessage({
          projectId: input.projectId,
          sessionId: branch.id,
          messageId,
          role: source.role,
          content: source.content,
          status: source.status === "streaming" || source.status === "pending" ? "cancelled" : source.status,
          parentMessageId: source.parentMessageId ? messageIdMap.get(source.parentMessageId) ?? null : null,
          sourceMessageId: source.id,
          attachmentIds,
        });
        messageIdMap.set(source.id, copied.id);
        createdMessageIds.push(copied.id);
      }
      return {
        session: await this.requireSession(input.projectId, branch.id),
        messages: await this.listMessages(input.projectId, branch.id),
      };
    } catch (error) {
      for (const messageId of createdMessageIds) await this.repository.remove("conversationMessages", messageId);
      for (const attachmentId of createdAttachmentIds) {
        await this.repository.remove("conversationAttachments", attachmentId);
      }
      const current = await this.requireSession(input.projectId, branch.id, true);
      await this.deleteSession(input.projectId, current.id, current.revision);
      throw error;
    }
  }

  async editMessageWithBranch(input: {
    projectId: string;
    sessionId: string;
    messageId: string;
    content: string;
    title?: string;
  }) {
    const sourceSession = await this.requireSession(input.projectId, input.sessionId);
    const source = await this.repository.get<ConversationMessage>("conversationMessages", input.messageId);
    if (!source || source.projectId !== input.projectId || source.sessionId !== input.sessionId || source.role !== "user") {
      throw new RepositoryOperationError("CONVERSATION_EDIT_SOURCE_INVALID");
    }
    const branch = source.parentMessageId
      ? await this.branchSession({
          projectId: input.projectId,
          sourceSessionId: input.sessionId,
          fromMessageId: source.parentMessageId,
          title: input.title ?? `${sourceSession.title} · 編輯分支`,
        })
      : {
          session: await this.createSession({
            projectId: input.projectId,
            title: input.title ?? `${sourceSession.title} · 編輯分支`,
            activeChapterId: sourceSession.activeChapterId,
            parentSessionId: sourceSession.id,
            branchedFromMessageId: source.id,
          }),
          messages: [] as ConversationMessage[],
        };
    const createdAttachmentIds: string[] = [];
    try {
      const attachmentIds = await this.copyMessageAttachments({
        projectId: input.projectId,
        sourceSessionId: sourceSession.id,
        targetSessionId: branch.session.id,
        attachmentIds: source.attachmentIds,
        attachmentIdMap: new Map<string, string>(),
        createdAttachmentIds,
      });
      const previous = branch.messages.at(-1) ?? null;
      const message = await this.appendMessage({
        projectId: input.projectId,
        sessionId: branch.session.id,
        role: "user",
        content: input.content,
        status: "completed",
        parentMessageId: previous?.id ?? null,
        sourceMessageId: source.id,
        attachmentIds,
      });
      return { session: await this.requireSession(input.projectId, branch.session.id), message };
    } catch (error) {
      const [branchMessages, branchAttachments] = await Promise.all([
        this.listMessages(input.projectId, branch.session.id).catch(() => []),
        this.listAttachments(input.projectId, branch.session.id).catch(() => []),
      ]);
      for (const message of branchMessages) {
        await this.repository.remove("conversationMessages", message.id).catch(() => undefined);
      }
      for (const attachment of branchAttachments) {
        await this.repository.remove("conversationAttachments", attachment.id).catch(() => undefined);
      }
      const current = await this.requireSession(input.projectId, branch.session.id, true).catch(() => null);
      if (current && current.status !== "deleted") {
        await this.deleteSession(input.projectId, current.id, current.revision).catch(() => undefined);
      }
      throw error;
    }
  }

  async prepareRegeneration(input: {
    projectId: string;
    sessionId: string;
    sourceMessageId: string;
    expectedSourceMessage: ConversationMessage;
    expectedSourceInvocation: ConversationToolInvocation;
    expectedClosedCandidateId: string;
  }) {
    await this.requireSession(input.projectId, input.sessionId);
    const [source, sourceInvocation] = await Promise.all([
      this.repository.get<ConversationMessage>("conversationMessages", input.sourceMessageId),
      this.repository.get<ConversationToolInvocation>(
        "conversationToolInvocations",
        input.expectedSourceInvocation.id,
      ),
    ]);
    if (
      stableStringify(source) !== stableStringify(input.expectedSourceMessage)
      || stableStringify(sourceInvocation) !== stableStringify(input.expectedSourceInvocation)
    ) {
      throw new RepositoryOperationError("CONVERSATION_REGENERATION_SOURCE_STALE");
    }
    const closedCandidateIds = source?.candidateIds.filter((candidateId) => (
      candidateId.startsWith("closed-agent-candidate:")
    )) ?? [];
    if (
      !source
      || source.projectId !== input.projectId
      || source.sessionId !== input.sessionId
      || source.role !== "assistant"
      || source.status !== "completed"
      || closedCandidateIds.length !== 1
      || closedCandidateIds[0] !== input.expectedClosedCandidateId
      || !sourceInvocation
      || sourceInvocation.projectId !== input.projectId
      || sourceInvocation.sessionId !== input.sessionId
      || sourceInvocation.messageId !== source.id
      || !source.toolInvocationIds.includes(sourceInvocation.id)
      || sourceInvocation.toolId !== CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
      || sourceInvocation.status !== "completed"
    ) {
      throw new RepositoryOperationError("CONVERSATION_REGENERATION_SOURCE_INVALID");
    }
    const taskId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    const message = await this.appendMessage({
      projectId: input.projectId,
      sessionId: input.sessionId,
      role: "assistant",
      content: "",
      status: "pending",
      parentMessageId: source.parentMessageId,
      sourceMessageId: source.id,
    });
    return { taskId, candidateId, messageId: message.id, sourceMessageId: source.id };
  }

  async conversationDigest(projectId: string, sessionId: string) {
    const messages = await this.listMessages(projectId, sessionId);
    return sha256Hex(messages.map((message) => `${message.id}:${message.revision}:${message.contentDigest}`).join("|"));
  }
}

export type ConversationApprovalResult = ApproveConversationArtifactTransactionResult;
export type ConversationCanonicalStore = ConversationCanonicalTargetStore;
