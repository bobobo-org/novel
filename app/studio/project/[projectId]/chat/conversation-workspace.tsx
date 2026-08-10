"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ClosedAIBackendId,
  ClosedAIProgressEvent,
} from "@/lib/novel-ai/closed-agent-os";
import { createExplicitRegenerationContract } from "@/lib/novel-ai/web/explicit-regeneration";
import {
  type Chapter,
  type Character,
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
  type WorldRule,
} from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  createProjectBackup,
  markdownDownload,
} from "@/lib/novel-ai/repository/backup";
import { createSovereignLearningRepository } from "@/lib/novel-ai/sovereign-learning";
import { conversationContentDigest } from "@/lib/novel-ai/conversation/approval-transaction";
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
  buildRpgChatCustomAction,
  loadRpgChatSnapshot,
  parseRpgChoiceSelection,
} from "@/lib/novel-ai/web/rpg-chat-turn";
import { MessageComposer } from "./components/message-composer";
import { MessageTimeline } from "./components/message-timeline";
import { SessionSidebar } from "./components/session-sidebar";
import { ConversationShell } from "./components/conversation-shell";
import { useConversationSessionController } from "./hooks/use-conversation-session";
import { useConversationBranchController } from "./hooks/use-conversation-branch";
import { useConversationAttachmentController } from "./hooks/use-conversation-attachments";
import { useConversationApprovalController } from "./hooks/use-conversation-approval";
import { useConversationRpgController } from "./hooks/use-conversation-rpg";
import { useConversationLearningCoordinatorLoader } from "./hooks/use-conversation-learning-loader";
import {
  toExecutionReceipt,
  useConversationOperationController,
} from "./hooks/use-conversation-operation";
import { useClosedAiBootstrap } from "./hooks/use-closed-ai-bootstrap";
import {
  artifactStory,
  parseRpgChoices,
} from "./components/conversation-presentation";
import type {
  ArtifactView,
  ConversationMessageActions,
  DrawerPayload,
} from "./components/conversation-types";
import styles from "./conversation.module.css";

const ArtifactDrawer = dynamic(() => import("./components/artifact-drawer"), {
  loading: () => <p className={styles.emptyNote} role="status">正在載入作品結果……</p>,
});

const MAX_TRANSIENT_ATTACHMENT_CONTEXT = 24_000;

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_OPERATION_FAILED");
  }
  if ((error as { name?: string })?.name === "AbortError") return "CONVERSATION_CANCELLED";
  return "CONVERSATION_OPERATION_FAILED";
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "操作沒有完成；正式作品維持原狀。";
}

function activeChapter(project: NovelProject | null, chapters: Chapter[]) {
  return chapters.find((chapter) => chapter.id === project?.activeChapterId)
    ?? [...chapters].sort((left, right) => left.order - right.order).at(-1)
    ?? null;
}


function artifactType(plan: ConversationPlan): ConversationArtifact["artifactType"] {
  if (plan.executionKind === "rpg") return "rpg";
  if (plan.intent === "character_candidate") return "character";
  if (plan.intent === "world_rule_candidate") return "world_rule";
  if (plan.intent === "learning_rule_candidate") return "learning_rule";
  if (plan.intent === "attachment_analysis") return "attachment_analysis";
  return "novel";
}

function targetStore(plan: ConversationPlan): ConversationArtifact["targetStore"] {
  if (plan.targetStore === "characters") return "characters";
  if (plan.targetStore === "worldRules") return "worldRules";
  if (plan.targetStore === "learningRules") return "controlledLearning";
  return plan.targetStore === "chapters" ? "chapters" : "none";
}

function progressLabel(event: ClosedAIProgressEvent) {
  const generated = event.generatedCharacters ?? 0;
  return `${event.label}${generated ? ` · 已產生 ${generated} 字` : ""}`;
}

