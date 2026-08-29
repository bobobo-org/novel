import { stableStringify } from "@/lib/novel-ai/closed-ai-cache";
import { conversationContentDigest } from "@/lib/novel-ai/conversation/approval-transaction";
import type { ConversationPlan } from "@/lib/novel-ai/conversation/planner";
import { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import type {
  Chapter,
  ConversationArtifact,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import type {
  ExternalAIProviderId,
  NovelAIExecutionMode,
} from "@/lib/novel-ai/providers/external/external-provider-contract";
import { generateExternalAIStream } from "@/lib/novel-ai/providers/external/external-provider-client";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import {
  artifactType,
  errorCode,
  targetStore,
} from "./conversation-workspace-support";
import {
  buildConversationExternalPrompt,
  CONVERSATION_EXTERNAL_AI_TOOL_ID,
} from "./external-ai";

export async function runConversationExternalAgent(input: {
  projectId: string;
  repository: NovelRepository;
  conversation: ConversationRepositoryService;
  currentChapter: Chapter | null;
  plan: ConversationPlan;
  sessionId: string;
  userMessage: ConversationMessage;
  providerId: ExternalAIProviderId;
  executionMode: Exclude<NovelAIExecutionMode, "closed-only">;
  signal: AbortSignal;
  onProgress: (message: string) => void;
  onProjectMessage: (message: ConversationMessage) => void;
  onOpenArtifact: (artifactId: string) => void;
}) {
  const plannedTargetStore = targetStore(input.plan);
  const chapterTarget = plannedTargetStore === "chapters" && input.currentChapter
    ? await input.repository.get<Chapter>("chapters", input.currentChapter.id)
    : null;
  if (plannedTargetStore === "chapters" && !chapterTarget) {
    throw Object.assign(new Error("找不到可供核准的目前章節；本次外來 AI 沒有送出。"), {
      code: "CONVERSATION_EXTERNAL_CHAPTER_TARGET_MISSING",
    });
  }
  const candidateTargetStore = chapterTarget ? "chapters" as const : "none" as const;
  const candidateTargetRecordId = chapterTarget?.id
    ?? `conversation-external-opinion:${input.sessionId}`;
  const candidateSourceRevision = chapterTarget?.revision ?? input.userMessage.revision;
  const prompt = buildConversationExternalPrompt({
    objective: input.userMessage.content,
    intent: input.plan.intent,
  });
  const systemInstruction = "你是小說寫作助理。只回傳供作者審閱的繁體中文候選內容；不得聲稱已修改正式作品，不得揭露思考過程，也不得假設未提供的角色、世界、章節或對話資料。";
  const contextDigest = await conversationContentDigest(stableStringify({
    schemaVersion: "conversation-external-ai-request-v1",
    executionMode: input.executionMode,
    providerId: input.providerId,
    prompt,
    systemInstruction,
  }));
  const taskId = `conversation-external-ai:task:${crypto.randomUUID()}`;
  let placeholder: ConversationMessage | null = null;
  let invocation: ConversationToolInvocation | null = null;
  let artifact: ConversationArtifact | null = null;
  let streamedText = "";
  let lastStreamFlushAt = 0;
  let streamFlushFailure: unknown = null;
  let streamFlushPromise = Promise.resolve();
  const assertExternalRunActive = () => {
    if (!input.signal.aborted) return;
    throw Object.assign(new Error("外來 AI 已由使用者取消，沒有建立候選。"), {
      code: "EXTERNAL_AI_CANCELLED",
    });
  };
  const flushVisibleExternalStream = (force = false) => {
    const content = streamedText;
    const message = placeholder;
    if (!message || !content || input.signal.aborted) return streamFlushPromise;
    const now = Date.now();
    if (!force && now - lastStreamFlushAt < 120) return streamFlushPromise;
    lastStreamFlushAt = now;
    streamFlushPromise = streamFlushPromise.then(async () => {
      assertExternalRunActive();
      const currentMessage = await input.repository.get<ConversationMessage>(
        "conversationMessages",
        message.id,
      );
      assertExternalRunActive();
      if (!currentMessage || currentMessage.status !== "streaming" || currentMessage.content === content) {
        return;
      }
      const visibleMessage = await input.conversation.updateMessageStatus({
        projectId: input.projectId,
        sessionId: input.sessionId,
        messageId: currentMessage.id,
        expectedRevision: currentMessage.revision,
        status: "streaming",
        content,
        candidateIds: currentMessage.candidateIds,
        toolInvocationIds: currentMessage.toolInvocationIds,
      });
      input.onProjectMessage(visibleMessage);
    }).catch((error) => {
      streamFlushFailure ??= error;
    });
    return streamFlushPromise;
  };
  try {
    assertExternalRunActive();
    placeholder = await input.conversation.appendMessage({
      projectId: input.projectId,
      sessionId: input.sessionId,
      role: "assistant",
      content: "",
      status: "streaming",
      parentMessageId: input.userMessage.id,
    });
    input.onProjectMessage(placeholder);
    assertExternalRunActive();
    invocation = await input.conversation.saveToolInvocation({
      projectId: input.projectId,
      sessionId: input.sessionId,
      messageId: placeholder.id,
      taskId,
      toolId: CONVERSATION_EXTERNAL_AI_TOOL_ID,
      taskType: input.plan.taskType ?? "assistant.general",
      inputDigest: input.plan.inputDigest,
      contextDigest,
      status: "running",
      actualExecutor: `external-api:${input.providerId}`,
      externalRequest: true,
      dataLeftDevice: true,
      canonicalMutationCount: 0,
      safeProgress: {
        stage: "external-generating",
        percent: 5,
        message: "已依本次同意連線到指定外來 AI；只會建立候選。",
      },
    });
    const result = await generateExternalAIStream({
      executionMode: input.executionMode,
      providerId: input.providerId,
      externalConsent: true,
      prompt,
      systemInstruction,
      maxOutputTokens: 4_000,
      temperature: 0.75,
    }, {
      signal: input.signal,
      onDelta: (delta, generatedTokenEvents) => {
        streamedText += delta;
        void flushVisibleExternalStream();
        input.onProgress(`指定外來 AI 正在建立候選 · 已收到 ${generatedTokenEvents.toLocaleString("zh-TW")} 個串流片段`);
      },
    });
    if (result.providerId !== input.providerId) {
      throw Object.assign(new Error("外來 AI 回傳的供應商身分與本次選擇不一致。"), {
        code: "CONVERSATION_EXTERNAL_PROVIDER_MISMATCH",
      });
    }
    streamedText = result.text;
    await flushVisibleExternalStream(true);
    if (streamFlushFailure) throw streamFlushFailure;
    assertExternalRunActive();
    artifact = await input.conversation.saveArtifact({
      projectId: input.projectId,
      sessionId: input.sessionId,
      sourceMessageId: placeholder.id,
      artifactType: artifactType(input.plan),
      targetStore: candidateTargetStore,
      targetRecordId: candidateTargetRecordId,
      sourceRevision: candidateSourceRevision,
      candidateContent: result.text,
    });
    assertExternalRunActive();
    const outputDigest = artifact.candidateDigest;
    const [currentPlaceholder, currentInvocation] = await Promise.all([
      input.repository.get<ConversationMessage>("conversationMessages", placeholder.id),
      input.repository.get<ConversationToolInvocation>("conversationToolInvocations", invocation.id),
    ]);
    if (!currentPlaceholder || currentPlaceholder.status !== "streaming") {
      throw new Error("CONVERSATION_EXTERNAL_MESSAGE_STALE");
    }
    if (!currentInvocation || currentInvocation.status !== "running") {
      throw new Error("CONVERSATION_EXTERNAL_INVOCATION_STALE");
    }
    // This is the final cancellation boundary. From here through the receipt
    // write, finalization is a non-interruptible persistence sequence: the
    // message/artifact lineage lands first and the completed receipt is the
    // last commit point. A later abort is therefore treated as arriving after
    // completion, never as a reason to reject the completed candidate.
    assertExternalRunActive();
    const message = await input.conversation.updateMessageStatus({
      projectId: input.projectId,
      sessionId: input.sessionId,
      messageId: currentPlaceholder.id,
      expectedRevision: currentPlaceholder.revision,
      status: "completed",
      content: result.text,
      candidateIds: currentPlaceholder.candidateIds,
      toolInvocationIds: currentPlaceholder.toolInvocationIds,
    });
    input.onProjectMessage(message);
    invocation = await input.conversation.updateToolInvocationStatus({
      projectId: input.projectId,
      sessionId: input.sessionId,
      invocationId: currentInvocation.id,
      expectedRevision: currentInvocation.revision,
      status: "completed",
      actualExecutor: `external-api:${input.providerId}`,
      modelId: result.modelId,
      modelDigest: null,
      contextDigest,
      executionReceipt: {
        receiptId: `conversation-external-receipt:${result.requestId}`,
        modelId: result.modelId,
        modelDigest: null,
        providerRunId: result.requestId,
        contextDigest,
        outputDigest,
        externalRequest: true,
        dataLeftDevice: true,
        latencyMs: result.elapsedMs,
      },
      externalRequest: true,
      dataLeftDevice: true,
      canonicalMutationCount: 0,
      safeProgress: {
        stage: "candidate",
        percent: 100,
        message: "外來 AI 候選已完成；等待作者核准，Canon 未修改。",
      },
    });
    input.onOpenArtifact(artifact.id);
    return { result, artifact, invocation, message };
  } catch (error) {
    const status = input.signal.aborted ? "cancelled" as const : "failed" as const;
    if (artifact) {
      const currentArtifact = await input.repository.get<ConversationArtifact>(
        "conversationArtifacts",
        artifact.id,
      );
      if (currentArtifact?.status === "candidate") {
        await input.conversation.rejectArtifact(
          input.projectId,
          input.sessionId,
          currentArtifact.id,
          currentArtifact.revision,
        ).catch(() => undefined);
      }
    }
    if (invocation) {
      const currentInvocation = await input.repository.get<ConversationToolInvocation>(
        "conversationToolInvocations",
        invocation.id,
      );
      if (currentInvocation && ["pending", "running"].includes(currentInvocation.status)) {
        await input.conversation.updateToolInvocationStatus({
          projectId: input.projectId,
          sessionId: input.sessionId,
          invocationId: currentInvocation.id,
          expectedRevision: currentInvocation.revision,
          status,
          actualExecutor: `external-api:${input.providerId}`,
          externalRequest: true,
          dataLeftDevice: true,
          canonicalMutationCount: 0,
          safeErrorCode: errorCode(error),
          safeProgress: {
            stage: status === "cancelled" ? "cancelled" : "failed",
            percent: 100,
            message: status === "cancelled"
              ? "已停止外來 AI；未完成內容與 Canon 均未修改。"
              : "指定外來 AI 沒有完成；未改用閉端 AI、其他供應商或規則後備。",
          },
        }).catch(() => undefined);
      }
    }
    if (placeholder) {
      const currentPlaceholder = await input.repository.get<ConversationMessage>(
        "conversationMessages",
        placeholder.id,
      );
      if (currentPlaceholder && ["pending", "streaming"].includes(currentPlaceholder.status)) {
        await input.conversation.updateMessageStatus({
          projectId: input.projectId,
          sessionId: input.sessionId,
          messageId: currentPlaceholder.id,
          expectedRevision: currentPlaceholder.revision,
          status,
          content: status === "cancelled"
            ? "外來 AI 已停止；沒有建立候選，Canon 維持原狀。"
            : "指定外來 AI 沒有完成；沒有建立候選，也沒有轉用其他來源。",
        }).catch(() => undefined);
      }
    }
    throw error;
  }
}
