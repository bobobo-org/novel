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

export type ConversationExternalRunConsentIntent = {
  intentId: string;
  providerId: ExternalAIProviderId;
  grantedAt: string;
  expiresAt: string;
};

const EXTERNAL_RUN_CONSENT_INTENT_MS = 2 * 60 * 1_000;

export function useConversationExternalAiController(
  onSelectionChange: () => void,
) {
  const [aiExecutionMode, setAiExecutionMode] = useState<NovelAIExecutionMode>("closed-only");
  const [hybridAiSource, setHybridAiSource] = useState<ConversationAiSource>("closed");
  const [externalProviderId, setExternalProviderId] = useState<ExternalAIProviderId>("openai");
  const [externalProviderStatuses, setExternalProviderStatuses] = useState<ExternalAIProviderPublicStatus[]>([]);
  const [externalProviderStatusError, setExternalProviderStatusError] = useState<string | null>(null);
  const [externalExecutionEnabled, setExternalExecutionEnabled] = useState(false);
  const [externalRunConsentIntent, setExternalRunConsentIntent] = useState<
    ConversationExternalRunConsentIntent | null
  >(null);
  const externalSelected = conversationUsesExternalAI(aiExecutionMode, hybridAiSource);
  const externalProviderConfigured = isExternalProviderConfigured(
    externalProviderStatuses,
    externalProviderId,
  );
  const externalRunConsent = Boolean(
    externalRunConsentIntent
    && externalRunConsentIntent.providerId === externalProviderId,
  );

  useEffect(() => {
    if (!externalRunConsentIntent) return;
    const remainingMs = Date.parse(externalRunConsentIntent.expiresAt) - Date.now();
    const timer = window.setTimeout(
      () => setExternalRunConsentIntent(null),
      Math.max(0, remainingMs),
    );
    return () => window.clearTimeout(timer);
  }, [externalRunConsentIntent]);

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
    setExternalRunConsentIntent(null);
  }, []);

  const setExternalRunConsent = useCallback((granted: boolean) => {
    if (!granted) {
      setExternalRunConsentIntent(null);
      return;
    }
    const now = Date.now();
    setExternalRunConsentIntent({
      intentId: `conversation-external-consent:${crypto.randomUUID()}`,
      providerId: externalProviderId,
      grantedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + EXTERNAL_RUN_CONSENT_INTENT_MS).toISOString(),
    });
  }, [externalProviderId]);

  const consumeExternalRunConsentIntent = useCallback(() => {
    const intent = externalRunConsentIntent;
    setExternalRunConsentIntent(null);
    if (
      !intent
      || intent.providerId !== externalProviderId
      || Date.parse(intent.expiresAt) <= Date.now()
    ) return null;
    return intent;
  }, [externalProviderId, externalRunConsentIntent]);

  const changeAiExecutionMode = useCallback((mode: NovelAIExecutionMode) => {
    setAiExecutionMode(mode);
    setHybridAiSource(mode === "external-only" ? "external" : "closed");
    setExternalRunConsentIntent(null);
    onSelectionChange();
  }, [onSelectionChange]);

  const changeHybridAiSource = useCallback((source: ConversationAiSource) => {
    setHybridAiSource(source);
    setExternalRunConsentIntent(null);
    onSelectionChange();
  }, [onSelectionChange]);

  const changeExternalProvider = useCallback((providerId: ExternalAIProviderId) => {
    setExternalProviderId(providerId);
    setExternalRunConsentIntent(null);
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
    externalRunConsentIntent,
    externalSelected,
    externalProviderConfigured,
    setExternalRunConsent,
    clearExternalRunConsent,
    consumeExternalRunConsentIntent,
    changeAiExecutionMode,
    changeHybridAiSource,
    changeExternalProvider,
  };
}
