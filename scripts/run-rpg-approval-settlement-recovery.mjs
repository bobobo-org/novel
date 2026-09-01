import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ClosedAICache,
  MemoryClosedAICacheRepository,
  sha256Hex,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  ClosedAgentOS,
  MemoryClosedAgentStateRepository,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  assertConversationClosedAgentApprovalBinding,
  buildConversationClosedAgentApprovalBindingProof,
} from "../lib/novel-ai/conversation/closed-agent-approval.ts";
import { ConversationRepositoryService } from "../lib/novel-ai/conversation/repository.ts";
import { CONVERSATION_LOCAL_TOOL_IDS } from "../lib/novel-ai/conversation/tool-registry.ts";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { resolveRpgChoice } from "../lib/novel-ai/game/progression/rpg-progression.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  acceptStudioChoice,
  persistStudioChoiceCandidate,
} from "../lib/novel-ai/repository/studio-canonical.ts";
import {
  ApprovalSigner,
  MemoryVerifiableLedgerRepository,
  VerifiableLedger,
} from "../lib/novel-ai/verifiable-ledger/index.ts";
import {
  buildDeterministicRpgTurnStory,
  buildRpgRuleChoicePlan,
  loadRpgChatSnapshot,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import { settleApprovedRpgTurnClosedAgent } from "../lib/novel-ai/web/rpg-approval-settlement.ts";
import { initializeMingtanPreset } from "../lib/novel-ai/web/rpg-preset.ts";
import {
  RPG_CHOICES_PREFIX,
  serializeRpgChoices,
} from "../app/studio/project/[projectId]/chat/components/conversation-presentation.ts";
import { findRpgChoiceRecoveryTarget } from "../app/studio/project/[projectId]/chat/conversation-workspace-support.ts";

const MODEL_DIGEST = "d".repeat(64);

class FixedStoryBackend {
  constructor(story) {
    this.id = "local-ollama";
    this.story = story;
    this.calls = 0;
  }

  async snapshot() {
    return {
      id: this.id,
      label: "Fault-injection Ollama",
      status: "ready",
      runtimeTruth: {
        installed: true,
        configured: true,
        reachable: true,
        modelAvailable: true,
        runtimeVerified: true,
        generationVerified: true,
        verificationSource: "local-bridge-generation",
        verifiedAt: "2026-08-30T00:00:00.000Z",
      },
      modelId: "settlement-test-model",
      modelDigest: MODEL_DIGEST,
      local: true,
      dataBoundary: "device",
      maximumComplexity: "standard",
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: "model_inference_verified",
    };
  }

  async execute(input) {
    this.calls += 1;
    return {
      backendId: this.id,
      modelId: "settlement-test-model",
      modelDigest: MODEL_DIGEST,
      content: this.story,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 7,
      profileId: "rpg-approval-settlement-recovery-v1",
      firstTokenMs: 1,
      inputCharacters: input.request.objective.length,
      outputCharacters: this.story.length,
      generatedTokenEvents: Math.max(12, Math.ceil(this.story.length / 16)),
      omittedInputCharacters: 0,
      qualityMode: "fast",
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }
}

function closedNamespace(projectId) {
  return {
    tenantId: "local-tenant",
    userId: "local-author",
    projectId,
    storyId: projectId,
    canonId: `canon:${projectId}`,
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "unrouted:runtime-managed",
    modelDigest: "unrouted:digest-runtime-managed",
    promptProfileVersion: "rpg-approval-settlement-recovery-v1",
    storyBibleRevision: "current",
    knowledgeScopeRevision: "current",
    privacyLevel: "device_only",
  };
}

function projectSeed(snapshot) {
  const protagonist = snapshot.characters.find((character) => (
    snapshot.storyBible.protagonistIds.includes(character.id)
  )) ?? snapshot.characters[0];
  return {
    id: snapshot.project.id,
    title: snapshot.project.title,
    chapterId: snapshot.chapter.id,
    chapterTitle: snapshot.chapter.title,
    draft: snapshot.chapter.content,
    packId: snapshot.project.genrePackId,
    topicId: snapshot.project.genreId,
    subCategory: snapshot.project.subgenreId,
    coreIdea: snapshot.project.coreIdea.value,
    protagonist: protagonist?.name ?? null,
    goal: protagonist?.goal.value ?? null,
    worldRule: snapshot.worldRules[0]?.description ?? null,
    conflict: snapshot.conflict,
    style: snapshot.project.narrativeStyle.value,
    adultMode: snapshot.project.adultMode,
    adultExperienceProfile: snapshot.project.adultExperienceProfile ?? null,
  };
}

async function buildFixture(label, faultPoint) {
  const repository = new MemoryNovelRepository();
  const draft = createDraft("quick");
  draft.title = `RPG 核准結算 ${label}`;
  draft.genreId = "classic-topic-009";
  draft.coreIdea = optionalValue(
    "明檀必須在追兵抵達以前護住同伴，並查清失蹤線索。",
    "user_defined",
  );
  draft.protagonist = optionalValue("明檀", "user_defined");
  const stageMatrix = buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode: "general",
  });
  draft.answers.stageFamily = optionalValue(
    serializeTopicWorldFamilyDraftSelection({
      matrix: stageMatrix,
      familyId: stageMatrix.stageFamilies[0].familyId,
    }),
    "user_defined",
  );
  const bundle = buildProjectBundle(draft);
  await repository.createProject(bundle, `create:rpg-settlement:${label}`);
  const chapter = await repository.put("chapters", {
    ...makeRecord(bundle.project.id),
    title: "雨夜山門",
    order: 1,
    content: "明檀守在殘破山門前。追兵的火把已越過溪谷，她必須先把受傷同伴送進暗道，再回頭查明失蹤者留下的印記。",
    summary: "追兵逼近山門，明檀守住同伴與線索。",
    status: "draft",
  });
  await repository.put("projects", {
    ...bundle.project,
    activeChapterId: chapter.id,
  }, bundle.project.revision);
  await initializeMingtanPreset(repository, bundle.project.id, { initialRealmLevel: 1 });
  const snapshot = await loadRpgChatSnapshot(repository, bundle.project.id);
  const choice = snapshot.baseChoices.find((item) => !item.disabledReason);
  assert.ok(choice, "the fixture needs one executable RPG choice");
  const resolution = resolveRpgChoice(choice, {
    seed: `approval-settlement:${label}`,
    revision: snapshot.storyState.revision,
    recentEncounterSignatures: snapshot.progression.procedural.recentEncounterSignatures,
    turn: snapshot.progression.turn,
    storyState: snapshot.storyState,
  });
  const story = buildDeterministicRpgTurnStory({
    snapshot,
    choice,
    resolution,
  });

  let stateFaultEnabled = faultPoint === "before-state-put-many";
  const state = new MemoryClosedAgentStateRepository({
    faultInjector(point) {
      if (stateFaultEnabled && point === "before:approval") {
        stateFaultEnabled = false;
        throw Object.assign(new Error("TEST_BEFORE_STATE_PUT_MANY"), {
          code: "TEST_BEFORE_STATE_PUT_MANY",
        });
      }
    },
  });
  const os = new ClosedAgentOS({
    backends: [new FixedStoryBackend(story)],
    cache: new ClosedAICache({
      repository: new MemoryClosedAICacheRepository(),
    }),
    ledger: new VerifiableLedger({
      repository: new MemoryVerifiableLedgerRepository(),
      signer: new ApprovalSigner(),
    }),
    state,
  });
  const generated = await os.execute({
    taskId: `rpg-settlement-task:${label}`,
    namespace: closedNamespace(bundle.project.id),
    taskType: "chapter.continue",
    objective: "依照既定 RPG 結果續寫一個完整小說回合。",
    context: [],
    complexity: "standard",
    qualityMode: "fast",
    preferredBackend: "local-ollama",
    allowedToolIds: [],
    permissionScopes: [
      "story:read",
      "story-bible:read",
      "candidate:write",
      "candidate:read",
      "evaluation:write",
    ],
    sourceChapterId: snapshot.chapter.id,
    sourceRevision: snapshot.chapter.revision,
  });
  assert.equal(generated.candidate.status, "awaiting-approval");
  const approvedStory = generated.candidate.content;
  assert.equal(
    await sha256Hex(approvedStory),
    generated.candidate.contentDigest,
    "the fixture must use the OS-normalized candidate as the approved prose",
  );

  const candidate = {
    schemaVersion: "rpg-chat-turn-v1",
    taskId: generated.candidate.taskId,
    candidateId: generated.candidate.id,
    candidateDigest: generated.candidate.contentDigest,
    model: generated.candidate.modelId,
    modelDigest: generated.candidate.modelDigest,
    actualExecutor: generated.candidate.actualExecutor,
    executionReceipt: {
      ...generated.candidate.executionReceipt,
      rpgContextDigest: snapshot.contextDigest,
      rpgContextRevisionDigest: snapshot.contextRevisionDigest,
    },
    contextDigest: snapshot.contextDigest,
    contextRevisionDigest: snapshot.contextRevisionDigest,
    contextRevisionGuard: structuredClone(snapshot.contextRevisionGuard),
    sourceChapterId: snapshot.chapter.id,
    sourceRevision: snapshot.chapter.revision,
    choice,
    resolution,
    story: approvedStory,
    outcomeLines: choice.impactLabels,
    canonicalMutationCount: 0,
    dataLeftDevice: false,
    externalRequest: false,
  };
  const conversation = new ConversationRepositoryService(repository);
  const session = await conversation.createSession({
    projectId: bundle.project.id,
    title: `核准故障 ${label}`,
    activeChapterId: snapshot.chapter.id,
  });
  const message = await conversation.appendMessage({
    projectId: bundle.project.id,
    sessionId: session.id,
    role: "assistant",
    content: approvedStory,
    status: "completed",
  });
  const contextDigest = await sha256Hex(`rpg-settlement-context:${label}`);
  const invocation = await conversation.saveToolInvocation({
    projectId: bundle.project.id,
    sessionId: session.id,
    messageId: message.id,
    taskId: `conversation-rpg-settlement:${label}`,
    toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgTurn,
    taskType: "chapter.continue",
    inputDigest: await sha256Hex(`rpg-settlement-input:${label}`),
    contextDigest,
    status: "completed",
    actualExecutor: candidate.actualExecutor,
    modelId: candidate.model,
    modelDigest: candidate.modelDigest,
    executionReceipt: {
      receiptId: `conversation-rpg-settlement-receipt:${label}`,
      modelId: candidate.model,
      modelDigest: candidate.modelDigest,
      providerRunId: candidate.taskId,
      contextDigest,
      outputDigest: candidate.candidateDigest,
      externalRequest: false,
      dataLeftDevice: false,
      latencyMs: 1,
    },
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  });
  const artifact = await conversation.saveArtifact({
    projectId: bundle.project.id,
    sessionId: session.id,
    sourceMessageId: message.id,
    artifactType: "rpg",
    targetStore: "chapters",
    targetRecordId: snapshot.chapter.id,
    sourceRevision: snapshot.chapter.revision,
    candidateContent: JSON.stringify({
      schemaVersion: "conversation-rpg-candidate-v1",
      candidate,
    }),
  });
  const artifactLinkedMessage = await repository.get("conversationMessages", message.id);
  assert.ok(artifactLinkedMessage);
  const approvalMessage = await repository.put("conversationMessages", {
    ...artifactLinkedMessage,
    candidateIds: [...new Set([
      ...artifactLinkedMessage.candidateIds,
      artifact.id,
      generated.candidate.id,
    ])],
  }, artifactLinkedMessage.revision);
  const saved = await persistStudioChoiceCandidate(
    repository,
    projectSeed(snapshot),
    {
      optionKey: choice.key,
      text: `${choice.title}｜${choice.description}`,
      consequence: `${choice.consequence}；${resolution.outcomeLabel}`,
      effect: resolution.effect,
      providerId: generated.candidate.backendId,
      modelId: generated.candidate.modelId,
      externalRequest: false,
      dataLeftDevice: false,
      rpgContextRevisionGuard: structuredClone(snapshot.contextRevisionGuard),
      rpgSettlement: resolution.settlement,
    },
  );
  const [approvalSession, approvalArtifact, approvalTarget] = await Promise.all([
    repository.get("conversationSessions", session.id),
    repository.get("conversationArtifacts", artifact.id),
    repository.get("chapters", snapshot.chapter.id),
  ]);
  assert.ok(approvalSession && approvalArtifact && approvalTarget);
  const closedAgentApprovalBinding = await buildConversationClosedAgentApprovalBindingProof(
    await assertConversationClosedAgentApprovalBinding({
      projectId: bundle.project.id,
      sessionId: session.id,
      session: approvalSession,
      sourceMessage: approvalMessage,
      artifact: approvalArtifact,
      sourceMessageCandidateArtifacts: [approvalArtifact],
      invocations: [invocation],
      targetRecord: approvalTarget,
      candidate: generated.candidate,
      candidateIntegrityVerified: await os.verifyCandidateIntegrity(generated.candidate.id),
    }),
  );
  const conversationApproval = {
    operationId: `conversation-rpg-approval:${artifact.id}`,
    idempotencyKey: `conversation-rpg-approval:${artifact.id}:${artifact.candidateDigest}`,
    sessionId: session.id,
    artifactId: artifact.id,
    sourceMessageId: message.id,
    candidateDigest: artifact.candidateDigest,
    expectedSessionRevision: approvalSession.revision,
    expectedArtifactRevision: approvalArtifact.revision,
    expectedSourceMessageRevision: approvalMessage.revision,
    expectedSourceRevision: snapshot.chapter.revision,
    closedAgentApprovalBinding,
  };
  let canonicalCommitCalls = 0;
  let firstCallbackFaultEnabled = faultPoint === "after-canon-before-ledger";
  const canonicalCommit = async () => {
    canonicalCommitCalls += 1;
    const transaction = await acceptStudioChoice(
      repository,
      saved.candidate.id,
      approvedStory,
      `${choice.key}｜${choice.title}｜${resolution.outcomeLabel}`,
      conversationApproval,
    );
    if (firstCallbackFaultEnabled) {
      firstCallbackFaultEnabled = false;
      throw Object.assign(new Error("TEST_AFTER_CANON_BEFORE_LEDGER"), {
        code: "TEST_AFTER_CANON_BEFORE_LEDGER",
      });
    }
    return { commitId: transaction.acceptedChoice.effectOperationId };
  };

  await assert.rejects(
    os.approveCandidate({
      candidateId: generated.candidate.id,
      approvedBy: "local-author",
      humanApproved: true,
      canonicalCommit,
    }),
    (error) => faultPoint === "after-canon-before-ledger"
      ? error?.code === "TEST_AFTER_CANON_BEFORE_LEDGER"
      : error?.code === "CLOSED_AGENT_APPROVAL_STATE_COMMIT_FAILED_RECOVERABLE",
  );
  const chapterAfterFault = await repository.get("chapters", snapshot.chapter.id);
  const artifactAfterFault = await repository.get("conversationArtifacts", artifact.id);
  const receiptsAfterFault = await repository.list("rpgTurnReceipts", bundle.project.id);
  assert.equal(chapterAfterFault.revision, snapshot.chapter.revision + 1);
  assert.equal(artifactAfterFault.status, "approved");
  assert.equal(receiptsAfterFault.length, 1);
  assert.equal((await state.get(generated.candidate.id)).status, "awaiting-approval");
  assert.equal((await state.get(generated.candidate.taskId)).state, "awaiting-approval");
  assert.equal(await state.get(`closed-agent-approval:${generated.candidate.id}`), null);
  assert.equal(await state.get(`closed-agent-memory:${generated.candidate.id}`), null);

  const settlement = await settleApprovedRpgTurnClosedAgent({
    repository,
    projectId: bundle.project.id,
    sessionId: session.id,
    artifactId: artifact.id,
    closedAgentOS: os,
  });
  assert.equal(settlement.applicable, true);
  assert.equal(settlement.alreadySettled, false);
  assert.equal(settlement.canonicalReplayed, true);
  assert.equal(canonicalCommitCalls, 1, "the helper owns the replay callback after the injected fault");
  assert.equal(
    (await repository.get("chapters", snapshot.chapter.id)).revision,
    chapterAfterFault.revision,
    "settlement recovery must not commit Canon twice",
  );
  assert.equal((await repository.get("conversationArtifacts", artifact.id)).status, "approved");
  assert.equal((await repository.list("rpgTurnReceipts", bundle.project.id)).length, 1);
  assert.equal((await state.get(generated.candidate.id)).status, "committed");
  assert.equal((await state.get(generated.candidate.id)).canonicalMutationCount, 1);
  assert.equal((await state.get(generated.candidate.taskId)).state, "completed");
  assert.ok(await state.get(`closed-agent-approval:${generated.candidate.id}`));
  assert.equal(
    (await state.get(`closed-agent-memory:${generated.candidate.id}`)).canonical,
    true,
  );
  const ledgerId = `closed-agent:${bundle.project.id}:${generated.candidate.taskId}`;
  const ledger = await os.ledger.verify(ledgerId);
  const ledgerBlocks = await os.ledger.repository.list(ledgerId);
  assert.equal(ledger.valid, true);
  assert.equal(ledger.signedApprovalCount, 1);
  assert.equal(ledgerBlocks.filter((block) => block.eventType === "canonical-commit").length, 1);

  const settledAgain = await settleApprovedRpgTurnClosedAgent({
    repository,
    projectId: bundle.project.id,
    sessionId: session.id,
    artifactId: artifact.id,
    closedAgentOS: os,
  });
  assert.equal(settledAgain.alreadySettled, true);
  assert.equal(settledAgain.canonicalReplayed, false);
  assert.equal(
    (await repository.get("chapters", snapshot.chapter.id)).revision,
    chapterAfterFault.revision,
  );

  const settledSnapshot = await loadRpgChatSnapshot(repository, bundle.project.id);
  const messagesBeforeChoice = await conversation.listMessages(bundle.project.id, session.id);
  const artifacts = await conversation.listArtifacts(bundle.project.id, session.id);
  assert.equal(
    findRpgChoiceRecoveryTarget(messagesBeforeChoice, artifacts, settledSnapshot)?.sourceArtifactId,
    artifact.id,
  );
  const plan = await buildRpgRuleChoicePlan({ snapshot: settledSnapshot });
  const choiceContent = serializeRpgChoices({
    schemaVersion: "conversation-rpg-choices-v1",
    chapterId: settledSnapshot.chapter.id,
    chapterRevision: settledSnapshot.chapter.revision,
    storyStateRevision: settledSnapshot.storyState.revision,
    contextRevisionDigest: settledSnapshot.contextRevisionDigest,
    plan,
  });
  await conversation.appendMessage({
    projectId: bundle.project.id,
    sessionId: session.id,
    role: "assistant",
    content: choiceContent,
    status: "completed",
    parentMessageId: message.id,
    candidateIds: [plan.candidateId],
  });
  const messagesAfterChoice = await conversation.listMessages(bundle.project.id, session.id);
  assert.equal(
    messagesAfterChoice.filter((item) => item.content.startsWith(RPG_CHOICES_PREFIX)).length,
    1,
  );
  assert.equal(
    findRpgChoiceRecoveryTarget(messagesAfterChoice, artifacts, settledSnapshot),
    null,
    "one exact next-choice card must suppress duplicate recovery",
  );

  return {
    faultPoint,
    resultingChapterRevision: chapterAfterFault.revision,
    signedApprovalCount: ledger.signedApprovalCount,
    canonicalCommitBlocks: ledgerBlocks.filter((block) => block.eventType === "canonical-commit").length,
    rpgTurnReceipts: receiptsAfterFault.length,
    nextChoiceCards: 1,
  };
}

const results = [];
for (const faultPoint of ["after-canon-before-ledger", "before-state-put-many"]) {
  results.push(await buildFixture(faultPoint, faultPoint));
}

const rpgController = await readFile(
  "app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts",
  "utf8",
);
const recoveryStart = rpgController.indexOf("async function recoverRpgChoices");
const recoveryEnd = rpgController.indexOf("\n  return {", recoveryStart);
const recoveryBody = rpgController.slice(recoveryStart, recoveryEnd);
const settlementIndex = recoveryBody.indexOf("await settleApprovedRpgTurnClosedAgent({");
const choicesIndex = recoveryBody.indexOf("await createRpgChoicesMessage({");
assert.ok(settlementIndex >= 0, "durable approved recovery must settle ClosedAgentOS");
assert.ok(
  settlementIndex < choicesIndex,
  "ClosedAgentOS settlement must finish before the next A/B/C card is rebuilt",
);

console.log(JSON.stringify({
  schemaVersion: "rpg-approval-settlement-recovery-v1",
  status: "PASS",
  results,
}, null, 2));
