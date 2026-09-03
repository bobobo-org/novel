import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { planConversationRequest } from "../lib/novel-ai/conversation/planner.ts";
import {
  rpgLogicalTurnFallbackRepairTaskId,
  rpgLogicalTurnFallbackReviewTaskId,
  rpgLogicalTurnGenerationTaskId,
} from "../lib/novel-ai/conversation/rpg-logical-turn.ts";
import { ConversationRepositoryService } from "../lib/novel-ai/conversation/repository.ts";
import { CONVERSATION_LOCAL_TOOL_IDS } from "../lib/novel-ai/conversation/tool-registry.ts";
import { makeRecord } from "../lib/novel-ai/domain/index.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  buildImportIdMap,
  remapImportedRecord,
  validateImportRecords,
} from "../lib/novel-ai/repository/import-remap.ts";
import {
  findRpgChoiceRecoveryTarget,
  latestRpgChoicesFrom,
} from "../app/studio/project/[projectId]/chat/conversation-workspace-support.ts";
import {
  rpgCandidateApprovalState,
  rpgCandidateRequiresClosedReview,
  rpgChoiceSelectionDisabled,
  serializeRpgChoices,
} from "../app/studio/project/[projectId]/chat/components/conversation-presentation.ts";
import {
  inspectRpgChoiceTurn,
  resolveRpgExecutionRecoveryMode,
  rpgSafeContinuityFailures,
  rpgChoiceUserContent,
  rpgUserMessageMatchesChoice,
  useConversationRpgController,
} from "../app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts";
import {
  RPG_CHOICE_STALE_EVIDENCE_MESSAGE,
  RPG_CHOICE_STALE_EVIDENCE_STAGE,
  RPG_CHOICE_STALE_EVIDENCE_TASK_TYPE,
  RPG_CHOICE_STALE_EVIDENCE_TOOL_ID,
  rpgChoiceStaleEvidenceId,
} from "../lib/novel-ai/conversation/rpg-choice-stale-evidence.ts";
import {
  rpgChoiceRuleFallbackReason,
  rpgStoryRuleFallbackReason,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";

const projectId = "project-rpg-recovery";
const sessionId = "session-rpg-recovery";

assert.deepEqual(
  rpgSafeContinuityFailures({
    reviewContinuityFailures: ["review_failure", "review_failure"],
    generationContinuityFailures: ["generation_failure"],
    continuityFailures: ["direct_failure"],
  }),
  ["review_failure"],
  "non-empty review failures must take precedence and remain deduplicated",
);
assert.deepEqual(
  rpgSafeContinuityFailures({
    reviewContinuityFailures: [],
    generationContinuityFailures: ["generation_failure"],
    continuityFailures: ["direct_failure"],
  }),
  [],
  "an authoritative empty final-review result must not misreport an older generation failure",
);
assert.deepEqual(
  rpgSafeContinuityFailures({
    reviewContinuityFailures: [],
    generationContinuityFailures: [],
    continuityFailures: ["direct_failure"],
  }),
  [],
  "an authoritative empty final-review result must not misreport an older direct failure",
);
assert.deepEqual(
  rpgSafeContinuityFailures({
    reviewContinuityFailures: [],
    generationContinuityFailures: [],
    continuityFailures: [],
    cause: {
      generationContinuityFailures: ["nested_generation_failure"],
    },
  }),
  [],
  "an authoritative empty final-review result must stop traversal into stale nested failures",
);

assert.equal(
  rpgChoiceRuleFallbackReason({
    error: Object.assign(new Error("bridge missing"), { code: "BRIDGE_PROCESS_UNREACHABLE" }),
  }),
  null,
  "a missing service must remain a visible failure instead of silently becoming rules fallback",
);
assert.equal(
  rpgChoiceRuleFallbackReason({
    error: Object.assign(new Error("request timed out"), { code: "REQUEST_TIMEOUT" }),
  }),
  "REQUEST_TIMEOUT",
);
assert.equal(
  rpgChoiceRuleFallbackReason({
    error: Object.assign(new Error("model timed out"), { code: "OLLAMA_TIMEOUT" }),
  }),
  "OLLAMA_TIMEOUT",
);
assert.equal(
  rpgChoiceRuleFallbackReason({
    error: new Error("enhancement deadline"),
    enhancementAbortReason: "RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT",
  }),
  "RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT",
);
assert.equal(
  rpgChoiceRuleFallbackReason({
    error: new Error("author chose fallback"),
    requestAbortReason: "USER_REQUESTED_RULE_FALLBACK",
  }),
  "USER_REQUESTED_RULE_FALLBACK",
);
assert.equal(
  rpgChoiceRuleFallbackReason({
    error: new Error("navigation cancelled"),
    requestAbortReason: "CONVERSATION_CANCELLED",
  }),
  null,
  "ordinary cancellation must never persist a fallback choice card",
);
assert.equal(
  rpgStoryRuleFallbackReason(
    Object.assign(new Error("bridge missing"), { code: "BRIDGE_PROCESS_UNREACHABLE" }),
  ),
  null,
  "a non-timeout story failure must remain fail-closed",
);
for (const timeoutCode of ["RPG_STORY_AI_TIMEOUT", "REQUEST_TIMEOUT", "OLLAMA_TIMEOUT"]) {
  assert.equal(
    rpgStoryRuleFallbackReason(Object.assign(new Error(timeoutCode), { code: timeoutCode })),
    timeoutCode,
    `${timeoutCode} must be recognized as an explicit story fallback deadline`,
  );
}

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
const staleEvidenceId = "choice-card-crash-matrix-stale-evidence";
const initialChoiceAnchor = message("initial-choice-anchor", { role: "user" });
const choiceCardMessage = message(choiceCardId, {
  content: choicesContent,
  contentDigest: "d".repeat(64),
  parentMessageId: initialChoiceAnchor.id,
  toolInvocationIds: [staleEvidenceId],
});
const staleChoiceEvidence = invocation(staleEvidenceId, choiceCardId, {
  taskId: staleEvidenceId,
  toolId: RPG_CHOICE_STALE_EVIDENCE_TOOL_ID,
  taskType: RPG_CHOICE_STALE_EVIDENCE_TASK_TYPE,
  inputDigest: choiceCardMessage.contentDigest,
  contextDigest: choiceContextRevisionDigest,
  status: "failed",
  actualExecutor: null,
  modelId: null,
  modelDigest: null,
  executionReceipt: null,
  externalRequest: false,
  dataLeftDevice: false,
  canonicalMutationCount: 0,
  safeProgress: {
    stage: RPG_CHOICE_STALE_EVIDENCE_STAGE,
    percent: 100,
    message: RPG_CHOICE_STALE_EVIDENCE_MESSAGE,
  },
  safeErrorCode: "RPG_CHAT_CHOICES_STALE",
});
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
const staleCancelledChoice = {
  ...persistedChoice,
  id: "choice-user-stale-cancelled",
  status: "cancelled",
};
const staleCancelledState = inspectRpgChoiceTurn([staleCancelledChoice], [], choiceCardId);
assert.equal(staleCancelledState.attempts.length, 1, "a compensated stale click remains auditable");
assert.equal(
  staleCancelledState.recoverableUser,
  null,
  "a stale pending click that was cancelled must not block a new valid choice",
);
const completedChoiceWithFailedAssistant = {
  ...persistedChoice,
  id: "choice-user-completed-before-stale-context",
  status: "completed",
};
const failedAssistantAfterCompletedChoice = message("choice-assistant-failed-before-stale-context", {
  parentMessageId: completedChoiceWithFailedAssistant.id,
  status: "failed",
});
const staleCompletedState = inspectRpgChoiceTurn(
  [choiceCardMessage, completedChoiceWithFailedAssistant, failedAssistantAfterCompletedChoice],
  [],
  choiceCardId,
  [staleChoiceEvidence],
);
assert.equal(staleCompletedState.attempts.length, 1, "a completed stale attempt remains auditable");
assert.equal(staleCompletedState.consumed, false, "stale evidence must not masquerade as a settled candidate");
assert.equal(staleCompletedState.abandoned, true, "durable stale evidence closes the obsolete choice card");
assert.equal(staleCompletedState.closed, true, "an abandoned card is closed without being consumed");
assert.equal(
  staleCompletedState.recoverableUser,
  null,
  "a completed choice abandoned after context drift must never replay its stale envelope",
);
assert.deepEqual(
  findRpgChoiceRecoveryTarget(
    [initialChoiceAnchor, choiceCardMessage, completedChoiceWithFailedAssistant, failedAssistantAfterCompletedChoice],
    [],
    openSnapshot,
    [staleChoiceEvidence],
  ),
  {
    sourceArtifactId: null,
    parentMessageId: initialChoiceAnchor.id,
    reason: "stale_choice_card",
    choiceCardMessageId: choiceCardMessage.id,
  },
  "an initial stale choice card must rebuild from its original anchor without requiring an approved artifact",
);
const unrelatedChoiceUser = message("unrelated-choice-user", {
  role: "user",
  sourceMessageId: "another-choice-card",
});
const unrelatedChoiceResponse = message("unrelated-choice-response", {
  parentMessageId: unrelatedChoiceUser.id,
});
assert.deepEqual(
  findRpgChoiceRecoveryTarget(
    [
      initialChoiceAnchor,
      choiceCardMessage,
      completedChoiceWithFailedAssistant,
      failedAssistantAfterCompletedChoice,
      unrelatedChoiceUser,
      unrelatedChoiceResponse,
    ],
    [artifact("unrelated-choice-artifact", unrelatedChoiceResponse.id, "candidate")],
    openSnapshot,
    [staleChoiceEvidence],
  )?.choiceCardMessageId,
  choiceCardMessage.id,
  "an unrelated branch candidate must not suppress recovery of this stale choice card",
);

const markerRepository = new MemoryNovelRepository();
await markerRepository.put("projects", {
  ...makeRecord(projectId, "user"),
  id: projectId,
});
const markerConversation = new ConversationRepositoryService(markerRepository);
await markerConversation.createSession({
  projectId,
  sessionId,
  title: "RPG stale marker repository regression",
});
const markerAnchor = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-stale-choice-anchor",
  role: "user",
  content: "開始故事",
  status: "completed",
});
const markerChoiceCard = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-stale-choice-card",
  role: "assistant",
  content: choicesContent,
  status: "completed",
  parentMessageId: markerAnchor.id,
});
const markerCompletedUser = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-stale-choice-user",
  role: "user",
  content: rpgChoiceUserContent(selectedChoice),
  status: "completed",
  sourceMessageId: markerChoiceCard.id,
});
const completedUserBeforeMarker = await markerRepository.get(
  "conversationMessages",
  markerCompletedUser.id,
);
const expectedMarkerId = await rpgChoiceStaleEvidenceId({
  sessionId,
  choiceCardMessageId: markerChoiceCard.id,
  contextRevisionDigest: choiceContextRevisionDigest,
});
const savedMarker = await markerConversation.saveRpgChoiceStaleEvidence({
  projectId,
  sessionId,
  choiceCardMessageId: markerChoiceCard.id,
});
const replayedMarker = await markerConversation.saveRpgChoiceStaleEvidence({
  projectId,
  sessionId,
  choiceCardMessageId: markerChoiceCard.id,
});
assert.equal(savedMarker.id, expectedMarkerId, "the stale marker id must be deterministic from card identity");
assert.deepEqual(replayedMarker, savedMarker, "replaying stale-marker persistence must be idempotent");
assert.deepEqual(
  await markerRepository.get("conversationMessages", markerCompletedUser.id),
  completedUserBeforeMarker,
  "persisting stale evidence must not rewrite or cancel an already completed user choice",
);
const crashChoiceCard = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-stale-choice-card-crash-gap",
  role: "assistant",
  content: choicesContent,
  status: "completed",
  parentMessageId: markerAnchor.id,
});
const crashMarkerId = await rpgChoiceStaleEvidenceId({
  sessionId,
  choiceCardMessageId: crashChoiceCard.id,
  contextRevisionDigest: choiceContextRevisionDigest,
});
await markerRepository.put("conversationToolInvocations", {
  ...savedMarker,
  ...makeRecord(projectId, "system"),
  id: crashMarkerId,
  taskId: crashMarkerId,
  messageId: crashChoiceCard.id,
  inputDigest: crashChoiceCard.contentDigest,
  contextDigest: choiceContextRevisionDigest,
});
assert.equal(
  (await markerRepository.get("conversationMessages", crashChoiceCard.id))
    .toolInvocationIds.includes(crashMarkerId),
  false,
  "fault injection must begin between marker persistence and message backlink persistence",
);
const repairedCrashMarker = await markerConversation.saveRpgChoiceStaleEvidence({
  projectId,
  sessionId,
  choiceCardMessageId: crashChoiceCard.id,
});
assert.equal(repairedCrashMarker.id, crashMarkerId);
assert.equal(
  (await markerRepository.get("conversationMessages", crashChoiceCard.id))
    .toolInvocationIds.includes(crashMarkerId),
  true,
  "replay must repair the exact valid marker backlink after a tab-crash gap",
);
await assert.rejects(
  markerConversation.saveToolInvocation({
    projectId,
    sessionId,
    messageId: markerChoiceCard.id,
    invocationId: "forged-generic-stale-marker",
    taskId: "forged-generic-stale-marker",
    toolId: RPG_CHOICE_STALE_EVIDENCE_TOOL_ID,
    taskType: RPG_CHOICE_STALE_EVIDENCE_TASK_TYPE,
    inputDigest: markerChoiceCard.contentDigest,
    contextDigest: choiceContextRevisionDigest,
    status: "failed",
  }),
  (error) => error?.code === "CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_RESERVED",
  "generic tool persistence must not forge the reserved stale-evidence identity",
);
await assert.rejects(
  markerConversation.updateToolInvocationStatus({
    projectId,
    sessionId,
    invocationId: savedMarker.id,
    expectedRevision: savedMarker.revision,
    status: "failed",
  }),
  (error) => error?.code === "CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_IMMUTABLE",
  "durable stale evidence must be immutable even under a same-status update",
);
const markerMessages = await markerConversation.listMessages(projectId, sessionId);
const markerInvocations = await markerConversation.listToolInvocations(projectId, sessionId);
const selectedStaleCard = latestRpgChoicesFrom(markerMessages, markerInvocations);
assert.equal(selectedStaleCard?.message.id, crashChoiceCard.id);
assert.equal(selectedStaleCard?.abandoned, true, "the latest-choice selector must expose the durable closed marker");
assert.equal(
  inspectRpgChoiceTurn(markerMessages, [], markerChoiceCard.id, markerInvocations).closed,
  true,
  "a repository-persisted stale marker must close the choice card without settling it",
);
const markerProject = await markerRepository.get("projects", projectId);
const markerPayload = {
  projects: [markerProject],
  conversationSessions: await markerRepository.list("conversationSessions"),
  conversationMessages: markerMessages,
  conversationToolInvocations: markerInvocations,
};
validateImportRecords(markerPayload);
const copiedProjectId = "project-rpg-recovery-copy";
const markerIdMap = buildImportIdMap(markerPayload, projectId, copiedProjectId);
const copiedMarkerPayload = Object.fromEntries(Object.entries(markerPayload).map(([store, records]) => [
  store,
  records.map((record) => remapImportedRecord(record, copiedProjectId, markerIdMap, true)),
]));
validateImportRecords(copiedMarkerPayload);
const copiedMarker = copiedMarkerPayload.conversationToolInvocations[0];
assert.equal(copiedMarker.id, copiedMarker.taskId, "copy import must preserve stale-marker id/task identity");
const copiedMarkerRepository = new MemoryNovelRepository();
for (const [store, records] of Object.entries(copiedMarkerPayload)) {
  for (const record of records) await copiedMarkerRepository.put(store, record);
}
const copiedMarkerConversation = new ConversationRepositoryService(copiedMarkerRepository);
const copiedSessionId = markerIdMap.get(sessionId);
const copiedChoiceCardId = markerIdMap.get(markerChoiceCard.id);
assert.ok(copiedSessionId && copiedChoiceCardId);
const copiedCardMarkersBeforeReplay = (
  await copiedMarkerConversation.listToolInvocations(copiedProjectId, copiedSessionId)
).filter((invocation) => invocation.messageId === copiedChoiceCardId);
assert.equal(copiedCardMarkersBeforeReplay.length, 1);
const replayedCopiedMarker = await copiedMarkerConversation.saveRpgChoiceStaleEvidence({
  projectId: copiedProjectId,
  sessionId: copiedSessionId,
  choiceCardMessageId: copiedChoiceCardId,
});
const copiedCardMarkersAfterReplay = (
  await copiedMarkerConversation.listToolInvocations(copiedProjectId, copiedSessionId)
).filter((invocation) => invocation.messageId === copiedChoiceCardId);
assert.equal(
  replayedCopiedMarker.id,
  copiedCardMarkersBeforeReplay[0].id,
  "copy recovery must reuse the validated remapped stale marker",
);
assert.equal(
  copiedCardMarkersAfterReplay.length,
  1,
  "copy recovery must not create a second stale marker for the same card",
);
const forgedMarkerPayload = structuredClone(markerPayload);
forgedMarkerPayload.conversationToolInvocations[0].safeProgress.message = "forged stale evidence";
assert.throws(
  () => validateImportRecords(forgedMarkerPayload),
  /BACKUP_CONVERSATION_RPG_CHOICE_STALE_EVIDENCE_INVALID/u,
  "backup import must reject a forged stale-marker shape",
);

