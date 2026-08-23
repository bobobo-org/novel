import type { StoryChoiceEffect, StoryState } from "../domain";
import type { RpgChoice } from "./progression/rpg-progression";
import { proceduralArcPhase, type ProceduralArcPhase } from "./procedural-world-director";
import { readStoryEnding, type StoryEndingEvaluation } from "./story-ending-contract";

export const STORY_ARC_HORIZON = 8;

export type StoryArcRuntime = {
  key: string;
  goal: string;
  thread: string;
  startTurn: number;
  localTurn: number;
  horizon: number;
  phase: ProceduralArcPhase;
  resolved: boolean;
  ending: StoryEndingEvaluation & {
    evidenceSource: "explicit-v1" | "legacy-approved-ledger" | "none";
    arcKey: string | null;
    goal: string | null;
    thread: string | null;
    ledgerEntry: string | null;
  };
  progressionTurn: number;
  epilogueRead: boolean;
  archived: boolean;
};

function stringFlag(state: StoryState, key: string) {
  const value = state.worldFlags?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberFlag(state: StoryState, key: string) {
  const value = state.worldFlags?.[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function stableArcKey(projectId: string, thread: string) {
  let hash = 2166136261;
  for (const character of `${projectId}|${thread}`.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `arc-${hash.toString(16).padStart(8, "0")}`;
}

export function readStoryArcRuntime(input: {
  storyState: StoryState;
  projectId: string;
  progressionTurn: number;
  fallbackGoal: string;
  fallbackThread: string;
}): StoryArcRuntime {
  const persistedKey = stringFlag(input.storyState, "story.arc.key");
  const ending = readStoryEnding(input.storyState);
  const resolved = ending.isEnding;
  const thread = stringFlag(input.storyState, "story.arc.thread") ?? input.fallbackThread;
  const startTurn = numberFlag(input.storyState, "story.arc.startTurn") ?? input.progressionTurn;
  const horizon = Math.max(4, numberFlag(input.storyState, "story.arc.horizon") ?? STORY_ARC_HORIZON);
  const persistedLocalTurn = numberFlag(input.storyState, "story.arc.localTurn") ?? 0;
  const localTurn = resolved
    ? persistedLocalTurn
    : Math.max(persistedLocalTurn + 1, input.progressionTurn - startTurn + 1);
  return {
    key: persistedKey ?? stableArcKey(input.projectId, thread),
    goal: stringFlag(input.storyState, "story.arc.goal") ?? input.fallbackGoal,
    thread,
    startTurn,
    localTurn,
    horizon,
    phase: resolved ? "resolution" : proceduralArcPhase(localTurn, horizon),
    resolved,
    ending,
    progressionTurn: input.progressionTurn,
    epilogueRead: input.storyState.worldFlags?.["story.arc.epilogueRead"] === true,
    archived: input.storyState.worldFlags?.["story.arc.archived"] === true,
  };
}

type ClosureKind = NonNullable<RpgChoice["encounter"]["arcResolutionKind"]>;

export type StoryArcContinuation = {
  thread: string;
  goal: string;
};

const CLOSURE_COPY: Record<"A" | "B" | "C", {
  kind: ClosureKind;
  title: string;
  description: string;
  consequence: string;
}> = {
  A: {
    kind: "complete",
    title: "完成目標｜把真相交到該承擔的人手上",
    description: "沿用已取得的證據與合作關係，完成原定目標並明確結束這條因果鏈。",
    consequence: "保住核心成果；放棄繼續追逐額外利益，讓事件在可驗證的終點停下。",
  },
  B: {
    kind: "accept-cost",
    title: "承擔代價｜用已知損失換取結案",
    description: "承認無法同時保全一切，主動承擔先前預告的代價，換取人物與局勢的正式結案。",
    consequence: "代價會留在狀態與關係裡；未解線索因此關閉，不會再偽裝成下一回合重來。",
  },
  C: {
    kind: "leave-consequence",
    title: "帶著後果離場｜保存選擇權與餘波",
    description: "停止追加風險，帶著已取得的成果與仍需承受的後果離開，讓故事進入尾聲。",
    consequence: "局勢不會完美，但角色保有可負擔的離場路徑；下一步只能是尾聲或全新故事弧。",
  },
};

const POST_ARC_COPY: Record<"A" | "B" | "C", {
  nextAction: NonNullable<RpgChoice["encounter"]["arcNextAction"]>;
  title: string;
  description: string;
}> = {
  A: { nextAction: "epilogue", title: "閱讀尾聲｜安置人物與成果", description: "只處理已結案事件留下的人物、關係與資源餘波，不重開原線索。" },
  B: { nextAction: "new-arc", title: "開啟續篇／下一卷｜承接結局後果", description: "保留同一作品的 Canon、人物與累積狀態，從另一項未解線索或結局後果建立全新故事弧。" },
  C: { nextAction: "archive-ending", title: "封存結局｜停在完整終點", description: "保存目前結局與狀態，讓本段故事在這裡正式完成。" },
};

function continuationArcKey(arc: StoryArcRuntime, continuation: StoryArcContinuation) {
  return stableArcKey(`${arc.key}|sequel`, continuation.thread);
}

function postArcEffect(nextAction: NonNullable<RpgChoice["encounter"]["arcNextAction"]>): StoryChoiceEffect {
  return {
    statChanges: {},
    relationshipChanges: {},
    resourceChanges: { "game.turn": 1 },
    moneyChange: 0,
    worldFlags: { "story.arc.nextAction": nextAction },
    questProgress: {},
    achievementProgress: {},
    timelineEvents: [],
  };
}

function bindArc(
  choice: RpgChoice,
  arc: StoryArcRuntime,
  continuation?: StoryArcContinuation,
): RpgChoice {
  const encounter = {
    ...choice.encounter,
    arcKey: arc.key,
    arcGoal: arc.goal,
    arcThread: arc.thread,
    arcStartTurn: arc.startTurn,
    arcLocalTurn: arc.localTurn,
    arcHorizon: arc.horizon,
    arcPhase: arc.phase,
    arcResolved: false,
  };
  if (arc.resolved && choice.key !== "custom") {
    const copy = POST_ARC_COPY[choice.key];
    const startsContinuation = copy.nextAction === "new-arc" && continuation;
    const continuationEncounter = startsContinuation ? {
      ...encounter,
      arcKey: continuationArcKey(arc, continuation),
      arcGoal: continuation.goal,
      arcThread: continuation.thread,
      // A reader may inspect the epilogue before opening the sequel.  The new
      // volume therefore starts from the real canonical progression turn,
      // never from the old arc's frozen local counter.
      arcStartTurn: arc.progressionTurn + 1,
      arcLocalTurn: 0,
      arcHorizon: STORY_ARC_HORIZON,
      arcPhase: "setup" as const,
      arcResolved: false,
      arcResolutionKind: undefined,
      arcNextAction: "new-arc" as const,
    } : {
      ...encounter,
      arcResolved: true,
      arcResolutionKind: undefined,
      arcNextAction: copy.nextAction,
    };
    const effect = postArcEffect(copy.nextAction);
    const epilogueAlreadyRead = copy.nextAction === "epilogue" && arc.epilogueRead;
    return {
      ...choice,
      id: `${choice.id}:post-arc:${copy.nextAction}`,
      title: copy.title,
      description: startsContinuation
        ? `${copy.description} 續篇命題：${continuation.thread}`
        : copy.description,
      consequenceTeaser: "舊弧保持結案；不會重新產生同一未解鉤子。",
      consequence: copy.description,
      acceptedText: `【已結案後續｜${copy.title}】\n\n${copy.description}`,
      requirements: [],
      missingRequirements: [],
      knownCosts: [],
      internalSuccessChance: 100,
      displayedChanceBand: "確定",
      risk: 1,
      successChance: 100,
      xpGain: 0,
      actionCost: 0,
      costLabels: ["不消耗額外資源"],
      impactLabels: [copy.nextAction === "new-arc" ? "建立下一卷" : copy.nextAction === "epilogue" ? "安置結局餘波" : "封存完整結局"],
      effect,
      immediateEffect: effect,
      failureEffect: effect,
      partialSuccessEffect: effect,
      successEffect: effect,
      criticalSuccessEffect: effect,
      delayedConsequenceRefs: [],
      irreversibleWarning: copy.nextAction === "archive-ending"
        ? "封存後目前故事弧不再產生行動選項。"
        : null,
      hiddenInformationLevel: "none",
      disabledReason: epilogueAlreadyRead ? "尾聲已閱讀；可開啟續篇或封存結局。" : null,
      encounter: continuationEncounter,
    };
  }
  if (arc.phase !== "resolution" || choice.key === "custom") return { ...choice, encounter };
  const copy = CLOSURE_COPY[choice.key];
  return {
    ...choice,
    id: `${choice.id}:closure:${copy.kind}`,
    title: copy.title,
    description: copy.description,
    consequence: copy.consequence,
    consequenceTeaser: copy.consequence,
    impactLabels: [...choice.impactLabels, `結案能力：${copy.kind}`],
    acceptedText: `【第 ${arc.localTurn} 回合結案｜${copy.title}】\n\n${copy.description}\n\n${copy.consequence}`,
    encounter: { ...encounter, arcResolved: true, arcResolutionKind: copy.kind },
  };
}

export function bindStoryArcToChoices(
  choices: readonly RpgChoice[],
  arc: StoryArcRuntime,
  continuation?: StoryArcContinuation,
) {
  if (arc.archived) return [];
  return choices.map((choice) => bindArc(choice, arc, continuation));
}
