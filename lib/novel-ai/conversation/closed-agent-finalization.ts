import type {
  Chapter,
  ConversationArtifact,
  ConversationMessage,
  ConversationToolInvocation,
} from "../domain";
import type { NovelRepository } from "../repository";
import { CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE } from "../closed-agent-os/safe-runtime-diagnostics";
import type { ConversationRepositoryService } from "./repository";
import type { ResolvedConversationCanonicalTarget } from "./canonical-target";

export function requireConversationApprovalTarget(input: {
  approvalRequired: boolean;
  targetStore: ConversationArtifact["targetStore"];
  projectId: string;
  chapter: Chapter | null;
  canonicalTarget: ResolvedConversationCanonicalTarget | null;
}) {
  if (!input.approvalRequired) return null;
  const targetRecordId = input.targetStore === "chapters"
    ? input.chapter?.id ?? ""
    : input.canonicalTarget?.targetRecordId ?? "";
  const sourceRevision = input.targetStore === "chapters"
    ? input.chapter?.revision ?? -1
    : input.canonicalTarget?.sourceRevision ?? -1;
  if (
    input.targetStore === "none"
    || input.targetStore === "controlledLearning"
    || (
      input.targetStore === "chapters"
      && (
        input.chapter?.projectId !== input.projectId
        || Boolean(input.chapter?.deletedAt)
      )
    )
    || !targetRecordId
    || !Number.isSafeInteger(sourceRevision)
    || sourceRevision < 0
  ) {
    throw Object.assign(new Error("The approval target is unavailable."), {
      code: "CONVERSATION_APPROVAL_TARGET_MISSING",
    });
  }
  return { targetStore: input.targetStore, targetRecordId, sourceRevision };
}

export async function persistConversationClosedAgentFailure(input: {
  repository: NovelRepository;
  conversation: ConversationRepositoryService;
  projectId: string;
  sessionId: string;
  placeholderId: string;
  invocationId: string | null;
  artifactId: string | null;
  closedCandidateId: string | null;
  cancelled: boolean;
  safeCode: string;
  serializedFailureEvidence: string;
  rejectClosedCandidate: (candidateId: string) => Promise<unknown>;
}) {
  let persistenceFailed = false;
  const currentMessage = await input.repository.get<ConversationMessage>(
    "conversationMessages",
    input.placeholderId,
  );
  if (currentMessage && ["pending", "streaming"].includes(currentMessage.status)) {
    await input.conversation.updateMessageStatus({
      projectId: input.projectId,
      sessionId: input.sessionId,
      messageId: currentMessage.id,
      expectedRevision: currentMessage.revision,
      status: input.cancelled ? "cancelled" : "failed",
      content: `這次執行沒有完成：${input.safeCode}。Canon 維持原狀。`,
    }).catch(() => {
      persistenceFailed = true;
    });
  }

  const currentInvocation = input.invocationId
    ? await input.repository.get<ConversationToolInvocation>(
        "conversationToolInvocations",
        input.invocationId,
      )
    : null;
  if (currentInvocation && ["pending", "running"].includes(currentInvocation.status)) {
    await input.conversation.updateToolInvocationStatus({
      projectId: input.projectId,
      sessionId: input.sessionId,
      invocationId: currentInvocation.id,
      expectedRevision: currentInvocation.revision,
      status: input.cancelled ? "cancelled" : "failed",
      safeErrorCode: input.safeCode,
      canonicalMutationCount: 0,
      ...(input.serializedFailureEvidence
        ? {
            safeProgress: {
              stage: CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE,
              percent: 100,
              message: input.serializedFailureEvidence,
            },
          }
        : {}),
    }).catch(() => {
      persistenceFailed = true;
    });
  }

  if (input.artifactId) {
    const currentArtifact = await input.repository.get<ConversationArtifact>(
      "conversationArtifacts",
      input.artifactId,
    );
    if (currentArtifact?.status === "candidate") {
      await input.conversation.rejectArtifact(
        input.projectId,
        input.sessionId,
        currentArtifact.id,
        currentArtifact.revision,
      ).catch(() => {
        persistenceFailed = true;
      });
    }
  }

  if (input.closedCandidateId) {
    await input.rejectClosedCandidate(input.closedCandidateId).catch(() => {
      persistenceFailed = true;
    });
  }
  if (persistenceFailed) {
    throw Object.assign(
      new Error("本機失敗證據未能安全保存；Canon 維持原狀。"),
      { code: "CLOSED_AGENT_FAILURE_EVIDENCE_PERSIST_FAILED" },
    );
  }
}
