import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { planConversationRequest } from "../lib/novel-ai/conversation/planner.ts";
import {
  rpgLogicalTurnFallbackReviewTaskId,
  rpgLogicalTurnGenerationTaskId,
} from "../lib/novel-ai/conversation/rpg-logical-turn.ts";
import { findRpgChoiceRecoveryTarget } from "../app/studio/project/[projectId]/chat/conversation-workspace-support.ts";
import { serializeRpgChoices } from "../app/studio/project/[projectId]/chat/components/conversation-presentation.ts";
import {
  inspectRpgChoiceTurn,
  resolveRpgExecutionRecoveryMode,
  rpgChoiceUserContent,
  rpgUserMessageMatchesChoice,
  useConversationRpgController,
} from "../app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts";

const projectId = "project-rpg-recovery";
const sessionId = "session-rpg-recovery";

function message(id, overrides = {}) {
  return {
    id,
    projectId,
    sessionId,
    role: "assistant",
    content: "",
    status: "completed",
    candidateIds: [],
    ...overrides,
  };
}

function artifact(id, sourceMessageId, status = "approved", overrides = {}) {
  return {
    id,
    projectId,
    sessionId,
    sourceMessageId,
    artifactType: "rpg",
    status,
    targetStore: "chapters",
    targetRecordId: "chapter-1",
    ...overrides,
  };
}

function invocation(id, messageId, overrides = {}) {
  return {
    id,
    projectId,
    sessionId,
    messageId,
    toolId: "closed-agent-os:rpg-choice-plan",
    status: "running",
    revision: 1,
    ...overrides,
  };
}

function executableChoice(key, index) {
  return {
    id: `choice-${key}`,
    key,
    approach: ["steady", "resource", "breakthrough"][index],
    strategyLabel: ["穩健", "關係", "突破"][index],
    title: `路線 ${key}`,
    description: `可執行的路線 ${key}`,
    displayedChanceBand: "成功機會可判斷",
    primaryStat: "focus",
    secondaryStat: "luck",
    successChance: 50,
    internalSuccessChance: 50,
    risk: index + 1,
    requirements: [],
    missingRequirements: [],
    knownCosts: [],
    costLabels: [],
    impactLabels: [],
    delayedConsequenceRefs: [],
    effect: {},
    immediateEffect: {},
    failureEffect: {},
    partialSuccessEffect: {},
    successEffect: {},
    criticalSuccessEffect: {},
    sourceSnapshot: {},
    encounter: {},
  };
}

const approvedTurn = message("approved-turn", { content: "上一回合正文" });
const approvedArtifact = artifact("approved-artifact", approvedTurn.id);
const openSnapshot = {
  chapter: { id: "chapter-1", revision: 2 },
  storyState: { revision: 3, worldFlags: {} },
};

assert.deepEqual(
  findRpgChoiceRecoveryTarget([approvedTurn], [approvedArtifact], openSnapshot),
  {
    sourceArtifactId: approvedArtifact.id,
    parentMessageId: approvedTurn.id,
    reason: "missing",
  },
  "an approved Canon turn without a following A/B/C card must be recoverable",
);

const otherChapterTurn = message("other-chapter-turn", { content: "另一章的核准正文" });
const otherChapterArtifact = artifact(
  "other-chapter-artifact",
  otherChapterTurn.id,
  "approved",
  { targetRecordId: "chapter-2" },
);
assert.deepEqual(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, otherChapterTurn],
    [approvedArtifact, otherChapterArtifact],
    openSnapshot,
  )?.sourceArtifactId,
  approvedArtifact.id,
  "a newer approved artifact from another chapter must not replace the current chapter recovery source",
);
assert.equal(
  findRpgChoiceRecoveryTarget(
    [otherChapterTurn],
    [otherChapterArtifact],
    openSnapshot,
  ),
  null,
  "an approved artifact from another target chapter must never be attached to recovery",
);

const failedPlan = message("failed-plan", {
  parentMessageId: approvedTurn.id,
  status: "failed",
  content: "三選一建立失敗",
});
assert.equal(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, failedPlan],
    [approvedArtifact],
    openSnapshot,
  )?.reason,
  "failed_or_interrupted",
  "a failed choice planner must remain retryable",
);

