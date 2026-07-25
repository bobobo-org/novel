import type { NarrativeAnalysis } from "./types";

export function buildEnding(analysis: NarrativeAnalysis): string {
  const payoff = analysis.irreversibleEvents.value?.[0] ?? analysis.majorEvents.value?.at(-1);
  const unresolved = analysis.unresolvedQuestions.value?.[0];
  if (payoff && unresolved) return `主要事件「${payoff}」得到回報，但「${unresolved}」仍推動下一篇章。`;
  if (payoff) return `以「${payoff}」完成本段落的因果回報。`;
  return "以角色承擔選擇後果作結，不憑空新增正式設定。";
}