const settledChoiceCard = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-settled-choice-card",
  role: "assistant",
  content: choicesContent,
  status: "completed",
  parentMessageId: markerAnchor.id,
});
const settledChoiceUser = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-settled-choice-user",
  role: "user",
  content: rpgChoiceUserContent(selectedChoice),
  status: "completed",
  sourceMessageId: settledChoiceCard.id,
});
const settledChoiceResponse = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-settled-choice-response",
  role: "assistant",
  content: "已完成的候選正文",
  status: "completed",
  parentMessageId: settledChoiceUser.id,
});
await markerConversation.saveArtifact({
  projectId,
  sessionId,
  sourceMessageId: settledChoiceResponse.id,
  artifactId: "repository-settled-choice-artifact",
  artifactType: "rpg",
  targetStore: "chapters",
  targetRecordId: "chapter-1",
  sourceRevision: 2,
  candidateContent: "已完成的候選正文",
});
await assert.rejects(
  markerConversation.saveRpgChoiceStaleEvidence({
    projectId,
    sessionId,
    choiceCardMessageId: settledChoiceCard.id,
  }),
  (error) => error?.code === "CONVERSATION_RPG_CHOICE_ALREADY_SETTLED",
  "a settled RPG choice must refuse stale-abandonment evidence",
);
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
const explicitRetryProviderRunId = await rpgLogicalTurnGenerationTaskId(persistedChoice.id, 2);
const stableFallbackReviewRunId = await rpgLogicalTurnFallbackReviewTaskId(persistedChoice.id);
const stableFallbackRepairFailures = ["continuity_anchor", "dialogue_attribution"];
const stableFallbackRepairRunId = await rpgLogicalTurnFallbackRepairTaskId(
  persistedChoice.id,
  stableFallbackRepairFailures,
);
assert.equal(
  await rpgLogicalTurnGenerationTaskId(persistedChoice.id),
  stableProviderRunId,
  "the same logical turn must replay the same Closed Agent idempotency key",
);
assert.notEqual(
  explicitRetryProviderRunId,
  stableProviderRunId,
  "an explicit terminal retry must preserve attempt 1 and dispatch a distinct attempt 2",
);
assert.match(explicitRetryProviderRunId, /:generation:attempt-2$/u);
assert.notEqual(
  await rpgLogicalTurnGenerationTaskId(`${persistedChoice.id}:next-attempt`),
  stableProviderRunId,
  "an explicitly new choice attempt must receive a distinct idempotency key",
);
assert.match(stableFallbackRepairRunId, /:fallback-repair:quality-[a-f0-9]{4}:attempt-1$/u);
assert.notEqual(stableFallbackRepairRunId, stableFallbackReviewRunId);
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

