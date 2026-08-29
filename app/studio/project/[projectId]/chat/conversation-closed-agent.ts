import type { ClosedAIBackendId } from "@/lib/novel-ai/closed-agent-os";
import {
  createClosedAgentFailureEvidence,
  serializeClosedAgentFailureEvidence,
} from "@/lib/novel-ai/closed-agent-os/safe-runtime-diagnostics";
import { buildConversationClosedAgentCacheOriginProof } from "@/lib/novel-ai/conversation/closed-agent-cache-origin-proof";
import {
  persistConversationClosedAgentFailure,
  requireConversationApprovalTarget,
} from "@/lib/novel-ai/conversation/closed-agent-finalization";
import { resolveConversationCanonicalTarget } from "@/lib/novel-ai/conversation/canonical-target";
import type { ConversationPlan } from "@/lib/novel-ai/conversation/planner";
import { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import type {
  Chapter,
  ConversationArtifact,
  ConversationAttachment,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import type { ManualLearningFileExtraction } from "@/lib/novel-ai/web/manual-learning-import-preparation";
import {
  executeStudioClosedAgent,
  rejectStudioClosedAgentCandidate,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import { createExplicitRegenerationContract } from "@/lib/novel-ai/web/explicit-regeneration";
import {
  hasExplicitLocalComputeAuthorization,
  resolveStudioClosedComputePolicy,
} from "@/lib/novel-ai/web/studio-closed-compute-policy";
import { toExecutionReceipt } from "./hooks/use-conversation-operation";
import {
  artifactType,
  errorCode,
  MAX_TRANSIENT_ATTACHMENT_CONTEXT,
  progressLabel,
  targetStore,
} from "./conversation-workspace-support";

export type ConversationClosedAgentRegeneration = {
  source: ConversationMessage;
  taskId: string;
  placeholderId: string;
  preferredBackend: ClosedAIBackendId;
  sourceCandidateId: string;
  sourceTaskId: string;
  sourceCandidateDigest: string;
  regenerationAttempt: number;
};

export async function runConversationClosedAgent(input: {
  projectId: string;
  repository: NovelRepository;
  conversation: ConversationRepositoryService;
  currentChapter: Chapter | null;
  plan: ConversationPlan;
  sessionId: string;
  userMessage: ConversationMessage;
  preparedAttachments: Array<{
    record: ConversationAttachment;
    extraction: ManualLearningFileExtraction;
  }>;
  signal: AbortSignal;
  regeneration?: ConversationClosedAgentRegeneration;
  ensureSharedLearningReady: (signal: AbortSignal) => Promise<unknown>;
  onProgress: (message: string) => void;
  onOpenArtifact: (artifactId: string) => void;
}) {
  const placeholder = input.regeneration
    ? await input.repository.get<ConversationMessage>(
        "conversationMessages",
        input.regeneration.placeholderId,
      )
    : await input.conversation.appendMessage({
        projectId: input.projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        parentMessageId: input.userMessage.id,
      });
  if (!placeholder) throw new Error("CONVERSATION_ASSISTANT_PLACEHOLDER_MISSING");
  const taskId = input.regeneration?.taskId ?? `conversation-agent:${crypto.randomUUID()}`;
  let invocation: ConversationToolInvocation | null = null;
  let closedCandidateId: string | null = null;
  let artifact: ConversationArtifact | null = null;
  try {
    invocation = await input.conversation.saveToolInvocation({
      projectId: input.projectId,
      sessionId: input.sessionId,
      messageId: placeholder.id,
      taskId,
      toolId: CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan,
      taskType: input.plan.taskType ?? "assistant.general",
      inputDigest: input.plan.inputDigest,
      contextDigest: input.plan.planDigest,
      status: "running",
      canonicalMutationCount: 0,
      safeProgress: { stage: "planning", percent: 10, message: "已辨識自然語言任務" },
    });
    const plannedTargetStore = targetStore(input.plan);
    const resolvedCanonicalTarget = plannedTargetStore === "characters" || plannedTargetStore === "worldRules"
      ? await resolveConversationCanonicalTarget({
          repository: input.repository,
          projectId: input.projectId,
          store: plannedTargetStore,
          objective: input.plan.objective,
        })
      : null;
    const resolvedChapterTarget = input.currentChapter
      ? await input.repository.get<Chapter>("chapters", input.currentChapter.id)
      : null;
    const approvalTarget = requireConversationApprovalTarget({
      approvalRequired: input.plan.approvalRequired,
      targetStore: plannedTargetStore,
      projectId: input.projectId,
      chapter: resolvedChapterTarget,
      canonicalTarget: resolvedCanonicalTarget,
    });
    const previousDigest = input.regeneration?.sourceCandidateDigest;
    await input.ensureSharedLearningReady(input.signal);
    const automaticComputePolicy = input.regeneration?.preferredBackend === "local-ollama"
      ? "quality-first"
      : resolveStudioClosedComputePolicy();
    const result = await executeStudioClosedAgent({
      projectId: input.projectId,
      taskType: input.plan.taskType ?? "assistant.general",
      objective: input.plan.objective,
      taskId,
      sourceChapterId: resolvedCanonicalTarget?.targetRecordId
        ?? resolvedChapterTarget?.id,
      sourceRevision: resolvedCanonicalTarget?.sourceRevision
        ?? resolvedChapterTarget?.revision,
      conversationSessionId: input.sessionId,
      conversationRecentMessageLimit: 12,
      selectedAttachmentSummaries: input.preparedAttachments.map(({ record, extraction }) => ({
        attachmentId: record.id,
        recordRevision: record.revision,
        summary: extraction.text.slice(0, MAX_TRANSIENT_ATTACHMENT_CONTEXT),
        contentDigest: extraction.contentHash,
      })),
      regeneration: previousDigest
        ? createExplicitRegenerationContract({
            previousCandidateId: input.regeneration!.sourceCandidateId,
            previousTaskId: input.regeneration!.sourceTaskId,
            previousCandidateDigest: previousDigest,
            regenerationAttempt: input.regeneration!.regenerationAttempt,
            extraRequirement: "建立新的 taskId 與候選，不覆蓋原訊息；保持 Canon 不變。",
          })
        : undefined,
      preferredBackend: previousDigest
        ? input.regeneration?.preferredBackend
        : undefined,
      browserComputePolicy: automaticComputePolicy,
      allowPreAuthorizedClosedEscalation: hasExplicitLocalComputeAuthorization(automaticComputePolicy),
      signal: input.signal,
      onProgress: (event) => input.onProgress(progressLabel(event)),
    });
    closedCandidateId = result.candidate.id;
    if (input.signal.aborted) {
      throw Object.assign(new Error("Conversation generation cancelled."), {
        code: "CONVERSATION_CANCELLED",
      });
    }
    if (
      result.candidate.canonicalMutationCount !== 0
      || result.candidate.externalRequest
      || result.candidate.dataLeftDevice
    ) {
      throw Object.assign(new Error("模型回覆越過候選或裝置邊界。"), {
        code: "CONVERSATION_CANDIDATE_BOUNDARY_VIOLATION",
      });
    }
    for (const execution of result.toolExecutions ?? []) {
      await input.conversation.saveToolInvocation({
        projectId: input.projectId,
        sessionId: input.sessionId,
        messageId: placeholder.id,
        invocationId: `conversation-agent-tool:${input.sessionId}:${execution.receiptId}`,
        taskId: execution.taskId,
        toolId: execution.toolId,
        taskType: execution.taskType,
        inputDigest: execution.inputDigest,
        contextDigest: execution.contextDigest,
        status: "completed",
        actualExecutor: execution.actualExecutor,
        modelId: null,
        modelDigest: null,
        executionReceipt: {
          receiptId: execution.receiptId,
          modelId: null,
          modelDigest: null,
          providerRunId: null,
          contextDigest: execution.contextDigest,
          outputDigest: execution.outputDigest,
          externalRequest: false,
          dataLeftDevice: false,
          latencyMs: execution.latencyMs,
        },
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: {
          stage: execution.cacheHit ? "tool-cache" : "tool-completed",
          percent: 100,
          message: `${execution.toolId} 已完成。`,
        },
      });
    }
    const completedExecutionReceipt = toExecutionReceipt({
      taskId: result.candidate.taskId,
      modelId: result.candidate.modelId,
      modelDigest: result.candidate.modelDigest,
      contextDigest: result.candidate.contextDigest ?? invocation.contextDigest,
      outputDigest: result.candidate.contentDigest,
      externalRequest: false,
      dataLeftDevice: false,
      receipt: result.candidate.executionReceipt,
      closedAgentProof: {
        schemaVersion: result.candidate.schemaVersion,
        backendId: result.candidate.backendId,
        normalizationReceiptId: result.candidate.traditionalChineseNormalization.receiptId,
        traditionalChineseNormalizerVersion:
          result.candidate.traditionalChineseNormalization.normalizerVersion,
        cacheOrigin: await buildConversationClosedAgentCacheOriginProof(result.candidate),
      },
    });
    if (approvalTarget) {
      artifact = await input.conversation.saveArtifact({
        projectId: input.projectId,
        sessionId: input.sessionId,
        sourceMessageId: placeholder.id,
        artifactType: artifactType(input.plan),
        targetStore: approvalTarget.targetStore,
        targetRecordId: approvalTarget.targetRecordId,
        sourceRevision: approvalTarget.sourceRevision,
        candidateContent: result.candidate.content,
      });
    }
    const currentPlaceholder = await input.repository.get<ConversationMessage>(
      "conversationMessages",
      placeholder.id,
    );
    if (!currentPlaceholder) throw new Error("CONVERSATION_MESSAGE_MISSING");
    if (input.signal.aborted) {
      throw Object.assign(new Error("Conversation generation cancelled."), {
        code: "CONVERSATION_CANCELLED",
      });
    }
    const primaryInvocation = invocation;
    if (!primaryInvocation) throw new Error("CONVERSATION_TOOL_INVOCATION_MISSING");
    const completeInvocation = () => input.conversation.updateToolInvocationStatus({
      projectId: input.projectId,
      sessionId: input.sessionId,
      invocationId: primaryInvocation.id,
      expectedRevision: primaryInvocation.revision,
      status: "completed",
      actualExecutor: result.candidate.actualExecutor,
      modelId: result.candidate.modelId,
      modelDigest: result.candidate.modelDigest,
      executionReceipt: completedExecutionReceipt,
      externalRequest: false,
      dataLeftDevice: false,
      canonicalMutationCount: 0,
      safeProgress: { stage: "candidate", percent: 100, message: "候選已完成，Canon 未修改" },
    });
    const completedMessage = await input.conversation.updateMessageStatus({
      projectId: input.projectId,
      sessionId: input.sessionId,
      messageId: currentPlaceholder.id,
      expectedRevision: currentPlaceholder.revision,
      status: "completed",
      content: result.candidate.content,
      candidateIds: [...currentPlaceholder.candidateIds, result.candidate.id],
      toolInvocationIds: currentPlaceholder.toolInvocationIds,
    });
    invocation = await completeInvocation();
    if (artifact) input.onOpenArtifact(artifact.id);
    return { result, artifact, invocation, message: completedMessage };
  } catch (error) {
    const cancelled = input.signal.aborted;
    const failureEvidence = cancelled ? null : createClosedAgentFailureEvidence(error);
    const persistedSafeCode = failureEvidence?.safeCode ?? errorCode(error);
    const persistedFailureEvidence = failureEvidence
      ? serializeClosedAgentFailureEvidence(failureEvidence)
      : "";
    await persistConversationClosedAgentFailure({
      repository: input.repository,
      conversation: input.conversation,
      projectId: input.projectId,
      sessionId: input.sessionId,
      placeholderId: placeholder.id,
      invocationId: invocation?.id ?? null,
      artifactId: artifact?.id ?? null,
      closedCandidateId,
      cancelled,
      safeCode: persistedSafeCode,
      serializedFailureEvidence: persistedFailureEvidence,
      rejectClosedCandidate: rejectStudioClosedAgentCandidate,
    });
    if (!failureEvidence) throw error;
    throw Object.assign(
      new Error("本機閉端 AI 已安全停止；未完成內容與 Canon 均未修改。"),
      { code: failureEvidence.safeCode },
    );
  }
}
