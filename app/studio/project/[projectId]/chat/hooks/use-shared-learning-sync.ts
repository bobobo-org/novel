"use client";

import { useCallback, useEffect } from "react";
import {
  ingestSharedLearningSnapshot,
  type SharedLearningSnapshot,
  type SovereignLearningRepository,
} from "@/lib/novel-ai/sovereign-learning";

type SyncResult = "ready" | "cached" | "degraded";
type SyncEntry = { expiresAt: number; promise: Promise<SyncResult> };

const syncByProject = new Map<string, SyncEntry>();
const SUCCESS_TTL_MS = 60_000;
const FAILURE_TTL_MS = 10_000;
const REQUEST_TIMEOUT_MS = 1_600;

function waitForForegroundSync(
  promise: Promise<SyncResult>,
  signal?: AbortSignal,
): Promise<SyncResult> {
  return new Promise((resolve) => {
    let finished = false;
    const complete = (result: SyncResult) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => complete("degraded");
    const timer = window.setTimeout(() => complete("degraded"), REQUEST_TIMEOUT_MS);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    void promise.then(complete, () => complete("degraded"));
  });
}

async function syncSharedLearning(
  projectId: string,
  repository: SovereignLearningRepository,
): Promise<SyncResult> {
  const cached = syncByProject.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = (async (): Promise<SyncResult> => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort("SHARED_LEARNING_SYNC_TIMEOUT"), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/ai/learning/shared-library?limit=24", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return "degraded";
      const snapshot = await response.json() as SharedLearningSnapshot;
      const result = await ingestSharedLearningSnapshot(repository, { projectId, snapshot });
      return result.status === "unchanged" ? "cached" : "ready";
    } catch {
      return "degraded";
    } finally {
      window.clearTimeout(timeout);
    }
  })();
  syncByProject.set(projectId, { expiresAt: Date.now() + SUCCESS_TTL_MS, promise });
  const result = await promise;
  if (result === "degraded") {
    syncByProject.set(projectId, { expiresAt: Date.now() + FAILURE_TTL_MS, promise: Promise.resolve(result) });
  }
  return result;
}

export function useSharedLearningSync(
  projectId: string,
  repository: SovereignLearningRepository,
) {
  const ensureSharedLearningReady = useCallback(
    (signal?: AbortSignal) => waitForForegroundSync(
      syncSharedLearning(projectId, repository),
      signal,
    ),
    [projectId, repository],
  );

  useEffect(() => {
    void ensureSharedLearningReady();
  }, [ensureSharedLearningReady]);

  return ensureSharedLearningReady;
}