const runningPlan = message("running-plan", {
  parentMessageId: approvedTurn.id,
  status: "streaming",
});
assert.deepEqual(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, runningPlan],
    [approvedArtifact],
    openSnapshot,
  ),
  {
    sourceArtifactId: approvedArtifact.id,
    parentMessageId: approvedTurn.id,
    reason: "missing",
  },
  "an orphan streaming placeholder without a live invocation must remain recoverable",
);
assert.equal(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, runningPlan],
    [approvedArtifact],
    openSnapshot,
    [invocation("running-plan-invocation", runningPlan.id)],
  ),
  null,
  "a same-source RPG choice-plan invocation that is truly in flight must suppress duplicate recovery",
);
assert.ok(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, runningPlan],
    [approvedArtifact],
    openSnapshot,
    [invocation("wrong-tool-invocation", runningPlan.id, { toolId: "closed-agent-os:rpg-turn" })],
  ),
  "a different tool invocation must not make an orphan choice placeholder look in flight",
);

const choiceContextRevisionDigest = "a".repeat(64);
const choiceContextRevisionGuard = {
  schemaVersion: "rpg-context-revision-guard-v1",
  digest: choiceContextRevisionDigest,
  vector: Object.fromEntries([
    "projects", "chapters", "storyStates", "storyBibles", "characters",
    "relationships", "worlds", "worldRules", "lore", "timeline",
    "acceptedChoices", "rpgTurnReceipts",
  ].map((store) => [store, []])),
};
const choicesContent = serializeRpgChoices({
  schemaVersion: "conversation-rpg-choices-v1",
  chapterId: "chapter-1",
  chapterRevision: 2,
  storyStateRevision: 3,
  contextRevisionDigest: choiceContextRevisionDigest,
  plan: {
    schemaVersion: "rpg-chat-turn-v1",
    candidateId: "choice-plan-1",
    contextRevisionDigest: choiceContextRevisionDigest,
    contextRevisionGuard: choiceContextRevisionGuard,
    choices: ["A", "B", "C"].map(executableChoice),
  },
});

const choiceCardId = "choice-card-crash-matrix";
const selectedChoice = executableChoice("A", 0);
const persistedChoice = message("choice-user-crash-matrix", {
  role: "user",
  sourceMessageId: choiceCardId,
  content: rpgChoiceUserContent(selectedChoice),
});
let crashState = inspectRpgChoiceTurn([persistedChoice], [], choiceCardId);
assert.equal(crashState.consumed, false, "a persisted user choice without an assistant is recoverable");
assert.equal(crashState.recoverableUser?.id, persistedChoice.id);
assert.equal(crashState.attempts.length, 1, "user-save recovery must reuse exactly one choice record");
assert.equal(rpgUserMessageMatchesChoice(persistedChoice, selectedChoice), true);
assert.equal(
  rpgUserMessageMatchesChoice({ ...persistedChoice, content: "A" }, selectedChoice),
  true,
  "legacy bare A/B/C input must still bind to the same logical choice",
);
const overlappingChoice = { ...selectedChoice, title: `${selectedChoice.title}後續` };
assert.equal(
  rpgUserMessageMatchesChoice({ ...persistedChoice, content: rpgChoiceUserContent(overlappingChoice) }, selectedChoice),
  false,
  "an overlapping longer title must not bind through substring matching",
);

const orphanAssistant = message("choice-assistant-before-invocation", {
  parentMessageId: persistedChoice.id,
  status: "streaming",
});
crashState = inspectRpgChoiceTurn(
  [persistedChoice, orphanAssistant],
  [],
  choiceCardId,
);
assert.equal(crashState.consumed, false, "assistant-placeholder-before-invocation stays recoverable");
assert.equal(resolveRpgExecutionRecoveryMode(orphanAssistant, null), "start_attempt");

const interruptedAssistant = { ...orphanAssistant, id: "choice-assistant-interrupted", status: "cancelled" };
const interruptedInvocation = invocation("choice-invocation-interrupted", interruptedAssistant.id, {
  toolId: "closed-agent-os:rpg-turn",
  status: "failed",
});
assert.equal(
  resolveRpgExecutionRecoveryMode(interruptedAssistant, interruptedInvocation),
  "retry_terminal",
  "a stale running attempt converged to interrupted records must use the terminal retry CAS path",
);

