"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import type { ConversationMessage } from "@/lib/novel-ai/domain";

export const CONVERSATION_TIMELINE_INITIAL_WINDOW = 120;
export const CONVERSATION_TIMELINE_PAGE_SIZE = 120;

export function conversationTimelineStartIndex(totalMessages: number, visibleCount: number) {
  return Math.max(0, Math.max(0, totalMessages) - Math.max(0, visibleCount));
}

export function nextConversationTimelineVisibleCount(totalMessages: number, visibleCount: number) {
  return Math.min(
    Math.max(0, totalMessages),
    Math.max(0, visibleCount) + CONVERSATION_TIMELINE_PAGE_SIZE,
  );
}

export function restoredScrollTopAfterPrepend(
  previousScrollTop: number,
  previousScrollHeight: number,
  nextScrollHeight: number,
) {
  return Math.max(0, previousScrollTop + Math.max(0, nextScrollHeight - previousScrollHeight));
}

type ScrollSnapshot = {
  scrollTop: number;
  visibleCount: number;
};

type ActiveSessionRestore = {
  token: number;
  lastWriteAt: number;
  lastWrittenScrollTop: number;
};

function storageKey(projectId: string, sessionId: string) {
  return `novel:conversation-scroll:${projectId}:${sessionId}`;
}

function readSnapshot(projectId: string, sessionId: string): ScrollSnapshot | null {
  if (typeof window === "undefined" || !sessionId) return null;
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(storageKey(projectId, sessionId)) ?? "null") as Partial<ScrollSnapshot> | null;
    if (!parsed || !Number.isFinite(parsed.scrollTop) || !Number.isInteger(parsed.visibleCount)) return null;
    return {
      scrollTop: Math.max(0, Number(parsed.scrollTop)),
      visibleCount: Math.max(CONVERSATION_TIMELINE_INITIAL_WINDOW, Number(parsed.visibleCount)),
    };
  } catch {
    return null;
  }
}

