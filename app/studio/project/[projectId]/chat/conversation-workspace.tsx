"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type {
  ClosedAIBackendId,
} from "@/lib/novel-ai/closed-agent-os";
import {
  createClosedAgentFailureEvidence,
  serializeClosedAgentFailureEvidence,
} from "@/lib/novel-ai/closed-agent-os/safe-runtime-diagnostics";
import { createExplicitRegenerationContract } from "@/lib/novel-ai/web/explicit-regeneration";
import {
  type Chapter,
  type ConversationArtifact,
  type ConversationAttachment,
  type ConversationMessage,
  type ConversationSession,
  type ConversationSummary,
  type ConversationToolInvocation,
  type LearningImportSession,
  type NovelProject,
  type StoryBible,
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
import { buildConversationClosedAgentCacheOriginProof } from "@/lib/novel-ai/conversation/closed-agent-cache-origin-proof";
import {
  persistConversationClosedAgentFailure,
  requireConversationApprovalTarget,
} from "@/lib/novel-ai/conversation/closed-agent-finalization";
import { stableStringify } from "@/lib/novel-ai/closed-ai-cache";
import { resolveConversationCanonicalTarget } from "@/lib/novel-ai/conversation/canonical-target";
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
import { conversationCanonRevisionDigest } from "@/lib/novel-ai/web/project-context-composer";
import {
  executeStudioClosedAgent,
  rejectStudioClosedAgentCandidate,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import {
  hasExplicitLocalComputeAuthorization,
  resolveStudioClosedComputePolicy,
} from "@/lib/novel-ai/web/studio-closed-compute-policy";
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
import { useConversationRpgController } from "./hooks/use-conversation-rpg";
import { useConversationLearningCoordinatorLoader } from "./hooks/use-conversation-learning-loader";
import {
  acquireConversationLease,
  toExecutionReceipt,
  useConversationOperationController,
} from "./hooks/use-conversation-operation";
import { useClosedAiBootstrap } from "./hooks/use-closed-ai-bootstrap";
import { useSharedLearningSync } from "./hooks/use-shared-learning-sync";
import {
  artifactStory,
} from "./components/conversation-presentation";
import type {
  ArtifactView,
  ConversationMessageActions,
  DrawerPayload,
} from "./components/conversation-types";
import {
  activeChapter,
  artifactType,
  errorCode,
  errorMessage,
  type ExistingUserRequest,
  latestRpgChoicesFrom,
  MAX_TRANSIENT_ATTACHMENT_CONTEXT,
  progressLabel,
  resolveArtifactBefore,
  targetStore,
} from "./conversation-workspace-support";
import { isClosedAiTaskRoutable } from "./closed-ai-task-readiness";

export default function ConversationWorkspace({
  projectId,
  initialPrompt,
}: {
  projectId: string;
  initialPrompt: string;
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
  const [drawer, setDrawer] = useState<DrawerPayload>(null);
  const [artifactDraft, setArtifactDraft] = useState("");
  const [artifactView, setArtifactView] = useState<"candidate" | "diff" | "comparison">("candidate");
  const [artifactBefore, setArtifactBefore] = useState("");
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
  ) => Promise<void>>(async () => undefined);
  const operationLocked = useCallback(() => operationLockRef.current, []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
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

  async function currentCanonRevisionDigest() {
    const loadedProject = await repository.get<NovelProject>("projects", projectId);
    if (!loadedProject) throw new Error("CONVERSATION_PROJECT_NOT_FOUND");
    const [loadedChapters, storyBible, storyState] = await Promise.all([
      repository.list<Chapter>("chapters", projectId),
      repository.get<StoryBible>("storyBibles", loadedProject.storyBibleId),
      repository.get<StoryState>("storyStates", loadedProject.storyStateId),
    ]);
    return conversationCanonRevisionDigest({
      project: loadedProject,
      activeChapter: activeChapter(loadedProject, loadedChapters),
      storyBible,
      storyState,
    });
  }

  async function maybeUpdateRollingSummary(sessionId: string) {
    const sessionMessages = await conversation.listMessages(projectId, sessionId);
    const olderMessages = sessionMessages.slice(0, Math.max(0, sessionMessages.length - 12));
    if (olderMessages.length < 6) return null;
    const canonRevisionDigest = await currentCanonRevisionDigest();
    const existing = (await repository.list<ConversationSummary>("conversationSummaries", projectId))
      .find((summary) => summary.sessionId === sessionId && !summary.invalidatedAt && !summary.deletedAt);
    if (
      existing
      && existing.canonRevisionDigest === canonRevisionDigest
      && existing.sourceMessageIds.length === olderMessages.length
      && existing.sourceMessageIds.every((id, index) => id === olderMessages[index]?.id)
    ) {
      return existing;
    }
    const excerpts = olderMessages.slice(-18).map((message) => {
      const label = message.role === "user"
        ? "使用者"
        : message.role === "assistant"
          ? "助手候選"
          : "工具狀態";
      const compact = message.content.replace(/\s+/gu, " ").trim().slice(0, 260);
      return `${label}：${compact}`;
    });
    return conversation.upsertSummary({
      projectId,
      sessionId,
      sourceMessageIds: olderMessages.map((message) => message.id),
      content: [
        `這是同一小說專案、同一 Session 較早 ${olderMessages.length} 則訊息的非 Canon 滾動摘要。`,
        "未採用的助手內容只代表候選，不得當成正式作品事實。",
        ...excerpts,
      ].join("\n").slice(0, 6_000),
      canonRevisionDigest,
    });
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

  async function runClosedAgent(input: {
    plan: ConversationPlan;
    sessionId: string;
    userMessage: ConversationMessage;
    preparedAttachments: Array<{
      record: ConversationAttachment;
      extraction: ManualLearningFileExtraction;
    }>;
    signal: AbortSignal;
    regeneration?: {
      source: ConversationMessage;
      taskId: string;
      placeholderId: string;
      preferredBackend: ClosedAIBackendId;
      sourceCandidateId: string;
      sourceTaskId: string;
      sourceCandidateDigest: string;
      regenerationAttempt: number;
    };
  }) {
    const placeholder = input.regeneration
      ? await repository.get<ConversationMessage>("conversationMessages", input.regeneration.placeholderId)
      : await conversation.appendMessage({
        projectId,
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
      invocation = await conversation.saveToolInvocation({
        projectId,
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
            repository,
            projectId,
            store: plannedTargetStore,
            objective: input.plan.objective,
          })
        : null;
      const resolvedChapterTarget = currentChapter
        ? await repository.get<Chapter>("chapters", currentChapter.id)
        : null;
      const approvalTarget = requireConversationApprovalTarget({
        approvalRequired: input.plan.approvalRequired,
        targetStore: plannedTargetStore,
        projectId,
        chapter: resolvedChapterTarget,
        canonicalTarget: resolvedCanonicalTarget,
      });
      const previousDigest = input.regeneration?.sourceCandidateDigest;
      await ensureSharedLearningReady(input.signal);
      const automaticComputePolicy = input.regeneration?.preferredBackend === "local-ollama"
        ? "quality-first"
        : resolveStudioClosedComputePolicy();
      const result = await executeStudioClosedAgent({
        projectId,
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
        onProgress: (event) => setProgress(progressLabel(event)),
      });
      closedCandidateId = result.candidate.id;
      if (input.signal.aborted) {
        throw Object.assign(new Error("Conversation generation cancelled."), { code: "CONVERSATION_CANCELLED" });
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
        await conversation.saveToolInvocation({
          projectId,
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
          normalizationReceiptId:
            result.candidate.traditionalChineseNormalization.receiptId,
          traditionalChineseNormalizerVersion:
            result.candidate.traditionalChineseNormalization.normalizerVersion,
          cacheOrigin: await buildConversationClosedAgentCacheOriginProof(
            result.candidate,
          ),
        },
      });
      if (approvalTarget) {
        artifact = await conversation.saveArtifact({
          projectId,
          sessionId: input.sessionId,
          sourceMessageId: placeholder.id,
          artifactType: artifactType(input.plan),
          targetStore: approvalTarget.targetStore,
          targetRecordId: approvalTarget.targetRecordId,
          sourceRevision: approvalTarget.sourceRevision,
          candidateContent: result.candidate.content,
        });
      }
      const currentPlaceholder = await repository.get<ConversationMessage>("conversationMessages", placeholder.id);
      if (!currentPlaceholder) throw new Error("CONVERSATION_MESSAGE_MISSING");
      if (input.signal.aborted) {
        throw Object.assign(new Error("Conversation generation cancelled."), { code: "CONVERSATION_CANCELLED" });
      }
      const primaryInvocation = invocation;
      if (!primaryInvocation) throw new Error("CONVERSATION_TOOL_INVOCATION_MISSING");
      const completeInvocation = () => conversation.updateToolInvocationStatus({
        projectId,
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
      const completedMessage = await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: currentPlaceholder.id,
        expectedRevision: currentPlaceholder.revision,
        status: "completed",
        content: result.candidate.content,
        candidateIds: [...currentPlaceholder.candidateIds, result.candidate.id],
        toolInvocationIds: currentPlaceholder.toolInvocationIds,
      });
      invocation = await completeInvocation();
      if (artifact) setDrawer({ kind: "artifact", artifactId: artifact.id });
      return { result, artifact, invocation, message: completedMessage };
    } catch (error) {
      const cancelled = input.signal.aborted;
      const failureEvidence = cancelled
        ? null
        : createClosedAgentFailureEvidence(error);
      const persistedSafeCode = failureEvidence?.safeCode ?? errorCode(error);
      const persistedFailureEvidence = failureEvidence
        ? serializeClosedAgentFailureEvidence(failureEvidence)
        : "";
      await persistConversationClosedAgentFailure({
        repository,
        conversation,
        projectId,
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

  async function sendRequest(
    contentOverride?: string,
    onAccepted?: () => void,
    existingUserRequest?: ExistingUserRequest,
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
    retryActionRef.current = () => { void sendRequest(content, undefined, existingUserRequest); };
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
    }).catch((error) => {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      return null;
    });
    if (!plan) {
      operationLockRef.current = false;
      return;
    }
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
    let requestOperationReleased = false;
    const releaseRequestOperation = () => {
      if (requestOperationReleased) return;
      requestOperationReleased = true;
      operationLockRef.current = false;
      releaseLease();
      setCancellable(false);
      if (runRef.current === runId) {
        abortRef.current = null;
        setBusy(false);
      }
    };
    const controller = new AbortController();
    abortRef.current?.abort("CONVERSATION_REPLACED");
    abortRef.current = controller;
    setCancellable(true);
    setBusy(true);
    setSafeError(null);
    if (!existingUserRequest) setDraft("");
    setProgress("正在辨識你的自然語言要求。");
    let completedResponseMessage: ConversationMessage | null = null;
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
      const rpgAttempts = activeRpgChoiceMessage
        ? currentSessionMessages.filter((message) =>
          message.role === "user"
          && message.sourceMessageId === activeRpgChoiceMessage.message.id)
        : [];
      const responseFor = (attempt: ConversationMessage) => currentSessionMessages.filter((message) =>
        message.role === "assistant" && message.parentMessageId === attempt.id).at(-1) ?? null;
      const existingRpgUser = rpgAttempts.find((attempt) => {
        const response = responseFor(attempt);
        return attempt.content === content
          && Boolean(response && ["failed", "cancelled"].includes(response.status));
      }) ?? null;
      const rpgChoiceConsumed = rpgAttempts.some((attempt) => {
        const response = responseFor(attempt);
        if (!response || ["pending", "streaming"].includes(response.status)) return true;
        if (["failed", "cancelled"].includes(response.status)) return false;
        const responseArtifacts = currentSessionArtifacts.filter((artifact) =>
          artifact.sourceMessageId === response.id && artifact.artifactType === "rpg");
        return responseArtifacts.some((artifact) => ["candidate", "approved"].includes(artifact.status));
      });
      if (
        rpgChoiceConsumed
      ) {
        throw Object.assign(new Error("這張故事選擇卡已經建立過回合。"), {
          code: "RPG_CHAT_TURN_ALREADY_CREATED",
        });
      }
      let userMessage = existingUserMessage ?? existingRpgUser ?? await conversation.appendMessage({
        projectId,
        sessionId,
        messageId: activeRpgChoiceMessage
          ? `conversation-rpg-choice:${sessionId}:${activeRpgChoiceMessage.message.id}:${rpgAttempts.length + 1}`
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
        completedResponseMessage = completed.message;
      } else if (plan.executionKind === "query") {
        const completed = await runDashboardQuery({
          plan,
          sessionId,
          userMessage,
          signal: controller.signal,
        });
        completedResponseMessage = completed.message;
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
            userMessage,
            signal: controller.signal,
          });
          completedResponseMessage = completed.message;
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
            userMessage,
            signal: controller.signal,
          });
          completedResponseMessage = completed.message;
        } else {
          const completed = await createRpgChoicesMessage({
            sessionId,
            parentMessageId: userMessage.id,
            signal: controller.signal,
          });
          completedResponseMessage = completed.placeholder;
        }
      } else {
        const completed = await runClosedAgent({
          plan,
          sessionId,
          userMessage,
          preparedAttachments,
          signal: controller.signal,
        });
        completedResponseMessage = completed.message;
      }
      if (runRef.current === runId) {
        setProgress(plan.approvalRequired
          ? "已完成；正式 Canon 只會在你按下採用後修改。"
          : "閉端 AI 意見已完成；這份回覆沒有採用入口，正式 Canon 維持原狀。");
      }
      if (!existingUserRequest) clearTransientAttachments();
      if (existingUserRequest) {
        // Keep terminal persistence, visible continuation and input readiness in
        // one UI commit. The complete workspace refresh may scan 1000+ messages
        // and must not leave a durable edit-copy hidden behind a disabled input.
        flushSync(() => {
          if (completedResponseMessage) {
            projectMessageIntoActiveSession(sessionId, completedResponseMessage);
          }
          releaseRequestOperation();
        });
      }
      await loadWorkspace(sessionId);
    } catch (error) {
      if (runRef.current !== runId) return;
      const safeCode = errorCode(error);
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
        : "操作沒有完成；可修正後重試。");
      if (!existingUserRequest) clearTransientAttachments();
      await loadWorkspace(sessionId).catch(() => undefined);
    } finally {
      releaseRequestOperation();
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
        if (url.searchParams.get("mode") === "play") url.searchParams.delete("mode");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSession, busy, initialPrompt, loading]);

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
      await runClosedAgent({
        plan,
        sessionId,
        userMessage: sourceUser,
        preparedAttachments: [],
        signal: controller.signal,
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
    retryActionRef,
    draft,
    setDraft,
    localAttachments,
    rightsConfirmed,
    setRightsConfirmed,
    closedAiSetup,
    closedAiSetupProgress,
    closedAiSetupBusy,
    closedAiSetupError,
    closedAiSetupLifecycle,
    onFilesSelected,
    retryLocalAttachment,
    removeLocalAttachment,
    stopGeneration,
    sendRequest,
    prepareClosedAi,
    cancelClosedAiSetup,
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
