import type { StoryState } from "../domain";

export const STORY_ENDING_CONTRACT_VERSION = "story-ending-contract-v1" as const;

export const STORY_ENDING_RESOLUTION_KINDS = [
  "complete",
  "accept-cost",
  "leave-consequence",
] as const;

export const STORY_POST_ENDING_ACTIONS = [
  "epilogue",
  "new-arc",
  "archive-ending",
] as const;

export type StoryEndingResolutionKind = typeof STORY_ENDING_RESOLUTION_KINDS[number];
export type StoryPostEndingAction = typeof STORY_POST_ENDING_ACTIONS[number];

export type StoryEndingEvidence = {
  coreGoalDecisivelyAnswered: boolean;
  centralThreadResolved: boolean;
  canonicalConsequencesPersisted: boolean;
  completeNarrativePersisted: boolean;
  immutableLedgerPersisted: boolean;
  userApproved: boolean;
};

export type NonEndingSignal = "scene-or-chapter-ended" | "temporary-outcome" | "resources-exhausted";

export type StoryEndingEvaluation = {
  isEnding: boolean;
  evidence: StoryEndingEvidence;
  missingEvidence: Array<keyof StoryEndingEvidence>;
  ignoredNonEndingSignals: NonEndingSignal[];
};

const REQUIRED_ENDING_EVIDENCE = [
  "coreGoalDecisivelyAnswered",
  "centralThreadResolved",
  "canonicalConsequencesPersisted",
  "completeNarrativePersisted",
  "immutableLedgerPersisted",
  "userApproved",
] as const satisfies ReadonlyArray<keyof StoryEndingEvidence>;

/**
 * A scene boundary, a temporary win/loss, or empty resources can affect the
 * story, but none of them is proof of an ending.  An ending exists only after
 * all six canonical facts are committed together through user approval.
 */
export function evaluateStoryEnding(input: StoryEndingEvidence & {
  sceneOrChapterEnded?: boolean;
  temporaryOutcome?: boolean;
  resourcesExhausted?: boolean;
}): StoryEndingEvaluation {
  const evidence = Object.fromEntries(
    REQUIRED_ENDING_EVIDENCE.map((key) => [key, input[key] === true]),
  ) as StoryEndingEvidence;
  const missingEvidence = REQUIRED_ENDING_EVIDENCE.filter((key) => !evidence[key]);
  const ignoredNonEndingSignals: NonEndingSignal[] = [];
  if (input.sceneOrChapterEnded) ignoredNonEndingSignals.push("scene-or-chapter-ended");
  if (input.temporaryOutcome) ignoredNonEndingSignals.push("temporary-outcome");
  if (input.resourcesExhausted) ignoredNonEndingSignals.push("resources-exhausted");
  return {
    isEnding: missingEvidence.length === 0,
    evidence,
    missingEvidence,
    ignoredNonEndingSignals,
  };
}

