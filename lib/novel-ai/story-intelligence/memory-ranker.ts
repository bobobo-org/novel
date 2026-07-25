import { estimateTokens } from "./token-budgeter";
import type { RankedMemory, TraceableMemory } from "./types";

function terms(value: string) {
  return new Set(
    value.toLocaleLowerCase("zh-TW")
      .split(/[\s，。！？、；：「」『』（）()\[\]]+/)
      .filter((term) => term.length > 1),
  );
}

function keywordSimilarity(query: Set<string>, text: string) {
  const normalized = text.toLocaleLowerCase("zh-TW");
  if (!query.size) return 0;
  let hits = 0;
  for (const term of query) if (normalized.includes(term)) hits += 1;
  return hits / query.size;
}

const KIND_WEIGHT: Record<TraceableMemory["kind"], number> = {
  current_scene: 1,
  recent_chapter: 0.86,
  accepted_choice: 0.84,
  character: 0.8,
  world_rule: 0.8,
  plot_thread: 0.78,
  foreshadowing: 0.76,
  relationship: 0.72,
  event: 0.7,
  note: 0.65,
};

export function rankMemories(query: string, memories: TraceableMemory[]): RankedMemory[] {
  const queryTerms = terms(query);
  return memories
    .filter((memory) => memory.metadata.visibility !== "private" || memory.metadata.projectId)
    .map((memory) => {
      const keyword = memory.keywordScore ?? keywordSimilarity(queryTerms, memory.text);
      const vector = memory.vectorScore ?? 0;
      const recency = memory.recencyScore ?? 0;
      const canonical = memory.metadata.canonical ? 0.08 : 0;
      const score = Math.min(1, KIND_WEIGHT[memory.kind] * 0.3 + keyword * 0.35 + vector * 0.25 + recency * 0.1 + canonical);
      const reasons = [
        keyword > 0 ? "符合目前任務關鍵詞" : "",
        vector > 0 ? "語意相近" : "",
        recency > 0.6 ? "近期內容" : "",
        memory.metadata.canonical ? "正式作品資料" : "",
      ].filter(Boolean);
      return {
        ...memory,
        score,
        selectedReason: reasons.length ? reasons : ["故事記憶優先序"],
        estimatedTokens: estimateTokens(memory.text),
      };
    })
    .sort((a, b) => b.score - a.score || a.memoryId.localeCompare(b.memoryId));
}