async function acquireConversationLease(projectId: string, sessionId: string) {
  if (typeof navigator === "undefined" || !navigator.locks) return () => undefined;
  const lockName = `novel:conversation-operation:${projectId}:${sessionId}`;
  return new Promise<(() => void) | null>((resolve) => {
    let resolved = false;
    void navigator.locks.request(
      lockName,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolved = true;
          resolve(null);
          return;
        }
        await new Promise<void>((release) => {
          let released = false;
          resolved = true;
          resolve(() => {
            if (released) return;
            released = true;
            release();
          });
        });
      },
    ).catch(() => {
      if (!resolved) resolve(null);
    });
  });
}

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
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [progress, setProgress] = useState("正在讀取作品對話。");
  const [safeError, setSafeError] = useState<{ code: string; message: string } | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [retryLabel, setRetryLabel] = useState("重試");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
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
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const operationLockRef = useRef(false);
  const retryActionRef = useRef<(() => void) | null>(null);
  const initialPromptUsed = useRef(false);
  const operationLocked = useCallback(() => operationLockRef.current, []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const {
    project,
    chapters,
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
    loadWorkspace,
    refreshSession,
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
  const {
    pendingMessageIds: branchPendingMessageIds,
    isBranchPending,
    createBranch,
    editMessage,
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
  } = useConversationRpgController({
    projectId,
    repository,
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

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    if (initialPromptUsed.current || !initialPrompt) return;
    initialPromptUsed.current = true;
    const timer = window.setTimeout(() => setDraft(initialPrompt), 0);
    return () => window.clearTimeout(timer);
  }, [initialPrompt]);

  useEffect(() => () => abortRef.current?.abort("CONVERSATION_UNMOUNTED"), []);

  const latestRpgChoices = (() => {
    for (const message of [...messages].reverse()) {
      const parsed = parseRpgChoices(message.content);
      if (parsed) return parsed.envelope ? { message, envelope: parsed.envelope } : null;
      if (message.role === "assistant" && message.candidateIds.length) break;
    }
    return null;
  })();

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
    await runDeterministicConversationTool({
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
    await runDeterministicConversationTool({
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
        const content = state
          ? JSON.stringify({
            money: state.money,
            inventory: state.inventory,
            relationships: state.relationships,
            protagonistStats: state.protagonistStats,
            resources: state.resources,
            location: state.locationState,
            time: state.timeState,
            risk: state.riskState,
          }, null, 2)
          : "目前作品沒有可顯示的 StoryState。";
        setDrawer({ kind: "status", title: "目前狀態", content });
        setArtifactOpen(true);
        return {
          result: undefined,
          assistantContent: "已依你的要求打開狀態；它不會自動出現在故事正文中。",
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
    let invocation = await conversation.saveToolInvocation({
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
    let invocationCompleted = false;
    let closedCandidateId: string | null = null;
    try {
      const plannedTargetStore = targetStore(input.plan);
      const resolvedCanonicalTarget = plannedTargetStore === "characters" || plannedTargetStore === "worldRules"
        ? await resolveConversationCanonicalTarget({
            repository,
            projectId,
            store: plannedTargetStore,
            objective: input.plan.objective,
          })
        : null;
      const previousDigest = input.regeneration?.sourceCandidateDigest;
      const result = await executeStudioClosedAgent({
        projectId,
        taskType: input.plan.taskType ?? "assistant.general",
        objective: input.plan.objective,
        taskId,
        sourceChapterId: currentChapter?.id,
        sourceRevision: currentChapter?.revision,
        conversationSessionId: input.sessionId,
        conversationRecentMessageLimit: 12,
        selectedAttachmentSummaries: input.preparedAttachments.map(({ record, extraction }) => ({
          attachmentId: record.id,
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
        browserComputePolicy: input.regeneration?.preferredBackend === "local-ollama"
          ? "quality-first"
          : "browser-first",
        allowPreAuthorizedClosedEscalation: false,
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
      const currentPlaceholder = await repository.get<ConversationMessage>("conversationMessages", placeholder.id);
      if (!currentPlaceholder) throw new Error("CONVERSATION_MESSAGE_MISSING");
      if (input.signal.aborted) {
        throw Object.assign(new Error("Conversation generation cancelled."), { code: "CONVERSATION_CANCELLED" });
      }
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: result.candidate.actualExecutor,
        modelId: result.candidate.modelId,
        modelDigest: result.candidate.modelDigest,
        executionReceipt: toExecutionReceipt({
          taskId: result.candidate.taskId,
          modelId: result.candidate.modelId,
          modelDigest: result.candidate.modelDigest,
          contextDigest: result.candidate.contextDigest ?? invocation.contextDigest,
          outputDigest: result.candidate.contentDigest,
          externalRequest: false,
          dataLeftDevice: false,
          receipt: result.candidate.executionReceipt,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "candidate", percent: 100, message: "候選已完成，Canon 未修改" },
      });
      invocationCompleted = true;
      await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: currentPlaceholder.id,
        expectedRevision: currentPlaceholder.revision,
        status: "completed",
        content: result.candidate.content,
        candidateIds: [result.candidate.id],
        toolInvocationIds: currentPlaceholder.toolInvocationIds,
      });
      let artifact: ConversationArtifact | null = null;
      if (input.plan.approvalRequired) {
        const targetRecordId = plannedTargetStore === "chapters"
          ? currentChapter?.id ?? ""
          : resolvedCanonicalTarget?.targetRecordId ?? "";
        const sourceRevision = plannedTargetStore === "chapters"
          ? currentChapter?.revision ?? 0
          : resolvedCanonicalTarget?.sourceRevision ?? 0;
        if (plannedTargetStore !== "none" && plannedTargetStore !== "controlledLearning" && targetRecordId) {
          artifact = await conversation.saveArtifact({
            projectId,
            sessionId: input.sessionId,
            sourceMessageId: placeholder.id,
            artifactType: artifactType(input.plan),
            targetStore: plannedTargetStore,
            targetRecordId,
            sourceRevision,
            candidateContent: result.candidate.content,
          });
        }
      }
      if (artifact) setDrawer({ kind: "artifact", artifactId: artifact.id });
      return { result, artifact, invocation };
    } catch (error) {
      const currentPlaceholder = await repository.get<ConversationMessage>("conversationMessages", placeholder.id);
      if (currentPlaceholder) {
        await conversation.updateMessageStatus({
          projectId,
          sessionId: input.sessionId,
          messageId: currentPlaceholder.id,
          expectedRevision: currentPlaceholder.revision,
          status: input.signal.aborted ? "cancelled" : "failed",
          content: `這次執行沒有完成：${errorCode(error)}。Canon 維持原狀。`,
        }).catch(() => undefined);
      }
      if (!invocationCompleted) await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: input.signal.aborted ? "cancelled" : "failed",
        safeErrorCode: errorCode(error),
        canonicalMutationCount: 0,
      }).catch(() => undefined);
      if (closedCandidateId) {
        await rejectStudioClosedAgentCandidate(closedCandidateId).catch(() => undefined);
      }
      throw error;
    }
  }

  async function sendRequest(contentOverride?: string) {
    const content = (contentOverride ?? draft).trim();
    if (isBranchPending()) {
      setProgress("分支正在建立；這次送出沒有啟動，請等待目前操作完成。");
      return;
    }
    if (!activeSession || busy || operationLockRef.current || (!content && !localAttachments.length)) return;
    const requestHadAttachments = localAttachments.length > 0;
    let learningResumeEnabled = false;
    retryActionRef.current = () => { void sendRequest(content); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, activeSession.id);
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
    const controller = new AbortController();
    abortRef.current?.abort("CONVERSATION_REPLACED");
    abortRef.current = controller;
    setCancellable(true);
    setBusy(true);
    setSafeError(null);
    setDraft("");
    setProgress("正在辨識你的自然語言要求。");
    try {
      const plan = await planConversationRequest({
        content,
        attachmentCount: localAttachments.length,
        hasActiveRpgTurn: Boolean(latestRpgChoices),
      });
      if (plan.executionKind === "learning_import") {
        learningResumeEnabled = true;
        if (!localAttachments.length) {
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
          sessionId: activeSession.id,
          content,
          signal: controller.signal,
        });
        await loadWorkspace(activeSession.id);
        return;
      }
      const currentSessionMessages = await conversation.listMessages(projectId, activeSession.id);
      const currentSessionArtifacts = await conversation.listArtifacts(projectId, activeSession.id);
      const last = currentSessionMessages.at(-1) ?? null;
      const activeRpgChoiceMessage = plan.executionKind === "rpg" ? latestRpgChoices : null;
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
      let userMessage = existingRpgUser ?? await conversation.appendMessage({
        projectId,
        sessionId: activeSession.id,
        messageId: activeRpgChoiceMessage
          ? `conversation-rpg-choice:${activeSession.id}:${activeRpgChoiceMessage.message.id}:${rpgAttempts.length + 1}`
          : undefined,
        role: "user",
        content: content || "請分析我剛附加的檔案。",
        status: localAttachments.length ? "pending" : "completed",
        parentMessageId: last?.id ?? null,
        sourceMessageId: activeRpgChoiceMessage?.message.id ?? null,
      });
      let preparedAttachments: Array<{
        record: ConversationAttachment;
        extraction: ManualLearningFileExtraction;
      }> = [];
      if (localAttachments.length) {
        try {
          preparedAttachments = await prepareLocalAttachments(
            activeSession.id,
            plan,
            userMessage.id,
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
              sessionId: activeSession.id,
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
      await maybeUpdateRollingSummary(activeSession.id);
      if (plan.executionKind === "repository") {
        await runRepositoryAction({
          plan,
          sessionId: activeSession.id,
          userMessage,
          signal: controller.signal,
        });
      } else if (plan.executionKind === "query") {
        await runDashboardQuery({
          plan,
          sessionId: activeSession.id,
          userMessage,
          signal: controller.signal,
        });
      } else if (plan.executionKind === "rpg") {
        const plannedChoice = latestRpgChoices
          ? parseRpgChoiceSelection(content, latestRpgChoices.envelope.plan.choices)
          : null;
        if (plannedChoice && latestRpgChoices) {
          await executeRpgChoice({
            sessionId: activeSession.id,
            choice: plannedChoice,
            choicePlanCandidateId: latestRpgChoices.envelope.plan.candidateId,
            choiceSourceMessageId: latestRpgChoices.message.id,
            expectedChapterId: latestRpgChoices.envelope.chapterId,
            expectedChapterRevision: latestRpgChoices.envelope.chapterRevision,
            expectedStoryStateRevision: latestRpgChoices.envelope.storyStateRevision,
            userMessage,
            signal: controller.signal,
          });
        } else if (plan.intent === "rpg_custom_action" && latestRpgChoices) {
          const snapshot = await loadRpgChatSnapshot(repository, projectId);
          await executeRpgChoice({
            sessionId: activeSession.id,
            choice: buildRpgChatCustomAction({ snapshot, action: content }),
            choicePlanCandidateId: latestRpgChoices.envelope.plan.candidateId,
            choiceSourceMessageId: latestRpgChoices.message.id,
            expectedChapterId: latestRpgChoices.envelope.chapterId,
            expectedChapterRevision: latestRpgChoices.envelope.chapterRevision,
            expectedStoryStateRevision: latestRpgChoices.envelope.storyStateRevision,
            userMessage,
            signal: controller.signal,
          });
        } else {
          await createRpgChoicesMessage({
            sessionId: activeSession.id,
            parentMessageId: userMessage.id,
            signal: controller.signal,
          });
        }
      } else {
        await runClosedAgent({
          plan,
          sessionId: activeSession.id,
          userMessage,
          preparedAttachments,
          signal: controller.signal,
        });
      }
      if (runRef.current === runId) {
        setProgress("已完成；正式 Canon 只會在你按下採用後修改。");
      }
      clearTransientAttachments();
      await loadWorkspace(activeSession.id);
    } catch (error) {
      if (runRef.current !== runId) return;
      if (requestHadAttachments && !learningResumeEnabled) {
        retryActionRef.current = null;
        setRetryAvailable(false);
        setDraft(content);
        setSafeError({
          code: "CONVERSATION_ATTACHMENTS_RESELECT_REQUIRED",
          message: "附件暫存內容已安全釋放。請重新附加原檔後再送出；系統不會在缺少附件時假裝重試分析。",
        });
      } else {
        setSafeError({ code: errorCode(error), message: errorMessage(error) });
      }
      setProgress(controller.signal.aborted
        ? "已停止；生成中的內容與 Canon 均未修改。"
        : "操作沒有完成；可修正後重試。");
      clearTransientAttachments();
      await loadWorkspace(activeSession.id).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setCancellable(false);
      if (runRef.current === runId) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  async function regenerateMessage(message: ConversationMessage) {
    if (!activeSession || busy || operationLockRef.current || message.role !== "assistant") return;
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
      const sourceArtifacts = (await conversation.listArtifacts(projectId, sessionId))
        .filter((artifact) => artifact.sourceMessageId === message.id);
      if (sourceArtifacts.some((artifact) => ["rpg", "learning_rule"].includes(artifact.artifactType))) {
        throw Object.assign(new Error("這類候選必須從原本的 RPG 選擇或附件匯入流程重新執行。"), {
          code: "CONVERSATION_REGENERATION_SPECIALIZED_FLOW_REQUIRED",
        });
      }
      const sourceUser = message.parentMessageId
        ? await repository.get<ConversationMessage>("conversationMessages", message.parentMessageId)
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
      const sourceInvocation = (await conversation.listToolInvocations(projectId, sessionId))
        .filter((invocation) => (
          invocation.messageId === message.id
          && invocation.toolId === CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan
          && invocation.status === "completed"
        ))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
      const regenerationSource = await resolveRegenerationBackend({
        sourceInvocation,
        sourceCandidateIds: message.candidateIds,
        sourceMessageContent: message.content,
        sourceMessageContentDigest: message.contentDigest,
        taskType: plan.taskType ?? "assistant.general",
        signal: controller.signal,
      });
      const prepared = await conversation.prepareRegeneration({
        projectId,
        sessionId,
        sourceMessageId: message.id,
      });
      await runClosedAgent({
        plan,
        sessionId,
        userMessage: sourceUser,
        preparedAttachments: [],
        signal: controller.signal,
        regeneration: {
          source: message,
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
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      await loadWorkspace(sessionId).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      if (runRef.current === runId) abortRef.current = null;
      setCancellable(false);
      setBusy(false);
    }
  }

  function stopGeneration() {
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
    if (view === "comparison") {
      const sourceMessage = messages.find((message) => message.id === artifact.sourceMessageId);
      const previousArtifact = sourceMessage?.sourceMessageId
        ? [...artifacts].reverse().find((candidate) => (
          candidate.sourceMessageId === sourceMessage.sourceMessageId
          && candidate.artifactType === artifact.artifactType
          && candidate.targetStore === artifact.targetStore
          && candidate.targetRecordId === artifact.targetRecordId
        ))
        : null;
      setArtifactBefore(previousArtifact ? artifactStory(previousArtifact) : "");
      return;
    }
    if (view !== "diff") return;
    if (artifact.targetStore === "chapters") {
      const chapter = await repository.get<Chapter>("chapters", artifact.targetRecordId);
      setArtifactBefore(chapter?.content ?? "");
      return;
    }
    if (artifact.targetStore === "characters") {
      const character = await repository.get<Character>("characters", artifact.targetRecordId);
      setArtifactBefore(character ? JSON.stringify(character, null, 2) : "");
      return;
    }
    if (artifact.targetStore === "worldRules") {
      const rule = await repository.get<WorldRule>("worldRules", artifact.targetRecordId);
      setArtifactBefore(rule?.description ?? "");
      return;
    }
    if (artifact.targetStore === "learningImportSessions") {
      const importSession = await repository.get<LearningImportSession>(
        "learningImportSessions",
        artifact.targetRecordId,
      );
      setArtifactBefore(importSession ? JSON.stringify({
        status: importSession.status,
        revision: importSession.revision,
        manifestDigest: importSession.manifestDigest,
      }, null, 2) : "");
    }
  }

  const selectedArtifact = drawer?.kind === "artifact"
    ? artifacts.find((artifact) => artifact.id === drawer.artifactId) ?? null
    : null;
  const latestInvocation = invocations.at(-1) ?? null;
  const canStop = busy && cancellable;
  const branchPending = branchPendingMessageIds.size > 0;
  const messageActions: ConversationMessageActions = {
    chooseRpgOption: (envelope, messageId, key) => {
      void chooseRpgOption(envelope, messageId, key);
    },
    openArtifact: (artifact, view) => {
      void openArtifact(artifact, view);
    },
    approveArtifact: (artifact) => {
      void approveArtifact(artifact);
    },
    rejectArtifact: (artifact) => {
      void rejectArtifact(artifact);
    },
    regenerateMessage: (message) => {
      void regenerateMessage(message);
    },
    editMessage: (message) => {
      void editMessage(message);
    },
    createBranch: (message) => {
      void createBranch(message);
    },
    retryMessage: (content) => {
      void sendRequest(content);
    },
    stopGeneration,
  };

  return (
    <ConversationShell
      projectId={projectId}
      projectTitle={project?.title ?? "小說專案"}
      sessionTitle={activeSession?.title ?? "小說專案對話"}
      chapterTitle={currentChapter?.title ?? null}
      sidebarOpen={sidebarOpen}
      artifactOpen={artifactOpen}
      loading={loading}
      onOpenSidebar={() => setSidebarOpen(true)}
      onOpenArtifacts={() => setArtifactOpen(true)}
      onToggleArtifacts={() => setArtifactOpen((value) => !value)}
      onCloseDrawers={() => {
        setSidebarOpen(false);
        setArtifactOpen(false);
      }}
      sidebar={(
        <SessionSidebar
          projectId={projectId}
          project={project}
          chapters={chapters}
          sessions={visibleSessions}
          activeSessionId={activeSessionId}
          switchingSessionId={switchingSessionId}
          queuedSessionId={queuedSessionId}
          search={search}
          showArchived={showArchived}
          busy={busy}
          branchPending={branchPending}
          open={sidebarOpen}
          onSearchChange={setSearch}
          onToggleArchived={() => setShowArchived((value) => !value)}
          onNewSession={() => { void newSession(); }}
          onChooseSession={(sessionId) => { void chooseSession(sessionId); }}
          onRenameSession={(session) => { void renameSession(session); }}
          onArchiveSession={(session) => { void archiveSession(session); }}
          onDeleteSession={(session) => { void deleteSession(session); }}
          onExportSummary={() => { void exportActiveConversationSummary(); }}
        />
      )}
      timeline={(
        <MessageTimeline
          projectId={projectId}
          sessionId={activeSessionId}
          messages={messages}
          artifacts={artifacts}
          invocations={invocations}
          attachments={attachments}
          loading={loading}
          busy={busy}
          canStop={canStop}
          progress={progress}
          safeError={safeError}
          retryAvailable={retryAvailable}
          retryLabel={retryLabel}
          branchPendingMessageIds={branchPendingMessageIds}
          actions={messageActions}
          onStarter={setDraft}
          onRetry={() => retryActionRef.current?.()}
        />
      )}
      composer={(
        <MessageComposer
          active={Boolean(activeSession)}
          projectId={projectId}
          busy={busy}
          busyReason={branchPending ? "分支建立中；訊息與附件操作已暫停。" : null}
          canStop={canStop}
          draft={draft}
          localAttachments={localAttachments}
          rightsConfirmed={rightsConfirmed}
          latestInvocation={latestInvocation}
          closedAiSetup={closedAiSetup}
          closedAiSetupProgress={closedAiSetupProgress}
          closedAiSetupBusy={closedAiSetupBusy}
          closedAiSetupError={closedAiSetupError}
          closedAiSetupLifecycle={closedAiSetupLifecycle}
          onDraftChange={setDraft}
          onFilesSelected={onFilesSelected}
          onRightsConfirmedChange={setRightsConfirmed}
          onRetryAttachment={retryLocalAttachment}
          onRemoveAttachment={removeLocalAttachment}
          onToggleArtifacts={() => setArtifactOpen((value) => !value)}
          onStop={stopGeneration}
          onSend={() => { void sendRequest(); }}
          onPrepareClosedAi={() => { void prepareClosedAi(); }}
          onCancelClosedAiSetup={cancelClosedAiSetup}
        />
      )}
      artifactDrawer={artifactOpen ? (
        <ArtifactDrawer
          projectId={projectId}
          selectedArtifact={selectedArtifact}
          drawer={drawer}
          artifacts={artifacts}
          artifactView={artifactView}
          artifactBefore={artifactBefore}
          artifactDraft={artifactDraft}
          invocations={invocations}
          busy={busy}
          onClose={() => setArtifactOpen(false)}
          onDraftChange={setArtifactDraft}
          onOpenArtifact={(artifact) => { void openArtifact(artifact); }}
          onApprove={(artifact, editedContent) => { void approveArtifact(artifact, editedContent); }}
          onReject={(artifact) => { void rejectArtifact(artifact); }}
        />
      ) : null}
    />
  );
}
