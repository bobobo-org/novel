"use client";

import { useMemo, type MutableRefObject } from "react";
import type {
  Character,
  ConversationArtifact,
  ConversationMessage,
  ConversationSession,
  ConversationToolInvocation,
  LearningImportSession,
  WorldRule,
} from "@/lib/novel-ai/domain";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import type { ConversationLearningCoordinatorLoader } from "./use-conversation-learning-loader";
import {
  conversationCanonicalRecordDigest,
  conversationContentDigest,
} from "@/lib/novel-ai/conversation/approval-transaction";
import { buildConversationCanonicalReplacement } from "@/lib/novel-ai/conversation/canonical-target";
import { planConversationRequest, type ConversationPlan } from "@/lib/novel-ai/conversation/planner";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import {
  approveStudioClosedAgentCandidate,
  rejectStudioClosedAgentCandidate,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import { approveRpgChatTurn, loadRpgChatSnapshot } from "@/lib/novel-ai/web/rpg-chat-turn";
import {
  artifactStory,
  parseLearningImportCandidate,
  parseRpgCandidate,
} from "../components/conversation-presentation";
import type { DrawerPayload } from "../components/conversation-types";
import { toExecutionReceipt } from "./use-conversation-operation";

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

function approvalApplicationMode(plan: ConversationPlan) {
  if (plan.intent === "rewrite_selection") return "replace" as const;
  if (plan.intent === "chapter_outline") return "summary" as const;
  return "append" as const;
}

export function useConversationApprovalController({
  projectId,
  repository,
  conversation,
  getLearningCoordinator,
  activeSession,
  busy,
  operationLockRef,
  retryActionRef,
  acquireLease,
  currentCanonRevisionDigest,
  createRpgChoicesMessage,
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
    if (!activeSession || busy || operationLockRef.current || artifact.status !== "candidate") return;
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
    try {
      let selected = artifact;
      if (
        !["rpg", "learning_rule"].includes(artifact.artifactType)
        && editedContent !== undefined
        && editedContent.trim() !== artifactStory(artifact).trim()
      ) {
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
        selected = editedArtifact;
        await conversation.rejectArtifact(projectId, sessionId, artifact.id, artifact.revision);
      }
      const session = await repository.get<ConversationSession>("conversationSessions", sessionId);
      const sourceMessage = await repository.get<ConversationMessage>("conversationMessages", selected.sourceMessageId);
      const freshArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", selected.id);
      if (!session || !sourceMessage || !freshArtifact) throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
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
        const candidate = parseRpgCandidate(freshArtifact);
        if (!candidate) throw new Error("RPG_CHAT_CANDIDATE_INVALID");
        const snapshot = await loadRpgChatSnapshot(repository, projectId);
        const currentSession = await repository.get<ConversationSession>("conversationSessions", session.id);
        const currentMessage = await repository.get<ConversationMessage>("conversationMessages", sourceMessage.id);
        const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id);
        if (!currentSession || !currentMessage || !currentArtifact) {
          throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
        }
        await approveRpgChatTurn({
          repository,
          snapshot,
          candidate,
          conversationApproval: {
            operationId: `conversation-rpg-approval:${freshArtifact.id}`,
            idempotencyKey: `conversation-rpg-approval:${freshArtifact.id}:${freshArtifact.candidateDigest}`,
            sessionId: session.id,
            artifactId: freshArtifact.id,
            sourceMessageId: sourceMessage.id,
            candidateDigest: freshArtifact.candidateDigest,
            expectedSessionRevision: currentSession.revision,
            expectedArtifactRevision: currentArtifact.revision,
            expectedSourceMessageRevision: currentMessage.revision,
            expectedSourceRevision: freshArtifact.sourceRevision,
          },
        });
        const latest = (await conversation.listMessages(projectId, session.id)).at(-1) ?? sourceMessage;
        const controller = new AbortController();
        await createRpgChoicesMessage({
          sessionId: session.id,
          parentMessageId: latest.id,
          signal: controller.signal,
        });
      } else if (freshArtifact.targetStore === "chapters") {
        const closedCandidateId = exactClosedCandidateId(sourceMessage);
        const requestMessage = sourceMessage.parentMessageId
          ? await repository.get<ConversationMessage>("conversationMessages", sourceMessage.parentMessageId)
          : null;
        const sourcePlan = await planConversationRequest({ content: requestMessage?.content ?? "" });
        const commit = async () => {
          const currentSession = await repository.get<ConversationSession>("conversationSessions", session.id);
          const currentMessage = await repository.get<ConversationMessage>("conversationMessages", sourceMessage.id);
          const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id);
          if (!currentSession || !currentMessage || !currentArtifact) {
            throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
          }
          return conversation.approveChapterArtifact({
            operationId: `conversation-approval:${freshArtifact.id}`,
            idempotencyKey: `conversation-approval:${freshArtifact.id}:${freshArtifact.candidateDigest}`,
            projectId,
            sessionId: session.id,
            artifactId: freshArtifact.id,
            sourceMessageId: sourceMessage.id,
            candidateDigest: freshArtifact.candidateDigest,
            targetRecordId: freshArtifact.targetRecordId,
            expectedSessionRevision: currentSession.revision,
            expectedArtifactRevision: currentArtifact.revision,
            expectedSourceMessageRevision: currentMessage.revision,
            expectedSourceRevision: freshArtifact.sourceRevision,
            applicationMode: approvalApplicationMode(sourcePlan),
          });
        };
        if (closedCandidateId && editedContent === undefined) {
          await approveStudioClosedAgentCandidate({
            candidateId: closedCandidateId,
            canonicalCommit: async () => {
              const result = await commit();
              return { commitId: result.approvalTransaction.operationId };
            },
          });
        } else {
          await commit();
        }
      } else if (freshArtifact.targetStore === "characters" || freshArtifact.targetStore === "worldRules") {
        const closedCandidateId = exactClosedCandidateId(sourceMessage);
        const targetStore = freshArtifact.targetStore;
        const current = await repository.get<Character | WorldRule>(
          targetStore,
          freshArtifact.targetRecordId,
        );
        const nextCanonicalRecord = buildConversationCanonicalReplacement({
          projectId,
          store: targetStore,
          targetRecordId: freshArtifact.targetRecordId,
          candidateContent: freshArtifact.candidateContent,
          current,
        });
        const currentSession = await repository.get<ConversationSession>("conversationSessions", session.id);
        const currentMessage = await repository.get<ConversationMessage>("conversationMessages", sourceMessage.id);
        const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id);
        if (!currentSession || !currentMessage || !currentArtifact) {
          throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
        }
        const commit = async () => conversation.approveArtifact({
          operationId: `conversation-approval:${freshArtifact.id}`,
          idempotencyKey: `conversation-approval:${freshArtifact.id}:${freshArtifact.candidateDigest}`,
          projectId,
          sessionId: session.id,
          artifactId: freshArtifact.id,
          sourceMessageId: sourceMessage.id,
          candidateDigest: freshArtifact.candidateDigest,
          targetStore,
          targetRecordId: freshArtifact.targetRecordId,
          expectedSessionRevision: currentSession.revision,
          expectedArtifactRevision: currentArtifact.revision,
          expectedSourceMessageRevision: currentMessage.revision,
          expectedSourceRevision: freshArtifact.sourceRevision,
          applicationMode: "record_replace",
          nextCanonicalRecord,
        });
        if (closedCandidateId && editedContent === undefined) {
          await approveStudioClosedAgentCandidate({
            candidateId: closedCandidateId,
            canonicalCommit: async () => {
              const result = await commit();
              return { commitId: result.approvalTransaction.operationId };
            },
          });
        } else {
          await commit();
        }
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
      setSafeError({ code: approvalErrorCode(error), message: approvalErrorMessage(error) });
      await loadWorkspace(sessionId).catch(() => undefined);
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
      if (artifact.artifactType === "learning_rule") {
        const learning = await getLearningCoordinator();
        await learning.rollbackPendingApproval(projectId, artifact.targetRecordId);
      }
      const currentArtifact = await repository.get<ConversationArtifact>(
        "conversationArtifacts",
        artifact.id,
      );
      if (!currentArtifact || currentArtifact.status !== "candidate") {
        throw Object.assign(new Error("Conversation artifact is no longer rejectable."), {
          code: "CONVERSATION_ARTIFACT_STALE",
        });
      }
      const source = await repository.get<ConversationMessage>(
        "conversationMessages",
        artifact.sourceMessageId,
      );
      const closedCandidateId = source ? exactClosedCandidateId(source) : null;
      await conversation.rejectArtifact(
        projectId,
        sessionId,
        currentArtifact.id,
        currentArtifact.revision,
      );
      if (closedCandidateId) {
        await rejectStudioClosedAgentCandidate(closedCandidateId).catch(() => undefined);
      }
      await refreshSession(sessionId);
    } catch (error) {
      setSafeError({ code: approvalErrorCode(error), message: approvalErrorMessage(error) });
      await refreshSession(sessionId).catch(() => undefined);
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
