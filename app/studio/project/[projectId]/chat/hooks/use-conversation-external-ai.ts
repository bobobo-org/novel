"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EXTERNAL_AI_PROVIDER_IDS,
  type ExternalAIProviderId,
  type ExternalAIProviderPublicStatus,
  type NovelAIExecutionMode,
} from "@/lib/novel-ai/providers/external/external-provider-contract";
import {
  conversationUsesExternalAI,
  isExternalProviderConfigured,
  type ConversationAiSource,
} from "../external-ai";

export function useConversationExternalAiController(
  onSelectionChange: () => void,
) {
  const [aiExecutionMode, setAiExecutionMode] = useState<NovelAIExecutionMode>("closed-only");
  const [hybridAiSource, setHybridAiSource] = useState<ConversationAiSource>("closed");
  const [externalProviderId, setExternalProviderId] = useState<ExternalAIProviderId>("openai");
  const [externalProviderStatuses, setExternalProviderStatuses] = useState<ExternalAIProviderPublicStatus[]>([]);
  const [externalProviderStatusError, setExternalProviderStatusError] = useState<string | null>(null);
  const [externalExecutionEnabled, setExternalExecutionEnabled] = useState(false);
  const [externalRunConsent, setExternalRunConsent] = useState(false);
  const externalSelected = conversationUsesExternalAI(aiExecutionMode, hybridAiSource);
  const externalProviderConfigured = isExternalProviderConfigured(
    externalProviderStatuses,
    externalProviderId,
  );

  const refreshExternalProviderStatuses = useCallback(async (signal: AbortSignal) => {
    setExternalProviderStatusError(null);
    try {
      const response = await fetch("/api/ai/external/providers", {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("外來 AI 接點狀態暫時無法讀取。");
      const snapshot = await response.json() as {
        providers?: ExternalAIProviderPublicStatus[];
        executionEnabled?: boolean;
      };
      if (signal.aborted) return;
      const providers = Array.isArray(snapshot.providers)
        ? snapshot.providers.filter((provider) => EXTERNAL_AI_PROVIDER_IDS.includes(provider.id))
        : [];
      setExternalProviderStatuses(providers);
      setExternalExecutionEnabled(snapshot.executionEnabled === true);
    } catch (error) {
      if (signal.aborted) return;
      setExternalProviderStatuses([]);
      setExternalExecutionEnabled(false);
      setExternalProviderStatusError(
        error instanceof Error ? error.message : "外來 AI 接點狀態暫時無法讀取。",
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => { void refreshExternalProviderStatuses(controller.signal); };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshExternalProviderStatuses]);

  const clearExternalRunConsent = useCallback(() => {
    setExternalRunConsent(false);
  }, []);

  const changeAiExecutionMode = useCallback((mode: NovelAIExecutionMode) => {
    setAiExecutionMode(mode);
    setHybridAiSource(mode === "external-only" ? "external" : "closed");
    setExternalRunConsent(false);
    onSelectionChange();
  }, [onSelectionChange]);

  const changeHybridAiSource = useCallback((source: ConversationAiSource) => {
    setHybridAiSource(source);
    setExternalRunConsent(false);
    onSelectionChange();
  }, [onSelectionChange]);

  const changeExternalProvider = useCallback((providerId: ExternalAIProviderId) => {
    setExternalProviderId(providerId);
    setExternalRunConsent(false);
    onSelectionChange();
  }, [onSelectionChange]);

  return {
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
    changeAiExecutionMode,
    changeHybridAiSource,
    changeExternalProvider,
  };
}
