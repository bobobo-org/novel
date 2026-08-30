"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ConversationArtifact,
  type ConversationAttachment,
  type ConversationMessage,
  type ConversationSession,
  type ConversationSummary,
  type ConversationToolInvocation,
  type LearningImportSession,
  type StoryState,
} from "@/lib/novel-ai/domain";
import {
  resolveStoryPlayMode,
} from "@/lib/novel-ai/domain/play-mode";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  createProjectBackup,
  markdownDownload,
} from "@/lib/novel-ai/repository/backup";
import { createSovereignLearningRepository } from "@/lib/novel-ai/sovereign-learning";
import { conversationContentDigest } from "@/lib/novel-ai/conversation/approval-transaction";
import { stableStringify } from "@/lib/novel-ai/closed-ai-cache";
import type { AtomicLearningImportCoordinator } from "@/lib/novel-ai/conversation/learning-import";
import {
  planConversationRequest,
  type ConversationPlan,
} from "@/lib/novel-ai/conversation/planner";
import {
  CONVERSATION_LOCAL_TOOL_IDS,
} from "@/lib/novel-ai/conversation/tool-registry";
import {
  ConversationRepositoryService,
} from "@/lib/novel-ai/conversation/repository";
import type { ManualLearningFileExtraction } from "@/lib/novel-ai/web/manual-learning-import-preparation";
import {
  buildRpgChatCustomAction,
  loadLearningAwareRpgChatSnapshot,
  parseRpgChoiceSelection,
} from "@/lib/novel-ai/web/rpg-chat-turn";
import { ConversationWorkspaceView } from "./components/conversation-workspace-view";
import { useConversationSessionController } from "./hooks/use-conversation-session";
import { useConversationBranchController } from "./hooks/use-conversation-branch";
import { useConversationAttachmentController } from "./hooks/use-conversation-attachments";
import { useConversationApprovalController } from "./hooks/use-conversation-approval";
import {
  inspectRpgChoiceTurn,
  rpgUserMessageMatchesChoice,
  useConversationRpgController,
} from "./hooks/use-conversation-rpg";
import {
  resolveRpgExecutionSourceBlock,
  type RpgExecutionSourceSnapshot,
} from "./hooks/rpg-execution-source-gate";
import { useConversationLearningCoordinatorLoader } from "./hooks/use-conversation-learning-loader";
import {
  acquireConversationLease,
  createConversationRequestCompletion,
  toExecutionReceipt,
  useConversationOperationController,
} from "./hooks/use-conversation-operation";
import { useClosedAiBootstrap } from "./hooks/use-closed-ai-bootstrap";
import { useSharedLearningSync } from "./hooks/use-shared-learning-sync";
import { useConversationSummaryController } from "./hooks/use-conversation-summary";
import { useConversationExternalAiController } from "./hooks/use-conversation-external-ai";
import {
  artifactStory,
} from "./components/conversation-presentation";
import type {
  ArtifactView,
  ConversationMessageActions,
  DrawerPayload,
} from "./components/conversation-types";
import {
  errorCode,
  errorMessage,
  type ExistingUserRequest,
  latestRpgChoicesFrom,
  resolveArtifactBefore,
} from "./conversation-workspace-support";
import { isClosedAiTaskRoutable } from "./closed-ai-task-readiness";
import type { PlatformTaskType } from "@/lib/novel-ai/router/platform-types";
import { runConversationExternalAgent } from "./conversation-external-agent";
import { runConversationClosedAgent } from "./conversation-closed-agent";

