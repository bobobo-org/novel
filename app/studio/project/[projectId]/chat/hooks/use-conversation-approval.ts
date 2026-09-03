"use client";

import { useMemo, type MutableRefObject } from "react";
import type {
  ConversationArtifact,
  ConversationMessage,
  ConversationSession,
  ConversationToolInvocation,
  DomainRecord,
  LearningImportSession,
} from "@/lib/novel-ai/domain";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import type { SovereignLearningRepository } from "@/lib/novel-ai/sovereign-learning";
import type { ClosedAgentCandidate } from "@/lib/novel-ai/closed-agent-os";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import { hasConversationClosedAgentLineage } from "@/lib/novel-ai/conversation/closed-agent-lineage";
import {
  assertConversationClosedAgentApprovalBinding,
  assertConversationClosedAgentApprovalCallbackCandidate,
  assertConversationClosedAgentApprovalSnapshotUnchanged,
  buildConversationClosedAgentApprovalBindingProof,
  type ConversationClosedAgentApprovalBinding,
} from "@/lib/novel-ai/conversation/closed-agent-approval";
import type { ConversationLearningCoordinatorLoader } from "./use-conversation-learning-loader";
import {
  assertStoryWorkspaceConversationApprovalTarget,
  conversationCanonicalRecordDigest,
  conversationContentDigest,
  isStoryWorkspaceForbiddenCanonicalTarget,
} from "@/lib/novel-ai/conversation/approval-transaction";
import { planConversationRequest, type ConversationPlan } from "@/lib/novel-ai/conversation/planner";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import {
  approveStudioClosedAgentCandidate,
  getStudioClosedAgentOS,
  rejectStudioClosedAgentCandidate,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import { settleApprovedRpgTurnClosedAgent } from "@/lib/novel-ai/web/rpg-approval-settlement";
import {
  artifactStory,
  parseLearningImportCandidate,
  parseRpgCandidate,
  rpgCandidateApprovalState,
} from "../components/conversation-presentation";
import type { DrawerPayload } from "../components/conversation-types";
import { toExecutionReceipt } from "./use-conversation-operation";
import {
  assertConversationExternalCandidateLineage,
  CONVERSATION_EXTERNAL_AI_TOOL_ID,
} from "../external-ai";

function approvalErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_APPROVAL_FAILED");
  }
  return "CONVERSATION_APPROVAL_FAILED";
}

function approvalErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "候選處理沒有完成；正式作品維持原狀。";
}

function exactClosedCandidateId(message: ConversationMessage) {
  const candidateIds = message.candidateIds.filter((id) => (
    id.startsWith("closed-agent-candidate:")
  ));
  if (candidateIds.length > 1) {
    throw Object.assign(new Error("Conversation has ambiguous Closed Agent candidate lineage."), {
      code: "CONVERSATION_CLOSED_CANDIDATE_AMBIGUOUS",
    });
  }
  return candidateIds[0] ?? null;
}

async function closedCandidateIdForUneditedApproval(
  repository: NovelRepository,
  message: ConversationMessage,
) {
  const invocations = await Promise.all(message.toolInvocationIds.map((invocationId) => (
    repository.get<ConversationToolInvocation>("conversationToolInvocations", invocationId)
  )));
  const hasClosedLineage = hasConversationClosedAgentLineage({
    message,
    invocations,
  });
  if (!hasClosedLineage) return null;
  const candidateId = exactClosedCandidateId(message);
  if (!candidateId) {
    throw Object.assign(new Error("Closed candidate approval binding is invalid."), {
      code: "CONVERSATION_CLOSED_CANDIDATE_BINDING_INVALID",
    });
  }
  return candidateId;
}

