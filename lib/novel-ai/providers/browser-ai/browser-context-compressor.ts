import type { ClosedAINamespace } from "../../closed-ai-cache";
import { sha256Hex } from "../../closed-ai-cache";
import {
  estimateBrowserTokens,
  fitBrowserTextToTokenBudget,
  type BrowserAIPerformancePolicy,
} from "./browser-performance-policy";

export const BROWSER_CONTEXT_PACK_VERSION = "browser-context-pack-v2" as const;

export type BrowserContextKind =
  | "canon-authority"
  | "current-chapter"
  | "recent-chapter-tail"
  | "story-bible"
  | "timeline"
  | "world-rule"
  | "active-character"
  | "character-knowledge-boundary"
  | "accepted-choice"
  | "active-branch"
  | "rpg-state"
  | "task-achievement"
  | "approved-learning-rule"
  | "user-instruction";

export type BrowserContextVisibility =
  | "actor"
  | "evaluator"
  | "both"
  | "author-only";

export type BrowserContextSource = {
  id: string;
  kind: BrowserContextKind;
  text: string;
  namespace: ClosedAINamespace;
  visibility: BrowserContextVisibility;
  approved: boolean;
  revision: string;
  relevance?: number;
  authority?: number;
};

export type BrowserContextPack = {
  schemaVersion: typeof BROWSER_CONTEXT_PACK_VERSION;
  namespace: ClosedAINamespace;
  audience: "actor" | "evaluator";
  items: Array<{
    id: string;
    kind: BrowserContextKind;
    text: string;
    contentDigest: string;
    originalTokens: number;
    includedTokens: number;
    revision: string;
  }>;
  composedText: string;
  metrics: {
    originalContextTokens: number;
    browserCompressedContextTokens: number;
    tokensSaved: number;
    compressionRatio: number;
    retrievalPrecision: number;
    duplicateItemsRemoved: number;
    namespaceItemsRejected: number;
    visibilityItemsRejected: number;
    unapprovedItemsRejected: number;
    authorOnlyLeakCount: 0;
    crossProjectLeakCount: 0;
  };
  externalRequest: false;
  dataLeftDevice: false;
  canonicalMutationCount: 0;
};

const KIND_PRIORITY: Record<BrowserContextKind, number> = {
  "canon-authority": 100,
  "current-chapter": 98,
  "recent-chapter-tail": 94,
  "active-branch": 92,
  "character-knowledge-boundary": 90,
  "accepted-choice": 88,
  "active-character": 86,
  "world-rule": 84,
  "story-bible": 82,
  timeline: 80,
  "rpg-state": 78,
  "task-achievement": 76,
  "approved-learning-rule": 72,
  "user-instruction": 96,
};

function sameExecutionBoundary(left: ClosedAINamespace, right: ClosedAINamespace) {
  return left.tenantId === right.tenantId
    && left.userId === right.userId
    && left.projectId === right.projectId
    && left.storyId === right.storyId
    && left.canonId === right.canonId
    && left.branchId === right.branchId
    && left.characterId === right.characterId
    && left.agentRole === right.agentRole
    && left.modelId === right.modelId
    && left.modelDigest === right.modelDigest
    && left.promptProfileVersion === right.promptProfileVersion
    && left.storyBibleRevision === right.storyBibleRevision
    && left.knowledgeScopeRevision === right.knowledgeScopeRevision
    && left.privacyLevel === right.privacyLevel;
}

function budgetFamily(kind: BrowserContextKind):
  | "canon"
  | "recent"
  | "character"
  | "world"
  | "retrieval" {
  if (kind === "canon-authority" || kind === "active-branch") return "canon";
  if (
    kind === "current-chapter"
    || kind === "recent-chapter-tail"
    || kind === "user-instruction"
  ) return "recent";
  if (
    kind === "active-character"
    || kind === "character-knowledge-boundary"
  ) return "character";
  if (kind === "world-rule" || kind === "rpg-state") return "world";
  return "retrieval";
}

function familyBudgets(policy: BrowserAIPerformancePolicy) {
  return {
    canon: policy.canonBudgetTokens,
    recent: policy.recentChapterBudgetTokens,
    character: policy.characterBudgetTokens,
    world: policy.worldBudgetTokens,
    retrieval: policy.retrievalBudgetTokens,
  };
}