export default function ConversationWorkspace({
  projectId,
  initialPrompt,
  initialTaskType,
}: {
  projectId: string;
  initialPrompt: string;
  initialTaskType: PlatformTaskType | null;
}) {
  const repository = useMemo(() => createNovelRepository(), []);
  const learningRepository = useMemo(
    () => createSovereignLearningRepository(),
    [],
  );
  const conversation = useMemo(
    () => new ConversationRepositoryService(repository, learningRepository),
    [learningRepository, repository],
  );
  const getLearningCoordinator = useConversationLearningCoordinatorLoader(
    repository,
    learningRepository,
  );
  const ensureSharedLearningReady = useSharedLearningSync(projectId, learningRepository);
  const { currentCanonRevisionDigest, maybeUpdateRollingSummary } = useConversationSummaryController({
    projectId,
    repository,
    conversation,
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [progress, setProgress] = useState("正在讀取作品對話。");
  const [safeError, setSafeError] = useState<{ code: string; message: string } | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [retryLabel, setRetryLabel] = useState("重試");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [dashboardOpenRequest, setDashboardOpenRequest] = useState(0);
  const [sourceControlsCollapseSignal, setSourceControlsCollapseSignal] = useState(0);
  const [drawer, setDrawer] = useState<DrawerPayload>(null);
  const [artifactDraft, setArtifactDraft] = useState("");
  const [artifactView, setArtifactView] = useState<"candidate" | "diff" | "comparison">("candidate");
  const [artifactBefore, setArtifactBefore] = useState("");
  const clearExternalSelectionError = useCallback(() => setSafeError(null), []);
  const {
    aiExecutionMode,
    hybridAiSource,
    externalProviderId,
    externalProviderStatuses,
    externalProviderStatusError,
    externalExecutionEnabled,
    externalRunConsent,
    externalSelected,
    externalProviderConfigured,
    setExternalRunConsent,
    clearExternalRunConsent,
    consumeExternalRunConsentIntent,
    changeAiExecutionMode,
    changeHybridAiSource,
    changeExternalProvider,
  } = useConversationExternalAiController(clearExternalSelectionError);
  const rpgExecutionSourceSnapshot = {
    externalSelected,
    publicExecutionEnabled: externalExecutionEnabled,
    providerConfigured: externalProviderConfigured,
    providerStatusError: externalProviderStatusError,
    singleRunConsentGranted: externalRunConsent,
    externalExecutionModeSelected: aiExecutionMode !== "closed-only",
  } satisfies RpgExecutionSourceSnapshot;
  const {
    closedAiSetup,
    closedAiSetupProgress,
    closedAiSetupBusy,
    closedAiSetupError,
    closedAiSetupLifecycle,
    prepareClosedAi,
    cancelClosedAiSetup,
    resolveRegenerationBackend,
  } = useClosedAiBootstrap(projectId);
  const closedAiRegenerationReady = Boolean(
    !closedAiSetupBusy
    && isClosedAiTaskRoutable(closedAiSetup),
  );
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const operationLockRef = useRef(false);
  const retryActionRef = useRef<(() => void) | null>(null);
  const initialPromptUsed = useRef(false);
  const initialPromptSenderRef = useRef<(
    contentOverride?: string,
    onAccepted?: () => void,
    existingUserRequest?: ExistingUserRequest,
    requestedTaskType?: PlatformTaskType | null,
  ) => Promise<void>>(async () => undefined);
  const operationLocked = useCallback(() => operationLockRef.current, []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const collapseSourceControlsAfterRpgStart = useCallback(() => {
    setSourceControlsCollapseSignal((value) => value + 1);
  }, []);

  const {
    project,
    storyBible,
    storyState,
    characters,
    relationships,
    worlds,
    activeSessionId,
    messages,
    artifacts,
    invocations,
    attachments,
    search,
    showArchived,
    loading,
    switchingSessionId,
    queuedSessionId,
    currentChapter,
    activeSession,
    visibleSessions,
    setSearch,
    setShowArchived,
    setStoryState,
    loadWorkspace,
    refreshSession,
    projectMessageIntoActiveSession,
    chooseSession: switchSession,
    beginSessionIntent,
    queueSessionIntent,
    completeBranchNavigation,
  } = useConversationSessionController({
    projectId,
    repository,
    learningRepository,
    conversation,
    getLearningCoordinator,
    operationLocked,
    onProgress: setProgress,
    onError: setSafeError,
    onSidebarClose: closeSidebar,
  });
  const fixedPlayMode = storyState ? resolveStoryPlayMode(storyState) : null;
  const {
    pendingMessageIds: branchPendingMessageIds,
    isBranchPending,
    editMessage,
    editDialog,
    updateEditDraft,
    cancelEditMessage,
    confirmEditMessage,
  } = useConversationBranchController({
    projectId,
    conversation,
    activeSession,
    busy,
    operationLockRef,
    setBusy,
    beginSessionIntent,
    completeBranchNavigation,
    onProgress: setProgress,
    onError: setSafeError,
  });
  const { runDeterministicConversationTool } = useConversationOperationController({
    projectId,
    repository,
    conversation,
  });
  const {
    localAttachments,
    rightsConfirmed,
    setRightsConfirmed,
    onFilesSelected,
    updateLocalAttachment,
    retryLocalAttachment,
    removeLocalAttachment,
    resetLocalAttachments,
    clearTransientAttachments,
    prepareLocalAttachments,
  } = useConversationAttachmentController({
    projectId,
    repository,
    runDeterministicConversationTool,
    onError: setSafeError,
  });
  const {
    createRpgChoicesMessage,
    executeRpgChoice,
    chooseRpgOption,
    recoverRpgChoices,
    requestRpgChoiceFallback,
    rpgChoicePlanning,
  } = useConversationRpgController({
    projectId,
    repository,
    learningRepository,
    ensureSharedLearningReady,
    conversation,
    activeSession,
    busy,
    executionSourceSnapshot: rpgExecutionSourceSnapshot,
    externalProviderId,
    externalExecutionMode: aiExecutionMode,
    consumeExternalRunConsentIntent,
    operationLockRef,
    retryActionRef,
    runRef,
    abortRef,
    acquireLease: acquireConversationLease,
    maybeUpdateRollingSummary,
    loadWorkspace,
    setRetryAvailable,
    setRetryLabel,
    setCancellable,
    setBusy,
    setSafeError,
    setProgress,
    setDrawer,
    onRpgGenerationStarted: collapseSourceControlsAfterRpgStart,
  });
  const { approveArtifact, rejectArtifact } = useConversationApprovalController({
    projectId,
    repository,
    learningRepository,
    conversation,
    getLearningCoordinator,
    activeSession,
    busy,
    operationLockRef,
    retryActionRef,
    acquireLease: acquireConversationLease,
    currentCanonRevisionDigest,
    createRpgChoicesMessage,
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
  });

  initialPromptSenderRef.current = sendRequest;

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => () => abortRef.current?.abort("CONVERSATION_UNMOUNTED"), []);

  const latestRpgChoices = latestRpgChoicesFrom(messages);

  async function chooseSession(sessionId: string) {
    if (isBranchPending()) {
      queueSessionIntent(sessionId);
      setSafeError(null);
      return;
    }
    await switchSession(sessionId, busy);
  }

  async function newSession() {
    if (busy || !project) return;
    const created = await conversation.createSession({
      projectId,
      title: "新對話",
      activeChapterId: currentChapter?.id ?? null,
    });
    await loadWorkspace(created.id);
    setSidebarOpen(false);
  }

  async function renameSession(session: ConversationSession) {
    const title = window.prompt("重新命名這個對話", session.title)?.trim();
    if (!title || title === session.title) return;
    await conversation.renameSession(projectId, session.id, title, session.revision);
    await loadWorkspace(session.id);
  }

  async function archiveSession(session: ConversationSession) {
    if (!window.confirm(`封存「${session.title}」？對話會保留，可稍後顯示封存項目。`)) return;
    await conversation.archiveSession(projectId, session.id, session.revision);
    await loadWorkspace();
  }

  async function deleteSession(session: ConversationSession) {
    if (!window.confirm(`刪除「${session.title}」？這只刪除對話，不會刪除小說 Canon。`)) return;
    await conversation.deleteSession(projectId, session.id, session.revision);
    await loadWorkspace();
  }

  async function runRepositoryAction(input: {
    plan: ConversationPlan;
    sessionId: string;
    userMessage: ConversationMessage;
    signal: AbortSignal;
  }) {
    const action = input.plan.intent === "backup_create"
      ? {
          idPrefix: "conversation-backup-create",
          toolId: CONVERSATION_LOCAL_TOOL_IDS.backupCreate,
          taskType: "repository.backup.create",
          runningMessage: "正在建立本機完整備份",
          completedMessage: "本機備份已完成，Canon 未修改",
        }
      : input.plan.intent === "project_export"
        ? {
            idPrefix: "conversation-project-export",
            toolId: CONVERSATION_LOCAL_TOOL_IDS.projectExport,
            taskType: "repository.project.export",
            runningMessage: "正在從本機 Canon 建立 Markdown 匯出",
            completedMessage: "Markdown 匯出已完成，Canon 未修改",
          }
        : {
            idPrefix: "conversation-backup-restore-guide",
            toolId: CONVERSATION_LOCAL_TOOL_IDS.backupRestoreGuide,
            taskType: "repository.backup.restore-guide",
            runningMessage: "正在開啟備份回復說明",
            completedMessage: "備份回復說明已開啟，Canon 未修改",
          };
    return runDeterministicConversationTool({
      sessionId: input.sessionId,
      parentMessageId: input.userMessage.id,
      ...action,
      inputDigest: input.plan.inputDigest,
      contextDigest: input.plan.planDigest,
      actualExecutor: "browser-main-thread",
      signal: input.signal,
      execute: async () => {
        if (!project) throw new Error("CONVERSATION_PROJECT_NOT_FOUND");
        if (input.plan.intent === "backup_create") {
          const created = await createProjectBackup(repository, projectId, "full", {
            sovereignLearningRepository: learningRepository,
          });
          return {
            result: undefined,
            assistantContent: `已建立本機完整備份。語意雜湊：${created.payload.manifest.contentHash.slice(0, 16)}…`,
          };
        }
        if (input.plan.intent === "project_export") {
          const records = await repository.exportProject(projectId);
          markdownDownload(records, project.title);
          return {
            result: undefined,
            assistantContent: "作品已從本機 Canon 匯出為 Markdown；對話原始附件不在匯出內容中。",
          };
        }
        setDrawer({
          kind: "status",
          title: "回復備份",
          content: "回復會驗證 schema、語意雜湊、作品隔離與版本。請在進階備份工作區選擇檔案；驗證失敗時不會部分還原。",
        });
        setArtifactOpen(true);
        return {
          result: undefined,
          assistantContent: "已打開備份回復說明；正式回復仍需你選取備份檔並再次確認。",
        };
      },
    });
  }

  async function runDashboardQuery(input: {
    plan: ConversationPlan;
    sessionId: string;
    userMessage: ConversationMessage;
    signal: AbortSignal;
  }) {
    return runDeterministicConversationTool({
      sessionId: input.sessionId,
      parentMessageId: input.userMessage.id,
      idPrefix: "conversation-dashboard-query",
      toolId: CONVERSATION_LOCAL_TOOL_IDS.storyStateQuery,
      taskType: "repository.story-state.query",
      inputDigest: input.plan.inputDigest,
      contextDigest: input.plan.planDigest,
      actualExecutor: "browser-main-thread",
      runningMessage: "正在讀取本機 StoryState",
      completedMessage: "StoryState 查詢已完成，Canon 未修改",
      signal: input.signal,
      execute: async () => {
        const states = await repository.list<StoryState>("storyStates", projectId);
        const state = states.find((item) => item.id === project?.storyStateId) ?? states[0] ?? null;
        setDrawer(null);
        setArtifactOpen(false);
        if (state) {
          setStoryState(state);
          setDashboardOpenRequest((request) => request + 1);
        }
        return {
          result: undefined,
          assistantContent: state
            ? "完整狀態儀表板已展開；能力、人物關係、背包資源、任務與近期歷程都已依正式存檔整理。"
            : "目前作品尚未建立可顯示的狀態資料；故事與數值均未修改。",
        };
      },
    });
  }

  async function exportActiveConversationSummary() {
    if (!activeSession || busy || operationLockRef.current) return;
    const sessionId = activeSession.id;
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "另一個分頁正在執行這個對話，請稍後再試。",
      });
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setSafeError(null);
    setProgress("正在建立不含原始附件的本機對話摘要匯出…");
    try {
      await maybeUpdateRollingSummary(sessionId);
      const [session, sessionMessages, sessionSummaries] = await Promise.all([
        repository.get<ConversationSession>("conversationSessions", sessionId),
        conversation.listMessages(projectId, sessionId),
        repository.list<ConversationSummary>("conversationSummaries", projectId),
      ]);
      if (!session || session.projectId !== projectId) {
        throw new Error("CONVERSATION_SESSION_SCOPE_MISMATCH");
      }
      const summary = sessionSummaries
        .filter((item) => item.sessionId === sessionId && !item.invalidatedAt && !item.deletedAt)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
      const parentMessage = sessionMessages.at(-1) ?? null;
      const contextDigest = await conversationContentDigest(JSON.stringify({
        sessionId: session.id,
        sessionRevision: session.revision,
        summaryDigest: summary?.contentDigest ?? null,
        canonRevisionDigest: summary?.canonRevisionDigest ?? null,
      }));
      await runDeterministicConversationTool({
        sessionId,
        parentMessageId: parentMessage?.id ?? null,
        idPrefix: "conversation-summary-export",
        toolId: CONVERSATION_LOCAL_TOOL_IDS.sessionSummaryExport,
        taskType: "repository.conversation-summary.export",
        inputDigest: await conversationContentDigest(`conversation-summary-export:${session.id}:${session.revision}`),
        contextDigest,
        actualExecutor: "browser-main-thread",
        runningMessage: "正在建立安全的對話摘要 JSON",
        completedMessage: "對話摘要已匯出，Canon 未修改",
        signal: controller.signal,
        execute: async () => {
          const exported = JSON.stringify({
            schemaVersion: "conversation-summary-export-v1",
            projectId,
            session: {
              id: session.id,
              title: session.title,
              status: session.status,
              activeChapterId: session.activeChapterId,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              lastMessageAt: session.lastMessageAt,
            },
            summary: summary ? {
              content: summary.content,
              contentDigest: summary.contentDigest,
              canonRevisionDigest: summary.canonRevisionDigest,
              sourceMessageCount: summary.sourceMessageIds.length,
              updatedAt: summary.updatedAt,
            } : null,
            privacy: {
              fullMessageTranscriptIncluded: false,
              rawAttachmentsIncluded: false,
              credentialsIncluded: false,
              dataLeftDevice: false,
            },
          }, null, 2);
          const blobUrl = URL.createObjectURL(new Blob([exported], { type: "application/json;charset=utf-8" }));
          const anchor = document.createElement("a");
          anchor.href = blobUrl;
          anchor.download = `conversation-summary-${session.id}.json`;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
          return {
            result: undefined,
            assistantContent: summary
              ? "已匯出目前對話的安全滾動摘要與 Session metadata；不含完整逐字稿、附件內容或憑證。"
              : "目前尚無足夠內容建立滾動摘要；已匯出 Session metadata，且不含完整逐字稿、附件內容或憑證。",
            receiptOutput: exported,
          };
        },
      });
      setProgress("對話摘要已在本機匯出；Canon 未修改。");
      await loadWorkspace(sessionId);
    } catch (error) {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      await loadWorkspace(sessionId).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setBusy(false);
    }
  }

  async function runAtomicLearningImport(input: {
    sessionId: string;
    content: string;
    signal: AbortSignal;
  }) {
    const files = localAttachments.map((item) => item.file);
    const parserModelId = "manual-learning-local-parser-v1";
    const parserModelDigest = await conversationContentDigest(parserModelId);
    let started: Awaited<ReturnType<AtomicLearningImportCoordinator["start"]>> | null = null;
    let learning: AtomicLearningImportCoordinator | null = null;
    let userMessage: ConversationMessage | null = null;
    let assistant: ConversationMessage | null = null;
    let invocation: ConversationToolInvocation | null = null;
    let invocationCompleted = false;
    try {
      const last = (await conversation.listMessages(projectId, input.sessionId)).at(-1) ?? null;
      userMessage = await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        role: "user",
        content: input.content || "請把我附加且有權使用的作品做整份本機分析，建立學習規則候選。",
        parentMessageId: last?.id ?? null,
      });
      await maybeUpdateRollingSummary(input.sessionId);
      assistant = await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        parentMessageId: userMessage.id,
      });
      const taskId = `conversation-learning-import:${crypto.randomUUID()}`;
      invocation = await conversation.saveToolInvocation({
        projectId,
        sessionId: input.sessionId,
        messageId: assistant.id,
        taskId,
        toolId: CONVERSATION_LOCAL_TOOL_IDS.atomicLearningImport,
        taskType: "learning.import.atomic",
        inputDigest: userMessage.contentDigest,
        contextDigest: userMessage.contentDigest,
        status: "running",
        actualExecutor: "browser-worker",
        modelId: parserModelId,
        modelDigest: parserModelDigest,
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "starting", percent: 1, message: "正在建立本機整份匯入交易" },
      });
      learning = await getLearningCoordinator();
      started = await learning.start({
        projectId,
        sessionId: input.sessionId,
        files,
        rightsBasis: "owned_by_user",
        rightsEvidence: "conversation-explicit-owned-work",
        userConfirmedRights: rightsConfirmed,
        mode: "atomic_document",
        signal: input.signal,
      });
      userMessage = await repository.put<ConversationMessage>("conversationMessages", {
        ...userMessage,
        attachmentIds: started.attachments.map((attachment) => attachment.id),
      }, userMessage.revision);
      const processed = await learning.process({
        projectId,
        importSessionId: started.session.importSessionId,
        files,
        sourceKind: "personal_note",
        rightsBasis: "owned_by_user",
        rightsEvidence: "conversation-explicit-owned-work",
        userConfirmedRights: rightsConfirmed,
        signal: input.signal,
        onProgress: (event) => {
          const file = localAttachments[event.partIndex];
          if (file) {
            updateLocalAttachment(file.localId, {
              status: "parsing",
              progress: event.fileProgress ?? null,
            });
          }
          setProgress(`整份匯入 · ${event.phase} · ${Math.max(1, event.partIndex + 1)}/${event.partCount}`);
        },
      });
      if (processed.session.status !== "ready_to_finalize") {
        throw Object.assign(new Error("整份文件尚未完整通過，沒有正式匯入任何 Learning Source。"), {
          code: "LEARNING_IMPORT_NOT_READY_TO_FINALIZE",
        });
      }
      if (!assistant || !invocation) throw new Error("LEARNING_IMPORT_TOOL_INVOCATION_MISSING");
      const assistantContent = "整份文件已完成本機分析。抽象學習規則仍是候選；請查看結果並按下採用後，才會原子寫入正式學習庫。原文與 ArrayBuffer 已釋放。";
      const candidateContent = JSON.stringify({
        schemaVersion: "conversation-learning-import-candidate-v1",
        importSessionId: processed.session.importSessionId,
        manifestDigest: processed.session.manifestDigest,
        totalParts: processed.session.totalParts,
        completedParts: processed.session.completedParts,
        globalSynthesis: processed.globalSynthesis,
        rawContentRetained: false,
        dataLeftDevice: false,
      });
      const candidateDigest = await conversationContentDigest(candidateContent);
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: "browser-worker",
        modelId: parserModelId,
        modelDigest: parserModelDigest,
        executionReceipt: toExecutionReceipt({
          taskId: invocation.taskId,
          modelId: parserModelId,
          modelDigest: parserModelDigest,
          contextDigest: invocation.contextDigest,
          outputDigest: candidateDigest,
          externalRequest: false,
          dataLeftDevice: false,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "candidate", percent: 100, message: "全卷抽象規則候選已完成" },
      });
      invocationCompleted = true;
      const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
      if (!currentAssistant) throw new Error("CONVERSATION_MESSAGE_MISSING");
      assistant = await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: currentAssistant.id,
        expectedRevision: currentAssistant.revision,
        status: "completed",
        content: assistantContent,
        toolInvocationIds: currentAssistant.toolInvocationIds,
      });
      const artifact = await conversation.saveArtifact({
        projectId,
        sessionId: input.sessionId,
        sourceMessageId: assistant.id,
        artifactType: "learning_rule",
        targetStore: "learningImportSessions",
        targetRecordId: processed.session.importSessionId,
        sourceRevision: processed.session.revision,
        candidateContent,
      });
      setDrawer({ kind: "artifact", artifactId: artifact.id });
      setArtifactOpen(true);
      resetLocalAttachments();
      setRightsConfirmed(false);
    } catch (error) {
      if (assistant) {
        const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
        if (currentAssistant && ["pending", "streaming"].includes(currentAssistant.status)) {
          await conversation.updateMessageStatus({
            projectId,
            sessionId: input.sessionId,
            messageId: currentAssistant.id,
            expectedRevision: currentAssistant.revision,
            status: input.signal.aborted ? "cancelled" : "failed",
            content: `附件匯入未完成：${errorCode(error)}`,
          }).catch(() => undefined);
        }
      }
      if (invocation && !invocationCompleted) {
        await conversation.updateToolInvocationStatus({
          projectId,
          sessionId: input.sessionId,
          invocationId: invocation.id,
          expectedRevision: invocation.revision,
          status: input.signal.aborted ? "cancelled" : "failed",
          safeErrorCode: errorCode(error),
          canonicalMutationCount: 0,
        }).catch(() => undefined);
      }
      const importSession = started
        ? await repository.get<LearningImportSession>(
          "learningImportSessions",
          started.session.importSessionId,
        )
        : null;
      if (importSession && ["cancelled", "failed"].includes(importSession.status)) {
        retryActionRef.current = () => {
          void resumeAtomicLearningImport({
            sessionId: input.sessionId,
            importSessionId: importSession.importSessionId,
            files,
          });
        };
        setRetryAvailable(true);
        setRetryLabel("繼續匯入（Resume）");
      } else {
        if (started && learning) {
          await learning.rollback(projectId, started.session.importSessionId).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async function resumeAtomicLearningImport(input: {
    sessionId: string;
    importSessionId: string;
    files: File[];
  }) {
    const parserModelId = "manual-learning-local-parser-v1";
    const parserModelDigest = await conversationContentDigest(parserModelId);
    if (busy || operationLockRef.current) return;
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, input.sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({ code: "CONVERSATION_OPERATION_ALREADY_RUNNING", message: "另一個分頁正在執行這個對話，請稍後再試。" });
      return;
    }
    const runId = runRef.current + 1;
    runRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setCancellable(true);
    setSafeError(null);
    setProgress("正在從已完成的安全分段繼續匯入…");
    retryActionRef.current = () => { void resumeAtomicLearningImport(input); };
    setRetryAvailable(true);
    setRetryLabel("繼續匯入（Resume）");
    let assistant: ConversationMessage | null = null;
    let invocation: ConversationToolInvocation | null = null;
    try {
      const sessionMessages = await conversation.listMessages(projectId, input.sessionId);
      const lastMessage = sessionMessages.at(-1) ?? null;
      const resumeInputDigest = await conversationContentDigest(JSON.stringify({
        schemaVersion: "conversation-learning-resume-v1",
        projectId,
        sessionId: input.sessionId,
        importSessionId: input.importSessionId,
      }));
      assistant = await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        parentMessageId: lastMessage?.id ?? null,
      });
      const taskId = `conversation-learning-resume:${crypto.randomUUID()}`;
      invocation = await conversation.saveToolInvocation({
        projectId,
        sessionId: input.sessionId,
        messageId: assistant.id,
        taskId,
        toolId: CONVERSATION_LOCAL_TOOL_IDS.atomicLearningImport,
        taskType: "learning.import.resume",
        inputDigest: resumeInputDigest,
        contextDigest: resumeInputDigest,
        status: "running",
        actualExecutor: "browser-worker",
        modelId: parserModelId,
        modelDigest: parserModelDigest,
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "resume", percent: 1, message: "正在繼續未完成的本機分段" },
      });
      const importSession = await repository.get<LearningImportSession>(
        "learningImportSessions",
        input.importSessionId,
      );
      if (!importSession || importSession.projectId !== projectId || importSession.sessionId !== input.sessionId) {
        throw new Error("LEARNING_IMPORT_SESSION_NOT_FOUND");
      }
      const sourceUser = [...sessionMessages].reverse().find((message) =>
        message.role === "user"
        && message.attachmentIds.some((attachmentId) => importSession.attachmentIds.includes(attachmentId)));
      if (!sourceUser) throw new Error("LEARNING_IMPORT_SOURCE_MESSAGE_MISSING");
      const learning = await getLearningCoordinator();
      const processed = await learning.resume({
        projectId,
        importSessionId: input.importSessionId,
        files: input.files,
        sourceKind: "personal_note",
        rightsBasis: "owned_by_user",
        rightsEvidence: "conversation-explicit-owned-work",
        userConfirmedRights: true,
        signal: controller.signal,
        onProgress: (event) => {
          const file = localAttachments[event.partIndex];
          if (file) {
            updateLocalAttachment(file.localId, {
              status: "parsing",
              progress: event.fileProgress ?? null,
            });
          }
          setProgress(`繼續匯入 · ${event.phase} · ${Math.max(1, event.partIndex + 1)}/${event.partCount}`);
        },
      });
      if (processed.session.status !== "ready_to_finalize") {
        throw Object.assign(new Error("匯入尚未完成；可再次繼續失敗的分段。"), {
          code: "LEARNING_IMPORT_NOT_READY_TO_FINALIZE",
        });
      }
      if (!assistant || !invocation) throw new Error("LEARNING_IMPORT_TOOL_INVOCATION_MISSING");
      const assistantContent = "附件已在裝置內完成全卷分析。以下只建立抽象規則候選；原文與暫存位元組已釋放，尚未寫入正式學習庫。";
      const candidateContent = JSON.stringify({
        schemaVersion: "conversation-learning-import-candidate-v1",
        importSessionId: processed.session.importSessionId,
        manifestDigest: processed.session.manifestDigest,
        totalParts: processed.session.totalParts,
        completedParts: processed.session.completedParts,
        globalSynthesis: processed.globalSynthesis,
        rawContentRetained: false,
        dataLeftDevice: false,
      });
      const candidateDigest = await conversationContentDigest(candidateContent);
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: "browser-worker",
        modelId: parserModelId,
        modelDigest: parserModelDigest,
        executionReceipt: toExecutionReceipt({
          taskId: invocation.taskId,
          modelId: parserModelId,
          modelDigest: parserModelDigest,
          contextDigest: invocation.contextDigest,
          outputDigest: candidateDigest,
          externalRequest: false,
          dataLeftDevice: false,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "candidate", percent: 100, message: "全卷抽象規則候選已完成" },
      });
      const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
      if (!currentAssistant) throw new Error("CONVERSATION_MESSAGE_MISSING");
      assistant = await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: currentAssistant.id,
        expectedRevision: currentAssistant.revision,
        status: "completed",
        content: assistantContent,
        toolInvocationIds: currentAssistant.toolInvocationIds,
      });
      const artifact = await conversation.saveArtifact({
        projectId,
        sessionId: input.sessionId,
        sourceMessageId: assistant.id,
        artifactType: "learning_rule",
        targetStore: "learningImportSessions",
        targetRecordId: processed.session.importSessionId,
        sourceRevision: processed.session.revision,
        candidateContent,
      });
      setDrawer({ kind: "artifact", artifactId: artifact.id });
      setArtifactOpen(true);
      resetLocalAttachments();
      setRightsConfirmed(false);
      retryActionRef.current = null;
      setRetryAvailable(false);
      await loadWorkspace(input.sessionId);
    } catch (error) {
      const status = controller.signal.aborted ? "cancelled" as const : "failed" as const;
      if (assistant) {
        const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
        if (currentAssistant && ["pending", "streaming"].includes(currentAssistant.status)) {
          await conversation.updateMessageStatus({
            projectId,
            sessionId: input.sessionId,
            messageId: currentAssistant.id,
            expectedRevision: currentAssistant.revision,
            status,
            content: `附件匯入未完成：${errorCode(error)}。可使用 Resume 從安全分段繼續。`,
          }).catch(() => undefined);
        }
      }
      if (invocation) {
        const currentInvocation = await repository.get<ConversationToolInvocation>(
          "conversationToolInvocations",
          invocation.id,
        );
        if (currentInvocation && ["pending", "running"].includes(currentInvocation.status)) {
          await conversation.updateToolInvocationStatus({
            projectId,
            sessionId: input.sessionId,
            invocationId: currentInvocation.id,
            expectedRevision: currentInvocation.revision,
            status,
            safeErrorCode: errorCode(error),
            canonicalMutationCount: 0,
          }).catch(() => undefined);
        }
      }
      retryActionRef.current = () => { void resumeAtomicLearningImport(input); };
      setRetryAvailable(true);
      setRetryLabel("繼續匯入（Resume）");
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      await loadWorkspace(input.sessionId).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      if (runRef.current === runId) abortRef.current = null;
      setCancellable(false);
      setBusy(false);
    }
  }

  async function sendRequest(
    contentOverride?: string,
    onAccepted?: () => void,
    existingUserRequest?: ExistingUserRequest,
    requestedTaskType?: PlatformTaskType | null,
  ) {
    const content = (contentOverride ?? draft).trim();
    const sessionId = existingUserRequest?.sessionId ?? activeSession?.id ?? "";
    const requestLocalAttachments = existingUserRequest ? [] : localAttachments;
    if (isBranchPending()) {
      setProgress("正在準備修改副本；這次送出沒有啟動，請等待目前操作完成。");
      return;
    }
    if (!sessionId || busy || operationLockRef.current || (!content && !requestLocalAttachments.length)) return;
    operationLockRef.current = true;
    let requestRpgChoices = latestRpgChoices;
    if (existingUserRequest) {
      try {
        requestRpgChoices = latestRpgChoicesFrom(await conversation.listMessages(projectId, sessionId));
      } catch (error) {
        operationLockRef.current = false;
        setSafeError({ code: errorCode(error), message: errorMessage(error) });
        setProgress("修改副本沒有啟動續寫；可稍後在該副本重試。");
        return;
      }
    }
    const requestHadAttachments = requestLocalAttachments.length > 0;
    let learningResumeEnabled = false;
    retryActionRef.current = () => { void sendRequest(content, undefined, existingUserRequest, requestedTaskType); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    const liveStoryState = project
      ? await repository.get<StoryState>("storyStates", project.storyStateId).catch(() => null)
      : null;
    if (!liveStoryState) {
      if (!existingUserRequest) setDraft(content);
      setSafeError({
        code: "CONVERSATION_PLAY_MODE_UNAVAILABLE",
        message: "作品玩法資料無法讀取；系統已停止，沒有把原玩法誤當成一般章節寫作。",
      });
      operationLockRef.current = false;
      return;
    }
    const requestPlayMode = resolveStoryPlayMode(liveStoryState);
    const plan = await planConversationRequest({
      content,
      attachmentCount: requestLocalAttachments.length,
      hasActiveRpgTurn: Boolean(requestRpgChoices),
      fixedPlayMode: requestPlayMode,
      requestedTaskType,
    }).catch((error) => {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      return null;
    });
    if (!plan) {
      operationLockRef.current = false;
      return;
    }
    const externalSelectedForRequest = externalSelected;
    const externalProviderForRequest = externalProviderId;
    const externalExecutionModeForRequest = aiExecutionMode === "closed-only"
      ? null
      : aiExecutionMode;
    if (requestRpgChoices && plan.intent === "continue_writing") {
      if (!existingUserRequest) setDraft(content);
      setSafeError({
        code: "RPG_CHOICE_REQUIRED",
        message: "目前回合正在等待路線選擇。請先點選畫面中的其中一條路線，或輸入一個具體的自訂行動；系統不會另開一條一般續寫來繞過本回合。",
      });
      setProgress("已保留你的文字；故事與數值都沒有改變。");
      operationLockRef.current = false;
      return;
    }
    if (externalSelectedForRequest) {
      retryActionRef.current = null;
      setRetryAvailable(false);
      if (requestLocalAttachments.length > 0) {
        if (!existingUserRequest) setDraft(content);
        setSafeError({
          code: "CONVERSATION_EXTERNAL_ATTACHMENTS_FORBIDDEN",
          message: "附件保留在本機分析邊界，不能隨外來 AI 請求送出。請移除附件，或切回閉端 AI。",
        });
        setProgress("本次外來 AI 沒有送出；沒有建立候選，也沒有改用其他來源。");
        operationLockRef.current = false;
        return;
      }
      if (plan.executionKind === "rpg") {
        const block = resolveRpgExecutionSourceBlock(rpgExecutionSourceSnapshot);
        if (!block) throw new Error("CONVERSATION_EXTERNAL_RPG_SOURCE_GATE_MISSING");
        if (!existingUserRequest) setDraft(content);
        setSafeError({ code: block.code, message: block.message });
        setProgress(block.progress);
        operationLockRef.current = false;
        return;
      }
      if (!externalExecutionEnabled) {
        if (!existingUserRequest) setDraft(content);
        setSafeError({
          code: "CONVERSATION_EXTERNAL_PUBLIC_EXECUTION_DISABLED",
          message: "外來 AI 的公開執行接點尚未開放；目前只能查看供應商設定，內容不會送出。",
        });
        setProgress("公開外來 AI 執行尚未開放；本次內容沒有離開裝置。");
        operationLockRef.current = false;
        return;
      }
      if (externalProviderStatusError || !externalProviderConfigured) {
        if (!existingUserRequest) setDraft(content);
        setSafeError({
          code: "CONVERSATION_EXTERNAL_PROVIDER_NOT_CONFIGURED",
          message: externalProviderStatusError
            ?? "所選外來 AI 尚未在伺服器設定，無法送出。請設定接點或改選已設定的供應商。",
        });
        setProgress("供應商未設定；本次內容沒有離開裝置，也沒有啟用任何後備。");
        operationLockRef.current = false;
        return;
      }
      if (!externalRunConsent || !externalExecutionModeForRequest) {
        if (!existingUserRequest) setDraft(content);
        setSafeError({
          code: "CONVERSATION_EXTERNAL_SINGLE_RUN_CONSENT_REQUIRED",
          message: "請先確認本次外送範圍與供應商，再勾選單次同意。未同意前不會送出。",
        });
        setProgress("等待本次外送同意；內容尚未離開裝置。");
        operationLockRef.current = false;
        return;
      }
      if (plan.executionKind !== "closed_agent") {
        if (!existingUserRequest) setDraft(content);
        setSafeError({
          code: "CONVERSATION_EXTERNAL_SPECIALIZED_FLOW_FORBIDDEN",
          message: "這項要求需要作品資料庫、附件或其他本機專用工具。請切回閉端 AI；系統不會把它靜默改送外來供應商。",
        });
        setProgress("本次外來 AI 沒有送出；專用本機流程與外來候選保持分離。");
        operationLockRef.current = false;
        return;
      }
    }
    if (requestLocalAttachments.length && !rightsConfirmed) {
      const code = plan.executionKind === "learning_import"
        ? "LEARNING_RIGHTS_CONFIRMATION_REQUIRED"
        : "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED";
      if (!existingUserRequest) setDraft(content);
      setSafeError({
        code,
        message: "Attachment rights confirmation is required.",
      });
      setProgress("Attachment rights must be confirmed before attachment processing starts.");
      operationLockRef.current = false;
      return;
    }
    const releaseLease = await acquireConversationLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "另一個分頁正在執行這個對話，請稍後再試。",
      });
      return;
    }
    const runId = runRef.current + 1;
    runRef.current = runId;
    const requestCompletion = createConversationRequestCompletion({
      runId,
      runRef,
      operationLockRef,
      abortRef,
      releaseLease,
      setCancellable,
      setBusy,
      projectMessage: (message) => projectMessageIntoActiveSession(sessionId, message),
    });
    const controller = new AbortController();
    abortRef.current?.abort("CONVERSATION_REPLACED");
    abortRef.current = controller;
    setCancellable(true);
    setBusy(true);
    setSafeError(null);
    if (!existingUserRequest) setDraft("");
    setProgress("正在辨識你的自然語言要求。");
    try {
      if (plan.executionKind === "learning_import") {
        learningResumeEnabled = true;
        if (!requestLocalAttachments.length) {
          throw Object.assign(new Error("請先附加你擁有或獲授權的作品檔案。"), {
            code: "LEARNING_IMPORT_FILES_REQUIRED",
          });
        }
        if (!rightsConfirmed) {
          throw Object.assign(new Error("整份匯入前，請先確認你擁有或已獲授權分析這些作品。"), {
            code: "LEARNING_RIGHTS_CONFIRMATION_REQUIRED",
          });
        }
        await runAtomicLearningImport({
          sessionId,
          content,
          signal: controller.signal,
        });
        await loadWorkspace(sessionId);
        return;
      }
      if (requestLocalAttachments.length && !rightsConfirmed) {
        throw Object.assign(new Error("Attachment rights confirmation is required."), {
          code: "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED",
        });
      }
      const currentSessionMessages = await conversation.listMessages(projectId, sessionId);
      const currentSessionArtifacts = await conversation.listArtifacts(projectId, sessionId);
      const last = currentSessionMessages.at(-1) ?? null;
      const existingUserMessage = existingUserRequest
        ? currentSessionMessages.find((message) => message.id === existingUserRequest.userMessageId) ?? null
        : null;
      if (existingUserRequest && (
        !existingUserMessage
        || existingUserMessage.sessionId !== sessionId
        || existingUserMessage.role !== "user"
        || existingUserMessage.status !== "completed"
        || existingUserMessage.content.trim() !== content
      )) {
        throw Object.assign(new Error("修改副本中的訊息已變更；系統沒有重複送出。"), {
          code: "CONVERSATION_EDIT_COPY_MESSAGE_STALE",
        });
      }
      if (existingUserMessage?.attachmentIds.length) {
        const branchAttachments = await conversation.listAttachments(projectId, sessionId);
        const attachmentsById = new Map(branchAttachments.map((attachment) => [attachment.id, attachment]));
        const attachmentsVerified = existingUserMessage.attachmentIds.every((attachmentId) => {
          const attachment = attachmentsById.get(attachmentId);
          return Boolean(
            attachment
            && attachment.projectId === projectId
            && attachment.sessionId === sessionId
            && attachment.parsingStatus === "completed"
            && attachment.userConfirmedRights === true
            && attachment.rightsConfirmationSchemaVersion
              === "conversation-attachment-rights-confirmation-v1"
            && attachment.localAnalysisOnly === true
            && attachment.rawContentRetained === false
            && !attachment.deletedAt
          );
        });
        retryActionRef.current = null;
        setRetryAvailable(false);
        setDraft(existingUserMessage.content);
        setSafeError({
          code: attachmentsVerified
            ? "CONVERSATION_EDIT_COPY_ATTACHMENTS_RESELECT_REQUIRED"
            : "CONVERSATION_EDIT_COPY_ATTACHMENT_PROOF_INVALID",
          message: attachmentsVerified
            ? "附件的名稱、雜湊、權利確認與解析狀態已完整保留在修改副本；但原始內容依隱私設計不會落盤，無法安全重建本次分析。請重新附加原檔後送出，系統不會用空附件假裝續寫。"
            : "修改副本的附件證明無法通過專案與對話範圍核對；系統已停止自動續寫。請重新附加原檔後送出。",
        });
        setProgress("修改副本已建立並保留附件證明；等待你重新附加原檔後再續寫。");
        return;
      }
      const existingResponse = existingUserMessage
        ? currentSessionMessages.find((message) => (
          message.role === "assistant"
          && message.parentMessageId === existingUserMessage.id
          && !["failed", "cancelled"].includes(message.status)
        )) ?? null
        : null;
      if (existingResponse) {
        setProgress("修改副本已經開始續寫；沒有啟動第二次回覆。");
        return;
      }
      const activeRpgChoiceMessage = plan.executionKind === "rpg" ? requestRpgChoices : null;
      const persistedRpgChoice = activeRpgChoiceMessage
        ? parseRpgChoiceSelection(content, activeRpgChoiceMessage.envelope.plan.choices)
        : null;
      const rpgTurnState = activeRpgChoiceMessage
        ? inspectRpgChoiceTurn(
            currentSessionMessages,
            currentSessionArtifacts,
            activeRpgChoiceMessage.message.id,
          )
        : null;
      if (rpgTurnState?.consumed) {
        throw Object.assign(new Error("這張故事選擇卡已經建立過回合。"), {
          code: "RPG_CHAT_TURN_ALREADY_CREATED",
        });
      }
      const existingRpgUser = rpgTurnState?.recoverableUser ?? null;
      if (
        existingRpgUser
        && persistedRpgChoice
        && !rpgUserMessageMatchesChoice(existingRpgUser, persistedRpgChoice)
      ) {
        throw Object.assign(new Error("這張選擇卡已保存另一個選擇；為避免重複結算，只能恢復原回合。"), {
          code: "RPG_CHAT_TURN_CHOICE_CONFLICT",
        });
      }
      let userMessage = existingUserMessage ?? existingRpgUser ?? await conversation.appendMessage({
        projectId,
        sessionId,
        messageId: activeRpgChoiceMessage
          ? `conversation-rpg-choice:${sessionId}:${activeRpgChoiceMessage.message.id}:${(rpgTurnState?.attempts.length ?? 0) + 1}`
          : undefined,
        role: "user",
        content: content || "請分析我剛附加的檔案。",
        status: requestLocalAttachments.length ? "pending" : "completed",
        parentMessageId: last?.id ?? null,
        sourceMessageId: activeRpgChoiceMessage?.message.id ?? null,
      });
      onAccepted?.();
      let preparedAttachments: Array<{
        record: ConversationAttachment;
        extraction: ManualLearningFileExtraction;
      }> = [];
      if (requestLocalAttachments.length) {
        try {
          preparedAttachments = await prepareLocalAttachments(
            sessionId,
            plan,
            userMessage.id,
            true,
            controller.signal,
          );
        } catch (error) {
          const currentUserMessage = await repository.get<ConversationMessage>(
            "conversationMessages",
            userMessage.id,
          );
          if (currentUserMessage && ["pending", "streaming"].includes(currentUserMessage.status)) {
            await conversation.updateMessageStatus({
              projectId,
              sessionId,
              messageId: currentUserMessage.id,
              expectedRevision: currentUserMessage.revision,
              status: controller.signal.aborted ? "cancelled" : "failed",
            }).catch(() => undefined);
          }
          throw error;
        }
        const currentUserMessage = await repository.get<ConversationMessage>(
          "conversationMessages",
          userMessage.id,
        );
        if (!currentUserMessage || currentUserMessage.status !== "pending") {
          throw new Error("CONVERSATION_ATTACHMENT_USER_MESSAGE_STALE");
        }
        userMessage = await repository.put<ConversationMessage>("conversationMessages", {
          ...currentUserMessage,
          status: "completed",
          attachmentIds: preparedAttachments.map(({ record }) => record.id),
          completedAt: new Date().toISOString(),
        }, currentUserMessage.revision);
      }
      await maybeUpdateRollingSummary(sessionId);
      if (plan.executionKind === "repository") {
        const completed = await runRepositoryAction({
          plan,
          sessionId,
          userMessage,
          signal: controller.signal,
        });
        requestCompletion.capture(completed.message);
      } else if (plan.executionKind === "query") {
        const completed = await runDashboardQuery({
          plan,
          sessionId,
          userMessage,
          signal: controller.signal,
        });
        requestCompletion.capture(completed.message);
      } else if (plan.executionKind === "rpg") {
        const plannedChoice = requestRpgChoices
          ? parseRpgChoiceSelection(content, requestRpgChoices.envelope.plan.choices)
          : null;
        if (plannedChoice && requestRpgChoices) {
          const completed = await executeRpgChoice({
            sessionId,
            choice: plannedChoice,
            choicePlanCandidateId: requestRpgChoices.envelope.plan.candidateId,
            choiceSourceMessageId: requestRpgChoices.message.id,
            expectedChapterId: requestRpgChoices.envelope.chapterId,
            expectedChapterRevision: requestRpgChoices.envelope.chapterRevision,
            expectedStoryStateRevision: requestRpgChoices.envelope.storyStateRevision,
            expectedContextRevisionDigest: requestRpgChoices.envelope.contextRevisionDigest,
            userMessage,
            signal: controller.signal,
          });
          requestCompletion.capture(completed.message);
        } else if (plan.intent === "rpg_custom_action" && requestRpgChoices) {
          const snapshot = await loadLearningAwareRpgChatSnapshot({
            repository,
            projectId,
            learningRepository,
            ensureSharedLearningReady,
            signal: controller.signal,
          });
          const completed = await executeRpgChoice({
            sessionId,
            choice: buildRpgChatCustomAction({ snapshot, action: content }),
            choicePlanCandidateId: requestRpgChoices.envelope.plan.candidateId,
            choiceSourceMessageId: requestRpgChoices.message.id,
            expectedChapterId: requestRpgChoices.envelope.chapterId,
            expectedChapterRevision: requestRpgChoices.envelope.chapterRevision,
            expectedStoryStateRevision: requestRpgChoices.envelope.storyStateRevision,
            expectedContextRevisionDigest: requestRpgChoices.envelope.contextRevisionDigest,
            userMessage,
            signal: controller.signal,
          });
          requestCompletion.capture(completed.message);
        } else {
          const completed = await createRpgChoicesMessage({
            sessionId,
            parentMessageId: userMessage.id,
            signal: controller.signal,
          });
          requestCompletion.capture(completed.placeholder);
        }
      } else {
        const completed = externalSelectedForRequest && externalExecutionModeForRequest
          ? await (async () => {
              clearExternalRunConsent();
              return runConversationExternalAgent({
                projectId,
                repository,
                conversation,
                currentChapter,
                plan,
                sessionId,
                userMessage,
                providerId: externalProviderForRequest,
                executionMode: externalExecutionModeForRequest,
                signal: controller.signal,
                onProgress: setProgress,
                onProjectMessage: (message) => {
                  projectMessageIntoActiveSession(sessionId, message);
                },
                onOpenArtifact: (artifactId) => {
                  setDrawer({ kind: "artifact", artifactId });
                },
              });
            })()
          : await runConversationClosedAgent({
              projectId,
              repository,
              conversation,
              currentChapter,
              plan,
              sessionId,
              userMessage,
              preparedAttachments,
              signal: controller.signal,
              ensureSharedLearningReady,
              onProgress: setProgress,
              onOpenArtifact: (artifactId) => {
                setDrawer({ kind: "artifact", artifactId });
              },
            });
        requestCompletion.capture(completed.message);
      }
      if (runRef.current === runId) {
        setProgress(externalSelectedForRequest
          ? "外來 AI 候選已完成；只有你按下採用後才會記錄決定，正式 Canon 目前維持原狀。"
          : plan.approvalRequired
            ? "已完成；正式 Canon 只會在你按下採用後修改。"
            : "閉端 AI 意見已完成；這份回覆沒有採用入口，正式 Canon 維持原狀。");
      }
      if (!existingUserRequest) clearTransientAttachments();
      if (existingUserRequest) {
        requestCompletion.revealAndRelease();
      }
      await loadWorkspace(sessionId);
    } catch (error) {
      if (runRef.current !== runId) return;
      const safeCode = errorCode(error);
      if (externalSelectedForRequest) {
        retryActionRef.current = null;
        setRetryAvailable(false);
        if (!existingUserRequest) setDraft(content);
      }
      if (
        requestHadAttachments
        && !learningResumeEnabled
        && safeCode !== "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED"
      ) {
        retryActionRef.current = null;
        setRetryAvailable(false);
        if (!existingUserRequest) setDraft(content);
        setSafeError({
          code: "CONVERSATION_ATTACHMENTS_RESELECT_REQUIRED",
          message: "附件暫存內容已安全釋放。請重新附加原檔後再送出；系統不會在缺少附件時假裝重試分析。",
        });
      } else {
        if ([
          "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED",
          "LEARNING_RIGHTS_CONFIRMATION_REQUIRED",
        ].includes(safeCode)) {
          if (!existingUserRequest) setDraft(content);
        }
        setSafeError({ code: safeCode, message: errorMessage(error) });
      }
      setProgress(controller.signal.aborted
        ? "已停止；生成中的內容與 Canon 均未修改。"
        : externalSelectedForRequest
          ? "指定外來 AI 沒有完成；沒有建立候選，也沒有靜默改用其他來源。"
          : "操作沒有完成；可修正後重試。");
      if (!existingUserRequest) clearTransientAttachments();
      await loadWorkspace(sessionId).catch(() => undefined);
    } finally {
      requestCompletion.release();
    }
  }

  useEffect(() => {
    if (initialPromptUsed.current || !initialPrompt || loading || busy || !activeSession) return;
    const timer = window.setTimeout(() => {
      if (initialPromptUsed.current || operationLockRef.current) return;
      initialPromptUsed.current = true;
      void initialPromptSenderRef.current(initialPrompt, () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("prompt");
        url.searchParams.delete("task");
        if (url.searchParams.get("mode") === "play") url.searchParams.delete("mode");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }, undefined, initialTaskType);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSession, busy, initialPrompt, initialTaskType, loading]);

  async function regenerateMessage(message: ConversationMessage) {
    if (message.role !== "assistant") return;
    if (!activeSession) {
      setSafeError({
        code: "CONVERSATION_REGENERATION_SESSION_NOT_READY",
        message: "The conversation session is not ready for regeneration.",
      });
      return;
    }
    if (busy || operationLockRef.current) {
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "Another conversation operation is already running.",
      });
      return;
    }
    if (!closedAiRegenerationReady) {
      setSafeError({
        code: "CONVERSATION_REGENERATION_CLOSED_BACKEND_NOT_READY",
        message: "The verified closed AI backend is still being restored.",
      });
      return;
    }
    const sessionId = activeSession.id;
    retryActionRef.current = () => { void regenerateMessage(message); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({ code: "CONVERSATION_OPERATION_ALREADY_RUNNING", message: "另一個分頁正在執行這個對話，請稍後再試。" });
      return;
    }
    const runId = runRef.current + 1;
    runRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    setCancellable(true);
    setBusy(true);
    setSafeError(null);
    try {
      const currentSourceMessage = await repository.get<ConversationMessage>(
        "conversationMessages",
        message.id,
      );
      if (
        !currentSourceMessage
        || stableStringify(currentSourceMessage) !== stableStringify(message)
      ) {
        throw Object.assign(new Error("The regeneration source changed after it was displayed."), {
          code: "CONVERSATION_REGENERATION_SOURCE_STALE",
        });
      }
      const sourceArtifacts = (await conversation.listArtifacts(projectId, sessionId))
        .filter((artifact) => artifact.sourceMessageId === currentSourceMessage.id);
      if (sourceArtifacts.some((artifact) => ["rpg", "learning_rule"].includes(artifact.artifactType))) {
        throw Object.assign(new Error("這類候選必須從原本的 RPG 選擇或附件匯入流程重新執行。"), {
          code: "CONVERSATION_REGENERATION_SPECIALIZED_FLOW_REQUIRED",
        });
      }
      const sourceUser = currentSourceMessage.parentMessageId
        ? await repository.get<ConversationMessage>("conversationMessages", currentSourceMessage.parentMessageId)
        : null;
      if (!sourceUser || sourceUser.role !== "user") {
        throw Object.assign(new Error("找不到原始使用者訊息。"), {
          code: "CONVERSATION_REGENERATION_SOURCE_MISSING",
        });
      }
      if (sourceUser.attachmentIds.length > 0) {
        retryActionRef.current = null;
        setRetryAvailable(false);
        setDraft(sourceUser.content);
        throw Object.assign(new Error("原始附件內容未被保留。已回填原要求，請重新附加原檔後再送出。"), {
          code: "CONVERSATION_ATTACHMENTS_RESELECT_REQUIRED",
        });
      }
      const plan = await planConversationRequest({ content: sourceUser.content });
      if (plan.executionKind !== "closed_agent") {
        throw Object.assign(new Error("這則回覆必須使用原本的專用本機工具重新執行，不能改由通用 AI 重新產生。"), {
          code: "CONVERSATION_REGENERATION_SPECIALIZED_FLOW_REQUIRED",
        });
      }
      const sourceInvocations = (await conversation.listToolInvocations(projectId, sessionId))
        .filter((invocation) => (
          invocation.messageId === currentSourceMessage.id
          && currentSourceMessage.toolInvocationIds.includes(invocation.id)
          && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
          && invocation.status === "completed"
        ));
      const sourceInvocation = sourceInvocations.length === 1
        ? sourceInvocations[0]
        : null;
      const regenerationSource = await resolveRegenerationBackend({
        sourceInvocation,
        sourceCandidateIds: currentSourceMessage.candidateIds,
        sourceMessageContent: currentSourceMessage.content,
        sourceMessageContentDigest: currentSourceMessage.contentDigest,
        taskType: plan.taskType ?? "assistant.general",
        signal: controller.signal,
      });
      const prepared = await conversation.prepareRegeneration({
        projectId,
        sessionId,
        sourceMessageId: currentSourceMessage.id,
        expectedSourceMessage: currentSourceMessage,
        expectedSourceInvocation: sourceInvocation!,
        expectedClosedCandidateId: regenerationSource.candidateId,
      });
      await runConversationClosedAgent({
        projectId,
        repository,
        conversation,
        currentChapter,
        plan,
        sessionId,
        userMessage: sourceUser,
        preparedAttachments: [],
        signal: controller.signal,
        ensureSharedLearningReady,
        onProgress: setProgress,
        onOpenArtifact: (artifactId) => {
          setDrawer({ kind: "artifact", artifactId });
        },
        regeneration: {
          source: currentSourceMessage,
          taskId: prepared.taskId,
          placeholderId: prepared.messageId,
          preferredBackend: regenerationSource.backendId,
          sourceCandidateId: regenerationSource.candidateId,
          sourceTaskId: regenerationSource.taskId,
          sourceCandidateDigest: regenerationSource.candidateDigest,
          regenerationAttempt: regenerationSource.regenerationAttempt,
        },
      });
      await loadWorkspace(sessionId);
    } catch (error) {
      await loadWorkspace(sessionId).catch(() => undefined);
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
    } finally {
      operationLockRef.current = false;
      releaseLease();
      if (runRef.current === runId) abortRef.current = null;
      setCancellable(false);
      setBusy(false);
    }
  }

  function stopGeneration() {
    if (rpgChoicePlanning && requestRpgChoiceFallback()) return;
    if (!abortRef.current) return;
    abortRef.current?.abort("CONVERSATION_USER_CANCELLED");
    clearTransientAttachments();
    setProgress("正在安全停止；未完成候選不會修改 Canon。");
  }

  function changeDraft(value: string) {
    setDraft(value);
    clearExternalRunConsent();
  }

  async function openArtifact(
    artifact: ConversationArtifact,
    view: ArtifactView = "candidate",
  ) {
    setDrawer({ kind: "artifact", artifactId: artifact.id });
    setArtifactDraft(artifactStory(artifact));
    setArtifactView(view);
    setArtifactBefore("");
    setArtifactOpen(true);
    setArtifactBefore(await resolveArtifactBefore({
      repository,
      artifact,
      view,
      messages,
      artifacts,
    }));
  }

  const messageActions: ConversationMessageActions = {
    chooseRpgOption: (envelope, messageId, key) => {
      void chooseRpgOption(envelope, messageId, key);
    },
    openArtifact: (artifact, view) => {
      void openArtifact(artifact, view);
    },
    approveArtifact: (artifact) => {
      setProgress("已收到採用指令；正在核對候選與正式作品版本。");
      void approveArtifact(artifact);
    },
    rejectArtifact: (artifact) => {
      void rejectArtifact(artifact);
    },
    regenerateMessage: (message) => {
      void regenerateMessage(message);
    },
    editMessage: (message) => {
      void editMessage(message).then((result) => {
        if (!result?.navigation.branchSelected) return;
        return sendRequest(result.content, undefined, {
          sessionId: result.sessionId,
          userMessageId: result.userMessageId,
        });
      });
    },
    retryMessage: (content) => {
      void sendRequest(content);
    },
    stopGeneration,
  };

  return <ConversationWorkspaceView {...{
    projectId,
    project,
    activeSession,
    currentChapterTitle: currentChapter?.title ?? null,
    currentChapter,
    fixedPlayMode,
    sidebarOpen,
    setSidebarOpen,
    artifactOpen,
    setArtifactOpen,
    loading,
    visibleSessions,
    activeSessionId,
    switchingSessionId,
    queuedSessionId,
    search,
    setSearch,
    showArchived,
    setShowArchived,
    busy,
    cancellable,
    rpgChoicePlanning,
    closeSidebar,
    newSession,
    chooseSession,
    renameSession,
    archiveSession,
    deleteSession,
    exportActiveConversationSummary,
    messages,
    artifacts,
    invocations,
    attachments,
    closedAiRegenerationReady,
    progress,
    safeError,
    retryAvailable,
    retryLabel,
    branchPendingMessageIds,
    dashboardOpenRequest,
    storyBible,
    storyState,
    onStoryStateChanged: setStoryState,
    worlds,
    characters,
    relationships,
    messageActions,
    recoverRpgChoices,
    retryActionRef,
    draft,
    setDraft: changeDraft,
    localAttachments,
    rightsConfirmed,
    setRightsConfirmed,
    closedAiSetup,
    closedAiSetupProgress,
    closedAiSetupBusy,
    closedAiSetupError,
    closedAiSetupLifecycle,
    aiExecutionMode,
    hybridAiSource,
    externalProviderId,
    externalProviderStatuses,
    externalProviderStatusError,
    externalExecutionEnabled,
    externalRunConsent,
    externalSelected,
    externalProviderConfigured,
    sourceControlsCollapseSignal,
    onFilesSelected,
    retryLocalAttachment,
    removeLocalAttachment,
    stopGeneration,
    sendRequest,
    prepareClosedAi,
    cancelClosedAiSetup,
    onAiExecutionModeChange: changeAiExecutionMode,
    onHybridAiSourceChange: changeHybridAiSource,
    onExternalProviderChange: changeExternalProvider,
    onExternalRunConsentChange: setExternalRunConsent,
    drawer,
    artifactView,
    artifactBefore,
    artifactDraft,
    setArtifactDraft,
    openArtifact,
    approveArtifact,
    rejectArtifact,
    editDialog,
    updateEditDraft,
    cancelEditMessage,
    confirmEditMessage,
  }} />;
}