const repositoryRpgChoice = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-rpg-orchestration-choice",
  role: "user",
  content: "選擇 A｜測試同一 logical turn 的收據身分。",
  status: "completed",
  sourceMessageId: markerChoiceCard.id,
});
const repositoryRpgAssistant = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-rpg-orchestration-assistant",
  role: "assistant",
  content: "",
  status: "streaming",
  parentMessageId: repositoryRpgChoice.id,
});
const repositoryRpgOrchestrationTaskId = [
  "conversation-rpg-turn-task",
  sessionId,
  repositoryRpgChoice.id,
].join(":");
const repositoryRpgProviderRunId = await rpgLogicalTurnGenerationTaskId(
  repositoryRpgChoice.id,
);
assert.notEqual(
  repositoryRpgOrchestrationTaskId,
  repositoryRpgProviderRunId,
  "the Conversation orchestration task and Closed Agent provider run are distinct identities",
);
const repositoryRpgInvocation = await markerConversation.saveToolInvocation({
  projectId,
  sessionId,
  messageId: repositoryRpgAssistant.id,
  invocationId: "repository-rpg-orchestration-invocation",
  taskId: repositoryRpgOrchestrationTaskId,
  toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgTurn,
  taskType: "chapter.continue",
  inputDigest: "1".repeat(64),
  contextDigest: "2".repeat(64),
  status: "running",
  canonicalMutationCount: 0,
});
const repositoryRpgReceipt = {
  receiptId: "repository-rpg-logical-turn-receipt",
  modelId: "repository-rpg-model",
  modelDigest: "3".repeat(64),
  providerRunId: repositoryRpgProviderRunId,
  contextDigest: "2".repeat(64),
  outputDigest: "4".repeat(64),
  externalRequest: false,
  dataLeftDevice: false,
  latencyMs: 1,
  closedAgentSchemaVersion: "closed-agent-os-v2",
  closedAgentBackendId: "local-ollama",
  normalizationReceiptId: `traditional-chinese-integrity:${"5".repeat(64)}`,
  traditionalChineseNormalizerVersion: "opencc-js-1.4.1-cn-to-tw-single-pass-v1",
};
const completedRepositoryRpgInvocation = await markerConversation.updateToolInvocationStatus({
  projectId,
  sessionId,
  invocationId: repositoryRpgInvocation.id,
  expectedRevision: repositoryRpgInvocation.revision,
  status: "completed",
  actualExecutor: "local-ollama",
  modelId: repositoryRpgReceipt.modelId,
  modelDigest: repositoryRpgReceipt.modelDigest,
  executionReceipt: repositoryRpgReceipt,
  externalRequest: false,
  dataLeftDevice: false,
  canonicalMutationCount: 0,
  safeProgress: { stage: "candidate", percent: 100, message: "RPG 候選證據已完成" },
});
assert.equal(completedRepositoryRpgInvocation.status, "completed");
assert.ok(completedRepositoryRpgInvocation.completedAt);
assert.equal(
  completedRepositoryRpgInvocation.taskId,
  repositoryRpgOrchestrationTaskId,
  "completion must preserve the orchestration task identity",
);
assert.equal(
  completedRepositoryRpgInvocation.executionReceipt?.providerRunId,
  repositoryRpgProviderRunId,
  "completion must preserve the exact provider identity for the same logical turn",
);

