"use client";

import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ConversationMessage, ConversationSession } from "@/lib/novel-ai/domain";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";

function branchErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_BRANCH_FAILED");
  }
  return "CONVERSATION_BRANCH_FAILED";
}

function branchErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "分支沒有完成；原對話與正式作品都維持原狀。";
}

function branchTitle(sessionTitle: string, message: ConversationMessage) {
  const base = sessionTitle.replace(/(?:\s*·\s*(?:(?:編輯)?分支|支線)(?:[：:][^·]{0,24})?)+$/gu, "").trim() || "主要對話";
  const excerpt = message.content.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 18);
  return `${base} · 支線${excerpt ? `：${excerpt}` : ""}`;
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
    kind: "branch" | "edit";
    intentToken: number;
  } | null>(null);
  const [pendingMessageIds, setPendingMessageIds] = useState<ReadonlySet<string>>(() => new Set());

  const acquire = useCallback((messageId: string, kind: "branch" | "edit", sourceSessionId: string) => {
    if (busy || operationLockRef.current || pendingOperationRef.current) {
      onProgress(pendingOperationRef.current
        ? "分支已在建立中；沒有啟動第二個操作。"
        : "目前另有操作正在執行；請完成後再建立分支。");
      return null;
    }
    const intentToken = beginSessionIntent(sourceSessionId);
    operationLockRef.current = true;
    pendingOperationRef.current = { messageId, kind, intentToken };
    setPendingMessageIds(new Set([messageId]));
    setBusy(true);
    onError(null);
    onProgress(kind === "edit" ? "正在建立編輯分支……" : "正在建立分支……");
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

  const createBranch = useCallback(async (message: ConversationMessage, editedContent?: string) => {
    const sourceSession = activeSession;
    if (!sourceSession) return false;
    const intentToken = acquire(message.id, "branch", sourceSession.id);
    if (intentToken === null) return false;
    try {
      const branched = await conversation.branchSession({
        projectId,
        sourceSessionId: sourceSession.id,
        fromMessageId: message.id,
        title: branchTitle(sourceSession.title, message),
      });
      if (editedContent?.trim()) {
        await conversation.appendMessage({
          projectId,
          sessionId: branched.session.id,
          role: "user",
          content: editedContent.trim(),
          sourceMessageId: message.id,
          parentMessageId: branched.messages.at(-1)?.id ?? null,
        });
      }
      const navigation = await completeBranchNavigation(
        branched.session.id,
        intentToken,
        sourceSession.id,
      );
      if (navigation.loaded) {
        onProgress(navigation.branchSelected
          ? "分支已建立，已切換到新對話。"
          : "分支已建立；已保留你後來選擇的對話，沒有被分支完成覆蓋。");
      }
      return navigation.loaded;
    } catch (error) {
      await completeBranchNavigation(null, intentToken, sourceSession.id).catch(() => undefined);
      onError({ code: branchErrorCode(error), message: branchErrorMessage(error) });
      return false;
    } finally {
      release(message.id);
    }
  }, [acquire, activeSession, completeBranchNavigation, conversation, onError, onProgress, projectId, release]);

  const editMessage = useCallback(async (message: ConversationMessage) => {
    const intentToken = acquire(message.id, "edit", message.sessionId);
    if (intentToken === null) return false;
    try {
      const edited = window.prompt(
        "編輯訊息會保留原對話，並從這裡建立新分支。",
        message.content,
      );
      if (!edited?.trim() || edited.trim() === message.content.trim()) return false;
      const branched = await conversation.editMessageWithBranch({
        projectId,
        sessionId: message.sessionId,
        messageId: message.id,
        content: edited.trim(),
        title: `${activeSession?.title ?? "對話"} · 編輯分支`,
      });
      const navigation = await completeBranchNavigation(
        branched.session.id,
        intentToken,
        message.sessionId,
      );
      if (navigation.loaded) {
        onProgress(navigation.branchSelected
          ? "編輯分支已建立，原訊息仍保留在原對話。"
          : "編輯分支已建立；已保留你後來選擇的對話。");
      }
      return navigation.loaded;
    } catch (error) {
      await completeBranchNavigation(null, intentToken, message.sessionId).catch(() => undefined);
      onError({ code: branchErrorCode(error), message: branchErrorMessage(error) });
      return false;
    } finally {
      release(message.id);
    }
  }, [acquire, activeSession?.title, completeBranchNavigation, conversation, onError, onProgress, projectId, release]);

  const isBranchPending = useCallback(() => pendingOperationRef.current !== null, []);

  return {
    pendingMessageIds,
    isBranchPending,
    createBranch,
    editMessage,
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