function trimToTokenBudget(text: string, maxTokens: number) {
  if (maxTokens <= 0) return "";
  return fitBrowserTextToTokenBudget(text.trim(), maxTokens, {
    marker: "\n[…已壓縮…]\n",
    headRatio: 0.36,
  }).text;
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export async function composeBrowserContextPack(input: {
  namespace: ClosedAINamespace;
  audience: "actor" | "evaluator";
  sources: BrowserContextSource[];
  performancePolicy: BrowserAIPerformancePolicy;
}): Promise<BrowserContextPack> {
  const originalContextTokens = input.sources.reduce(
    (sum, source) => sum + estimateBrowserTokens(source.text),
    0,
  );
  let namespaceItemsRejected = 0;
  let visibilityItemsRejected = 0;
  let unapprovedItemsRejected = 0;
  const accepted = input.sources.filter((source) => {
    if (!sameExecutionBoundary(source.namespace, input.namespace)) {
      namespaceItemsRejected += 1;
      return false;
    }
    if (!source.approved && source.kind !== "user-instruction") {
      unapprovedItemsRejected += 1;
      return false;
    }
    const visible = input.audience === "actor"
      ? source.visibility === "actor" || source.visibility === "both"
      : source.visibility === "evaluator" || source.visibility === "both";
    if (!visible || source.visibility === "author-only") {
      visibilityItemsRejected += 1;
      return false;
    }
    return Boolean(source.text.trim());
  });

  const digested = await Promise.all(accepted.map(async (source) => ({
    source,
    digest: await sha256Hex(source.text.trim()),
  })));
  const seen = new Set<string>();
  let duplicateItemsRemoved = 0;
  const unique = digested.filter((item) => {
    const key = `${item.source.kind}:${item.digest}`;
    if (seen.has(key)) {
      duplicateItemsRemoved += 1;
      return false;
    }
    seen.add(key);
    return true;
  });
  unique.sort((left, right) => {
    const leftScore = KIND_PRIORITY[left.source.kind]
      + (left.source.authority ?? 0) * 12
      + (left.source.relevance ?? 0) * 10;
    const rightScore = KIND_PRIORITY[right.source.kind]
      + (right.source.authority ?? 0) * 12
      + (right.source.relevance ?? 0) * 10;
    return rightScore - leftScore || left.source.id.localeCompare(right.source.id);
  });

  const remaining = familyBudgets(input.performancePolicy);
  const items: BrowserContextPack["items"] = [];
  let composedText = "";
  for (const item of unique) {
    const family = budgetFamily(item.source.kind);
    if (remaining[family] <= 0) continue;
    const originalTokens = estimateBrowserTokens(item.source.text);
    const separator = items.length ? "\n\n" : "";
    const heading = `[${item.source.kind}]\n`;
    const baseText = `${composedText}${separator}${heading}`;
    const totalRemaining = Math.max(
      0,
      input.performancePolicy.inputBudgetTokens - estimateBrowserTokens(baseText),
    );
    const itemBudget = Math.min(remaining[family], totalRemaining);
    const text = trimToTokenBudget(item.source.text, itemBudget);
    const includedTokens = estimateBrowserTokens(text);
    if (!text || includedTokens <= 0) continue;
    const nextComposedText = `${baseText}${text}`;
    if (
      estimateBrowserTokens(nextComposedText)
      > input.performancePolicy.inputBudgetTokens
    ) continue;
    remaining[family] = Math.max(0, remaining[family] - includedTokens);
    composedText = nextComposedText;
    items.push({
      id: item.source.id,
      kind: item.source.kind,
      text,
      contentDigest: item.digest,
      originalTokens,
      includedTokens,
      revision: item.source.revision,
    });
  }
  const browserCompressedContextTokens = estimateBrowserTokens(composedText);
  const tokensSaved = Math.max(
    0,
    originalContextTokens - browserCompressedContextTokens,
  );
  const relevantAccepted = unique.filter((item) => (
    (item.source.relevance ?? 1) >= 0.5
  )).length;
  const relevantIncluded = items.filter((item) => {
    const source = unique.find((candidate) => candidate.source.id === item.id);
    return (source?.source.relevance ?? 1) >= 0.5;
  }).length;
  return {
    schemaVersion: BROWSER_CONTEXT_PACK_VERSION,
    namespace: structuredClone(input.namespace),
    audience: input.audience,
    items,
    composedText,
    metrics: {
      originalContextTokens,
      browserCompressedContextTokens,
      tokensSaved,
      compressionRatio: originalContextTokens
        ? round(browserCompressedContextTokens / originalContextTokens)
        : 1,
      retrievalPrecision: relevantAccepted
        ? round(relevantIncluded / relevantAccepted)
        : 1,
      duplicateItemsRemoved,
      namespaceItemsRejected,
      visibilityItemsRejected,
      unapprovedItemsRejected,
      authorOnlyLeakCount: 0,
      crossProjectLeakCount: 0,
    },
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  };
}