const wrongLogicalTurnChoice = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-rpg-wrong-logical-turn-choice",
  role: "user",
  content: "選擇 B｜測試錯誤 logical turn 的收據身分。",
  status: "completed",
  sourceMessageId: markerChoiceCard.id,
});
const wrongLogicalTurnAssistant = await markerConversation.appendMessage({
  projectId,
  sessionId,
  messageId: "repository-rpg-wrong-logical-turn-assistant",
  role: "assistant",
  content: "",
  status: "streaming",
  parentMessageId: wrongLogicalTurnChoice.id,
});
const wrongLogicalTurnInvocation = await markerConversation.saveToolInvocation({
  projectId,
  sessionId,
  messageId: wrongLogicalTurnAssistant.id,
  invocationId: "repository-rpg-wrong-logical-turn-invocation",
  taskId: [
    "conversation-rpg-turn-task",
    sessionId,
    wrongLogicalTurnChoice.id,
  ].join(":"),
  toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgTurn,
  taskType: "chapter.continue",
  inputDigest: "6".repeat(64),
  contextDigest: "7".repeat(64),
  status: "running",
  canonicalMutationCount: 0,
});
await assert.rejects(
  markerConversation.updateToolInvocationStatus({
    projectId,
    sessionId,
    invocationId: wrongLogicalTurnInvocation.id,
    expectedRevision: wrongLogicalTurnInvocation.revision,
    status: "completed",
    actualExecutor: "local-ollama",
    modelId: repositoryRpgReceipt.modelId,
    modelDigest: repositoryRpgReceipt.modelDigest,
    executionReceipt: {
      ...repositoryRpgReceipt,
      receiptId: "repository-rpg-wrong-logical-turn-receipt",
      providerRunId: repositoryRpgProviderRunId,
      contextDigest: "7".repeat(64),
      outputDigest: "8".repeat(64),
    },
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  }),
  (error) => error?.code === "CONVERSATION_RECEIPT_IDENTITY_INVALID",
  "an RPG receipt from a different logical turn must not complete the orchestration invocation",
);
assert.equal(
  (await markerRepository.get(
    "conversationToolInvocations",
    wrongLogicalTurnInvocation.id,
  )).status,
  "running",
  "rejecting the mismatched provider identity must leave the durable invocation unmodified",
);

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
      executionReceipt: { ...receipt, providerRunId: stableFallbackRepairRunId },
    },
    [stableProviderRunId, stableFallbackRepairRunId],
  ),
  "resume_completed",
  "a completed bounded continuity-repair receipt must resume the same logical turn",
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

