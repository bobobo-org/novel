import type {
  BrowserFabricContextItem,
  BrowserFabricTask,
  BrowserFabricVisibility,
} from "./types";

export type NarrativeMemoryLevel = "L0" | "L1" | "L2" | "L3" | "L4";
export type NarrativeMemoryPyramid = {
  schemaVersion: "narrative-memory-pyramid-v1";
  levels: Record<NarrativeMemoryLevel, BrowserFabricContextItem[]>;
  authorityItemCount: number;
  filteredItemCount: number;
  rejectedCrossNamespaceCount: number;
  crossNamespaceLeakCount: 0;
};

const NAMESPACE_KEYS = [
  "tenantId",
  "userId",
  "projectId",
  "storyId",
  "canonId",
  "branchId",
] as const;

function belongsToTaskNamespace(
  item: BrowserFabricContextItem,
  task: BrowserFabricTask,
) {
  return NAMESPACE_KEYS.every((key) => {
    const declared = item.metadata?.[key];
    return declared == null || String(declared) === task.namespace[key];
  });
}

function visibleTo(
  visibility: BrowserFabricVisibility,
  audience: "actor" | "evaluator",
  allowFutureReveal: boolean,
) {
  if (visibility === "FUTURE_REVEAL") return allowFutureReveal;
  if (visibility === "AUTHOR_ONLY") return audience === "evaluator";
  if (visibility === "BOTH") return true;
  return visibility === audience.toUpperCase();
}

function memoryLevel(item: BrowserFabricContextItem): NarrativeMemoryLevel {
  if (item.kind === "canon") return "L0";
  if (item.kind === "story-state" || item.kind === "accepted-choice") return "L1";
  if (item.kind === "story-bible" || item.kind === "learning-rule") return "L2";
  if (item.kind === "chapter") return "L3";
  return "L4";
}

export function buildNarrativeMemoryPyramid(input: {
  task: BrowserFabricTask;
  audience: "actor" | "evaluator";
  allowFutureReveal?: boolean;
}): NarrativeMemoryPyramid {
  const levels: NarrativeMemoryPyramid["levels"] = {
    L0: [], L1: [], L2: [], L3: [], L4: [],
  };
  let filteredItemCount = 0;
  let rejectedCrossNamespaceCount = 0;
  for (const item of input.task.context) {
    const sameNamespace = belongsToTaskNamespace(item, input.task);
    const accepted = sameNamespace
      && item.approved
      && visibleTo(item.visibility, input.audience, input.allowFutureReveal ?? false)
      && item.privacyLevel === input.task.privacyLevel;
    if (!accepted) {
      filteredItemCount += 1;
      if (!sameNamespace) rejectedCrossNamespaceCount += 1;
      continue;
    }
    levels[memoryLevel(item)].push({ ...item, text: item.text });
  }
  for (const level of Object.values(levels)) {
    level.sort((left, right) =>
      (right.authorityWeight ?? 0) - (left.authorityWeight ?? 0)
      || (right.revision ?? 0) - (left.revision ?? 0)
      || left.id.localeCompare(right.id));
  }
  return {
    schemaVersion: "narrative-memory-pyramid-v1",
    levels,
    authorityItemCount: levels.L0.length,
    filteredItemCount,
    rejectedCrossNamespaceCount,
    crossNamespaceLeakCount: 0,
  };
}

export function flattenNarrativeMemory(pyramid: NarrativeMemoryPyramid) {
  return ["L0", "L1", "L2", "L3", "L4"]
    .flatMap((level) => pyramid.levels[level as NarrativeMemoryLevel]);
}