function stringFlag(state: StoryState, key: string) {
  const value = state.worldFlags?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanFlag(state: StoryState, key: string) {
  return state.worldFlags?.[key] === true;
}

export function buildStoryEndingLedgerEntry(input: {
  arcKey: string;
  goal: string;
  thread: string;
  resolutionKind: StoryEndingResolutionKind;
  resolvedTurn: number;
}) {
  return [
    STORY_ENDING_CONTRACT_VERSION,
    input.arcKey,
    input.resolutionKind,
    Math.max(0, Math.trunc(input.resolvedTurn)),
    input.goal,
    input.thread,
  ].join("|");
}

/**
 * These flags are part of the accepted choice effect.  They are not present
 * on a mere candidate: the repository writes them in the same approval
 * transaction that persists the verified full prose and its Canon effects.
 */
export function buildApprovedStoryEndingFlags(input: {
  arcKey: string;
  goal: string;
  thread: string;
  resolutionKind: StoryEndingResolutionKind;
  resolvedTurn: number;
}): Record<string, boolean | string | number> {
  const legacyLedgerEntry = [
    input.arcKey,
    input.thread,
    input.resolutionKind,
    Math.max(0, Math.trunc(input.resolvedTurn)),
  ].join("|");
  return {
    "story.arc.resolved": true,
    "story.arc.resolvedThread": input.thread,
    "story.arc.resolvedTurn": Math.max(0, Math.trunc(input.resolvedTurn)),
    "story.arc.resolutionKind": input.resolutionKind,
    "story.arc.ledgerEntry": legacyLedgerEntry,
    "story.ending.contractVersion": STORY_ENDING_CONTRACT_VERSION,
    "story.ending.arcKey": input.arcKey,
    "story.ending.answeredGoal": input.goal,
    "story.ending.resolvedThread": input.thread,
    "story.ending.resolutionKind": input.resolutionKind,
    "story.ending.resolvedTurn": Math.max(0, Math.trunc(input.resolvedTurn)),
    "story.ending.ledgerEntry": buildStoryEndingLedgerEntry(input),
    "story.ending.coreGoalDecisivelyAnswered": true,
    "story.ending.centralThreadResolved": true,
    "story.ending.canonicalConsequencesPersisted": true,
    "story.ending.completeNarrativePersisted": true,
    "story.ending.immutableLedgerPersisted": true,
    "story.ending.userApproved": true,
  };
}

/** Reads only a committed StoryState.  Legacy ledgers remain compatible. */
export function readStoryEnding(state: StoryState): StoryEndingEvaluation & {
  evidenceSource: "explicit-v1" | "legacy-approved-ledger" | "none";
  arcKey: string | null;
  goal: string | null;
  thread: string | null;
  ledgerEntry: string | null;
} {
  const activeArcKey = stringFlag(state, "story.arc.key");
  const explicitArcKey = stringFlag(state, "story.ending.arcKey");
  const explicitLedger = stringFlag(state, "story.ending.ledgerEntry");
  const explicitForActiveArc = Boolean(
    activeArcKey
    && explicitArcKey === activeArcKey
    && stringFlag(state, "story.ending.contractVersion") === STORY_ENDING_CONTRACT_VERSION
    && explicitLedger,
  );
  const legacyLedger = stringFlag(state, "story.arc.ledgerEntry");
  const legacyForActiveArc = Boolean(
    activeArcKey
    && booleanFlag(state, "story.arc.resolved")
    && legacyLedger?.startsWith(`${activeArcKey}|`)
    && stringFlag(state, "story.arc.resolvedThread"),
  );
  const evidenceSource = explicitForActiveArc
    ? "explicit-v1"
    : legacyForActiveArc
      ? "legacy-approved-ledger"
      : "none";
  const explicit = evidenceSource === "explicit-v1";
  const legacy = evidenceSource === "legacy-approved-ledger";
  const evaluation = evaluateStoryEnding({
    coreGoalDecisivelyAnswered: explicit
      ? booleanFlag(state, "story.ending.coreGoalDecisivelyAnswered")
      : legacy,
    centralThreadResolved: explicit
      ? booleanFlag(state, "story.ending.centralThreadResolved")
      : legacy,
    canonicalConsequencesPersisted: explicit
      ? booleanFlag(state, "story.ending.canonicalConsequencesPersisted")
      : legacy,
    completeNarrativePersisted: explicit
      ? booleanFlag(state, "story.ending.completeNarrativePersisted")
      : legacy,
    immutableLedgerPersisted: explicit
      ? booleanFlag(state, "story.ending.immutableLedgerPersisted")
      : legacy,
    userApproved: explicit
      ? booleanFlag(state, "story.ending.userApproved")
      : legacy,
  });
  return {
    ...evaluation,
    evidenceSource,
    arcKey: activeArcKey,
    goal: explicit
      ? stringFlag(state, "story.ending.answeredGoal")
      : stringFlag(state, "story.arc.goal"),
    thread: explicit
      ? stringFlag(state, "story.ending.resolvedThread")
      : stringFlag(state, "story.arc.resolvedThread"),
    ledgerEntry: explicitLedger ?? legacyLedger,
  };
}

export type StoryEndingReaderDisclosure = {
  stage: "in-progress" | "closure-now" | "post-ending";
  mayRevealEndingConditions: false;
  mayRevealPresetHorizon: false;
  mayRevealClosureChoices: boolean;
  mayRevealPostEndingActions: boolean;
  readerBeat: string;
};

/**
 * Internal planning may retain a bounded horizon, but this is the only text
 * that may flow into reader-facing causal prose.
 */
export function storyEndingReaderDisclosure(input: {
  phase: "setup" | "escalation" | "reversal" | "climax" | "resolution";
  approvedEnding: boolean;
}): StoryEndingReaderDisclosure {
  if (input.approvedEnding) {
    return {
      stage: "post-ending",
      mayRevealEndingConditions: false,
      mayRevealPresetHorizon: false,
      mayRevealClosureChoices: false,
      mayRevealPostEndingActions: true,
      readerBeat: "結局已由使用者核准並寫入 Canon；此刻只可呈現尾聲、續篇或封存，不再重開原中央線索。",
    };
  }
  if (input.phase === "resolution") {
    return {
      stage: "closure-now",
      mayRevealEndingConditions: false,
      mayRevealPresetHorizon: false,
      mayRevealClosureChoices: true,
      mayRevealPostEndingActions: false,
      readerBeat: "核心目標與中央線索已抵達必須作出決定性回答的收束當下；現在才揭示完成目標、承擔代價、帶著後果離場三個結案方向。",
    };
  }
  return {
    stage: "in-progress",
    mayRevealEndingConditions: false,
    mayRevealPresetHorizon: false,
    mayRevealClosureChoices: false,
    mayRevealPostEndingActions: false,
    readerBeat: "本回合只推進既有因果鏈與眼前可知的壓力，不預告尚未發生的收束方式，也不揭露內部規劃節點。",
  };
}
