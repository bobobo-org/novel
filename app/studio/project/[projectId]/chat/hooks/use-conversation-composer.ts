"use client";

import { useCallback, type KeyboardEvent } from "react";

export function useConversationComposer({
  active,
  busy,
  draft,
  attachmentCount,
  blocked = false,
  onSend,
}: {
  active: boolean;
  busy: boolean;
  draft: string;
  attachmentCount: number;
  blocked?: boolean;
  onSend: () => void;
}) {
  const canSend = active && !busy && !blocked && Boolean(draft.trim() || attachmentCount);
  const submit = useCallback(() => {
    if (canSend) onSend();
  }, [canSend, onSend]);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }, [submit]);
  return { canSend, submit, onKeyDown };
}
