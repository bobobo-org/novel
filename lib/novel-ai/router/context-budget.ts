export type ContextBudgetInput = {
  chapterCharacters?: number;
  recentContextCharacters?: number;
  storyBibleCharacters?: number;
  sourceExcerptCharacters?: number;
  promptOverheadTokens?: number;
  expectedOutputTokens?: number;
  modelContextWindow: number;
};

export type ContextPlan = {
  estimatedTokens: number;
  maxContextTokens: number;
  includedSections: string[];
  omittedSections: string[];
  summarizationRequired: boolean;
  chunkCount: number;
};

function charsToTokens(chars: number) {
  return Math.ceil(chars / 3.2);
}

export function buildContextPlan(input: ContextBudgetInput): ContextPlan {
  const sections = [
    { name: "author_request", tokens: input.promptOverheadTokens ?? 400, priority: 1 },
    { name: "recent_context", tokens: charsToTokens(input.recentContextCharacters ?? 0), priority: 2 },
    { name: "story_bible", tokens: charsToTokens(input.storyBibleCharacters ?? 0), priority: 3 },
    { name: "source_excerpts", tokens: charsToTokens(input.sourceExcerptCharacters ?? 0), priority: 4 },
    { name: "chapter_text", tokens: charsToTokens(input.chapterCharacters ?? 0), priority: 5 },
    { name: "expected_output", tokens: input.expectedOutputTokens ?? 800, priority: 1 },
  ];
  const max = input.modelContextWindow;
  let total = sections.reduce((sum, section) => sum + section.tokens, 0);
  const omittedSections: string[] = [];
  const includedSections = sections.map((s) => s.name);
  for (const section of [...sections].sort((a, b) => b.priority - a.priority)) {
    if (total <= max) break;
    if (section.priority <= 2) continue;
    total -= section.tokens;
    omittedSections.push(section.name);
    const index = includedSections.indexOf(section.name);
    if (index >= 0) includedSections.splice(index, 1);
  }
  return {
    estimatedTokens: total,
    maxContextTokens: max,
    includedSections,
    omittedSections,
    summarizationRequired: total > max,
    chunkCount: Math.max(1, Math.ceil(total / Math.max(1, max))),
  };
}