const fallbackCandidateTaskId = "fallback-review-task";
const fallbackCandidateDigest = "f".repeat(64);
const fallbackCandidateArtifact = artifact(
  "choice-artifact-fallback-candidate",
  completedAssistantBeforeArtifact.id,
  "candidate",
  {
    candidateContent: JSON.stringify({
      schemaVersion: "conversation-rpg-candidate-v1",
      candidate: {
        taskId: fallbackCandidateTaskId,
        candidateDigest: fallbackCandidateDigest,
      },
    }),
  },
);
const fallbackInvocation = invocation(
  "choice-invocation-fallback-candidate",
  completedAssistantBeforeArtifact.id,
  {
    toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgTurn,
    status: "completed",
    actualExecutor: "deterministic-rule-fallback",
    executionReceipt: {
      providerRunId: fallbackCandidateTaskId,
      outputDigest: fallbackCandidateDigest,
    },
  },
);
const runningCandidateInvocation = {
  ...fallbackInvocation,
  status: "running",
  completedAt: null,
  actualExecutor: null,
  executionReceipt: null,
};
assert.equal(
  rpgCandidateApprovalState(fallbackCandidateArtifact, []),
  "settling",
  "an RPG artifact without its durable completed invocation must not expose approval",
);
assert.equal(
  rpgCandidateApprovalState(fallbackCandidateArtifact, [runningCandidateInvocation]),
  "settling",
  "a running RPG invocation must keep the candidate in the evidence-settling state",
);
assert.equal(
  rpgCandidateApprovalState(fallbackCandidateArtifact, [{
    ...fallbackInvocation,
    executionReceipt: {
      ...fallbackInvocation.executionReceipt,
      outputDigest: "e".repeat(64),
    },
  }]),
  "settling",
  "a completed invocation with a mismatched candidate digest must not expose approval",
);
assert.equal(
  rpgCandidateApprovalState(fallbackCandidateArtifact, [{
    ...fallbackInvocation,
    actualExecutor: "local-ollama",
  }]),
  "ready",
  "an exact completed closed-AI invocation must expose approval",
);
assert.equal(
  rpgCandidateApprovalState(fallbackCandidateArtifact, [fallbackInvocation]),
  "closed_review_required",
  "an exact deterministic fallback invocation must remain fail-closed",
);
assert.equal(
  rpgCandidateRequiresClosedReview(fallbackCandidateArtifact, [fallbackInvocation]),
  true,
  "the exact fallback invocation bound by task and output digest must require closed review",
);
assert.equal(
  rpgCandidateRequiresClosedReview(fallbackCandidateArtifact, [{
    ...fallbackInvocation,
    executionReceipt: {
      ...fallbackInvocation.executionReceipt,
      outputDigest: "e".repeat(64),
    },
  }]),
  false,
  "an unrelated fallback invocation must not block a candidate",
);
const rejectedFallbackArtifact = { ...fallbackCandidateArtifact, status: "rejected" };
const rejectedFallbackState = inspectRpgChoiceTurn(
  [persistedChoice, completedAssistantBeforeArtifact],
  [rejectedFallbackArtifact],
  choiceCardId,
  [fallbackInvocation],
);
assert.equal(rejectedFallbackState.consumed, false, "rejecting the old fallback candidate must unconsume the choice");
assert.equal(rejectedFallbackState.closed, false, "rejecting the old fallback candidate must reopen the turn");
assert.equal(
  rejectedFallbackState.closedReviewRequired,
  true,
  "the reopened turn must remember that verified closed review is required",
);
assert.equal(rpgChoiceSelectionDisabled({
  busy: false,
  consumed: rejectedFallbackState.consumed,
  abandoned: rejectedFallbackState.abandoned,
  hasEnvelope: true,
  closedReviewRequired: rejectedFallbackState.closedReviewRequired,
  closedAiReady: false,
}), true, "the original choice must wait while closed AI is not routable and ready");
assert.equal(rpgChoiceSelectionDisabled({
  busy: false,
  consumed: rejectedFallbackState.consumed,
  abandoned: rejectedFallbackState.abandoned,
  hasEnvelope: true,
  closedReviewRequired: rejectedFallbackState.closedReviewRequired,
  closedAiReady: true,
}), false, "the original choice must be selectable again after closed AI becomes ready");

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