const stableProviderRunId = await rpgLogicalTurnGenerationTaskId(persistedChoice.id);
const stableFallbackReviewRunId = await rpgLogicalTurnFallbackReviewTaskId(persistedChoice.id);
assert.equal(
  await rpgLogicalTurnGenerationTaskId(persistedChoice.id),
  stableProviderRunId,
  "the same logical turn must replay the same Closed Agent idempotency key",
);
assert.notEqual(
  await rpgLogicalTurnGenerationTaskId(`${persistedChoice.id}:next-attempt`),
  stableProviderRunId,
  "an explicitly new choice attempt must receive a distinct idempotency key",
);
const receipt = {
  receiptId: "choice-receipt-completed-before-message",
  modelId: "test-model",
  modelDigest: "a".repeat(64),
  providerRunId: stableProviderRunId,
  contextDigest: "b".repeat(64),
  outputDigest: "c".repeat(64),
  externalRequest: false,
  dataLeftDevice: false,
  latencyMs: 1,
};
const completedInvocation = invocation("choice-invocation-completed", orphanAssistant.id, {
  toolId: "closed-agent-os:rpg-turn",
  status: "completed",
  executionReceipt: receipt,
});
assert.equal(
  resolveRpgExecutionRecoveryMode(orphanAssistant, completedInvocation),
  "resume_completed",
  "receipt-before-message crash must replay the same logical turn and finish the existing assistant",
);
assert.equal(
  resolveRpgExecutionRecoveryMode(
    orphanAssistant,
    completedInvocation,
    stableProviderRunId,
  ),
  "resume_completed",
);
assert.equal(
  resolveRpgExecutionRecoveryMode(
    orphanAssistant,
    {
      ...completedInvocation,
      executionReceipt: { ...receipt, providerRunId: stableFallbackReviewRunId },
    },
    [stableProviderRunId, stableFallbackReviewRunId],
  ),
  "resume_completed",
  "a completed deterministic fallback-review receipt must resume the same logical turn",
);
assert.equal(
  resolveRpgExecutionRecoveryMode(
    orphanAssistant,
    {
      ...completedInvocation,
      executionReceipt: { ...receipt, providerRunId: "legacy-random-generation-task" },
    },
    stableProviderRunId,
  ),
  "start_attempt",
  "a pre-fix random generation receipt must not enter a permanent stable-replay mismatch loop",
);
const completedAssistantBeforeArtifact = {
  ...orphanAssistant,
  status: "completed",
  content: "候選正文已持久化，artifact 尚未建立。",
};
assert.equal(
  resolveRpgExecutionRecoveryMode(completedAssistantBeforeArtifact, completedInvocation),
  "resume_completed",
  "message-before-artifact crash must reuse the completed receipt",
);
crashState = inspectRpgChoiceTurn(
  [persistedChoice, completedAssistantBeforeArtifact],
  [],
  choiceCardId,
);
assert.equal(crashState.consumed, false, "a completed message without an artifact must not consume the card");
assert.equal(crashState.recoverableUser?.id, persistedChoice.id);

const candidateArtifact = artifact(
  "choice-artifact-candidate",
  completedAssistantBeforeArtifact.id,
  "candidate",
);
crashState = inspectRpgChoiceTurn(
  [persistedChoice, completedAssistantBeforeArtifact],
  [candidateArtifact],
  choiceCardId,
);
assert.equal(crashState.consumed, true, "artifact persistence is the choice-card settlement boundary");
assert.equal(crashState.recoverableUser, null);
const rejectedArtifact = { ...candidateArtifact, status: "rejected" };
crashState = inspectRpgChoiceTurn(
  [persistedChoice, completedAssistantBeforeArtifact],
  [rejectedArtifact],
  choiceCardId,
);
assert.equal(crashState.consumed, false, "an explicitly rejected candidate reopens the card");
assert.equal(
  crashState.recoverableUser,
  null,
  "a rejected attempt is finished and must not replay its rejected artifact id",
);

const completedPlan = message("completed-plan", {
  parentMessageId: approvedTurn.id,
  content: choicesContent,
});
assert.equal(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, completedPlan],
    [approvedArtifact],
    openSnapshot,
  ),
  null,
  "a completed executable A/B/C card must suppress recovery",
);

const wrongParentCompletedPlan = message("wrong-parent-completed-plan", {
  parentMessageId: "different-approved-turn",
  content: choicesContent,
});
assert.ok(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, wrongParentCompletedPlan],
    [approvedArtifact],
    openSnapshot,
  ),
  "a completed A/B/C card attached to a different parent must not suppress exact-source recovery",
);

