"use client";

import { useCallback, useRef } from "react";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import type { SovereignLearningRepository } from "@/lib/novel-ai/sovereign-learning";
import type { AtomicLearningImportCoordinator } from "@/lib/novel-ai/conversation/learning-import";

export type ConversationLearningCoordinatorLoader = () => Promise<AtomicLearningImportCoordinator>;

export function useConversationLearningCoordinatorLoader(
  repository: NovelRepository,
  learningRepository: SovereignLearningRepository,
): ConversationLearningCoordinatorLoader {
  const coordinatorPromiseRef = useRef<Promise<AtomicLearningImportCoordinator> | null>(null);

  return useCallback(() => {
    if (!coordinatorPromiseRef.current) {
      coordinatorPromiseRef.current = Promise.all([
        import("@/lib/novel-ai/conversation/learning-import"),
        import("@/lib/novel-ai/web/manual-learning-worker-client"),
      ])
        .then(([{ AtomicLearningImportCoordinator }, { prepareManualLearningFileInWorker }]) => (
          new AtomicLearningImportCoordinator(
            repository,
            learningRepository,
            { prepareFile: prepareManualLearningFileInWorker },
          )
        ))
        .catch((error) => {
          coordinatorPromiseRef.current = null;
          throw error;
        });
    }
    return coordinatorPromiseRef.current;
  }, [learningRepository, repository]);
}