const [
  rpgController,
  approvalController,
  timeline,
  sessionController,
  composer,
  workspace,
  rpgTurnSource,
  candidateCardSource,
  artifactDrawerSource,
  rpgTurnCardSource,
] = await Promise.all([
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/message-timeline.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-session.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/message-composer.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/conversation-workspace.tsx", "utf8"),
  readFile("lib/novel-ai/web/rpg-chat-turn.ts", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/candidate-card.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/artifact-drawer.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/rpg-turn-card.tsx", "utf8"),
]);
const recoveryStart = rpgController.indexOf("async function recoverRpgChoices");
const recoveryEnd = rpgController.indexOf("\n  return {", recoveryStart);
const recoveryBody = rpgController.slice(recoveryStart, recoveryEnd);
assert(recoveryStart >= 0 && recoveryEnd > recoveryStart, "the recovery controller must exist");
assert.match(recoveryBody, /createRpgChoicesMessage\(\{/u);
assert.doesNotMatch(recoveryBody, /approveRpgChatTurn/u, "choice recovery must never replay Canon approval");
const settlementIndex = recoveryBody.indexOf("await settleApprovedRpgTurnClosedAgent({");
const staleMarkerIndex = recoveryBody.indexOf("await abandonStaleRpgChoiceCard({");
const createNextChoicesIndex = recoveryBody.indexOf("await createRpgChoicesMessage({");
assert.ok(settlementIndex >= 0, "durable approval recovery must finish ClosedAgentOS settlement");
assert.ok(
  settlementIndex < createNextChoicesIndex,
  "ClosedAgentOS settlement must finish before rebuilding the next A/B/C card",
);
assert.ok(staleMarkerIndex >= 0, "stale recovery must persist a durable terminal marker");
assert.ok(
  staleMarkerIndex < createNextChoicesIndex,
  "stale recovery must close the old card before rebuilding the next A/B/C card",
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
assert.match(
  workspace,
  /safeCode === "RPG_CHAT_CHOICES_STALE" && requestRpgChoices[\s\S]{0,500}await abandonStaleRpgChoiceCard\(\{/u,
  "typed A/B/C must durably abandon a stale envelope instead of retrying it forever",
);
assert.match(
  workspace,
  /await abandonStaleRpgChoiceCard\(\{[\s\S]{0,900}retryActionRef\.current = \(\) => \{ void recoverRpgChoices\(\); \};/u,
  "typed stale A/B/C must retry through choice recovery, never through the old send request",
);
assert.match(timeline, /inspectRpgChoiceTurn\(/u, "dashboard placement must share the recoverable choice boundary");
assert.match(candidateCardSource, /!closedReviewRequired[\s\S]*?<ApprovalCard/u, "inline fallback candidates must hide approval");
assert.match(candidateCardSource, /放棄舊候選，回到原三選一/u);
assert.match(artifactDrawerSource, /!canonMutationForbidden && !closedReviewRequired/u, "the drawer must hide fallback approval too");
assert.match(artifactDrawerSource, /放棄舊候選，回到原三選一/u);
assert.match(rpgTurnCardSource, /rpgChoiceSelectionDisabled\(/u, "choice re-entry must use the closed readiness gate");
assert.match(rpgTurnCardSource, /rpg-closed-review-status/u, "the waiting state must be visible to the user");
assert.match(rpgController, /readRpgChoiceTurnState\([\s\S]*?true/u);
assert.match(rpgController, /logicalTurnId:\s*userMessage\.id/u);
assert.match(
  rpgController,
  /resumeProviderTaskId:\s*explicitRetryProviderTaskId \?\? \(invocationCompleted[\s\S]{0,100}invocation\.executionReceipt\?\.providerRunId/u,
  "completed recovery must pass the exact durable provider task into candidate replay",
);
assert.match(
  rpgController,
  /recoveryMode === "retry_terminal"[\s\S]{0,300}rpgLogicalTurnGenerationTaskId\(userMessage\.id, attemptNumber\)/u,
  "an explicit terminal retry must use a new immutable provider attempt instead of replaying the failed task",
);
assert.match(rpgController, /artifactId:\s*`conversation-rpg-artifact:\$\{input\.sessionId\}:\$\{userMessage\.id\}`/u);
assert.match(rpgTurnSource, /rpgLogicalTurnGenerationTaskId\(logicalTurnId, attempt\)/u);
assert.match(
  rpgTurnSource,
  /const resumeIdentity = resumeProviderTaskId[\s\S]{0,180}parseRpgLogicalTurnProviderTaskId[\s\S]{0,500}const resumeReviewStage = resumeIdentity\?\.stage === "fallback-review"[\s\S]*if \(resumeClosedReview\)[\s\S]*RPG_STORY_AI_RESUME_FALLBACK_REPAIR[\s\S]*RPG_STORY_AI_RESUME_FALLBACK_REVIEW/u,
  "fallback review and continuity-repair recovery must bypass initial generation before replaying their durable receipt",
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
assert.equal(
  createChoicesBody.match(/status: input\.signal\.aborted \? "cancelled" : "failed"/gu)?.length,
  2,
  "ordinary outer cancellation must settle both the choice placeholder and invocation as cancelled",
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
    "stale-choice-marker-deterministic-and-idempotent",
    "stale-choice-marker-generic-save-is-reserved",
    "stale-choice-marker-is-immutable",
    "stale-choice-marker-preserves-completed-user",
    "stale-choice-marker-repairs-crash-gap-backlink",
    "settled-choice-refuses-stale-marker",
    "stale-choice-selector-closes-card",
    "stale-choice-marker-copy-import-replay-remains-singleton",
    "forged-stale-choice-marker-import-is-rejected",
    "unrelated-candidate-does-not-block-stale-card",
    "typed-stale-choice-routes-through-durable-abandonment",
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