async function loadClosedCandidateApprovalBinding(input: {
  projectId: string;
  sessionId: string;
  repository: NovelRepository;
  candidateId: string;
  sourceMessageId: string;
  artifactId: string;
}) {
  const os = getStudioClosedAgentOS();
  const [session, sourceMessage, artifact, candidate, artifacts, invocations] = await Promise.all([
    input.repository.get<ConversationSession>("conversationSessions", input.sessionId),
    input.repository.get<ConversationMessage>("conversationMessages", input.sourceMessageId),
    input.repository.get<ConversationArtifact>("conversationArtifacts", input.artifactId),
    os.state.get<ClosedAgentCandidate>(input.candidateId),
    input.repository.list<ConversationArtifact>(
      "conversationArtifacts",
      input.projectId,
    ),
    input.repository.list<ConversationToolInvocation>(
      "conversationToolInvocations",
      input.projectId,
    ),
  ]);
  if (!session || !sourceMessage || !artifact) {
    throw Object.assign(new Error("Closed candidate approval binding is invalid."), {
      code: "CONVERSATION_CLOSED_CANDIDATE_BINDING_INVALID",
    });
  }
  const sourceMessageCandidateArtifacts = artifacts.filter((candidateArtifact) => (
    candidateArtifact.projectId === input.projectId
    && candidateArtifact.sessionId === input.sessionId
    && candidateArtifact.sourceMessageId === sourceMessage.id
    && candidateArtifact.status === "candidate"
  ));
  const targetRecord = artifact.targetStore === "chapters"
    || artifact.targetStore === "characters"
    || artifact.targetStore === "worldRules"
    ? await input.repository.get<DomainRecord>(artifact.targetStore, artifact.targetRecordId)
    : null;
  const candidateIntegrityVerified = candidate
    ? await os.verifyCandidateIntegrity(candidate.id)
    : false;
  return assertConversationClosedAgentApprovalBinding({
    projectId: input.projectId,
    sessionId: input.sessionId,
    session,
    sourceMessage,
    artifact,
    sourceMessageCandidateArtifacts,
    invocations,
    targetRecord,
    candidate,
    candidateIntegrityVerified,
  });
}

async function assertClosedCandidateApprovalSnapshotCurrent(input: {
  expected: ConversationClosedAgentApprovalBinding;
  projectId: string;
  sessionId: string;
  repository: NovelRepository;
}) {
  const current = await loadClosedCandidateApprovalBinding({
    projectId: input.projectId,
    sessionId: input.sessionId,
    repository: input.repository,
    candidateId: input.expected.candidate.id,
    sourceMessageId: input.expected.sourceMessage.id,
    artifactId: input.expected.artifact.id,
  });
  assertConversationClosedAgentApprovalSnapshotUnchanged(input.expected, current);
  return current;
}

/*
 * Approval spans Closed Agent ledger/state and Conversation IndexedDB stores.
 * The first preflight guarantees pre-existing mismatch never reaches the OS.
 * This callback-time check is the saga CAS: a concurrent mismatch leaves at
 * most the reusable signed approval intent, while Canon and candidate state
 * remain unchanged until an exact retry completes the canonical commit.
 */
function assertCanonicalCallbackCandidate(
  expected: ClosedAgentCandidate,
  candidate: ClosedAgentCandidate,
) {
  assertConversationClosedAgentApprovalCallbackCandidate(expected, candidate);
}

function approvalApplicationMode(plan: ConversationPlan) {
  if (plan.intent === "rewrite_selection") return "replace" as const;
  if (plan.intent === "chapter_outline") return "summary" as const;
  return "append" as const;
}

