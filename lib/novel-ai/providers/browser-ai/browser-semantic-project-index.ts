import type {
  AcceptedChoice,
  Achievement,
  Chapter,
  Character,
  CharacterRelationship,
  NovelProject,
  StoryBible,
  StoryBranch,
  StoryState,
  TimelineEvent,
  WorldRule,
  WritingTask,
} from "../../domain";
import type { LearnedNarrativeRule } from "../../sovereign-learning";
import type {
  BrowserSemanticIndexSource,
  BrowserSemanticIndexSourceKind,
} from "./browser-semantic-index";

export type BrowserSemanticProjectSnapshot = {
  project: NovelProject | null | undefined;
  chapters: Chapter[];
  characters: Character[];
  relationships: CharacterRelationship[];
  worldRules: WorldRule[];
  timeline: TimelineEvent[];
  storyBibles: StoryBible[];
  storyStates: StoryState[];
  acceptedChoices: AcceptedChoice[];
  storyBranches: StoryBranch[];
  writingTasks: WritingTask[];
  achievements: Achievement[];
  approvedLearningRules: LearnedNarrativeRule[];
};

function compactLines(values: Array<string | null | undefined>) {
  return values
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

function stableEntries(value: Record<string, unknown>) {
  return Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${key}=${JSON.stringify(item)}`)
    .join("；");
}

function source(
  id: string,
  kind: BrowserSemanticIndexSourceKind,
  revision: number | string,
  text: string,
  visibility: BrowserSemanticIndexSource["visibility"] = "both",
): BrowserSemanticIndexSource | null {
  const normalized = text.trim();
  return normalized
    ? { id, kind, revision: String(revision), text: normalized, visibility }
    : null;
}

/**
 * Builds an in-memory, actor-safe project corpus. The returned text is embedded
 * immediately by the semantic indexer and is never written to index metadata.
 * Character privateSecrets and Story Bible authorPreferences are deliberately
 * excluded because this shared Closed Agent OS namespace is not AUTHOR_ONLY.
 */
export function buildBrowserSemanticProjectSources(
  snapshot: BrowserSemanticProjectSnapshot,
): BrowserSemanticIndexSource[] {
  const rows: Array<BrowserSemanticIndexSource | null> = [];
  const project = snapshot.project;
  if (project) {
    rows.push(source(
      `project:${project.id}`,
      "storyBible",
      project.revision,
      compactLines([
        `作品：${project.title}`,
        project.coreIdea.value ? `核心：${project.coreIdea.value}` : null,
        project.narrativeStyle.value ? `敘事風格：${project.narrativeStyle.value}` : null,
        project.genreId ? `類型：${project.genreId}` : null,
        project.subgenreId ? `子類型：${project.subgenreId}` : null,
      ]),
    ));
  }

  for (const chapter of snapshot.chapters) {
    rows.push(source(
      `chapter:${chapter.id}`,
      "chapter",
      chapter.revision,
      compactLines([
        `第 ${chapter.order} 章｜${chapter.title}`,
        chapter.content,
        chapter.summary ? `摘要：${chapter.summary}` : null,
        `狀態：${chapter.status}`,
      ]),
    ));
  }

  for (const bible of snapshot.storyBibles) {
    rows.push(source(
      `story-bible:${bible.id}`,
      "storyBible",
      bible.revision,
      compactLines([
        bible.theme.value ? `主題：${bible.theme.value}` : null,
        bible.style.value ? `風格：${bible.style.value}` : null,
        bible.foreshadowing.length ? `伏筆：${bible.foreshadowing.join("；")}` : null,
        bible.unresolvedThreads.length ? `未解線索：${bible.unresolvedThreads.join("；")}` : null,
        bible.forbiddenContradictions.length
          ? `禁止矛盾：${bible.forbiddenContradictions.join("；")}`
          : null,
      ]),
    ));
  }

  for (const rule of snapshot.worldRules) {
    rows.push(source(
      `world-rule:${rule.id}`,
      "worldRule",
      rule.revision,
      `${rule.title}\n${rule.description}\nimmutable=${rule.immutable}`,
    ));
  }

  for (const character of snapshot.characters) {
    rows.push(source(
      `character:${character.id}`,
      "character",
      character.revision,
      compactLines([
        `角色：${character.name}`,
        character.aliases.length ? `別名：${character.aliases.join("、")}` : null,
        character.identity.value ? `身分：${character.identity.value}` : null,
        character.personality.value ? `性格：${character.personality.value}` : null,
        character.goal.value ? `目標：${character.goal.value}` : null,
        character.values?.length ? `價值：${character.values.join("、")}` : null,
        character.fears?.length ? `恐懼：${character.fears.join("、")}` : null,
        character.capabilities?.length ? `能力：${character.capabilities.join("、")}` : null,
        character.limitations?.length ? `限制：${character.limitations.join("、")}` : null,
        character.portrait?.visualDescription
          ? `核准外觀：${character.portrait.visualDescription}`
          : null,
        character.rpgProfile
          ? `RPG：${stableEntries(character.rpgProfile.stats)}`
          : null,
        character.dynamicsProfile
          ? `動態：${character.dynamicsProfile.archetypeLabel}；${character.dynamicsProfile.socialRole}；${character.dynamicsProfile.personalityTraits.join("、")}`
          : null,
        character.voiceStyle
          ? `聲線：${stableEntries(character.voiceStyle as unknown as Record<string, unknown>)}`
          : null,
      ]),
    ));
  }

  for (const relationship of snapshot.relationships) {
    rows.push(source(
      `relationship:${relationship.id}`,
      "relationship",
      relationship.revision,
      compactLines([
        `${relationship.fromCharacterId} → ${relationship.toCharacterId}`,
        `關係：${relationship.kind}`,
        relationship.summary,
        relationship.trust == null ? null : `信任：${relationship.trust}`,
      ]),
    ));
  }

  for (const event of snapshot.timeline) {
    rows.push(source(
      `timeline:${event.id}`,
      "timeline",
      event.revision,
      compactLines([
        event.storyTime ? `時間：${event.storyTime}` : null,
        event.title,
        event.summary,
        event.chapterId ? `章節：${event.chapterId}` : null,
      ]),
    ));
  }

  for (const choice of snapshot.acceptedChoices) {
    rows.push(source(
      `accepted-choice:${choice.id}`,
      "acceptedChoice",
      choice.revision,
      compactLines([
        `選擇 ${choice.choiceKey}${choice.choiceLabel ? `｜${choice.choiceLabel}` : ""}`,
        choice.acceptedText,
        `章節：${choice.chapterId}`,
        `分支：${choice.branchId}`,
        `正式效果：${stableEntries(choice.appliedEffect as unknown as Record<string, unknown>)}`,
      ]),
    ));
  }

  for (const branch of snapshot.storyBranches) {
    rows.push(source(
      `story-branch:${branch.id}`,
      "storyBranch",
      branch.revision,
      compactLines([
        `分支：${branch.name}`,
        `狀態：${branch.status}`,
        `章節：${branch.chapterId}`,
        `Head revision：${branch.headRevision}`,
        branch.parentBranchId ? `父分支：${branch.parentBranchId}` : null,
      ]),
    ));
  }

  for (const state of snapshot.storyStates) {
    rows.push(source(
      `story-state:${state.id}`,
      "quest",
      state.revision,
      compactLines([
        `能力值：${stableEntries(state.protagonistStats)}`,
        `資源：${stableEntries(state.resources)}`,
        state.money == null ? null : `金錢：${state.money}`,
        state.inventory.length ? `物品：${state.inventory.join("、")}` : null,
        `關係值：${stableEntries(state.relationships)}`,
        state.reputation == null ? null : `聲望：${state.reputation}`,
        `陣營：${stableEntries(state.factionStanding)}`,
        `世界旗標：${stableEntries(state.worldFlags)}`,
        `任務：${stableEntries(state.questStates)}`,
        `成就：${stableEntries(state.achievementStates)}`,
        state.timeState ? `時間：${state.timeState}` : null,
        state.locationState ? `位置：${state.locationState}` : null,
        state.riskState ? `風險：${state.riskState}` : null,
      ]),
    ));
  }

  for (const task of snapshot.writingTasks) {
    rows.push(source(
      `writing-task:${task.id}`,
      "quest",
      task.revision,
      compactLines([
        task.title,
        `類型：${task.kind}`,
        `進度：${task.progress}/${task.target}`,
        `狀態：${task.status}`,
      ]),
    ));
  }

  for (const achievement of snapshot.achievements) {
    rows.push(source(
      `achievement:${achievement.id}`,
      "achievement",
      achievement.revision,
      compactLines([
        achievement.title,
        `進度：${achievement.progress}/${achievement.target}`,
        achievement.unlockedAt ? `解鎖：${achievement.unlockedAt}` : "尚未解鎖",
      ]),
    ));
  }

  for (const rule of snapshot.approvedLearningRules) {
    if (rule.status !== "approved") continue;
    rows.push(source(
      `approved-learning-rule:${rule.id}`,
      "approvedLearningRule",
      rule.revision,
      compactLines([
        `${rule.family}／${rule.dimension}`,
        rule.statement,
        `適用：${rule.recipe.when}`,
        `操作：${rule.recipe.operation}`,
        `限制：${rule.recipe.constraint}`,
        `評估：${rule.recipe.evaluate}`,
        rule.tags.length ? `標籤：${rule.tags.join("、")}` : null,
      ]),
    ));
  }

  return rows.filter((row): row is BrowserSemanticIndexSource => Boolean(row));
}