export function useConversationTimelineWindow({
  projectId,
  sessionId,
  messages,
  updateToken,
}: {
  projectId: string;
  sessionId: string;
  messages: ConversationMessage[];
  updateToken: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prependSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const pendingSessionRestoreRef = useRef<ScrollSnapshot | null | undefined>(undefined);
  const followTailRef = useRef(true);
  const prependFrameRef = useRef<number | null>(null);
  const sessionRestoreFrameRef = useRef<number | null>(null);
  const sessionRestoreGuardTimerRef = useRef<number | null>(null);
  const sessionRestoreStateRef = useRef<ActiveSessionRestore | null>(null);
  const sessionRestoreTokenRef = useRef(0);
  const persistenceTimerRef = useRef<number | null>(null);
  const pageTearingDownRef = useRef(false);
  const [visibleCount, setVisibleCount] = useState(CONVERSATION_TIMELINE_INITIAL_WINDOW);
  const [restoreVersion, setRestoreVersion] = useState(0);

  const cancelSessionRestore = useCallback((container = containerRef.current) => {
    sessionRestoreTokenRef.current += 1;
    if (sessionRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(sessionRestoreFrameRef.current);
      sessionRestoreFrameRef.current = null;
    }
    if (sessionRestoreGuardTimerRef.current !== null) {
      window.clearTimeout(sessionRestoreGuardTimerRef.current);
      sessionRestoreGuardTimerRef.current = null;
    }
    sessionRestoreStateRef.current = null;
    container?.removeAttribute("data-scroll-restoring");
  }, []);

  useEffect(() => {
    cancelSessionRestore();
    const snapshot = readSnapshot(projectId, sessionId);
    const timer = window.setTimeout(() => {
      pendingSessionRestoreRef.current = snapshot;
      setVisibleCount(snapshot?.visibleCount ?? CONVERSATION_TIMELINE_INITIAL_WINDOW);
      setRestoreVersion((current) => current + 1);
      followTailRef.current = !snapshot;
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (prependFrameRef.current !== null) window.cancelAnimationFrame(prependFrameRef.current);
      cancelSessionRestore();
    };
  }, [cancelSessionRestore, projectId, sessionId]);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    const beginTeardown = () => {
      pageTearingDownRef.current = true;
      if (persistenceTimerRef.current !== null) {
        window.clearTimeout(persistenceTimerRef.current);
        persistenceTimerRef.current = null;
      }
    };
    const resumePage = () => {
      pageTearingDownRef.current = false;
    };
    window.addEventListener("beforeunload", beginTeardown);
    window.addEventListener("pagehide", beginTeardown);
    window.addEventListener("pageshow", resumePage);
    return () => {
      window.removeEventListener("beforeunload", beginTeardown);
      window.removeEventListener("pagehide", beginTeardown);
      window.removeEventListener("pageshow", resumePage);
      if (persistenceTimerRef.current !== null) window.clearTimeout(persistenceTimerRef.current);
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  const startIndex = conversationTimelineStartIndex(messages.length, visibleCount);
  const visibleMessages = useMemo(
    () => messages.slice(startIndex),
    [messages, startIndex],
  );

  const loadEarlier = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      prependSnapshotRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }
    setVisibleCount((current) => nextConversationTimelineVisibleCount(messages.length, current));
  }, [messages.length]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // This timeline owns prepend and reload restoration. Native overflow anchoring
    // otherwise shifts the saved offset again while the 240-row window settles.
    container.style.overflowAnchor = "none";
    if (pendingSessionRestoreRef.current !== undefined && messages.length) {
      const snapshot = pendingSessionRestoreRef.current;
      pendingSessionRestoreRef.current = undefined;
      cancelSessionRestore(container);
      const restoreToken = sessionRestoreTokenRef.current + 1;
      sessionRestoreTokenRef.current = restoreToken;
      sessionRestoreStateRef.current = {
        token: restoreToken,
        lastWriteAt: Number.NEGATIVE_INFINITY,
        lastWrittenScrollTop: Number.NaN,
      };
      container.setAttribute("data-scroll-restoring", "true");
      const restoreSessionScroll = () => {
        const restoreState = sessionRestoreStateRef.current;
        if (!restoreState || restoreState.token !== restoreToken) return false;
        container.scrollTop = snapshot?.scrollTop ?? container.scrollHeight;
        restoreState.lastWriteAt = performance.now();
        restoreState.lastWrittenScrollTop = container.scrollTop;
        followTailRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 96;
        return true;
      };
      restoreSessionScroll();
      const restoreStartedAt = performance.now();
      const restoreUntilLayoutSettles = () => {
        if (!restoreSessionScroll()) return;
        if (performance.now() - restoreStartedAt < 750) {
          sessionRestoreFrameRef.current = window.requestAnimationFrame(restoreUntilLayoutSettles);
        } else {
          sessionRestoreFrameRef.current = null;
          sessionRestoreGuardTimerRef.current = window.setTimeout(() => {
            const restoreState = sessionRestoreStateRef.current;
            if (restoreState?.token === restoreToken) {
              sessionRestoreStateRef.current = null;
              container.removeAttribute("data-scroll-restoring");
            }
            sessionRestoreGuardTimerRef.current = null;
          }, 120);
        }
      };
      sessionRestoreFrameRef.current = window.requestAnimationFrame(restoreUntilLayoutSettles);
      return;
    }
    const prependSnapshot = prependSnapshotRef.current;
    if (prependSnapshot) {
      prependSnapshotRef.current = null;
      const restorePrependAnchor = () => {
        container.scrollTop = restoredScrollTopAfterPrepend(
          prependSnapshot.scrollTop,
          prependSnapshot.scrollHeight,
          container.scrollHeight,
        );
      };
      restorePrependAnchor();
      if (prependFrameRef.current !== null) window.cancelAnimationFrame(prependFrameRef.current);
      prependFrameRef.current = window.requestAnimationFrame(restorePrependAnchor);
      return;
    }
    if (followTailRef.current) container.scrollTop = container.scrollHeight;
  }, [cancelSessionRestore, messages.length, restoreVersion, updateToken, visibleCount]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const restoreState = sessionRestoreStateRef.current;
    if (restoreState) {
      // Only the exact offset written by the restore loop belongs to the loop.
      // Pointer automation and real touch/wheel input can arrive inside the same
      // 120 ms guard, so time alone would incorrectly pull the reader away from
      // the choice they are trying to reach.
      const matchesLastWrite = Number.isFinite(restoreState.lastWrittenScrollTop)
        && Math.abs(container.scrollTop - restoreState.lastWrittenScrollTop) <= 1;
      const restoreGenerated = event.nativeEvent.isTrusted
        && matchesLastWrite
        && performance.now() - restoreState.lastWriteAt <= 120;
      if (restoreGenerated) return;
      // A wheel/touch/keyboard/test scroll changed the offset while the layout
      // settle loop was active. The user's position now owns the timeline.
      cancelSessionRestore(container);
    }
    followTailRef.current = container.scrollHeight - container.scrollTop - container.clientHeight < 96;
    if (!sessionId || pageTearingDownRef.current) return;
    const snapshot = {
      scrollTop: container.scrollTop,
      visibleCount,
    } satisfies ScrollSnapshot;
    if (persistenceTimerRef.current !== null) window.clearTimeout(persistenceTimerRef.current);
    persistenceTimerRef.current = window.setTimeout(() => {
      persistenceTimerRef.current = null;
      if (pageTearingDownRef.current) return;
      try {
        window.sessionStorage.setItem(storageKey(projectId, sessionId), JSON.stringify(snapshot));
      } catch {
        // A full/disabled sessionStorage must not affect the conversation itself.
      }
    }, 100);
  }, [cancelSessionRestore, projectId, sessionId, visibleCount]);

  const cancelSessionRestoreForInteraction = useCallback(() => {
    if (sessionRestoreStateRef.current) cancelSessionRestore();
  }, [cancelSessionRestore]);

  return {
    containerRef,
    visibleMessages,
    hiddenMessageCount: startIndex,
    renderedMessageCount: visibleMessages.length,
    loadEarlier,
    onScroll,
    cancelSessionRestoreForInteraction,
  };
}
