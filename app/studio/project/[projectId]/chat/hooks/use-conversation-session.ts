"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  Chapter,
  ConversationArtifact,
  ConversationAttachment,
  ConversationMessage,
  ConversationSession,
  ConversationToolInvocation,
  LearningImportSession,
  NovelProject,
} from "@/lib/novel-ai/domain";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import type { SovereignLearningRepository } from "@/lib/novel-ai/sovereign-learning";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import type { ConversationLearningCoordinatorLoader } from "./use-conversation-learning-loader";

type SessionSnapshot = {
  messages: ConversationMessage[];
  artifacts: ConversationArtifact[];
  invocations: ConversationToolInvocation[];
  attachments: ConversationAttachment[];
};

type WorkspaceLoadOptions = {
  expectedIntentToken?: number;
};

function operationErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_OPERATION_FAILED");
  }
  return "CONVERSATION_OPERATION_FAILED";
}

function operationErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "操作沒有完成；正式作品維持原狀。";
}

export function conversationActiveChapter(project: NovelProject | null, chapters: Chapter[]) {
  return chapters.find((chapter) => chapter.id === project?.activeChapterId)
    ?? [...chapters].sort((left, right) => left.order - right.order).at(-1)
    ?? null;
}

async function acquireSessionLease(projectId: string, sessionId: string) {
  if (typeof navigator === "undefined" || !navigator.locks) return () => undefined;
  return new Promise<(() => void) | null>((resolve) => {
    let resolved = false;
    void navigator.locks.request(
      `novel:conversation-operation:${projectId}:${sessionId}`,
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

export function useConversationSessionController({
  projectId,
  repository,
  learningRepository,
  conversation,
  getLearningCoordinator,
  operationLocked,
  onProgress,
  onError,
  onSidebarClose,
}: {
  projectId: string;
  repository: NovelRepository;
  learningRepository: SovereignLearningRepository;
  conversation: ConversationRepositoryService;
  getLearningCoordinator: ConversationLearningCoordinatorLoader;
  operationLocked: () => boolean;
  onProgress: (message: string) => void;
  onError: (error: { code: string; message: string } | null) => void;
  onSidebarClose: () => void;
}) {
  const [project, setProject] = useState<NovelProject | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [artifacts, setArtifacts] = useState<ConversationArtifact[]>([]);
  const [invocations, setInvocations] = useState<ConversationToolInvocation[]>([]);
  const [attachments, setAttachments] = useState<ConversationAttachment[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null);
  const [queuedSessionId, setQueuedSessionId] = useState<string | null>(null);
  const requestTokenRef = useRef(0);
  const sessionIntentRef = useRef({ token: 0, sessionId: "" });
  const reconciledSessionIdsRef = useRef(new Set<string>());

  const beginSessionIntent = useCallback((sessionId: string) => {
    const next = {
      token: sessionIntentRef.current.token + 1,
      sessionId,
    };
    sessionIntentRef.current = next;
    return next.token;
  }, []);

  const queueSessionIntent = useCallback((sessionId: string) => {
    const token = beginSessionIntent(sessionId);
    setQueuedSessionId(sessionId);
    onProgress("分支建立中；已記住你的對話切換，完成後會以這次選擇為準。");
    return token;
  }, [beginSessionIntent, onProgress]);

  const readSessionSnapshot = useCallback(async (sessionId: string): Promise<SessionSnapshot> => {
    let [nextMessages, nextArtifacts, nextInvocations, nextAttachments] = await Promise.all([
      conversation.listMessages(projectId, sessionId),
      conversation.listArtifacts(projectId, sessionId),
      conversation.listToolInvocations(projectId, sessionId),
      conversation.listAttachments(projectId, sessionId),
    ]);
    const interruptedInvocations = nextInvocations.filter((invocation) => ["pending", "running"].includes(invocation.status));
    const interruptedMessages = nextMessages.filter((message) => ["pending", "streaming"].includes(message.status));
    if (
      (interruptedInvocations.length || interruptedMessages.length)
      && !operationLocked()
      && !reconciledSessionIdsRef.current.has(sessionId)
    ) {
      const releaseLease = await acquireSessionLease(projectId, sessionId);
      if (releaseLease) try {
        [nextMessages, nextArtifacts, nextInvocations, nextAttachments] = await Promise.all([
          conversation.listMessages(projectId, sessionId),
          conversation.listArtifacts(projectId, sessionId),
          conversation.listToolInvocations(projectId, sessionId),
          conversation.listAttachments(projectId, sessionId),
        ]);
        await Promise.all(nextInvocations
          .filter((invocation) => ["pending", "running"].includes(invocation.status))
          .map((invocation) => conversation.updateToolInvocationStatus({
            projectId,
            sessionId,
            invocationId: invocation.id,
            expectedRevision: invocation.revision,
            status: "failed",
            safeErrorCode: "CONVERSATION_RELOAD_INTERRUPTED",
            canonicalMutationCount: 0,
            safeProgress: { stage: "interrupted", percent: 0, message: "頁面重新載入後已安全停止；可按重試重新執行。" },
          }).catch(() => invocation)));
        await Promise.all(nextMessages
          .filter((message) => ["pending", "streaming"].includes(message.status))
          .map((message) => conversation.updateMessageStatus({
            projectId,
            sessionId,
            messageId: message.id,
            expectedRevision: message.revision,
            status: "cancelled",
            content: "頁面重新載入後已安全停止這次生成；Canon 維持原狀，可按重試重新執行。",
          }).catch(() => message)));
        [nextMessages, nextArtifacts, nextInvocations, nextAttachments] = await Promise.all([
          conversation.listMessages(projectId, sessionId),
          conversation.listArtifacts(projectId, sessionId),
          conversation.listToolInvocations(projectId, sessionId),
          conversation.listAttachments(projectId, sessionId),
        ]);
      } finally {
        reconciledSessionIdsRef.current.add(sessionId);
        releaseLease();
      }
    } else if (!interruptedInvocations.length && !interruptedMessages.length) {
      reconciledSessionIdsRef.current.add(sessionId);
    }
    const pendingLearningArtifacts = nextArtifacts.filter((artifact) => (
      artifact.artifactType === "learning_rule" && artifact.status === "candidate"
    ));
    if (pendingLearningArtifacts.length) {
      const learning = await getLearningCoordinator();
      await Promise.all(pendingLearningArtifacts.map(async (artifact) => {
        const importSession = await repository.get<LearningImportSession>("learningImportSessions", artifact.targetRecordId);
        const staging = await learningRepository.getImportStaging(artifact.targetRecordId);
        if (importSession?.status === "committed" && staging?.formalCommit) {
          await learning.rollbackPendingApproval(projectId, artifact.targetRecordId);
          const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", artifact.id);
          if (currentArtifact?.status === "candidate") {
            await conversation.rejectArtifact(projectId, currentArtifact.sessionId, currentArtifact.id, currentArtifact.revision);
          }
        }
      }));
    }
    nextArtifacts = await conversation.listArtifacts(projectId, sessionId);
    const approvedLearningArtifacts = nextArtifacts.filter((artifact) => (
      artifact.artifactType === "learning_rule" && artifact.status === "approved"
    ));
    if (approvedLearningArtifacts.length) {
      const learning = await getLearningCoordinator();
      await Promise.all(approvedLearningArtifacts.map((artifact) => (
        learning.releaseFinalizedStaging(projectId, artifact.targetRecordId).catch(() => undefined)
      )));
    }
    return {
      messages: nextMessages,
      artifacts: nextArtifacts.sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      invocations: nextInvocations.sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
      attachments: nextAttachments,
    };
  }, [conversation, getLearningCoordinator, learningRepository, operationLocked, projectId, repository]);

  const commitSessionSnapshot = useCallback((
    sessionId: string,
    snapshot: SessionSnapshot,
    token: number,
    expectedIntentToken?: number,
  ) => {
    if (token !== requestTokenRef.current) return false;
    if (expectedIntentToken !== undefined && expectedIntentToken !== sessionIntentRef.current.token) return false;
    setActiveSessionId(sessionId);
    setMessages(snapshot.messages);
    setArtifacts(snapshot.artifacts);
    setInvocations(snapshot.invocations);
    setAttachments(snapshot.attachments);
    sessionIntentRef.current = { ...sessionIntentRef.current, sessionId };
    setQueuedSessionId(null);
    window.sessionStorage.setItem(`novel:conversation-active:${projectId}`, sessionId);
    return true;
  }, [projectId]);

  const refreshSession = useCallback(async (sessionId: string) => {
    const token = ++requestTokenRef.current;
    const snapshot = await readSessionSnapshot(sessionId);
    return commitSessionSnapshot(sessionId, snapshot, token);
  }, [commitSessionSnapshot, readSessionSnapshot]);

  const loadWorkspace = useCallback(async (
    preferredSessionId = "",
    options: WorkspaceLoadOptions = {},
  ) => {
    if (
      options.expectedIntentToken !== undefined
      && options.expectedIntentToken !== sessionIntentRef.current.token
    ) return false;
    const token = ++requestTokenRef.current;
    setLoading(true);
    onError(null);
    try {
      const [loadedProject, loadedChapters] = await Promise.all([
        repository.get<NovelProject>("projects", projectId),
        repository.list<Chapter>("chapters", projectId),
      ]);
      if (!loadedProject || loadedProject.deletedAt) {
        throw Object.assign(new Error("找不到這個小說專案。"), { code: "CONVERSATION_PROJECT_NOT_FOUND" });
      }
      let nextSessions = await conversation.listSessions(projectId, { includeArchived: showArchived });
      if (!nextSessions.length && !showArchived) {
        const allProjectSessions = await repository.list<ConversationSession>("conversationSessions", projectId);
        nextSessions = [await conversation.createSession({
          projectId,
          sessionId: allProjectSessions.length
            ? `conversation-session:${projectId}:recovery:${allProjectSessions.length}`
            : `conversation-session:${projectId}:primary`,
          title: "主要對話",
          activeChapterId: conversationActiveChapter(loadedProject, loadedChapters)?.id ?? null,
        })];
      }
      const remembered = window.sessionStorage.getItem(`novel:conversation-active:${projectId}`) ?? "";
      const selected = nextSessions.find((session) => session.id === (preferredSessionId || remembered)) ?? nextSessions[0] ?? null;
      const snapshot = selected ? await readSessionSnapshot(selected.id) : null;
      if (token !== requestTokenRef.current) return false;
      if (
        options.expectedIntentToken !== undefined
        && options.expectedIntentToken !== sessionIntentRef.current.token
      ) return false;
      setProject(loadedProject);
      setChapters([...loadedChapters].sort((left, right) => left.order - right.order));
      setSessions(nextSessions);
      if (selected && snapshot) {
        commitSessionSnapshot(selected.id, snapshot, token, options.expectedIntentToken);
      }
      else {
        setActiveSessionId("");
        setMessages([]);
        setArtifacts([]);
        setInvocations([]);
        setAttachments([]);
      }
      onProgress("對話、核准記憶與目前章節已同步。");
      return true;
    } catch (error) {
      if (token === requestTokenRef.current) {
        onError({ code: operationErrorCode(error), message: operationErrorMessage(error) });
      }
      return false;
    } finally {
      if (token === requestTokenRef.current) setLoading(false);
    }
  }, [commitSessionSnapshot, conversation, onError, onProgress, projectId, readSessionSnapshot, repository, showArchived]);

  const chooseSession = useCallback(async (sessionId: string, busy: boolean) => {
    if (busy) return false;
    const intentToken = beginSessionIntent(sessionId);
    if (sessionId === activeSessionId) {
      setQueuedSessionId(null);
      onSidebarClose();
      return true;
    }
    const token = ++requestTokenRef.current;
    setSwitchingSessionId(sessionId);
    try {
      const snapshot = await readSessionSnapshot(sessionId);
      const committed = commitSessionSnapshot(sessionId, snapshot, token, intentToken);
      if (committed) onSidebarClose();
      return committed;
    } catch (error) {
      if (token === requestTokenRef.current) {
        onError({ code: operationErrorCode(error), message: operationErrorMessage(error) });
      }
      return false;
    } finally {
      if (token === requestTokenRef.current) setSwitchingSessionId(null);
    }
  }, [activeSessionId, beginSessionIntent, commitSessionSnapshot, onError, onSidebarClose, readSessionSnapshot]);

  const completeBranchNavigation = useCallback(async (
    createdSessionId: string | null,
    branchIntentToken: number,
    fallbackSessionId: string,
  ) => {
    while (true) {
      const latestIntent = sessionIntentRef.current;
      const branchSelected = latestIntent.token === branchIntentToken;
      const selectedSessionId = branchSelected
        ? createdSessionId ?? fallbackSessionId
        : latestIntent.sessionId || fallbackSessionId;
      const loaded = await loadWorkspace(selectedSessionId, {
        expectedIntentToken: latestIntent.token,
      });
      if (loaded) return { loaded: true, branchSelected, selectedSessionId };
      if (latestIntent.token === sessionIntentRef.current.token) {
        return { loaded: false, branchSelected, selectedSessionId };
      }
    }
  }, [loadWorkspace]);

  const currentChapter = conversationActiveChapter(project, chapters);
  const derived = useConversationSession({ projectId, sessions, activeSessionId, search });
  return {
    project,
    chapters,
    sessions,
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
    ...derived,
    setSearch,
    setShowArchived,
    loadWorkspace,
    refreshSession,
    chooseSession,
    beginSessionIntent,
    queueSessionIntent,
    completeBranchNavigation,
  };
}

export function useConversationSession({
  projectId,
  sessions,
  activeSessionId,
  search,
}: {
  projectId: string;
  sessions: ConversationSession[];
  activeSessionId: string;
  search: string;
}) {
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const visibleSessions = useMemo(() => {
    const query = search.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
    if (!query) return sessions;
    return sessions.filter((session) =>
      session.title.normalize("NFKC").toLocaleLowerCase("zh-TW").includes(query));
  }, [search, sessions]);
  const rememberActiveSession = useCallback((sessionId: string) => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(`novel:conversation-active:${projectId}`, sessionId);
    }
  }, [projectId]);
  return { activeSession, visibleSessions, rememberActiveSession };
}
