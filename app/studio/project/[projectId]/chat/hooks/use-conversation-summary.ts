"use client";

import { useCallback } from "react";
import type {
  Chapter,
  ConversationSummary,
  NovelProject,
  StoryBible,
  StoryState,
} from "@/lib/novel-ai/domain";
import { resolveProjectStoryBible } from "@/lib/novel-ai/domain/story-bible-selection";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import type { ConversationRepositoryService } from "@/lib/novel-ai/conversation/repository";
import { conversationCanonRevisionDigest } from "@/lib/novel-ai/web/project-context-composer";
import { activeChapter } from "../conversation-workspace-support";

export function useConversationSummaryController(input: {
  projectId: string;
  repository: NovelRepository;
  conversation: ConversationRepositoryService;
}) {
  const currentCanonRevisionDigest = useCallback(async () => {
    const loadedProject = await input.repository.get<NovelProject>("projects", input.projectId);
    if (!loadedProject) throw new Error("CONVERSATION_PROJECT_NOT_FOUND");
    const [chapters, storyBibles, storyState] = await Promise.all([
      input.repository.list<Chapter>("chapters", input.projectId),
      input.repository.list<StoryBible>("storyBibles", input.projectId),
      input.repository.get<StoryState>("storyStates", loadedProject.storyStateId),
    ]);
    const storyBible = resolveProjectStoryBible(loadedProject, storyBibles);
    return conversationCanonRevisionDigest({
      project: loadedProject,
      activeChapter: activeChapter(loadedProject, chapters),
      storyBible,
      storyState,
    });
  }, [input.projectId, input.repository]);

  const maybeUpdateRollingSummary = useCallback(async (sessionId: string) => {
    const messages = await input.conversation.listMessages(input.projectId, sessionId);
    const olderMessages = messages.slice(0, Math.max(0, messages.length - 12));
    if (olderMessages.length < 6) return null;
    const canonRevisionDigest = await currentCanonRevisionDigest();
    const existing = (await input.repository.list<ConversationSummary>("conversationSummaries", input.projectId))
      .find((summary) => summary.sessionId === sessionId && !summary.invalidatedAt && !summary.deletedAt);
    if (
      existing
      && existing.canonRevisionDigest === canonRevisionDigest
      && existing.sourceMessageIds.length === olderMessages.length
      && existing.sourceMessageIds.every((id, index) => id === olderMessages[index]?.id)
    ) return existing;
    const excerpts = olderMessages.slice(-18).map((message) => {
      const label = message.role === "user" ? "使用者" : message.role === "assistant" ? "助手候選" : "工具狀態";
      return `${label}：${message.content.replace(/\s+/gu, " ").trim().slice(0, 260)}`;
    });
    return input.conversation.upsertSummary({
      projectId: input.projectId,
      sessionId,
      sourceMessageIds: olderMessages.map((message) => message.id),
      content: [
        `這是同一小說專案、同一 Session 較早 ${olderMessages.length} 則訊息的非 Canon 滾動摘要。`,
        "未採用的助手內容只代表候選，不得當成正式作品事實。",
        ...excerpts,
      ].join("\n").slice(0, 6_000),
      canonRevisionDigest,
    });
  }, [currentCanonRevisionDigest, input.conversation, input.projectId, input.repository]);

  return { currentCanonRevisionDigest, maybeUpdateRollingSummary };
}