assert.ok(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, completedPlan],
    [approvedArtifact],
    {
      chapter: openSnapshot.chapter,
      storyState: { revision: 4, worldFlags: {} },
    },
  ),
  "a stale story-state revision must not suppress the recovery entry",
);
assert.ok(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, completedPlan],
    [approvedArtifact],
    {
      chapter: { id: "chapter-1", revision: 3 },
      storyState: openSnapshot.storyState,
    },
  ),
  "a stale chapter revision must not suppress the recovery entry",
);

const nextCandidateMessage = message("next-candidate", { content: "下一回合候選正文" });
assert.equal(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, nextCandidateMessage],
    [approvedArtifact, artifact("next-artifact", nextCandidateMessage.id, "candidate")],
    openSnapshot,
  ),
  null,
  "an unapproved next-turn candidate must not be bypassed by choice recovery",
);
assert.ok(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, nextCandidateMessage],
    [
      approvedArtifact,
      artifact("other-chapter-candidate", nextCandidateMessage.id, "candidate", {
        targetRecordId: "chapter-2",
      }),
    ],
    openSnapshot,
  ),
  "a candidate for another chapter must not block the current chapter recovery",
);
const otherChapterRunningPlan = message("other-chapter-running-plan", {
  parentMessageId: otherChapterTurn.id,
  status: "streaming",
});
assert.ok(
  findRpgChoiceRecoveryTarget(
    [approvedTurn, otherChapterTurn, otherChapterRunningPlan],
    [approvedArtifact, otherChapterArtifact],
    openSnapshot,
    [invocation("other-chapter-plan-invocation", otherChapterRunningPlan.id)],
  ),
  "an in-flight choice plan attached to another chapter source must not block this chapter",
);
assert.equal(
  findRpgChoiceRecoveryTarget(
    [approvedTurn],
    [approvedArtifact],
    {
      chapter: openSnapshot.chapter,
      storyState: {
        revision: openSnapshot.storyState.revision,
        worldFlags: { "story.arc.archived": true },
      },
    },
  ),
  null,
  "an archived ending must not offer another round",
);

for (const content of ["繼續", "下一輪", "下一步"]) {
  const plan = await planConversationRequest({
    content,
    fixedPlayMode: "rpg",
    hasActiveRpgTurn: false,
  });
  assert.equal(plan.intent, "rpg_turn", `${content} must route to rpg_turn when no choice is active`);
  assert.equal(plan.executionKind, "rpg");
  assert.equal(plan.taskType, "chapter.continue");
}
const generalPlan = await planConversationRequest({
  content: "下一步",
  fixedPlayMode: "general",
  hasActiveRpgTurn: false,
});
assert.equal(generalPlan.intent, "general_assistant", "bare continuation routing must stay scoped to game stories");

