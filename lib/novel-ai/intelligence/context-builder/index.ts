import type { Character, Chapter, StoryBible, TimelineEvent, WorldRule } from "../../domain/index";

export type MemoryLayer = "L0-current" | "L1-chapter" | "L2-recent" | "L3-character" | "L4-world" | "L5-timeline" | "L6-open-threads" | "L7-story-bible" | "L8-retrieval";
export type ContextEvidence = { layer: MemoryLayer; id: string; title: string; content: string; score: number };
export type ContextBuildInput = { task: string; currentInput: string; currentChapter?: Chapter | null; recentChapters: Chapter[]; characters: Character[]; worldRules: WorldRule[]; timeline: TimelineEvent[]; storyBible: StoryBible; retrieved?: ContextEvidence[]; maxCharacters?: number };
export type BuiltNovelContext = { text: string; evidence: ContextEvidence[]; omitted: number; characterCount: number; layers: MemoryLayer[] };

function terms(value: string) { return new Set(value.toLocaleLowerCase("zh-TW").split(/[\s，。！？、；：「」『』（）]+/).filter((x) => x.length > 1)); }
function relevance(query: Set<string>, value: string) { const hay = value.toLocaleLowerCase("zh-TW"); return [...query].reduce((score, term) => score + (hay.includes(term) ? 1 : 0), 0); }

export function buildNovelContext(input: ContextBuildInput): BuiltNovelContext {
  const query = terms(`${input.task} ${input.currentInput}`), evidence: ContextEvidence[] = [];
  evidence.push({ layer: "L0-current", id: "current", title: "目前要求", content: input.currentInput, score: 100 });
  if (input.currentChapter) evidence.push({ layer: "L1-chapter", id: input.currentChapter.id, title: input.currentChapter.title, content: input.currentChapter.content.slice(-5000), score: 90 });
  input.recentChapters.slice(-3).reverse().forEach((chapter, index) => evidence.push({ layer: "L2-recent", id: chapter.id, title: chapter.title, content: chapter.summary || chapter.content.slice(-1200), score: 70 - index }));
  input.characters.forEach((character) => { const text = [character.name, character.identity.value, character.personality.value, character.goal.value].filter(Boolean).join("；"); evidence.push({ layer: "L3-character", id: character.id, title: character.name, content: text, score: 50 + relevance(query, text) * 10 }); });
  input.worldRules.forEach((rule) => evidence.push({ layer: "L4-world", id: rule.id, title: rule.title, content: rule.description, score: 45 + relevance(query, `${rule.title} ${rule.description}`) * 10 }));
  input.timeline.slice(-12).forEach((event) => evidence.push({ layer: "L5-timeline", id: event.id, title: event.title, content: event.summary, score: 40 + relevance(query, event.summary) * 10 }));
  input.storyBible.unresolvedThreads.forEach((thread, index) => evidence.push({ layer: "L6-open-threads", id: `thread-${index}`, title: "未解事件", content: thread, score: 55 + relevance(query, thread) * 10 }));
  evidence.push({ layer: "L7-story-bible", id: input.storyBible.id, title: "作品長期設定", content: [...input.storyBible.forbiddenContradictions, ...input.storyBible.authorPreferences].join("；"), score: 60 });
  evidence.push(...(input.retrieved ?? []));
  const max = input.maxCharacters ?? 16_000, selected: ContextEvidence[] = []; let used = 0;
  for (const item of evidence.sort((a, b) => b.score - a.score)) { if (!item.content || used + item.content.length > max) continue; selected.push(item); used += item.content.length; }
  return { text: selected.map((item) => `【${item.title}】\n${item.content}`).join("\n\n"), evidence: selected, omitted: evidence.length - selected.length, characterCount: used, layers: [...new Set(selected.map((x) => x.layer))] };
}