export function useConversationApprovalController({
  projectId,
  repository,
  learningRepository,
  conversation,
  getLearningCoordinator,
  activeSession,
  busy,
  operationLockRef,
  retryActionRef,
  acquireLease,
  currentCanonRevisionDigest,
  createRpgChoicesMessage,
  settleRpgCandidateEvidence,
  recoverRpgChoices,
  loadWorkspace,
  refreshSession,
  setRetryAvailable,
  setRetryLabel,
  setBusy,
  setSafeError,
  setProgress,
  setArtifactOpen,
  setDrawer,
}: {
  projectId: string;
  repository: NovelRepository;
  learningRepository: SovereignLearningRepository;
  conversation: ConversationRepositoryService;
  getLearningCoordinator: ConversationLearningCoordinatorLoader;
  activeSession: ConversationSession | null;
  busy: boolean;
  operationLockRef: MutableRefObject<boolean>;
  retryActionRef: MutableRefObject<(() => void) | null>;
  acquireLease: (projectId: string, sessionId: string) => Promise<(() => void) | null>;
  currentCanonRevisionDigest: () => Promise<string>;
  createRpgChoicesMessage: (input: {
    sessionId: string;
    parentMessageId: string;
    signal: AbortSignal;
  }) => Promise<unknown>;
  settleRpgCandidateEvidence: (artifact: ConversationArtifact) => Promise<unknown>;
  recoverRpgChoices: () => Promise<void>;
  loadWorkspace: (preferredSessionId?: string) => Promise<boolean>;
  refreshSession: (sessionId: string) => Promise<boolean>;
  setRetryAvailable: (value: boolean) => void;
  setRetryLabel: (value: string) => void;
  setBusy: (value: boolean) => void;
  setSafeError: (error: { code: string; message: string } | null) => void;
  setProgress: (message: string) => void;
  setArtifactOpen: (value: boolean) => void;
  setDrawer: (value: DrawerPayload) => void;
}) {
  async function approveArtifact(artifact: ConversationArtifact, editedContent?: string) {
    if (isStoryWorkspaceForbiddenCanonicalTarget(artifact.targetStore)) {
      setSafeError({
        code: "CONVERSATION_STORY_CANON_MUTATION_FORBIDDEN",
        message: "故事工作台只能選擇上場內容，不能採用人物、關係、世界規則、Story Bible、記憶或時間線的正式變更；請回首頁修改。",
      });
      return;
    }
    if (!activeSession) {
      setSafeError({
        code: "CONVERSATION_APPROVAL_SESSION_NOT_READY",
        message: "目前對話尚未準備完成，請稍後再按一次採用。",
      });
      return;
    }
    if (artifact.status !== "candidate") {
      setSafeError({
        code: "CONVERSATION_APPROVAL_CANDIDATE_NOT_CURRENT",
        message: "這份候選已不是待採用狀態；正在重新整理目前對話。",
      });
      await refreshSession(activeSession.id).catch(() => undefined);
      return;
    }
    if (busy || operationLockRef.current) {
      setSafeError({
        code: "CONVERSATION_APPROVAL_OPERATION_LOCKED",
        message: "上一個故事操作尚未完全釋放；正式作品維持原狀，請按重試。",
      });
      setRetryAvailable(true);
      setRetryLabel("重試採用");
      retryActionRef.current = () => { void approveArtifact(artifact, editedContent); };
      return;
    }
    const contentWasEdited = (
      !["rpg", "learning_rule"].includes(artifact.artifactType)
      && editedContent !== undefined
      && editedContent.normalize("NFKC").trim()
        !== artifactStory(artifact).normalize("NFKC").trim()
    );
    const sessionId = activeSession.id;
    retryActionRef.current = () => { void approveArtifact(artifact, editedContent); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "另一個分頁正在執行這個對話，請稍後再試。",
      });
      return;
    }
    setBusy(true);
    setSafeError(null);
    let rpgCanonCommitted = false;
    let rpgApprovalSettled = false;
    let rpgChoicesCompleted = false;
    try {
      let selected = artifact;
      if (contentWasEdited) {
        const originalSourceMessage = await repository.get<ConversationMessage>(
          "conversationMessages",
          artifact.sourceMessageId,
        );
        if (
          !originalSourceMessage
          || originalSourceMessage.projectId !== projectId
          || originalSourceMessage.sessionId !== sessionId
          || originalSourceMessage.status !== "completed"
        ) {
          throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
        }
        const originalInvocations = (await Promise.all(
          originalSourceMessage.toolInvocationIds.map((invocationId) => (
            repository.get<ConversationToolInvocation>("conversationToolInvocations", invocationId)
          )),
        )).filter((invocation): invocation is ConversationToolInvocation => Boolean(invocation));
        if (originalInvocations.some((invocation) => (
          invocation.toolId === CONVERSATION_EXTERNAL_AI_TOOL_ID
        ))) {
          throw Object.assign(new Error("外來 AI 候選的核准證明只綁定原始回傳內容；請先核准原候選，或把修改後文字另開成新的本機要求。"), {
            code: "CONVERSATION_EXTERNAL_CANDIDATE_EDIT_REQUIRES_NEW_REQUEST",
          });
        }
        const editedArtifact = await conversation.saveArtifact({
          projectId,
          sessionId,
          sourceMessageId: artifact.sourceMessageId,
          artifactType: artifact.artifactType,
          targetStore: artifact.targetStore,
          targetRecordId: artifact.targetRecordId,
          sourceRevision: artifact.sourceRevision,
          candidateContent: editedContent.trim(),
        });
        let editInvocation: ConversationToolInvocation | null = null;
        try {
          const attemptId = crypto.randomUUID();
          const contextDigest = await conversationContentDigest(JSON.stringify({
            schemaVersion: "conversation-local-user-edit-v1",
            originalArtifactId: artifact.id,
            originalCandidateDigest: artifact.candidateDigest,
            sourceMessageId: artifact.sourceMessageId,
          }));
          editInvocation = await conversation.saveToolInvocation({
            projectId,
            sessionId,
            messageId: originalSourceMessage.id,
            invocationId: `conversation-local-user-edit:invocation:${attemptId}`,
            taskId: `conversation-local-user-edit:task:${attemptId}`,
            toolId: CONVERSATION_LOCAL_TOOL_IDS.localUserEdit,
            taskType: "candidate.user-edit",
            inputDigest: artifact.candidateDigest,
            contextDigest,
            status: "running",
            externalRequest: false,
            dataLeftDevice: false,
            canonicalMutationCount: 0,
            safeProgress: { stage: "editing", percent: 50, message: "正在記錄本機使用者修改" },
          });
          editInvocation = await conversation.updateToolInvocationStatus({
            projectId,
            sessionId,
            invocationId: editInvocation.id,
            expectedRevision: editInvocation.revision,
            status: "completed",
            actualExecutor: "local-user-edit",
            modelId: null,
            modelDigest: null,
            executionReceipt: toExecutionReceipt({
              taskId: editInvocation.taskId,
              modelId: null,
              modelDigest: null,
              contextDigest: editInvocation.contextDigest,
              outputDigest: editedArtifact.candidateDigest,
              externalRequest: false,
              dataLeftDevice: false,
            }),
            externalRequest: false,
            dataLeftDevice: false,
            canonicalMutationCount: 0,
            safeProgress: { stage: "completed", percent: 100, message: "本機使用者修改已記錄，Canon 未修改" },
          });
        } catch (error) {
          if (editInvocation) {
            const currentInvocation = await repository.get<ConversationToolInvocation>(
              "conversationToolInvocations",
              editInvocation.id,
            );
            if (currentInvocation && ["pending", "running"].includes(currentInvocation.status)) {
              await conversation.updateToolInvocationStatus({
                projectId,
                sessionId,
                invocationId: currentInvocation.id,
                expectedRevision: currentInvocation.revision,
                status: "failed",
                safeErrorCode: approvalErrorCode(error),
                canonicalMutationCount: 0,
              }).catch(() => undefined);
            }
          }
          const currentEditedArtifact = await repository.get<ConversationArtifact>(
            "conversationArtifacts",
            editedArtifact.id,
          );
          if (currentEditedArtifact?.status === "candidate") {
            await conversation.rejectArtifact(
              projectId,
              sessionId,
              currentEditedArtifact.id,
              currentEditedArtifact.revision,
            ).catch(() => undefined);
          }
          throw error;
        }
        const originalClosedCandidateId = exactClosedCandidateId(originalSourceMessage);
        if (originalClosedCandidateId) {
          await rejectStudioClosedAgentCandidate(originalClosedCandidateId);
        }
        selected = editedArtifact;
        await conversation.rejectArtifact(projectId, sessionId, artifact.id, artifact.revision);
      }
      const session = await repository.get<ConversationSession>("conversationSessions", sessionId);
      const sourceMessage = await repository.get<ConversationMessage>("conversationMessages", selected.sourceMessageId);
      const freshArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", selected.id);
      if (!session || !sourceMessage || !freshArtifact) throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
      const sourceInvocations = (await Promise.all(
        sourceMessage.toolInvocationIds.map((invocationId) => (
          repository.get<ConversationToolInvocation>("conversationToolInvocations", invocationId)
        )),
      )).filter((invocation): invocation is ConversationToolInvocation => Boolean(invocation));
      const hasExternalLineage = sourceInvocations.some((invocation) => (
        invocation.toolId === CONVERSATION_EXTERNAL_AI_TOOL_ID
      ));
      if (hasExternalLineage) {
        assertConversationExternalCandidateLineage({
          message: sourceMessage,
          artifact: freshArtifact,
          invocations: sourceInvocations,
        });
      }
      assertStoryWorkspaceConversationApprovalTarget(freshArtifact.targetStore);
      if (freshArtifact.targetStore === "none") {
        throw Object.assign(new Error("這是參考候選，不會寫入 Canon；你可以保留查看、複製內容或放棄。"), {
          code: "CONVERSATION_NON_CANONICAL_CANDIDATE_REFERENCE_ONLY",
        });
      }
      if (freshArtifact.artifactType === "learning_rule") {
        const learning = await getLearningCoordinator();
        const candidate = parseLearningImportCandidate(freshArtifact);
        const importSession = await repository.get<LearningImportSession>(
          "learningImportSessions",
          freshArtifact.targetRecordId,
        );
        if (
          !candidate
          || !importSession
          || candidate.importSessionId !== importSession.importSessionId
          || candidate.manifestDigest !== importSession.manifestDigest
          || importSession.projectId !== projectId
          || importSession.sessionId !== session.id
          || freshArtifact.targetStore !== "learningImportSessions"
          || (importSession.status === "ready_to_finalize"
            ? importSession.revision !== freshArtifact.sourceRevision
            : importSession.revision !== freshArtifact.sourceRevision + 1)
          || !["ready_to_finalize", "committed"].includes(importSession.status)
        ) {
          throw Object.assign(new Error("整份學習匯入候選已過期或範圍不符。"), {
            code: "LEARNING_IMPORT_APPROVAL_SOURCE_STALE",
          });
        }
        const finalized = await learning.finalize(
          projectId,
          importSession.importSessionId,
          { retainStagingUntilApproval: true },
        );
        try {
          await learning.approveFinalizedRules(projectId, importSession.importSessionId);
          const committed = await repository.get<LearningImportSession>(
            "learningImportSessions",
            importSession.id,
          );
          if (!committed || committed.status !== "committed") {
            throw new Error("LEARNING_IMPORT_CANONICAL_COMMIT_MISSING");
          }
          const currentSession = await repository.get<ConversationSession>("conversationSessions", session.id);
          const currentMessage = await repository.get<ConversationMessage>("conversationMessages", sourceMessage.id);
          const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id);
          if (!currentSession || !currentMessage || !currentArtifact) {
            throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
          }
          await conversation.markArtifactApprovedFromExternalCommit({
            operationId: `conversation-learning-approval:${freshArtifact.id}`,
            idempotencyKey: `conversation-learning-approval:${freshArtifact.id}:${freshArtifact.candidateDigest}`,
            projectId,
            sessionId: session.id,
            artifactId: freshArtifact.id,
            sourceMessageId: sourceMessage.id,
            candidateDigest: freshArtifact.candidateDigest,
            targetStore: "learningImportSessions",
            targetRecordId: committed.id,
            expectedSessionRevision: currentSession.revision,
            expectedArtifactRevision: currentArtifact.revision,
            expectedSourceMessageRevision: currentMessage.revision,
            expectedSourceRevision: freshArtifact.sourceRevision,
            resultingRevision: committed.revision,
            canonicalRecordDigest: await conversationCanonicalRecordDigest(committed),
            commitId: `learning-import:${committed.manifestDigest}`,
          });
        } catch (approvalError) {
          try {
            await learning.compensateFinalizedApproval(projectId, importSession.importSessionId);
          } catch (compensationError) {
            throw Object.assign(
              new AggregateError(
                [approvalError, compensationError],
                "Learning approval compensation failed.",
              ),
              { code: "LEARNING_IMPORT_APPROVAL_COMPENSATION_FAILED" },
            );
          }
          throw approvalError;
        }
        await learning.releaseFinalizedStaging(projectId, importSession.importSessionId).catch(() => undefined);
        setProgress(
          `整份學習匯入已採用：${finalized.sources?.length ?? 0} 個安全來源、${finalized.rules?.length ?? 0} 條抽象規則；原文未保存。`,
        );
      } else if (freshArtifact.artifactType === "rpg") {
        if (
          sourceMessage.status !== "completed"
          || rpgCandidateApprovalState(freshArtifact, sourceInvocations) === "settling"
        ) {
          setProgress("既有正文候選已保存；正在重驗並補完本機執行收據，不會重新執行模型。");
          await settleRpgCandidateEvidence(freshArtifact);
        }
        const rpgRuntime = await import("@/lib/novel-ai/web/rpg-chat-turn");
        const currentSession = await repository.get<ConversationSession>("conversationSessions", session.id);
        const currentMessage = await repository.get<ConversationMessage>("conversationMessages", sourceMessage.id);
        const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id);
        if (!currentSession || !currentMessage || !currentArtifact) {
          throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
        }
        const candidate = parseRpgCandidate(currentArtifact);
        if (!candidate) throw new Error("RPG_CHAT_CANDIDATE_INVALID");
        const snapshot = await rpgRuntime.loadRpgChatSnapshot(
          repository,
          projectId,
          undefined,
          learningRepository,
        );
        const closedAgentApprovalBinding = candidate.externalRequest
          || candidate.actualExecutor === "deterministic-rule-fallback"
          ? undefined
          : await buildConversationClosedAgentApprovalBindingProof(
              await loadClosedCandidateApprovalBinding({
                projectId,
                sessionId: session.id,
                repository,
                candidateId: candidate.candidateId,
                sourceMessageId: currentMessage.id,
                artifactId: currentArtifact.id,
              }),
            );
        await rpgRuntime.approveRpgChatTurn({
          repository,
          snapshot,
          candidate,
          conversationApproval: {
            operationId: `conversation-rpg-approval:${freshArtifact.id}`,
            idempotencyKey: `conversation-rpg-approval:${freshArtifact.id}:${freshArtifact.candidateDigest}`,
            sessionId: session.id,
            artifactId: currentArtifact.id,
            sourceMessageId: currentMessage.id,
            candidateDigest: currentArtifact.candidateDigest,
            expectedSessionRevision: currentSession.revision,
            expectedArtifactRevision: currentArtifact.revision,
            expectedSourceMessageRevision: currentMessage.revision,
            expectedSourceRevision: currentArtifact.sourceRevision,
            closedAgentApprovalBinding,
          },
        });
        rpgCanonCommitted = true;
        rpgApprovalSettled = true;
        const controller = new AbortController();
        await createRpgChoicesMessage({
          sessionId: session.id,
          parentMessageId: currentMessage.id,
          signal: controller.signal,
        });
        rpgChoicesCompleted = true;
      } else if (freshArtifact.targetStore === "chapters") {
        const closedCandidateId = !contentWasEdited
          ? await closedCandidateIdForUneditedApproval(repository, sourceMessage)
          : null;
        const requestMessage = sourceMessage.parentMessageId
          ? await repository.get<ConversationMessage>("conversationMessages", sourceMessage.parentMessageId)
          : null;
        const sourcePlan = await planConversationRequest({ content: requestMessage?.content ?? "" });
        const commit = async (
          binding?: ConversationClosedAgentApprovalBinding,
        ) => {
          const [currentSession, currentMessage, currentArtifact] = binding
            ? [binding.session, binding.sourceMessage, binding.artifact]
            : await Promise.all([
                repository.get<ConversationSession>("conversationSessions", session.id),
                repository.get<ConversationMessage>("conversationMessages", sourceMessage.id),
                repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id),
              ]);
          if (!currentSession || !currentMessage || !currentArtifact) {
            throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
          }
          const closedAgentApprovalBinding = binding
            ? await buildConversationClosedAgentApprovalBindingProof(binding)
            : undefined;
          return conversation.approveChapterArtifact({
            operationId: `conversation-approval:${currentArtifact.id}`,
            idempotencyKey: `conversation-approval:${currentArtifact.id}:${currentArtifact.candidateDigest}`,
            projectId,
            sessionId: session.id,
            artifactId: currentArtifact.id,
            sourceMessageId: currentMessage.id,
            candidateDigest: currentArtifact.candidateDigest,
            targetRecordId: currentArtifact.targetRecordId,
            expectedSessionRevision: currentSession.revision,
            expectedArtifactRevision: currentArtifact.revision,
            expectedSourceMessageRevision: currentMessage.revision,
            expectedSourceRevision: currentArtifact.sourceRevision,
            applicationMode: approvalApplicationMode(sourcePlan),
            closedAgentApprovalBinding,
          });
        };
        if (closedCandidateId && !contentWasEdited) {
          const bound = await loadClosedCandidateApprovalBinding({
            projectId,
            sessionId: session.id,
            repository,
            candidateId: closedCandidateId,
            sourceMessageId: sourceMessage.id,
            artifactId: freshArtifact.id,
          });
          await approveStudioClosedAgentCandidate({
            candidateId: closedCandidateId,
            canonicalCommit: async ({ candidate }) => {
              assertCanonicalCallbackCandidate(bound.candidate, candidate);
              await assertClosedCandidateApprovalSnapshotCurrent({
                expected: bound,
                projectId,
                sessionId: session.id,
                repository,
              });
              const result = await commit(bound);
              return { commitId: result.approvalTransaction.operationId };
            },
          });
        } else {
          await commit();
        }
      } else {
        throw Object.assign(new Error("這類故事候選不能在故事工作台採用。"), {
          code: "CONVERSATION_APPROVAL_TARGET_NOT_SUPPORTED",
        });
      }
      await conversation.invalidateSummariesForCanonChange(
        projectId,
        await currentCanonRevisionDigest(),
      );
      setProgress("候選已由你明確採用；唯一 Canon 交易與安全備份已完成。");
      setArtifactOpen(false);
      setDrawer(null);
      await loadWorkspace(sessionId);
    } catch (error) {
      let rpgSettlementError: unknown = null;
      if (!rpgCanonCommitted && artifact.artifactType === "rpg") {
        const durableArtifact = await repository.get<ConversationArtifact>(
          "conversationArtifacts",
          artifact.id,
        ).catch(() => null);
        rpgCanonCommitted = durableArtifact?.status === "approved";
      }
      if (rpgCanonCommitted && !rpgApprovalSettled && artifact.artifactType === "rpg") {
        try {
          await settleApprovedRpgTurnClosedAgent({
            repository,
            projectId,
            sessionId,
            artifactId: artifact.id,
          });
          rpgApprovalSettled = true;
        } catch (settlementError) {
          rpgSettlementError = settlementError;
        }
      }
      await loadWorkspace(sessionId).catch(() => undefined);
      if (rpgCanonCommitted && !rpgApprovalSettled) {
        retryActionRef.current = () => { void recoverRpgChoices(); };
        setRetryAvailable(true);
        setRetryLabel("完成核准並重建三選一");
        setArtifactOpen(false);
        setDrawer(null);
        setProgress("上一回合 Canon 已保存；正在等待完成閉端 AI 核准帳本與記憶結算，尚未建立下一組三選一。");
        setSafeError({
          code: approvalErrorCode(rpgSettlementError),
          message: "上一回合正文、數值與回合收據已安全保存，但閉端 AI 核准結算尚未完整落盤。請重試；系統會先完成冪等結算，再建立三選一，絕不重複寫入 Canon。",
        });
      } else if (rpgCanonCommitted && !rpgChoicesCompleted) {
        try {
          const canonRevisionDigest = await currentCanonRevisionDigest();
          await conversation.invalidateSummariesForCanonChange(
            projectId,
            canonRevisionDigest,
          );
        } catch {
          // Canon is already committed. Summary invalidation is a recoverable
          // post-commit concern and must never hide the choice recovery entry.
        }
        retryActionRef.current = () => { void recoverRpgChoices(); };
        setRetryAvailable(true);
        setRetryLabel("重新建立三選一");
        setArtifactOpen(false);
        setDrawer(null);
        setProgress("上一回合正文、數值與 Canon 已核准保存；只有下一組三選一尚未完成。");
        setSafeError({
          code: "RPG_NEXT_CHOICES_RECOVERY_REQUIRED",
          message: "上一回合已核准並完整保留。請重新建立下一組三選一；這次只產生選項，不會再次寫入 Canon。",
        });
      } else if (rpgCanonCommitted) {
        retryActionRef.current = () => {
          void loadWorkspace(sessionId).then((loaded) => {
            if (!loaded) return;
            retryActionRef.current = null;
            setRetryAvailable(false);
            setSafeError(null);
            setProgress("上一回合與下一組三選一均已保存；畫面已重新整理。");
          }).catch(() => undefined);
        };
        setRetryAvailable(true);
        setRetryLabel("重新整理");
        setArtifactOpen(false);
        setDrawer(null);
        setProgress("上一回合與下一組三選一均已保存；只有摘要更新或畫面重新整理未完成。");
        setSafeError({
          code: "RPG_POST_COMMIT_REFRESH_REQUIRED",
          message: "正文、數值、Canon 與下一組三選一都已保存，不會重複寫入。請重新整理目前對話。",
        });
      } else {
        setSafeError({ code: approvalErrorCode(error), message: approvalErrorMessage(error) });
      }
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setBusy(false);
    }
  }

  async function rejectArtifact(artifact: ConversationArtifact) {
    if (!activeSession || busy || operationLockRef.current || artifact.status !== "candidate") return;
    const sessionId = activeSession.id;
    retryActionRef.current = () => { void rejectArtifact(artifact); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "另一個分頁正在執行這個對話，請稍後再試。",
      });
      return;
    }
    setBusy(true);
    setSafeError(null);
    try {
      const currentArtifact = await repository.get<ConversationArtifact>(
        "conversationArtifacts",
        artifact.id,
      );
      if (
        !currentArtifact
        || currentArtifact.projectId !== projectId
        || currentArtifact.sessionId !== sessionId
        || !["candidate", "rejected"].includes(currentArtifact.status)
      ) {
        throw Object.assign(new Error("Conversation artifact is no longer rejectable."), {
          code: "CONVERSATION_ARTIFACT_STALE",
        });
      }
      const source = await repository.get<ConversationMessage>(
        "conversationMessages",
        currentArtifact.sourceMessageId,
      );
      if (
        !source
        || source.projectId !== projectId
        || source.sessionId !== sessionId
      ) {
        throw Object.assign(new Error("Conversation artifact source is no longer rejectable."), {
          code: "CONVERSATION_ARTIFACT_STALE",
        });
      }
      const closedCandidateId = source ? exactClosedCandidateId(source) : null;
      if (closedCandidateId) {
        await rejectStudioClosedAgentCandidate(closedCandidateId);
      }
      if (currentArtifact.artifactType === "learning_rule") {
        const learning = await getLearningCoordinator();
        await learning.rollbackPendingApproval(
          projectId,
          currentArtifact.targetRecordId,
        );
      }
      if (currentArtifact.status === "candidate") {
        await conversation.rejectArtifact(
          projectId,
          sessionId,
          currentArtifact.id,
          currentArtifact.revision,
        );
      }
      await refreshSession(sessionId);
    } catch (error) {
      await refreshSession(sessionId).catch(() => undefined);
      setSafeError({ code: approvalErrorCode(error), message: approvalErrorMessage(error) });
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setBusy(false);
    }
  }

  return { approveArtifact, rejectArtifact };
}

export function useConversationApproval(artifacts: ConversationArtifact[]) {
  return useMemo(() => {
    const artifactsByMessage = new Map<string, ConversationArtifact[]>();
    const candidateIds = new Set<string>();
    for (const artifact of artifacts) {
      artifactsByMessage.set(artifact.sourceMessageId, [
        ...(artifactsByMessage.get(artifact.sourceMessageId) ?? []),
        artifact,
      ]);
      if (artifact.status === "candidate") candidateIds.add(artifact.id);
    }
    return { artifactsByMessage, candidateIds };
  }, [artifacts]);
}
