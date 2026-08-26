"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ConversationMessage, ConversationSession } from "@/lib/novel-ai/domain";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";

export type ConversationEditCopyResult = {
  sessionId: string;
  userMessageId: string;
  content: string;
  navigation: {
    loaded: boolean;
    branchSelected: boolean;
    selectedSessionId: string;
  };
};

type PendingEditRequest = {
  message: ConversationMessage;
  sessionTitle: string;
  confirming: boolean;
  resolve: (result: ConversationEditCopyResult | null) => void;
};

function editCopyErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "CONVERSATION_EDIT_COPY_FAILED");
    return code.includes("BRANCH") ? "CONVERSATION_EDIT_COPY_FAILED" : code;
  }
  return "CONVERSATION_EDIT_COPY_FAILED";
}

function editCopyErrorMessage(error: unknown) {
  return error instanceof Error && error.message && !error.message.includes("BRANCH")
    ? error.message
    : "修改沒有完成；原訊息、原對話與正式作品都維持原狀。";
}

export function useConversationBranchController({
  projectId,
  conversation,
  activeSession,
  busy,
  operationLockRef,
  setBusy,
  beginSessionIntent,
  completeBranchNavigation,
  onProgress,
  onError,
}: {
  projectId: string;
  conversation: ConversationRepositoryService;
  activeSession: ConversationSession | null;
  busy: boolean;
  operationLockRef: MutableRefObject<boolean>;
  setBusy: (busy: boolean) => void;
  beginSessionIntent: (sessionId: string) => number;
  completeBranchNavigation: (
    createdSessionId: string | null,
    branchIntentToken: number,
    fallbackSessionId: string,
  ) => Promise<{ loaded: boolean; branchSelected: boolean; selectedSessionId: string }>;
  onProgress: (message: string) => void;
  onError: (error: { code: string; message: string } | null) => void;
}) {
  const pendingOperationRef = useRef<{
    messageId: string;
    intentToken: number;
  } | null>(null);
  const pendingEditRequestRef = useRef<PendingEditRequest | null>(null);
  const editDraftRef = useRef("");
  const [pendingMessageIds, setPendingMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  const [editDialog, setEditDialog] = useState<{
    messageId: string;
    sourceContent: string;
    value: string;
    confirming: boolean;
  } | null>(null);

  const acquire = useCallback((messageId: string, sourceSessionId: string) => {
    if (busy || operationLockRef.current || pendingOperationRef.current) {
      onProgress(pendingOperationRef.current
        ? "正在準備修改副本；沒有啟動第二個操作。"
        : "目前另有操作正在執行；請完成後再修改訊息。");
      return null;
    }
    const intentToken = beginSessionIntent(sourceSessionId);
    operationLockRef.current = true;
    pendingOperationRef.current = { messageId, intentToken };
    setPendingMessageIds(new Set([messageId]));
    setBusy(true);
    onError(null);
    onProgress("正在準備修改副本……");
    return intentToken;
  }, [beginSessionIntent, busy, onError, onProgress, operationLockRef, setBusy]);

  const release = useCallback((messageId: string) => {
    if (pendingOperationRef.current?.messageId === messageId) {
      pendingOperationRef.current = null;
      operationLockRef.current = false;
      setBusy(false);
    }
    setPendingMessageIds((current) => current.has(messageId) ? new Set() : current);
  }, [operationLockRef, setBusy]);

  const editMessage = useCallback((message: ConversationMessage) => {
    if (busy || operationLockRef.current || pendingOperationRef.current || pendingEditRequestRef.current) {
      onProgress(pendingEditRequestRef.current
        ? "修改視窗已開啟；沒有啟動第二個操作。"
        : "目前另有操作正在執行；請完成後再修改訊息。");
      return Promise.resolve(null);
    }
    editDraftRef.current = message.content;
    setEditDialog({
      messageId: message.id,
      sourceContent: message.content,
      value: message.content,
      confirming: false,
    });
    onError(null);
    onProgress("請在視窗中修改內容；確認前不會建立副本。");
    return new Promise<ConversationEditCopyResult | null>((resolve) => {
      pendingEditRequestRef.current = {
        message,
        sessionTitle: activeSession?.title ?? "對話",
        confirming: false,
        resolve,
      };
    });
  }, [activeSession?.title, busy, onError, onProgress, operationLockRef]);

  const updateEditDraft = useCallback((value: string) => {
    editDraftRef.current = value;
    setEditDialog((current) => current ? { ...current, value } : current);
  }, []);

  const cancelEditMessage = useCallback(() => {
    const pending = pendingEditRequestRef.current;
    if (!pending || pending.confirming) return;
    pendingEditRequestRef.current = null;
    editDraftRef.current = "";
    setEditDialog(null);
    onError(null);
    onProgress("已取消修改；沒有建立副本。");
    pending.resolve(null);
  }, [onError, onProgress]);

  const confirmEditMessage = useCallback(async () => {
    const pending = pendingEditRequestRef.current;
    if (!pending || pending.confirming) return;
    const edited = editDraftRef.current.trim();
    if (!edited) {
      onError({
        code: "CONVERSATION_EDIT_COPY_EMPTY",
        message: "修改內容不能是空白；尚未建立副本。",
      });
      return;
    }
    const { message } = pending;
    const intentToken = acquire(message.id, message.sessionId);
    if (intentToken === null) return;
    pending.confirming = true;
    setEditDialog((current) => current ? { ...current, confirming: true } : current);
    let result: ConversationEditCopyResult | null = null;
    try {
      const branched = await conversation.editMessageWithBranch({
        projectId,
        sessionId: message.sessionId,
        messageId: message.id,
        content: edited,
        title: `${pending.sessionTitle} · 修改副本`,
      });
      const navigation = await completeBranchNavigation(
        branched.session.id,
        intentToken,
        message.sessionId,
      );
      if (navigation.loaded) {
        onProgress(navigation.branchSelected
          ? "修改副本已建立，原訊息仍保留在原對話。"
          : "修改副本已建立；已保留你後來選擇的對話。");
      }
      if (navigation.loaded) {
        result = {
          sessionId: branched.session.id,
          userMessageId: branched.message.id,
          content: edited,
          navigation,
        };
      }
    } catch (error) {
      await completeBranchNavigation(null, intentToken, message.sessionId).catch(() => undefined);
      onError({ code: editCopyErrorCode(error), message: editCopyErrorMessage(error) });
    } finally {
      release(message.id);
      if (pendingEditRequestRef.current === pending) {
        pendingEditRequestRef.current = null;
        editDraftRef.current = "";
        setEditDialog(null);
      }
      pending.resolve(result);
    }
  }, [acquire, completeBranchNavigation, conversation, onError, onProgress, projectId, release]);

  useEffect(() => () => {
    pendingEditRequestRef.current?.resolve(null);
    pendingEditRequestRef.current = null;
  }, []);

  const isBranchPending = useCallback(() => pendingOperationRef.current !== null, []);

  return {
    pendingMessageIds,
    isBranchPending,
    editMessage,
    editDialog,
    updateEditDraft,
    cancelEditMessage,
    confirmEditMessage,
  };
}

export function useConversationBranch(messages: ConversationMessage[]) {
  return useMemo(() => {
    const byId = new Map(messages.map((message) => [message.id, message]));
    const lineageByMessageId = new Map<string, { rootId: string; depth: number }>();
    const resolve = (message: ConversationMessage, visiting = new Set<string>()): { rootId: string; depth: number } => {
      const existing = lineageByMessageId.get(message.id);
      if (existing) return existing;
      if (!message.parentMessageId || visiting.has(message.id)) {
        const root = { rootId: message.id, depth: 0 };
        lineageByMessageId.set(message.id, root);
        return root;
      }
      const parent = byId.get(message.parentMessageId);
      if (!parent) {
        const detached = { rootId: message.id, depth: 0 };
        lineageByMessageId.set(message.id, detached);
        return detached;
      }
      const nextVisiting = new Set(visiting).add(message.id);
      const parentLineage = resolve(parent, nextVisiting);
      const lineage = { rootId: parentLineage.rootId, depth: parentLineage.depth + 1 };
      lineageByMessageId.set(message.id, lineage);
      return lineage;
    };
    for (const message of messages) resolve(message);
    return { byId, lineageByMessageId };
  }, [messages]);
}