const [rpgController, approvalController, timeline, sessionController, composer, workspace, rpgTurnSource] = await Promise.all([
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/message-timeline.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-session.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/message-composer.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/conversation-workspace.tsx", "utf8"),
  readFile("lib/novel-ai/web/rpg-chat-turn.ts", "utf8"),
]);
const recoveryStart = rpgController.indexOf("async function recoverRpgChoices");
const recoveryEnd = rpgController.indexOf("\n  return {", recoveryStart);
const recoveryBody = rpgController.slice(recoveryStart, recoveryEnd);
assert(recoveryStart >= 0 && recoveryEnd > recoveryStart, "the recovery controller must exist");
assert.match(recoveryBody, /createRpgChoicesMessage\(\{/u);
assert.doesNotMatch(recoveryBody, /approveRpgChatTurn/u, "choice recovery must never replay Canon approval");
const settlementIndex = recoveryBody.indexOf("await settleApprovedRpgTurnClosedAgent({");
const createNextChoicesIndex = recoveryBody.indexOf("await createRpgChoicesMessage({");
assert.ok(settlementIndex >= 0, "durable approval recovery must finish ClosedAgentOS settlement");
assert.ok(
  settlementIndex < createNextChoicesIndex,
  "ClosedAgentOS settlement must finish before rebuilding the next A/B/C card",
);
assert.match(approvalController, /rpgCanonCommitted = true;[\s\S]*retryActionRef\.current = \(\) => \{ void recoverRpgChoices\(\); \};/u);
assert.match(approvalController, /let rpgChoicesCompleted = false/u);
assert.match(approvalController, /rpgChoicesCompleted = true/u);
assert.match(approvalController, /if \(rpgCanonCommitted && !rpgChoicesCompleted\)/u);
assert.match(approvalController, /else if \(rpgCanonCommitted\)/u);
assert.match(approvalController, /const canonRevisionDigest = await currentCanonRevisionDigest\(\)[\s\S]{0,300}\} catch \{/u);
assert.match(timeline, /data-testid="rpg-next-choice-recovery"/u);
assert.match(timeline, /繼續下一輪／重新建立三選一/u);
assert.doesNotMatch(
  sessionController,
  /reconciledSessionIdsRef/u,
  "session reconciliation must be allowed to converge newly orphaned work on a later same-page read",
);
assert.match(
  sessionController,
  /\(interruptedInvocations\.length \|\| interruptedMessages\.length\)[\s\S]{0,120}&& !operationLocked\(\)/u,
);
assert.doesNotMatch(composer, /sourceControlsCollapseSignal/u);
assert.match(
  await readFile("app/studio/project/[projectId]/chat/components/conversation-workspace-view.tsx", "utf8"),
  /key=\{`conversation-message-composer:\$\{props\.sourceControlsCollapseSignal\}`\}/u,
);
assert.match(workspace, /onRpgGenerationStarted:\s*collapseSourceControlsAfterRpgStart/u);
assert.match(workspace, /inspectRpgChoiceTurn\(/u, "typed A/B/C must share the artifact-only consumed boundary");
assert.match(timeline, /inspectRpgChoiceTurn\(/u, "dashboard placement must share the recoverable choice boundary");
assert.match(rpgController, /readRpgChoiceTurnState\([\s\S]*?true/u);
assert.match(rpgController, /logicalTurnId:\s*userMessage\.id/u);
assert.match(
  rpgController,
  /resumeProviderTaskId:\s*invocationCompleted[\s\S]{0,100}invocation\.executionReceipt\?\.providerRunId/u,
  "completed recovery must pass the exact durable provider task into candidate replay",
);
assert.match(rpgController, /artifactId:\s*`conversation-rpg-artifact:\$\{input\.sessionId\}:\$\{userMessage\.id\}`/u);
assert.match(rpgTurnSource, /rpgLogicalTurnGenerationTaskId\(logicalTurnId, attempt\)/u);
assert.match(
  rpgTurnSource,
  /const resumeIdentity = resumeProviderTaskId[\s\S]{0,180}parseRpgLogicalTurnProviderTaskId[\s\S]{0,400}const resumeFallbackReview = resumeIdentity\?\.stage === "fallback-review"[\s\S]*if \(resumeFallbackReview\)[\s\S]*RPG_STORY_AI_RESUME_FALLBACK_REVIEW/u,
  "fallback-review recovery must bypass the initial generation task before replaying its durable receipt",
);
assert.match(
  rpgTurnSource,
  /attemptResult\.taskId !== attemptTaskId[\s\S]{0,100}attemptResult\.executionReceipt\?\.taskId !== attemptTaskId/u,
  "generation success must bind both the candidate and durable receipt to the actual provider attempt",
);
assert.match(
  sessionController,
  /completedRpgInvocationMessageIds[\s\S]*CONVERSATION_LOCAL_TOOL_IDS\.rpgTurn[\s\S]*invocation\.executionReceipt/u,
  "a completed RPG receipt must remain resumable instead of cancelling its streaming message",
);
assert.match(
  approvalController,
  /parentMessageId:\s*currentMessage\.id/u,
  "next choices must stay bound to the exact approved same-chapter source message",
);
assert.doesNotMatch(
  approvalController,
  /const latest = \(await conversation\.listMessages\(projectId, session\.id\)\)\.at\(-1\)/u,
);
assert.match(
  approvalController,
  /durableArtifact\?\.status === "approved"/u,
  "post-commit throws must recover from durable atomic approval truth",
);
assert.match(
  approvalController,
  /durableArtifact\?\.status === "approved"[\s\S]*settleApprovedRpgTurnClosedAgent\(\{/u,
  "durable Canon truth must trigger replay-safe ClosedAgentOS settlement",
);
const createChoicesBody = rpgController.slice(
  rpgController.indexOf("async function createRpgChoicesMessage"),
  rpgController.indexOf("function requestRpgChoiceFallback"),
);
assert.ok(
  createChoicesBody.indexOf("try {") < createChoicesBody.indexOf("conversation.saveToolInvocation({"),
  "choice-plan invocation persistence must be inside the placeholder convergence try block",
);
assert.ok(
  createChoicesBody.indexOf("conversation.saveToolInvocation({")
    < createChoicesBody.indexOf("onRpgGenerationStarted();"),
  "source controls may collapse only after the choice-plan invocation has started",
);

// Inject a persistence failure exactly after the streaming placeholder is
// created. The controller must converge that orphan to failed even though no
// invocation object was returned to the caller.
const injectedPlaceholder = message("failure-injection-placeholder", {
  status: "streaming",
  revision: 1,
  parentMessageId: approvedTurn.id,
});
let settledStatus = null;
let controller = null;
function ControllerHarness() {
  controller = useConversationRpgController({
    projectId,
    repository: {
      get: async (store, id) => store === "conversationMessages" && id === injectedPlaceholder.id
        ? injectedPlaceholder
        : null,
    },
    learningRepository: {},
    ensureSharedLearningReady: async () => undefined,
    conversation: {
      appendMessage: async () => injectedPlaceholder,
      saveToolInvocation: async () => {
        throw Object.assign(new Error("injected invocation persistence failure"), {
          code: "TEST_SAVE_INVOCATION_FAILED",
        });
      },
      listToolInvocations: async () => [],
      updateMessageStatus: async (input) => {
        settledStatus = input.status;
        return { ...injectedPlaceholder, status: input.status, content: input.content };
      },
    },
    activeSession: null,
    busy: false,
    executionSourceSnapshot: {
      externalSelected: false,
      publicExecutionEnabled: false,
      providerConfigured: false,
      providerStatusError: null,
      singleRunConsentGranted: false,
      externalExecutionModeSelected: false,
    },
    operationLockRef: { current: false },
    retryActionRef: { current: null },
    runRef: { current: 0 },
    abortRef: { current: null },
    acquireLease: async () => null,
    maybeUpdateRollingSummary: async () => undefined,
    loadWorkspace: async () => true,
    setRetryAvailable: () => undefined,
    setRetryLabel: () => undefined,
    setCancellable: () => undefined,
    setBusy: () => undefined,
    setSafeError: () => undefined,
    setProgress: () => undefined,
    setDrawer: () => undefined,
    onRpgGenerationStarted: () => {
      throw new Error("generation-start signal must not fire when invocation persistence fails");
    },
  });
  return null;
}
renderToStaticMarkup(React.createElement(ControllerHarness));
await assert.rejects(
  controller.createRpgChoicesMessage({
    sessionId,
    parentMessageId: approvedTurn.id,
    signal: new AbortController().signal,
  }),
  /injected invocation persistence failure/u,
);
assert.equal(settledStatus, "failed", "saveToolInvocation failure must settle its streaming placeholder");
const cancelledController = new AbortController();
cancelledController.abort("failure-injection-cancelled");
settledStatus = null;
await assert.rejects(
  controller.createRpgChoicesMessage({
    sessionId,
    parentMessageId: approvedTurn.id,
    signal: cancelledController.signal,
  }),
  /injected invocation persistence failure/u,
);
assert.equal(
  settledStatus,
  "cancelled",
  "an aborted saveToolInvocation failure must settle its streaming placeholder as cancelled",
);

console.log(JSON.stringify({
  schemaVersion: "rpg-choice-recovery-v1",
  status: "PASS",
  covered: [
    "approved-turn-without-choices",
    "cross-chapter-approved-artifact-is-ignored",
    "failed-choice-plan-retry",
    "orphan-streaming-placeholder-is-recoverable",
    "same-source-choice-plan-invocation-suppresses-recovery",
    "other-tool-and-other-chapter-invocations-do-not-block",
    "save-invocation-failure-settles-placeholder",
    "choice-user-save-before-assistant-resumes-one-logical-turn",
    "assistant-placeholder-before-invocation-resumes",
    "stale-running-invocation-converges-before-retry",
    "completed-receipt-before-message-replays-same-candidate",
    "fallback-review-receipt-before-message-replays-same-candidate",
    "completed-message-before-artifact-replays-same-candidate",
    "candidate-artifact-is-the-consumption-boundary",
    "rejected-artifact-starts-a-new-logical-attempt",
    "post-commit-durable-approval-replays-only-idempotent-settlement",
    "completed-choices-suppress-recovery",
    "wrong-parent-completed-choices-do-not-suppress-recovery",
    "stale-story-state-choice-allows-recovery",
    "stale-chapter-choice-allows-recovery",
    "pending-candidate-suppresses-recovery",
    "archived-ending-suppresses-recovery",
    "bare-game-continuation-planner",
    "recovery-replays-canon-idempotently-before-next-choice",
    "post-commit-error-stage-is-explicit",
    "visible-recovery-control",
  ],
}, null, 2));
