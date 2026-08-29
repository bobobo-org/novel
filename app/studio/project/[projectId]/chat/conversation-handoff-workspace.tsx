"use client";

import { useEffect, useRef, useState } from "react";
import { consumeStoryWorkspaceHandoff } from "@/lib/novel-ai/web/story-workspace-handoff";
import type { PlatformTaskType } from "@/lib/novel-ai/router/platform-types";
import ConversationWorkspace from "./conversation-workspace";

export default function ConversationHandoffWorkspace({
  projectId,
  initialPrompt,
  initialTaskType,
  handoffId,
}: {
  projectId: string;
  initialPrompt: string;
  initialTaskType: PlatformTaskType | null;
  handoffId: string;
}) {
  const [resolvedPrompt, setResolvedPrompt] = useState(initialPrompt);
  const [ready, setReady] = useState(!handoffId);
  const [handoffFailed, setHandoffFailed] = useState(false);
  const consumedHandoffRef = useRef("");

  useEffect(() => {
    if (!handoffId || consumedHandoffRef.current === handoffId) return;
    consumedHandoffRef.current = handoffId;
    const handoff = consumeStoryWorkspaceHandoff({ projectId, handoffId });
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("handoff");
    window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    setResolvedPrompt(handoff?.prompt ?? initialPrompt);
    setHandoffFailed(!handoff);
    setReady(true);
  }, [handoffId, initialPrompt, projectId]);

  if (!ready) {
    return (
      <main data-testid="story-workspace-handoff-loading">
        <p role="status">正在接回同一作品的作者候選……</p>
      </main>
    );
  }

  return (
    <>
      {handoffFailed ? (
        <p role="alert" data-testid="story-workspace-handoff-failed">
          作者候選交接已失效或不屬於此作品；沒有載入其他內容。
        </p>
      ) : null}
      <ConversationWorkspace
        key={`${projectId}:${handoffId || "direct"}`}
        projectId={projectId}
        initialPrompt={resolvedPrompt}
        initialTaskType={initialTaskType}
      />
    </>
  );
}
