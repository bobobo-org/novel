import {
  assert,
  assertNoForbiddenKeys,
  expectErrorCode,
  Rc6TestHarness,
} from "./rc6-test-harness.mjs";
import { readFileSync } from "node:fs";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import {
  buildProjectBundle,
  createDraft,
} from "../lib/novel-ai/domain/creation.ts";
import {
  CONVERSATION_STORES,
  NOVEL_STORES,
} from "../lib/novel-ai/repository/contracts/index.ts";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  IndexedDbNovelRepository,
  indexedDbCapability,
} from "../lib/novel-ai/repository/indexeddb/indexeddb-repository.ts";
import {
  ConversationRepositoryService,
} from "../lib/novel-ai/conversation/repository.ts";
import {
  buildConversationCanonicalReplacement,
  resolveConversationCanonicalTarget,
} from "../lib/novel-ai/conversation/canonical-target.ts";
import {
  CONVERSATION_PLANNER_TOOL_ALLOWLIST,
  planConversationRequest,
} from "../lib/novel-ai/conversation/planner.ts";
import {
  CONVERSATION_LOCAL_TOOL_IDS,
  assertConversationPlannerToolAllowed,
} from "../lib/novel-ai/conversation/tool-registry.ts";
import {
  composeProjectContext,
  conversationCanonRevisionDigest,
  selectedAttachmentModelContextSource,
} from "../lib/novel-ai/web/project-context-composer.ts";
import {
  getStudioClosedAgentOS,
  loadApprovedConversationLearningRules,
} from "../lib/novel-ai/web/closed-agent-os-service.ts";
import {
  useConversationApprovalController,
} from "../app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts";
import {
  artifactStory,
} from "../app/studio/project/[projectId]/chat/components/conversation-presentation.ts";
import { sha256Hex } from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  assertConversationClosedAgentApprovalBinding,
  buildConversationClosedAgentApprovalBindingProof,
} from "../lib/novel-ai/conversation/closed-agent-approval.ts";
import {
  buildConversationClosedAgentCacheOriginProof,
} from "../lib/novel-ai/conversation/closed-agent-cache-origin-proof.ts";
import { conversationContentDigest } from "../lib/novel-ai/conversation/approval-transaction.ts";
import {
  createProjectBackup,
  restoreProjectBackup,
  validateBackupPayload,
} from "../lib/novel-ai/repository/backup.ts";
import {
  MemorySovereignLearningRepository,
} from "../lib/novel-ai/sovereign-learning/repository.ts";
import {
  approveLearningRule,
  ingestLearningSource,
} from "../lib/novel-ai/sovereign-learning/service.ts";
import {
  buildRpgChatCustomAction,
} from "../lib/novel-ai/web/rpg-chat-turn.ts";
import {
  readRpgProgression,
} from "../lib/novel-ai/game/progression/rpg-progression.ts";
import {
  validateRpgStoryTurnContract,
} from "../lib/novel-ai/web/rpg-closed-ai-director.ts";
import {
  CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE,
  createClosedAgentFailureEvidence,
  parseClosedAgentFailureEvidence,
  serializeClosedAgentFailureEvidence,
} from "../lib/novel-ai/closed-agent-os/safe-runtime-diagnostics.ts";
import {
  CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_SCHEMA_VERSION,
  createConversationAttachmentRecord,
} from "../lib/novel-ai/conversation/attachments.ts";

const mode = process.argv[2] ?? "all";
const harness = new Rc6TestHarness("P2.4B RC6 conversation-first runtime gate", mode);
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

class ApprovalSnapshotTamperingRepository extends IndexedDbNovelRepository {
  #armedRecord = null;

  armArtifactTamper(artifactId, tamperedContent) {
    this.#armedRecord = {
      store: "conversationArtifacts",
      id: artifactId,
      patch: { candidateContent: tamperedContent },
    };
  }

  armSourceMessageTamper(messageId, tamperedContent) {
    this.#armedRecord = {
      store: "conversationMessages",
      id: messageId,
      patch: { content: tamperedContent },
    };
  }

  async get(store, id) {
    const snapshot = await super.get(store, id);
    if (
      store !== this.#armedRecord?.store
      || id !== this.#armedRecord.id
      || !snapshot
    ) {
      return snapshot;
    }
    const armedRecord = this.#armedRecord;
    this.#armedRecord = null;
    const db = await this.open();
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put({
      ...snapshot,
      ...armedRecord.patch,
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? new Error("TEST_IDB_TAMPER_ABORTED"));
      tx.onerror = () => reject(tx.error ?? new Error("TEST_IDB_TAMPER_FAILED"));
    });
    return snapshot;
  }
}

function record(id, projectId = id, source = "user") {
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: "novel-domain-v1",
    id,
    projectId,
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    source,
    provenance: {
      source,
      actor: source === "system" ? "local-rule" : source === "ai_candidate" ? "local-ollama" : "author",
      createdAt,
    },
    deletedAt: null,
    parentRevision: null,
    migrationVersion: null,
  };
}

function project(projectId, chapterId = `chapter:${projectId}`) {
  return {
    ...record(projectId),
    title: `Project ${projectId}`,
    creationMode: "blank",
    genrePackId: null,
    genreId: null,
    subgenreId: null,
    coreIdea: optionalValue("A project-only story"),
    narrativeStyle: optionalValue("immersive"),
    adultMode: false,
    activeChapterId: chapterId,
    storyBibleId: `bible:${projectId}`,
    storyStateId: `state:${projectId}`,
  };
}

function chapter(projectId, chapterId = `chapter:${projectId}`) {
  return {
    ...record(chapterId, projectId),
    title: "Chapter One",
    order: 1,
    content: "Canonical opening.",
    summary: null,
    status: "draft",
  };
}

function storyBible(projectId, storyBibleId = `bible:${projectId}`) {
  return {
    ...record(storyBibleId, projectId),
    theme: optionalValue("A project-only theme"),
    style: optionalValue("immersive"),
    protagonistIds: [],
    characterIds: [],
    relationshipIds: [],
    worldId: null,
    worldRuleIds: [],
    loreIds: [],
    timelineEventIds: [],
    foreshadowing: [],
    unresolvedThreads: [],
    forbiddenContradictions: [],
    authorPreferences: [],
  };
}

async function setup(projectId = "project-a", repository = new MemoryNovelRepository()) {
  const chapterRecord = chapter(projectId);
  await repository.put("projects", project(projectId, chapterRecord.id));
  await repository.put("chapters", chapterRecord);
  await repository.put("storyBibles", storyBible(projectId));
  return {
    repository,
    service: new ConversationRepositoryService(repository),
    projectId,
    chapterId: chapterRecord.id,
  };
}

async function attachCompletedInvocation(service, {
  projectId,
  sessionId,
  messageId,
  outputDigest,
  taskType = "chapter.continue",
}) {
  const inputDigest = await sha256Hex(`input:${messageId}`);
  const contextDigest = await sha256Hex(`context:${messageId}`);
  const modelDigest = await sha256Hex("qwen2.5:3b");
  return service.saveToolInvocation({
    projectId,
    sessionId,
    messageId,
    taskId: `task:${crypto.randomUUID()}`,
    toolId: CONVERSATION_LOCAL_TOOL_IDS.storyStateQuery,
    taskType,
    inputDigest,
    contextDigest,
    status: "completed",
    actualExecutor: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest,
    executionReceipt: {
      receiptId: crypto.randomUUID(),
      modelId: "qwen2.5:3b",
      modelDigest,
      providerRunId: `local:${crypto.randomUUID()}`,
      contextDigest,
      outputDigest,
      externalRequest: false,
      dataLeftDevice: false,
      latencyMs: 12,
    },
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  });
}

async function setupApproval(options = {}) {
  const {
    repository: providedRepository,
    projectId = "project-approval",
    candidateContent = "The approved continuation arrives.",
    requestContent = null,
    ...repositoryOptions
  } = options;
  const repository = providedRepository ?? new MemoryNovelRepository(repositoryOptions);
  const state = await setup(projectId, repository);
  const session = await state.service.createSession({
    projectId: state.projectId,
    title: "Approval",
    activeChapterId: state.chapterId,
  });
  const request = requestContent
    ? await state.service.appendMessage({
        projectId: state.projectId,
        sessionId: session.id,
        role: "user",
        content: requestContent,
      })
    : null;
  const assistant = await state.service.appendMessage({
    projectId: state.projectId,
    sessionId: session.id,
    role: "assistant",
    content: candidateContent,
    parentMessageId: request?.id,
  });
  await attachCompletedInvocation(state.service, {
    projectId: state.projectId,
    sessionId: session.id,
    messageId: assistant.id,
    outputDigest: await sha256Hex(candidateContent),
  });
  const artifact = await state.service.saveArtifact({
    projectId: state.projectId,
    sessionId: session.id,
    sourceMessageId: assistant.id,
    artifactType: "novel",
    targetStore: "chapters",
    targetRecordId: state.chapterId,
    sourceRevision: 1,
    candidateContent,
  });
  const currentSession = await repository.get("conversationSessions", session.id);
  const currentMessage = await repository.get("conversationMessages", assistant.id);
  return {
    ...state,
    request,
    session: currentSession,
    message: currentMessage,
    artifact,
    approvalInput: {
      operationId: crypto.randomUUID(),
      idempotencyKey: `approval-key:${projectId}`,
      projectId: state.projectId,
      sessionId: session.id,
      artifactId: artifact.id,
      sourceMessageId: assistant.id,
      candidateDigest: artifact.candidateDigest,
      targetStore: "chapters",
      targetRecordId: state.chapterId,
      expectedSessionRevision: currentSession.revision,
      expectedArtifactRevision: artifact.revision,
      expectedSourceMessageRevision: currentMessage.revision,
      expectedSourceRevision: 1,
      applicationMode: "append",
    },
  };
}

async function setupClosedApprovalFixture({
  cacheHit = false,
  requestContent = null,
  repository = new IndexedDbNovelRepository(),
  projectId = `project-closed-approval:${crypto.randomUUID()}`,
  candidateContent = "Ａ，封閉候選保持繁體與完整來源綁定。",
} = {}) {
  const state = await setupApproval({
    repository,
    projectId,
    candidateContent,
    requestContent,
  });
  const originalInvocation = await repository.get(
    "conversationToolInvocations",
    state.message.toolInvocationIds[0],
  );
  assert(originalInvocation);
  const taskId = `closed-agent-task:${crypto.randomUUID()}`;
  const originTaskId = cacheHit
    ? `closed-agent-origin-task:${crypto.randomUUID()}`
    : taskId;
  const candidateId = `closed-agent-candidate:${taskId}`;
  const modelId = "rc6-browser-model";
  const modelDigest = await sha256Hex(modelId);
  const contentDigest = await sha256Hex(candidateContent);
  const contextDigest = await sha256Hex(`context:${taskId}`);
  const normalizationReceiptId = `traditional-chinese-integrity:${await sha256Hex(`normalization:${originTaskId}`)}`;
  const normalization = {
    schemaVersion: "closed-agent-traditional-chinese-integrity-v2-ambiguous-occurrences",
    normalizerVersion: "opencc-js-1.4.1-cn-to-tw-single-pass-v1",
    policyVersion: "closed-agent-traditional-chinese-policy-v3-boundary-identity-occurrences",
    policyId: `policy:${await sha256Hex(projectId)}`,
    sourceDigest: await sha256Hex(`source:${projectId}`),
    protectedTermsDigest: await sha256Hex("protected-terms"),
    originRequestId: originTaskId,
    providerId: "browser-ai",
    modelId,
    modelDigest,
    inputStage: "closed-agent-final-selected-content",
    normalizationInputDigest: contentDigest,
    outputDigest: contentDigest,
    normalizationOperationCount: 1,
    ambiguousCanonicalOccurrenceCount: 0,
    receiptId: normalizationReceiptId,
  };
  const originContextDigest = await sha256Hex(`origin-context:${originTaskId}`);
  const originExecutionReceipt = {
    taskId: originTaskId,
    backendId: "browser-ai",
    modelId,
    modelDigest,
    startedAt: "2026-08-10T00:00:00.000Z",
    completedAt: "2026-08-10T00:00:01.000Z",
    generatedTokenEvents: 4,
    outputCharacters: candidateContent.length,
    contentDigest,
    contextDigest: cacheHit ? originContextDigest : contextDigest,
    proofState: "verified",
    dataLeftDevice: false,
    externalRequest: false,
    actualExecutor: "browser-ai",
    traditionalChineseNormalization: normalization,
  };
  const cacheOrigin = cacheHit ? {
    schemaVersion: "closed-agent-cache-origin-v1",
    layer: "exact",
    entryId: `closed-ai-cache:${await sha256Hex(`entry:${projectId}`)}`,
    entryValueDigest: await sha256Hex(`value:${projectId}`),
    originCandidateId: `closed-agent-candidate:${originTaskId}`,
    originTaskId,
    originRequestId: originTaskId,
    originLedgerId: `closed-agent:${projectId}:${originTaskId}`,
    originLedgerBlockHash: await sha256Hex(`block:${originTaskId}`),
    originExecutionReceipt,
    normalizationReceiptId,
  } : null;
  const candidate = {
    schemaVersion: "closed-agent-os-v2",
    kind: "candidate",
    id: candidateId,
    projectId,
    taskId,
    namespace: {
      tenantId: "local-tenant",
      userId: "local-author",
      projectId,
      storyId: projectId,
      canonId: `canon:${projectId}`,
      branchId: "main",
      characterId: "shared",
      agentRole: "closed-agent-os",
      modelId,
      modelDigest,
      promptProfileVersion: "studio-closed-agent-v3",
      storyBibleRevision: "current",
      knowledgeScopeRevision: "current",
      privacyLevel: "device_only",
    },
    backendId: "browser-ai",
    modelId,
    modelDigest,
    adapterId: "browser-ai",
    adapterDigest: await sha256Hex("browser-ai-adapter"),
    content: candidateContent,
    contentDigest,
    sourceChapterId: state.chapterId,
    sourceRevision: 1,
    actualExecutor: cacheHit ? "not_executed" : "browser-ai",
    executionReceipt: cacheHit ? null : originExecutionReceipt,
    cacheOrigin,
    traditionalChineseNormalization: normalization,
    contextDigest,
    dataLeftDevice: false,
    externalRequest: false,
    planComplexity: "standard",
    planDigest: await sha256Hex(`plan:${projectId}`),
    requestContractDigest: await sha256Hex(`request:${projectId}`),
    evaluation: {
      passed: true,
      score: 1,
      blockingCodes: [],
      warningCodes: [],
      evaluatorInputDigest: await sha256Hex(`evaluation:${projectId}`),
      rubric: { safety: 1, objectiveCoverage: 1, structure: 1, specificity: 1, repetitionPenalty: 0 },
      rawChainOfThoughtStored: false,
    },
    status: "awaiting-approval",
    candidateOnly: true,
    canonicalMutationCount: 0,
  };
  const cacheOriginProof = await buildConversationClosedAgentCacheOriginProof(candidate);
  const invocation = await repository.put("conversationToolInvocations", {
    ...originalInvocation,
    taskId,
    toolId: CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan,
    taskType: "chapter.continue",
    contextDigest,
    actualExecutor: cacheHit ? "not_executed" : "browser-ai",
    modelId,
    modelDigest,
    executionReceipt: {
      receiptId: `conversation-receipt:${taskId}`,
      modelId,
      modelDigest,
      providerRunId: cacheHit ? null : taskId,
      contextDigest,
      outputDigest: contentDigest,
      externalRequest: false,
      dataLeftDevice: false,
      latencyMs: cacheHit ? null : 1_000,
      closedAgentSchemaVersion: "closed-agent-os-v2",
      closedAgentBackendId: "browser-ai",
      normalizationReceiptId,
      traditionalChineseNormalizerVersion: normalization.normalizerVersion,
      ...(cacheOriginProof ? { closedAgentCacheOrigin: cacheOriginProof } : {}),
    },
  }, originalInvocation.revision);
  const originalMessage = await repository.get("conversationMessages", state.message.id);
  assert(originalMessage);
  const message = await repository.put("conversationMessages", {
    ...originalMessage,
    candidateIds: [candidateId, state.artifact.id],
  }, originalMessage.revision);
  const session = await repository.get("conversationSessions", state.session.id);
  const artifact = await repository.get("conversationArtifacts", state.artifact.id);
  const targetRecord = await repository.get("chapters", state.chapterId);
  assert(session && artifact && targetRecord);
  const bindingInput = {
    projectId,
    sessionId: session.id,
    session,
    sourceMessage: message,
    artifact,
    sourceMessageCandidateArtifacts: [artifact],
    invocations: [invocation],
    targetRecord,
    candidate,
    candidateIntegrityVerified: true,
  };
  return {
    ...state,
    session,
    message,
    artifact,
    invocation,
    candidate,
    targetRecord,
    bindingInput,
    approvalInput: {
      ...state.approvalInput,
      expectedSessionRevision: session.revision,
      expectedArtifactRevision: artifact.revision,
      expectedSourceMessageRevision: message.revision,
    },
  };
}

async function runClosedDrawerApproval(state, approvalContent) {
  const os = getStudioClosedAgentOS();
  const originalStateGet = os.state.get;
  const originalVerifyCandidateIntegrity = os.verifyCandidateIntegrity;
  const originalApproveCandidate = os.approveCandidate;
  const originalRejectCandidate = os.rejectCandidate;
  const approvedCandidateIds = [];
  const rejectedCandidateIds = [];
  const safeErrors = [];
  let leaseReleaseCount = 0;

  os.state.get = async function getControllerFixtureRecord(recordId) {
    if (recordId === state.candidate.id) return structuredClone(state.candidate);
    return originalStateGet.call(this, recordId);
  };
  os.verifyCandidateIntegrity = async function verifyControllerFixtureCandidate(candidateId) {
    if (candidateId === state.candidate.id) return true;
    return originalVerifyCandidateIntegrity.call(this, candidateId);
  };
  os.approveCandidate = async function approveControllerFixtureCandidate(input) {
    assert.equal(input.candidateId, state.candidate.id);
    approvedCandidateIds.push(input.candidateId);
    const commit = input.canonicalCommit
      ? await input.canonicalCommit({
          candidate: structuredClone(state.candidate),
          approvalId: `closed-agent-approval:${state.candidate.id}`,
          idempotencyKey: `closed-agent-approval:${state.candidate.id}`,
        })
      : null;
    return {
      candidate: {
        ...state.candidate,
        status: commit ? "committed" : "approved",
        canonicalMutationCount: commit ? 1 : 0,
      },
      canonicalMutationCount: commit ? 1 : 0,
    };
  };
  os.rejectCandidate = async function rejectControllerFixtureCandidate(candidateId) {
    assert.equal(candidateId, state.candidate.id);
    rejectedCandidateIds.push(candidateId);
    return { ...state.candidate, status: "rejected" };
  };

  try {
    // Deterministic harness invocation uses the stubbed React hook runtime above.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const controller = useConversationApprovalController({
      projectId: state.projectId,
      repository: state.repository,
      conversation: state.service,
      getLearningCoordinator: async () => {
        throw new Error("UNEXPECTED_LEARNING_APPROVAL");
      },
      activeSession: state.session,
      busy: false,
      operationLockRef: { current: false },
      retryActionRef: { current: null },
      acquireLease: async () => () => {
        leaseReleaseCount += 1;
      },
      currentCanonRevisionDigest: () => sha256Hex(`canon:${state.projectId}:controller`),
      createRpgChoicesMessage: async () => {
        throw new Error("UNEXPECTED_RPG_APPROVAL");
      },
      loadWorkspace: async () => true,
      refreshSession: async () => true,
      setRetryAvailable: () => undefined,
      setRetryLabel: () => undefined,
      setBusy: () => undefined,
      setSafeError: (error) => {
        if (error) safeErrors.push(error);
      },
      setProgress: () => undefined,
      setArtifactOpen: () => undefined,
      setDrawer: () => undefined,
    });
    await controller.approveArtifact(state.artifact, approvalContent);
  } finally {
    os.state.get = originalStateGet;
    os.verifyCandidateIntegrity = originalVerifyCandidateIntegrity;
    os.approveCandidate = originalApproveCandidate;
    os.rejectCandidate = originalRejectCandidate;
  }

  return {
    approvedCandidateIds,
    rejectedCandidateIds,
    safeErrors,
    leaseReleaseCount,
  };
}

const rpgChoiceEffect = (reputationDelta = 3) => ({
  statChanges: { reputation: reputationDelta },
  relationshipChanges: {},
  resourceChanges: {},
  moneyChange: 0,
  worldFlags: { "rpg.rc6ConversationApproval": true },
  questProgress: {},
  achievementProgress: {},
  timelineEvents: ["conversation-rpg-choice"],
});

function rpgFixtureDraft(title) {
  const draft = createDraft("quick");
  draft.title = title;
  draft.coreIdea = optionalValue("A conversation choice changes the city.", "user_defined");
  draft.protagonist = optionalValue("Lin Zhao", "user_defined");
  return draft;
}

async function setupRpgConversationApproval({
  repository = new MemoryNovelRepository(),
  label = `rpg-conversation:${crypto.randomUUID()}`,
} = {}) {
  const bundle = buildProjectBundle(rpgFixtureDraft(label));
  await repository.createProject(bundle, `create:${label}`);
  const chapterRecord = await repository.put("chapters", {
    ...makeRecord(bundle.project.id),
    title: "Chapter One",
    order: 1,
    content: "Canonical opening.",
    summary: null,
    status: "draft",
  });
  const projectRecord = await repository.put("projects", {
    ...bundle.project,
    activeChapterId: chapterRecord.id,
  }, bundle.project.revision);
  const storyState = (await repository.list("storyStates", projectRecord.id))[0];
  const storyBible = (await repository.list("storyBibles", projectRecord.id))[0];
  const acceptedText = "Lin Zhao opens the gate and accepts the immediate consequence.";
  const candidateBase = makeRecord(projectRecord.id, "ai_candidate");
  const candidate = await repository.put("candidates", {
    ...candidateBase,
    provenance: {
      ...candidateBase.provenance,
      providerId: "deterministic-local",
      modelId: "rules-v1",
      taskType: "interactive_choice",
      externalRequest: false,
      dataLeftDevice: false,
      contextSources: ["chapter", "conversation"],
      elapsedMs: 1,
    },
    prompt: "Choose the next action.",
    optionKey: "A",
    text: "Open the gate",
    consequence: "Reputation changes",
    effect: rpgChoiceEffect(),
    status: "pending",
    chapterId: chapterRecord.id,
    sceneId: null,
    inputRevision: projectRecord.revision,
    chapterRevision: chapterRecord.revision,
    storyStateRevision: storyState.revision,
    storyBibleRevision: storyBible.revision,
  });
  const service = new ConversationRepositoryService(repository);
  const session = await service.createSession({
    projectId: projectRecord.id,
    title: "RPG conversation approval",
    activeChapterId: chapterRecord.id,
  });
  const assistant = await service.appendMessage({
    projectId: projectRecord.id,
    sessionId: session.id,
    role: "assistant",
    content: "A complete RPG story turn is ready for approval.",
  });
  const candidateContent = JSON.stringify({
    schemaVersion: "conversation-rpg-candidate-v1",
    candidate: {
      story: acceptedText,
      sourceChapterId: chapterRecord.id,
      sourceRevision: chapterRecord.revision,
      canonicalMutationCount: 0,
    },
  });
  await attachCompletedInvocation(service, {
    projectId: projectRecord.id,
    sessionId: session.id,
    messageId: assistant.id,
    outputDigest: await sha256Hex(candidateContent),
    taskType: "rpg.turn",
  });
  const artifact = await service.saveArtifact({
    projectId: projectRecord.id,
    sessionId: session.id,
    sourceMessageId: assistant.id,
    artifactType: "rpg",
    targetStore: "chapters",
    targetRecordId: chapterRecord.id,
    sourceRevision: chapterRecord.revision,
    candidateContent,
  });
  const summary = await service.upsertSummary({
    projectId: projectRecord.id,
    sessionId: session.id,
    sourceMessageIds: [assistant.id],
    content: "The player is deciding whether to open the gate.",
    canonRevisionDigest: await sha256Hex(`canon:${projectRecord.revision}:${chapterRecord.revision}`),
  });
  const currentSession = await repository.get("conversationSessions", session.id);
  const currentMessage = await repository.get("conversationMessages", assistant.id);
  const currentArtifact = await repository.get("conversationArtifacts", artifact.id);
  const input = {
    operationId: `accept:${candidate.id}`,
    idempotencyKey: `${projectRecord.id}:${candidate.id}:${projectRecord.revision}`,
    projectId: projectRecord.id,
    chapterId: chapterRecord.id,
    candidateId: candidate.id,
    acceptedText,
    choiceLabel: "Open the gate",
    expectedProjectRevision: projectRecord.revision,
    expectedChapterRevision: chapterRecord.revision,
    expectedCandidateRevision: candidate.revision,
    expectedStoryStateRevision: storyState.revision,
    expectedStoryBibleRevision: storyBible.revision,
    origin: "studio",
    conversationApproval: {
      operationId: `conversation-approval:${candidate.id}`,
      idempotencyKey: `conversation-approval-key:${candidate.id}`,
      sessionId: currentSession.id,
      artifactId: currentArtifact.id,
      sourceMessageId: currentMessage.id,
      candidateDigest: currentArtifact.candidateDigest,
      expectedSessionRevision: currentSession.revision,
      expectedArtifactRevision: currentArtifact.revision,
      expectedSourceMessageRevision: currentMessage.revision,
      expectedSourceRevision: chapterRecord.revision,
    },
  };
  return {
    repository,
    service,
    project: projectRecord,
    chapter: chapterRecord,
    storyState,
    candidate,
    session: currentSession,
    message: currentMessage,
    artifact: currentArtifact,
    summary,
    input,
  };
}

function errorWithCode(expected) {
  return (error) => {
    assert.equal(error?.code ?? error?.message, expected);
    return true;
  };
}

harness.test("contract", "project backup restore validates before import and returns to conversation chat", () => {
  const source = readFileSync(
    new URL("../app/studio/project/[projectId]/project-section-client.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /validateBackupPayload\(/u);
  assert.match(source, /restoreProjectBackup\(repo, check\.payload, "replace", projectId\)/u);
  assert.match(source, /location\.assign\(`\/studio\/project\/\$\{projectId\}\/chat`\)/u);
  assert.doesNotMatch(source, /location\.assign\(`\/studio\/project\/\$\{projectId\}\/write`\)/u);
});

harness.test("contract", "attachment rights confirmation precedes message, parser, and model work", () => {
  const workspace = readFileSync(
    new URL("../app/studio/project/[projectId]/chat/conversation-workspace.tsx", import.meta.url),
    "utf8",
  );
  const tray = readFileSync(
    new URL("../app/studio/project/[projectId]/chat/components/attachment-tray.tsx", import.meta.url),
    "utf8",
  );
  const rightsGate = workspace.indexOf(
    "if (localAttachments.length && !rightsConfirmed)",
  );
  const planStart = workspace.lastIndexOf(
    "const plan = await planConversationRequest",
    rightsGate,
  );
  const localOperationGuard = workspace.lastIndexOf(
    "operationLockRef.current = true",
    rightsGate,
  );
  const leaseStart = workspace.indexOf(
    "const releaseLease = await acquireConversationLease",
    rightsGate,
  );
  const messageWrite = workspace.indexOf(
    "let userMessage = existingRpgUser ?? await conversation.appendMessage",
  );
  const parserStart = workspace.indexOf(
    "preparedAttachments = await prepareLocalAttachments(",
  );
  assert(rightsGate >= 0);
  assert(planStart >= 0 && planStart < rightsGate);
  assert(localOperationGuard >= 0 && localOperationGuard < planStart);
  assert(leaseStart > rightsGate);
  assert(messageWrite > rightsGate);
  assert(parserStart > messageWrite);
  const preflight = workspace.slice(rightsGate, leaseStart);
  assert.match(preflight, /setDraft\(content\)/u);
  assert.match(preflight, /setSafeError\(\{/u);
  assert.match(preflight, /operationLockRef\.current = false/u);
  assert.doesNotMatch(preflight, /appendMessage|prepareLocalAttachments|runClosedAgent/u);
  assert.match(
    workspace,
    /safeCode !== "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED"/u,
  );
  assert.match(
    workspace,
    /"CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED",[\s\S]*"LEARNING_RIGHTS_CONFIRMATION_REQUIRED",[\s\S]*\.includes\(safeCode\)[\s\S]*setDraft\(content\)/u,
  );
  assert.match(
    tray,
    /附件分析與整份學習匯入都會使用此確認/u,
  );
});

harness.test("contract", "closed regeneration waits for readiness and commits its invocation last", () => {
  const workspace = readFileSync(
    new URL("../app/studio/project/[projectId]/chat/conversation-workspace.tsx", import.meta.url),
    "utf8",
  );
  const messageRow = readFileSync(
    new URL("../app/studio/project/[projectId]/chat/components/message-row.tsx", import.meta.url),
    "utf8",
  );
  const finalization = readFileSync(
    new URL("../lib/novel-ai/conversation/closed-agent-finalization.ts", import.meta.url),
    "utf8",
  );
  const runClosedAgent = workspace.slice(
    workspace.indexOf("async function runClosedAgent"),
    workspace.indexOf("async function sendRequest"),
  );
  const targetSnapshotAt = runClosedAgent.indexOf("const approvalTarget");
  const modelExecutionAt = runClosedAgent.indexOf("await executeStudioClosedAgent");
  const artifactCommitAt = runClosedAgent.indexOf("artifact = await conversation.saveArtifact");
  const messageCommitAt = runClosedAgent.indexOf("await conversation.updateMessageStatus", artifactCommitAt);
  const invocationCommitAt = runClosedAgent.indexOf("invocation = await completeInvocation()", messageCommitAt);
  assert(targetSnapshotAt >= 0 && targetSnapshotAt < modelExecutionAt);
  assert(modelExecutionAt < artifactCommitAt);
  assert(artifactCommitAt < messageCommitAt);
  assert(messageCommitAt < invocationCommitAt);
  assert.match(finalization, /CONVERSATION_APPROVAL_TARGET_MISSING/u);
  assert.match(finalization, /currentArtifact\?\.status === "candidate"/u);
  assert.match(finalization, /CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE/u);
  assert.match(workspace, /closedAiSetup\?\.status === "ready"/u);
  assert.match(workspace, /closedAiSetup\.readiness\.generationVerifiedBackends > 0/u);
  assert.match(messageRow, /&& regenerationReady/u);

  const regeneration = workspace.slice(
    workspace.indexOf("async function regenerateMessage"),
    workspace.indexOf("function stopGeneration"),
  );
  const failure = regeneration.slice(regeneration.lastIndexOf("} catch (error)"));
  assert(failure.indexOf("await loadWorkspace(sessionId)") >= 0);
  assert(failure.indexOf("await loadWorkspace(sessionId)") < failure.indexOf("setSafeError"));
});

harness.test("contract", "story tasks use the automatic coordinator without a user backend picker", () => {
  const page = readFileSync(
    new URL("../app/studio/project/[projectId]/chat/page.tsx", import.meta.url),
    "utf8",
  );
  const workspace = readFileSync(
    new URL("../app/studio/project/[projectId]/chat/conversation-workspace.tsx", import.meta.url),
    "utf8",
  );
  const composer = readFileSync(
    new URL("../app/studio/project/[projectId]/chat/components/message-composer.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(page, /query\.backend|first\(query\.backend\)/u);
  assert.doesNotMatch(composer, /setBackend|<select/u);
  assert.match(
    workspace,
    /preferredBackend:\s*previousDigest\s*\?\s*input\.regeneration\?\.preferredBackend\s*:\s*undefined/u,
  );
  assert.match(workspace, /preferredBackend:\s*regenerationSource\.backendId/u);
});

harness.test("contract", "artifact rejection validates current scope before convergent side effects", () => {
  const approval = readFileSync(
    new URL(
      "../app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const readCurrent = approval.indexOf(
    "const currentArtifact = await repository.get<ConversationArtifact>",
  );
  const validateScope = approval.indexOf(
    "currentArtifact.projectId !== projectId",
    readCurrent,
  );
  const currentSource = approval.indexOf(
    "currentArtifact.sourceMessageId",
    validateScope,
  );
  const rejectClosed = approval.indexOf(
    "await rejectStudioClosedAgentCandidate(closedCandidateId)",
    currentSource,
  );
  const rollbackLearning = approval.indexOf(
    "await learning.rollbackPendingApproval(",
    rejectClosed,
  );
  const rejectConversation = approval.indexOf(
    "await conversation.rejectArtifact(",
    rollbackLearning,
  );
  assert(readCurrent >= 0);
  assert(validateScope > readCurrent);
  assert(currentSource > validateScope);
  assert(rejectClosed > currentSource);
  assert(rollbackLearning > rejectClosed);
  assert(rejectConversation > rollbackLearning);
});

harness.test("contract", "conversation domain stores are canonical repository stores", () => {
  assert.deepEqual(CONVERSATION_STORES, [
    "conversationSessions",
    "conversationMessages",
    "conversationToolInvocations",
    "conversationAttachments",
    "conversationArtifacts",
    "conversationSummaries",
    "conversationApprovalTransactions",
    "learningImportSessions",
  ]);
  for (const store of CONVERSATION_STORES) assert(NOVEL_STORES.includes(store));
  assert.equal(new Set(NOVEL_STORES).size, NOVEL_STORES.length);
});

harness.test("contract", "IndexedDB v8 opens every Conversation store", async () => {
  const capability = indexedDbCapability();
  assert.equal(capability.version, 8);
  assert(CONVERSATION_STORES.every((store) => capability.stores.includes(store)));
  const repository = new IndexedDbNovelRepository();
  for (const store of CONVERSATION_STORES) {
    assert.deepEqual(await repository.list(store), []);
  }
});

harness.test("contract", "session, message, tool and candidate records carry versioned scoped receipts", async () => {
  const { service, repository, projectId } = await setup();
  const session = await service.createSession({ projectId, title: "Long-running novel" });
  const message = await service.appendMessage({
    projectId,
    sessionId: session.id,
    role: "user",
    content: "Continue the chapter naturally.",
  });
  const invocation = await service.saveToolInvocation({
    projectId,
    sessionId: session.id,
    messageId: message.id,
    taskId: crypto.randomUUID(),
    toolId: CONVERSATION_PLANNER_TOOL_ALLOWLIST[0],
    taskType: "chapter.continue",
    inputDigest: await sha256Hex("input"),
    contextDigest: await sha256Hex("context"),
    status: "completed",
    actualExecutor: "local-ollama",
    modelId: "qwen2.5:3b",
    modelDigest: await sha256Hex("qwen2.5:3b"),
    executionReceipt: {
      receiptId: crypto.randomUUID(),
      modelId: "qwen2.5:3b",
      modelDigest: await sha256Hex("qwen2.5:3b"),
      providerRunId: "local-run",
      contextDigest: await sha256Hex("context"),
      outputDigest: await sha256Hex("output"),
      externalRequest: false,
      dataLeftDevice: false,
      latencyMs: 12,
    },
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  });
  const linked = await repository.get("conversationMessages", message.id);
  assert.equal(session.conversationSchemaVersion, "conversation-session-v1");
  assert.equal(message.conversationSchemaVersion, "conversation-message-v1");
  assert.equal(invocation.conversationSchemaVersion, "conversation-tool-invocation-v1");
  assert.equal(invocation.projectId, projectId);
  assert.equal(invocation.sessionId, session.id);
  assert.equal(invocation.externalRequest, false);
  assert.equal(invocation.dataLeftDevice, false);
  assert.equal(invocation.canonicalMutationCount, 0);
  assert(linked.toolInvocationIds.includes(invocation.id));
});

harness.test("persistence", "reload over the same repository restores sessions and messages", async () => {
  const { repository, service, projectId } = await setup();
  const session = await service.createSession({ projectId, title: "Persistent session" });
  const first = await service.appendMessage({
    projectId,
    sessionId: session.id,
    role: "user",
    content: "Persist this request.",
    messageId: "message-idempotent",
  });
  const replay = await service.appendMessage({
    projectId,
    sessionId: session.id,
    role: "user",
    content: "Persist this request.",
    messageId: "message-idempotent",
  });
  assert.equal(replay.id, first.id);
  const reloaded = new ConversationRepositoryService(repository);
  const sessions = await reloaded.listSessions(projectId);
  const messages = await reloaded.listMessages(projectId, session.id);
  assert.equal(sessions.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].content, "Persist this request.");
});

harness.test("persistence", "pending generation can be cancelled and restored after reload", async () => {
  const { repository, service, projectId } = await setup();
  const session = await service.createSession({ projectId });
  const pending = await service.appendMessage({
    projectId,
    sessionId: session.id,
    role: "assistant",
    content: "",
    status: "streaming",
  });
  const cancelled = await service.updateMessageStatus({
    projectId,
    sessionId: session.id,
    messageId: pending.id,
    expectedRevision: pending.revision,
    status: "cancelled",
    content: "Partial response retained as cancelled.",
  });
  const reloaded = new ConversationRepositoryService(repository);
  assert.equal((await reloaded.listMessages(projectId, session.id))[0].status, "cancelled");
  assert(cancelled.completedAt);
});

harness.test("persistence", "failed Closed Agent evidence survives reload as a finite sanitized envelope", async () => {
  const projectId = `project-failure-evidence:${crypto.randomUUID()}`;
  const { repository, service } = await setup(projectId, new IndexedDbNovelRepository());
  const session = await service.createSession({ projectId });
  const message = await service.appendMessage({
    projectId,
    sessionId: session.id,
    role: "assistant",
    content: "",
    status: "streaming",
  });
  const invocation = await service.saveToolInvocation({
    projectId,
    sessionId: session.id,
    messageId: message.id,
    taskId: `task:${crypto.randomUUID()}`,
    toolId: CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan,
    taskType: "chapter.continue",
    inputDigest: await sha256Hex(`input:${projectId}`),
    contextDigest: await sha256Hex(`context:${projectId}`),
    status: "running",
    canonicalMutationCount: 0,
  });
  const rawSentinel = "PRIVATE_PROMPT_REJECTED_PROSE_PERSISTENCE_X9";
  const evidence = createClosedAgentFailureEvidence(Object.assign(new Error(rawSentinel), {
    code: "BROWSER_AI_QUALITY_INSUFFICIENT",
    qualityReasonCodes: ["QUALITY_NARRATIVE_TOO_SHORT", rawSentinel],
    browserRuntimeEvidence: [{
      stage: "initial",
      finishReason: "stop",
      completionTokens: 19,
      rawOutputCharacters: 27,
      normalizedOutputCharacters: 27,
      observedHanCharacters: 25,
    }, {
      stage: "repair",
      finishReason: "stop",
      completionTokens: 160,
      rawOutputCharacters: 281,
      normalizedOutputCharacters: 281,
      observedHanCharacters: 212,
    }],
  }));
  const serialized = serializeClosedAgentFailureEvidence(evidence);
  await service.updateToolInvocationStatus({
    projectId,
    sessionId: session.id,
    invocationId: invocation.id,
    expectedRevision: invocation.revision,
    status: "failed",
    safeErrorCode: evidence.safeCode,
    canonicalMutationCount: 0,
    safeProgress: {
      stage: CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE,
      percent: 100,
      message: serialized,
    },
  });

  const reloaded = new ConversationRepositoryService(repository);
  const persisted = (await reloaded.listToolInvocations(projectId, session.id))
    .find((candidate) => candidate.id === invocation.id);
  assert(persisted);
  assert.equal(persisted.status, "failed");
  assert.equal(persisted.safeProgress?.message, serialized);
  assert.deepEqual(parseClosedAgentFailureEvidence(persisted.safeProgress?.message), evidence);
  assert.doesNotMatch(JSON.stringify(persisted), new RegExp(rawSentinel, "u"));

  const secondMessage = await service.appendMessage({
    projectId,
    sessionId: session.id,
    role: "assistant",
    content: "",
    status: "streaming",
  });
  const secondInvocation = await service.saveToolInvocation({
    projectId,
    sessionId: session.id,
    messageId: secondMessage.id,
    taskId: `task:${crypto.randomUUID()}`,
    toolId: CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan,
    taskType: "chapter.continue",
    inputDigest: await sha256Hex(`input-2:${projectId}`),
    contextDigest: await sha256Hex(`context-2:${projectId}`),
    status: "running",
    canonicalMutationCount: 0,
  });
  await assert.rejects(
    () => service.updateToolInvocationStatus({
      projectId,
      sessionId: session.id,
      invocationId: secondInvocation.id,
      expectedRevision: secondInvocation.revision,
      status: "failed",
      safeErrorCode: evidence.safeCode,
      canonicalMutationCount: 0,
      safeProgress: { stage: "failed", percent: 100, message: rawSentinel },
    }),
    errorWithCode("CONVERSATION_FAILURE_EVIDENCE_REQUIRED"),
  );
  assert.equal(
    (await repository.get("conversationToolInvocations", secondInvocation.id)).status,
    "running",
    "a rejected evidence write must not fabricate a failed durable invocation",
  );
});

harness.test("persistence", "terminal messages and invocations cannot resurrect; explicit retry creates new evidence IDs", async () => {
  const repositories = [
    ["memory", () => new MemoryNovelRepository()],
    ["indexeddb", () => new IndexedDbNovelRepository()],
  ];
  for (const [kind, createRepository] of repositories) {
    for (const terminalStatus of ["failed", "cancelled"]) {
      const projectId = `project-retry:${kind}:${terminalStatus}:${crypto.randomUUID()}`;
      const { repository, service } = await setup(projectId, createRepository());
      const session = await service.createSession({ projectId, title: "Retry state machine" });
      const pendingMessage = await service.appendMessage({
        projectId,
        sessionId: session.id,
        role: "assistant",
        content: "Partial output",
        status: "streaming",
      });
      const parserModelId = "manual-learning-local-parser-v1";
      const parserModelDigest = await sha256Hex(parserModelId);
      const runningInvocation = await service.saveToolInvocation({
        projectId,
        sessionId: session.id,
        messageId: pendingMessage.id,
        taskId: `task:${crypto.randomUUID()}`,
        toolId: "closed-agent-os:story-context-index",
        taskType: "chapter.continue",
        inputDigest: await sha256Hex(`input:${projectId}`),
        contextDigest: await sha256Hex(`context:${projectId}`),
        status: "running",
        actualExecutor: "browser-main-thread",
        modelId: parserModelId,
        modelDigest: parserModelDigest,
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
      });
      const linkedMessage = await repository.get("conversationMessages", pendingMessage.id);
      const terminalMessage = await service.updateMessageStatus({
        projectId,
        sessionId: session.id,
        messageId: linkedMessage.id,
        expectedRevision: linkedMessage.revision,
        status: terminalStatus,
        content: "Terminal output retained.",
      });
      const terminalInvocation = await service.updateToolInvocationStatus({
        projectId,
        sessionId: session.id,
        invocationId: runningInvocation.id,
        expectedRevision: runningInvocation.revision,
        status: terminalStatus,
        ...(terminalStatus === "failed" ? { safeErrorCode: "LOCAL_MODEL_FAILED" } : {}),
        canonicalMutationCount: 0,
      });
      assert.equal(terminalInvocation.actualExecutor, "browser-main-thread");
      assert.equal(terminalInvocation.modelId, parserModelId);
      assert.equal(terminalInvocation.modelDigest, parserModelDigest);
      assert.equal(terminalInvocation.executionReceipt, null);
      assert.equal(terminalInvocation.externalRequest, false);
      assert.equal(terminalInvocation.dataLeftDevice, false);
      await assert.rejects(
        () => service.updateMessageStatus({
          projectId,
          sessionId: session.id,
          messageId: terminalMessage.id,
          expectedRevision: terminalMessage.revision,
          status: "streaming",
        }),
        errorWithCode("CONVERSATION_MESSAGE_TERMINAL_STATUS_IMMUTABLE"),
      );
      await assert.rejects(
        () => service.updateToolInvocationStatus({
          projectId,
          sessionId: session.id,
          invocationId: terminalInvocation.id,
          expectedRevision: terminalInvocation.revision,
          status: "running",
        }),
        errorWithCode("CONVERSATION_TOOL_TERMINAL_STATUS_IMMUTABLE"),
      );
      const retry = await service.prepareToolInvocationRetry({
        projectId,
        sessionId: session.id,
        sourceMessageId: terminalMessage.id,
        sourceInvocationId: terminalInvocation.id,
        expectedMessageRevision: terminalMessage.revision,
        expectedInvocationRevision: terminalInvocation.revision,
      });
      assert.notEqual(retry.message.id, terminalMessage.id);
      assert.notEqual(retry.invocation.id, terminalInvocation.id);
      assert.notEqual(retry.taskId, terminalInvocation.taskId);
      assert.equal(retry.message.status, "streaming");
      assert.equal(retry.message.sourceMessageId, terminalMessage.id);
      assert.equal(retry.invocation.status, "running");
      assert.equal((await repository.get("conversationMessages", terminalMessage.id)).status, terminalStatus);
      assert.equal((await repository.get("conversationToolInvocations", terminalInvocation.id)).status, terminalStatus);
    }
  }
});

harness.test("branching", "branching preserves the source history with new immutable message IDs", async () => {
  const { service, projectId } = await setup();
  const session = await service.createSession({ projectId, title: "Original" });
  const user = await service.appendMessage({
    projectId,
    sessionId: session.id,
    role: "user",
    content: "Take the quiet path.",
  });
  const assistant = await service.appendMessage({
    projectId,
    sessionId: session.id,
    role: "assistant",
    content: "The quiet path opens.",
    parentMessageId: user.id,
  });
  const branch = await service.branchSession({
    projectId,
    sourceSessionId: session.id,
    fromMessageId: assistant.id,
    branchSessionId: "branch-session",
  });
  assert.equal(branch.session.parentSessionId, session.id);
  assert.equal(branch.session.branchedFromMessageId, assistant.id);
  assert.deepEqual(branch.messages.map((item) => item.sourceMessageId), [user.id, assistant.id]);
  assert(branch.messages.every((item) => ![user.id, assistant.id].includes(item.id)));
  assert.equal((await service.listMessages(projectId, session.id)).length, 2);
});

harness.test("branching", "regeneration creates distinct task, candidate and message IDs without overwriting", async () => {
  const state = await setupClosedApprovalFixture({ cacheHit: false });
  const prepare = () => state.service.prepareRegeneration({
    projectId: state.projectId,
    sessionId: state.session.id,
    sourceMessageId: state.message.id,
    expectedSourceMessage: state.message,
    expectedSourceInvocation: state.invocation,
    expectedClosedCandidateId: state.candidate.id,
  });
  const first = await prepare();
  const second = await prepare();
  assert.notEqual(first.taskId, second.taskId);
  assert.notEqual(first.candidateId, second.candidateId);
  assert.notEqual(first.messageId, second.messageId);
  assert.equal(
    (await state.service.listMessages(state.projectId, state.session.id))
      .find((message) => message.id === state.message.id)?.content,
    state.message.content,
  );

  const staleState = await setupClosedApprovalFixture({ cacheHit: false });
  const changedContent = "The displayed source was replaced before regeneration started.";
  const changedMessage = await staleState.repository.put("conversationMessages", {
    ...staleState.message,
    content: changedContent,
    contentDigest: await conversationContentDigest(changedContent),
  }, staleState.message.revision);
  const messageCountBefore = (await staleState.service.listMessages(
    staleState.projectId,
    staleState.session.id,
  )).length;
  await assert.rejects(
    () => staleState.service.prepareRegeneration({
      projectId: staleState.projectId,
      sessionId: staleState.session.id,
      sourceMessageId: staleState.message.id,
      expectedSourceMessage: staleState.message,
      expectedSourceInvocation: staleState.invocation,
      expectedClosedCandidateId: staleState.candidate.id,
    }),
    errorWithCode("CONVERSATION_REGENERATION_SOURCE_STALE"),
  );
  assert.equal(changedMessage.content, changedContent);
  assert.equal((await staleState.service.listMessages(
    staleState.projectId,
    staleState.session.id,
  )).length, messageCountBefore);
});

harness.test("approval", "candidate-only artifact mutates Canon exactly once after approval", async () => {
  const state = await setupApproval();
  const before = await state.repository.get("chapters", state.chapterId);
  assert.equal(before.content, "Canonical opening.");
  assert.equal(state.artifact.status, "candidate");
  const approved = await state.repository.approveConversationArtifactTransaction(state.approvalInput);
  assert.equal(approved.replayed, false);
  assert.equal(approved.canonicalRecord.revision, 2);
  assert.match(approved.canonicalRecord.content, /approved continuation/u);
  assert.equal(approved.artifact.status, "approved");
  assert.equal(approved.approvalTransaction.canonicalMutationCount, 1);
  const replay = await state.repository.approveConversationArtifactTransaction(state.approvalInput);
  assert.equal(replay.replayed, true);
  assert.equal((await state.repository.list("conversationApprovalTransactions", state.projectId)).length, 1);
  assert.equal((await state.repository.get("chapters", state.chapterId)).revision, 2);
});

harness.test("approval", "Closed approval preflight binds the current IndexedDB candidate before signed intent", async () => {
  const positive = await setupClosedApprovalFixture({ cacheHit: false });
  const binding = await assertConversationClosedAgentApprovalBinding(positive.bindingInput);
  const proof = await buildConversationClosedAgentApprovalBindingProof(binding);
  let signedIntentCount = 0;
  signedIntentCount += 1;
  const approved = await positive.repository.approveConversationArtifactTransaction({
    ...positive.approvalInput,
    closedAgentApprovalBinding: proof,
  });
  assert.equal(signedIntentCount, 1);
  assert.equal(approved.artifact.status, "approved");
  assert.equal(approved.canonicalRecord.revision, 2);

  const tampered = await setupClosedApprovalFixture({ cacheHit: false });
  const tamperedContent = "另一份已被竄改但自洽的候選內容。";
  const currentArtifact = await tampered.repository.get(
    "conversationArtifacts",
    tampered.artifact.id,
  );
  const tamperedArtifact = await tampered.repository.put("conversationArtifacts", {
    ...currentArtifact,
    candidateContent: tamperedContent,
    candidateDigest: await sha256Hex(tamperedContent.normalize("NFKC")),
  }, currentArtifact.revision);
  let rejectedSignedIntentCount = 0;
  await assert.rejects(
    async () => {
      await assertConversationClosedAgentApprovalBinding({
        ...tampered.bindingInput,
        artifact: tamperedArtifact,
        sourceMessageCandidateArtifacts: [tamperedArtifact],
      });
      rejectedSignedIntentCount += 1;
    },
    errorWithCode("CONVERSATION_CLOSED_CANDIDATE_BINDING_INVALID"),
  );
  assert.equal(rejectedSignedIntentCount, 0);
  assert.equal((await tampered.repository.get("chapters", tampered.chapterId)).revision, 1);
  assert.equal((await tampered.repository.list("conversationApprovalTransactions", tampered.projectId)).length, 0);
});

harness.test("approval", "Closed cache-hit approval requires exact persisted origin proof", async () => {
  const cached = await setupClosedApprovalFixture({ cacheHit: true });
  const binding = await assertConversationClosedAgentApprovalBinding(cached.bindingInput);
  const proof = await buildConversationClosedAgentApprovalBindingProof(binding);
  const approved = await cached.repository.approveConversationArtifactTransaction({
    ...cached.approvalInput,
    closedAgentApprovalBinding: proof,
  });
  assert.equal(cached.invocation.actualExecutor, "not_executed");
  assert.equal(cached.invocation.executionReceipt.providerRunId, null);
  assert.equal(approved.artifact.status, "approved");
  assert.equal(approved.canonicalRecord.revision, 2);

  const missing = await setupClosedApprovalFixture({ cacheHit: true });
  await assert.rejects(
    () => missing.repository.approveConversationArtifactTransaction(missing.approvalInput),
    errorWithCode("CONVERSATION_CLOSED_APPROVAL_BINDING_INVALID"),
  );
  assert.equal((await missing.repository.get("chapters", missing.chapterId)).revision, 1);

  const tampered = await setupClosedApprovalFixture({ cacheHit: true });
  const persistedInvocation = await tampered.repository.get(
    "conversationToolInvocations",
    tampered.invocation.id,
  );
  const tamperedInvocation = await tampered.repository.put("conversationToolInvocations", {
    ...persistedInvocation,
    executionReceipt: {
      ...persistedInvocation.executionReceipt,
      closedAgentCacheOrigin: {
        ...persistedInvocation.executionReceipt.closedAgentCacheOrigin,
        entryId: `closed-ai-cache:${await sha256Hex("tampered-entry")}`,
      },
    },
  }, persistedInvocation.revision);
  let signedIntentCount = 0;
  await assert.rejects(
    async () => {
      await assertConversationClosedAgentApprovalBinding({
        ...tampered.bindingInput,
        invocations: [tamperedInvocation],
      });
      signedIntentCount += 1;
    },
    errorWithCode("CONVERSATION_CLOSED_CANDIDATE_BINDING_INVALID"),
  );
  assert.equal(signedIntentCount, 0);
  assert.equal((await tampered.repository.get("chapters", tampered.chapterId)).revision, 1);
});

harness.test("approval", "Drawer-defined unchanged fresh Closed content uses the bound OS approval path", async () => {
  const state = await setupClosedApprovalFixture({
    cacheHit: false,
    candidateContent: "Fresh Closed content shown unchanged in the artifact drawer.",
    requestContent: "Continue the current chapter.",
  });
  const result = await runClosedDrawerApproval(state, artifactStory(state.artifact));
  const approvedArtifact = await state.repository.get("conversationArtifacts", state.artifact.id);
  const invocations = await state.repository.list("conversationToolInvocations", state.projectId);

  assert.deepEqual(result.safeErrors, []);
  assert.deepEqual(result.approvedCandidateIds, [state.candidate.id]);
  assert.deepEqual(result.rejectedCandidateIds, []);
  assert.equal(result.leaseReleaseCount, 1);
  assert.equal(approvedArtifact.status, "approved");
  assert.equal((await state.repository.get("chapters", state.chapterId)).revision, 2);
  assert.equal(invocations.filter((item) => item.actualExecutor === "local-user-edit").length, 0);
});

harness.test("approval", "Drawer-defined unchanged cache-hit Closed content preserves cache origin approval", async () => {
  const state = await setupClosedApprovalFixture({
    cacheHit: true,
    candidateContent: "Cache-hit Closed content shown unchanged in the artifact drawer.",
    requestContent: "Continue the current chapter.",
  });
  const unchangedDrawerContent = `  \n${artifactStory(state.artifact)}\n  `;
  const result = await runClosedDrawerApproval(state, unchangedDrawerContent);
  const approvedArtifact = await state.repository.get("conversationArtifacts", state.artifact.id);
  const invocations = await state.repository.list("conversationToolInvocations", state.projectId);

  assert.deepEqual(result.safeErrors, []);
  assert.deepEqual(result.approvedCandidateIds, [state.candidate.id]);
  assert.deepEqual(result.rejectedCandidateIds, []);
  assert.equal(result.leaseReleaseCount, 1);
  assert.equal(state.invocation.actualExecutor, "not_executed");
  assert(state.invocation.executionReceipt.closedAgentCacheOrigin);
  assert.equal(approvedArtifact.status, "approved");
  assert.equal((await state.repository.get("chapters", state.chapterId)).revision, 2);
  assert.equal(invocations.filter((item) => item.actualExecutor === "local-user-edit").length, 0);
});

harness.test("approval", "Drawer true edit derives local-user-edit and rejects the original Closed candidate", async () => {
  const state = await setupClosedApprovalFixture({
    cacheHit: false,
    candidateContent: "Original Closed content before the author edits it in the drawer.",
    requestContent: "Continue the current chapter.",
  });
  const editedContent = `${artifactStory(state.artifact)}\nThe author adds a materially new ending.`;
  const result = await runClosedDrawerApproval(state, editedContent);
  const artifacts = await state.repository.list("conversationArtifacts", state.projectId);
  const invocations = await state.repository.list("conversationToolInvocations", state.projectId);
  const originalArtifact = artifacts.find((item) => item.id === state.artifact.id);
  const editedArtifact = artifacts.find((item) => (
    item.id !== state.artifact.id && item.status === "approved"
  ));
  const localEdits = invocations.filter((item) => item.actualExecutor === "local-user-edit");

  assert.deepEqual(result.safeErrors, []);
  assert.deepEqual(result.approvedCandidateIds, []);
  assert.deepEqual(result.rejectedCandidateIds, [state.candidate.id]);
  assert.equal(result.leaseReleaseCount, 1);
  assert.equal(originalArtifact.status, "rejected");
  assert(editedArtifact);
  assert.equal(editedArtifact.candidateContent, editedContent.trim());
  assert.equal(localEdits.length, 1);
  assert.equal(localEdits[0].executionReceipt.outputDigest, editedArtifact.candidateDigest);
  assert.equal((await state.repository.get("chapters", state.chapterId)).revision, 2);
});

harness.test("approval", "Closed lineage cannot downgrade to generic approval when candidate identity is missing", async () => {
  const state = await setupClosedApprovalFixture({ cacheHit: false });
  const currentMessage = await state.repository.get("conversationMessages", state.message.id);
  const tamperedMessage = await state.repository.put("conversationMessages", {
    ...currentMessage,
    candidateIds: [state.artifact.id],
  }, currentMessage.revision);
  await assert.rejects(
    () => state.repository.approveConversationArtifactTransaction({
      ...state.approvalInput,
      expectedSourceMessageRevision: tamperedMessage.revision,
    }),
    errorWithCode("CONVERSATION_CLOSED_APPROVAL_BINDING_INVALID"),
  );
  assert.equal((await state.repository.get("chapters", state.chapterId)).revision, 1);
  assert.equal((await state.repository.list("conversationApprovalTransactions", state.projectId)).length, 0);
});

harness.test("approval", "author-edited Closed artifact uses one exact local-edit derivation", async () => {
  const state = await setupClosedApprovalFixture({ cacheHit: false });
  const editedContent = "作者親自改寫後的繁體候選，內容與模型輸出明確不同。";
  const editedArtifact = await state.service.saveArtifact({
    projectId: state.projectId,
    sessionId: state.session.id,
    sourceMessageId: state.message.id,
    artifactType: "novel",
    targetStore: "chapters",
    targetRecordId: state.chapterId,
    sourceRevision: 1,
    candidateContent: editedContent,
  });
  await state.service.rejectArtifact(
    state.projectId,
    state.session.id,
    state.artifact.id,
    state.artifact.revision,
  );
  const sourceMessage = await state.repository.get("conversationMessages", state.message.id);
  const contextDigest = await sha256Hex(`local-edit:${state.projectId}`);
  const localEditTaskId = `conversation-local-user-edit:task:${crypto.randomUUID()}`;
  const localEdit = await state.service.saveToolInvocation({
    projectId: state.projectId,
    sessionId: state.session.id,
    messageId: sourceMessage.id,
    taskId: localEditTaskId,
    toolId: CONVERSATION_LOCAL_TOOL_IDS.localUserEdit,
    taskType: "candidate.user-edit",
    inputDigest: sourceMessage.contentDigest,
    contextDigest,
    status: "completed",
    actualExecutor: "local-user-edit",
    modelId: null,
    modelDigest: null,
    executionReceipt: {
      receiptId: `conversation-local-user-edit:${crypto.randomUUID()}`,
      modelId: null,
      modelDigest: null,
      providerRunId: localEditTaskId,
      contextDigest,
      outputDigest: editedArtifact.candidateDigest,
      externalRequest: false,
      dataLeftDevice: false,
      latencyMs: 0,
    },
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  });
  const linkedMessage = await state.repository.get("conversationMessages", state.message.id);
  const currentSession = await state.repository.get("conversationSessions", state.session.id);
  const currentArtifact = await state.repository.get("conversationArtifacts", editedArtifact.id);
  const input = {
    ...state.approvalInput,
    operationId: `edited-approval:${editedArtifact.id}`,
    idempotencyKey: `edited-approval:${editedArtifact.id}`,
    artifactId: editedArtifact.id,
    candidateDigest: editedArtifact.candidateDigest,
    expectedSessionRevision: currentSession.revision,
    expectedArtifactRevision: currentArtifact.revision,
    expectedSourceMessageRevision: linkedMessage.revision,
  };
  const approved = await state.repository.approveConversationArtifactTransaction(input);
  assert.equal(approved.artifact.status, "approved");
  assert.equal(approved.canonicalRecord.revision, 2);

  const tampered = await setupClosedApprovalFixture({ cacheHit: false });
  const tamperedArtifact = await tampered.service.saveArtifact({
    projectId: tampered.projectId,
    sessionId: tampered.session.id,
    sourceMessageId: tampered.message.id,
    artifactType: "novel",
    targetStore: "chapters",
    targetRecordId: tampered.chapterId,
    sourceRevision: 1,
    candidateContent: `${editedContent}第二份`,
  });
  await tampered.service.rejectArtifact(
    tampered.projectId,
    tampered.session.id,
    tampered.artifact.id,
    tampered.artifact.revision,
  );
  const tamperedMessage = await tampered.repository.get("conversationMessages", tampered.message.id);
  const tamperedContext = await sha256Hex(`local-edit:${tampered.projectId}`);
  const tamperedEditTaskId = `conversation-local-user-edit:task:${crypto.randomUUID()}`;
  await tampered.service.saveToolInvocation({
    projectId: tampered.projectId,
    sessionId: tampered.session.id,
    messageId: tamperedMessage.id,
    taskId: tamperedEditTaskId,
    toolId: CONVERSATION_LOCAL_TOOL_IDS.localUserEdit,
    taskType: "candidate.user-edit",
    inputDigest: tamperedMessage.contentDigest,
    contextDigest: tamperedContext,
    status: "completed",
    actualExecutor: "local-user-edit",
    modelId: null,
    modelDigest: null,
    executionReceipt: {
      receiptId: `conversation-local-user-edit:${crypto.randomUUID()}`,
      modelId: null,
      modelDigest: null,
      providerRunId: tamperedEditTaskId,
      contextDigest: tamperedContext,
      outputDigest: await sha256Hex("wrong local edit output"),
      externalRequest: false,
      dataLeftDevice: false,
      latencyMs: 0,
    },
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  });
  const tamperedLinkedMessage = await tampered.repository.get("conversationMessages", tampered.message.id);
  const tamperedSession = await tampered.repository.get("conversationSessions", tampered.session.id);
  const tamperedCurrentArtifact = await tampered.repository.get("conversationArtifacts", tamperedArtifact.id);
  await assert.rejects(
    () => tampered.repository.approveConversationArtifactTransaction({
      ...tampered.approvalInput,
      operationId: `tampered-edit:${tamperedArtifact.id}`,
      idempotencyKey: `tampered-edit:${tamperedArtifact.id}`,
      artifactId: tamperedArtifact.id,
      candidateDigest: tamperedArtifact.candidateDigest,
      expectedSessionRevision: tamperedSession.revision,
      expectedArtifactRevision: tamperedCurrentArtifact.revision,
      expectedSourceMessageRevision: tamperedLinkedMessage.revision,
    }),
    errorWithCode("CONVERSATION_CLOSED_APPROVAL_BINDING_INVALID"),
  );
  assert.equal((await tampered.repository.get("chapters", tampered.chapterId)).revision, 1);
  assert(localEdit);
});

harness.test("approval", "failed receipts and output-unbound receipts cannot approve in Memory or IndexedDB", async () => {
  const repositories = [
    ["memory", () => new MemoryNovelRepository()],
    ["indexeddb", () => new IndexedDbNovelRepository()],
  ];
  for (const [kind, createRepository] of repositories) {
    const failedState = await setupApproval({
      repository: createRepository(),
      projectId: `project-failed-receipt:${kind}:${crypto.randomUUID()}`,
    });
    const failedInvocation = await failedState.repository.get(
      "conversationToolInvocations",
      failedState.message.toolInvocationIds[0],
    );
    const failedEvidence = createClosedAgentFailureEvidence(Object.assign(
      new Error("discarded failed receipt detail"),
      { code: "CLOSED_AGENT_TASK_FAILED" },
    ));
    await failedState.repository.put("conversationToolInvocations", {
      ...failedInvocation,
      status: "failed",
      safeErrorCode: failedEvidence.safeCode,
      safeProgress: {
        stage: CLOSED_AGENT_FAILURE_EVIDENCE_PROGRESS_STAGE,
        percent: 100,
        message: serializeClosedAgentFailureEvidence(failedEvidence),
      },
    }, failedInvocation.revision);
    await assert.rejects(
      () => failedState.repository.approveConversationArtifactTransaction(failedState.approvalInput),
      errorWithCode("CONVERSATION_APPROVAL_EXECUTION_RECEIPT_REQUIRED"),
    );
    assert.equal((await failedState.repository.get("chapters", failedState.chapterId)).revision, 1);
    assert.equal((await failedState.repository.get("conversationArtifacts", failedState.artifact.id)).status, "candidate");

    const invalidState = await setupApproval({
      repository: createRepository(),
      projectId: `project-invalid-receipt:${kind}:${crypto.randomUUID()}`,
    });
    const invalidInvocation = await invalidState.repository.get(
      "conversationToolInvocations",
      invalidState.message.toolInvocationIds[0],
    );
    await invalidState.repository.put("conversationToolInvocations", {
      ...invalidInvocation,
      executionReceipt: {
        ...invalidInvocation.executionReceipt,
        outputDigest: await sha256Hex("unbound output"),
      },
    }, invalidInvocation.revision);
    await assert.rejects(
      () => invalidState.repository.approveConversationArtifactTransaction(invalidState.approvalInput),
      errorWithCode("CONVERSATION_APPROVAL_EXECUTION_TRUTH_INVALID"),
    );
    assert.equal((await invalidState.repository.get("chapters", invalidState.chapterId)).revision, 1);
    assert.equal((await invalidState.repository.get("conversationArtifacts", invalidState.artifact.id)).status, "candidate");
  }
});

harness.test("approval", "raw model-output digest remains truthfully bound when NFKC storage digest differs", async () => {
  const state = await setupApproval({
    projectId: `project-nfkc-output:${crypto.randomUUID()}`,
    candidateContent: "全形輸出，Ａ計畫正式啟動！",
  });
  const invocation = await state.repository.get(
    "conversationToolInvocations",
    state.message.toolInvocationIds[0],
  );
  assert.notEqual(invocation.executionReceipt.outputDigest, state.artifact.candidateDigest);
  const approved = await state.repository.approveConversationArtifactTransaction(state.approvalInput);
  assert.equal(approved.artifact.status, "approved");
});

harness.test("approval", "same idempotency key with a changed payload is rejected", async () => {
  const state = await setupApproval();
  await state.repository.approveConversationArtifactTransaction(state.approvalInput);
  await assert.rejects(
    () => state.repository.approveConversationArtifactTransaction({
      ...state.approvalInput,
      applicationMode: "replace",
    }),
    errorWithCode("CONVERSATION_IDEMPOTENCY_PAYLOAD_MISMATCH"),
  );
});

harness.test("approval", "stale canonical revision cannot overwrite a newer chapter", async () => {
  const state = await setupApproval();
  const current = await state.repository.get("chapters", state.chapterId);
  await state.repository.put("chapters", { ...current, content: "Concurrent author edit." }, current.revision);
  await assert.rejects(
    () => state.repository.approveConversationArtifactTransaction(state.approvalInput),
    errorWithCode("CONVERSATION_CANONICAL_REVISION_STALE"),
  );
  assert.equal((await state.repository.get("chapters", state.chapterId)).content, "Concurrent author edit.");
  assert.equal((await state.repository.get("conversationArtifacts", state.artifact.id)).status, "candidate");
});

harness.test("approval", "fault during approval rolls Canon, artifact and ledger back together", async () => {
  let injected = false;
  const state = await setupApproval({
    approvalFaultInjector(point) {
      if (!injected && point === "after:chapters") {
        injected = true;
        throw new Error("INJECTED_APPROVAL_FAILURE");
      }
    },
  });
  await assert.rejects(
    () => state.repository.approveConversationArtifactTransaction(state.approvalInput),
    /INJECTED_APPROVAL_FAILURE/u,
  );
  assert.equal((await state.repository.get("chapters", state.chapterId)).content, "Canonical opening.");
  assert.equal((await state.repository.get("conversationArtifacts", state.artifact.id)).status, "candidate");
  assert.equal((await state.repository.list("conversationApprovalTransactions", state.projectId)).length, 0);
});

harness.test("approval", "IndexedDB v7 approval is atomic, replay-safe, and rolls back injected faults", async () => {
  const projectId = `project-indexeddb-approval:${crypto.randomUUID()}`;
  const repository = new IndexedDbNovelRepository();
  const state = await setupApproval({ repository, projectId });
  const first = await repository.approveConversationArtifactTransaction(state.approvalInput);
  const replay = await repository.approveConversationArtifactTransaction(state.approvalInput);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(first.approvalTransaction.id, replay.approvalTransaction.id);
  assert.equal((await repository.list("conversationApprovalTransactions", projectId)).length, 1);
  assert.equal((await repository.get("conversationArtifacts", state.artifact.id)).status, "approved");

  let injectFault = false;
  const rollbackProjectId = `project-indexeddb-rollback:${crypto.randomUUID()}`;
  const rollbackRepository = new IndexedDbNovelRepository({
    approvalFaultInjector: (point) => {
      if (injectFault && point === "after:conversationArtifacts") throw new Error("RC6_INDEXEDDB_INJECTED_FAULT");
    },
  });
  const rollbackState = await setupApproval({
    repository: rollbackRepository,
    projectId: rollbackProjectId,
  });
  const beforeChapter = await rollbackRepository.get("chapters", rollbackState.chapterId);
  injectFault = true;
  await assert.rejects(
    () => rollbackRepository.approveConversationArtifactTransaction(rollbackState.approvalInput),
    /RC6_INDEXEDDB_INJECTED_FAULT/u,
  );
  assert.deepEqual(await rollbackRepository.get("chapters", rollbackState.chapterId), beforeChapter);
  assert.equal((await rollbackRepository.get("conversationArtifacts", rollbackState.artifact.id)).status, "candidate");
  assert.equal((await rollbackRepository.list("conversationApprovalTransactions", rollbackProjectId)).length, 0);
});

harness.test("approval", "IndexedDB approval rejects exact-snapshot artifact and message races before Canon mutation", async () => {
  const projectId = `project-indexeddb-approval-race:${crypto.randomUUID()}`;
  const repository = new ApprovalSnapshotTamperingRepository();
  const state = await setupApproval({ repository, projectId });
  const tamperedContent = "A direct IndexedDB write changed only the candidate content.";
  repository.armArtifactTamper(state.artifact.id, tamperedContent);

  await assert.rejects(
    () => repository.approveConversationArtifactTransaction(state.approvalInput),
    errorWithCode("CONVERSATION_APPROVAL_SOURCE_STALE"),
  );

  assert.equal((await repository.get("chapters", state.chapterId)).revision, 1);
  assert.equal((await repository.get("chapters", state.chapterId)).content, "Canonical opening.");
  assert.equal((await repository.get("conversationArtifacts", state.artifact.id)).candidateContent, tamperedContent);
  assert.equal((await repository.list("conversationApprovalTransactions", projectId)).length, 0);

  const messageProjectId = `project-indexeddb-approval-message-race:${crypto.randomUUID()}`;
  const messageRepository = new ApprovalSnapshotTamperingRepository();
  const messageState = await setupApproval({
    repository: messageRepository,
    projectId: messageProjectId,
  });
  const tamperedMessageContent = "A direct IndexedDB write changed only the source message content.";
  messageRepository.armSourceMessageTamper(
    messageState.message.id,
    tamperedMessageContent,
  );
  await assert.rejects(
    () => messageRepository.approveConversationArtifactTransaction(messageState.approvalInput),
    errorWithCode("CONVERSATION_APPROVAL_SOURCE_STALE"),
  );
  assert.equal((await messageRepository.get("chapters", messageState.chapterId)).revision, 1);
  assert.equal((await messageRepository.get("chapters", messageState.chapterId)).content, "Canonical opening.");
  assert.equal(
    (await messageRepository.get("conversationMessages", messageState.message.id)).content,
    tamperedMessageContent,
  );
  assert.equal((await messageRepository.list("conversationApprovalTransactions", messageProjectId)).length, 0);

  const inconsistentProjectId = `project-indexeddb-approval-inconsistent-message:${crypto.randomUUID()}`;
  const inconsistentRepository = new ApprovalSnapshotTamperingRepository();
  const inconsistentState = await setupApproval({
    repository: inconsistentRepository,
    projectId: inconsistentProjectId,
  });
  inconsistentRepository.armSourceMessageTamper(
    inconsistentState.message.id,
    "The source was already inconsistent before the approval preflight read it.",
  );
  await inconsistentRepository.get("conversationMessages", inconsistentState.message.id);
  await assert.rejects(
    () => inconsistentRepository.approveConversationArtifactTransaction(
      inconsistentState.approvalInput,
    ),
    errorWithCode("CONVERSATION_APPROVAL_SOURCE_STALE"),
  );
  assert.equal((await inconsistentRepository.get("chapters", inconsistentState.chapterId)).revision, 1);
  assert.equal((await inconsistentRepository.list(
    "conversationApprovalTransactions",
    inconsistentProjectId,
  )).length, 0);
});

harness.test("routing", "natural-language planner maps supported intents to the fixed tool allowlist", async () => {
  const cases = [
    ["繼續寫下一章", "continue_writing", "closed_agent"],
    ["改寫選取內容", "rewrite_selection", "closed_agent"],
    ["擴寫這個場景", "expand_scene", "closed_agent"],
    ["強化角色對話", "strengthen_dialogue", "closed_agent"],
    ["建立章節大綱", "chapter_outline", "closed_agent"],
    ["建立 A/B/C 選項", "create_abc_choices", "rpg"],
    ["執行 RPG 回合", "rpg_turn", "rpg"],
    ["建立一名角色", "character_candidate", "closed_agent"],
    ["檢查時間線", "timeline_check", "closed_agent"],
    ["搜尋目前作品", "project_search", "closed_agent"],
    ["建立備份", "backup_create", "repository"],
    ["匯出作品", "project_export", "repository"],
    ["查看狀態", "dashboard_query", "query"],
  ];
  const allowlist = new Set(CONVERSATION_PLANNER_TOOL_ALLOWLIST);
  for (const [content, intent, executionKind] of cases) {
    const plan = await planConversationRequest({ content });
    assert.equal(plan.intent, intent, content);
    assert.equal(plan.executionKind, executionKind, content);
    assert(plan.allowedToolIds.every((toolId) => allowlist.has(toolId)));
    assert(!plan.allowedToolIds.some((toolId) => /shell|filesystem|network|database/iu.test(toolId)));
  }
  assert.deepEqual(
    (await planConversationRequest({ content: "建立備份" })).allowedToolIds,
    [CONVERSATION_LOCAL_TOOL_IDS.backupCreate],
  );
  assert.deepEqual(
    (await planConversationRequest({ content: "匯出作品" })).allowedToolIds,
    [CONVERSATION_LOCAL_TOOL_IDS.projectExport],
  );
  assert.deepEqual(
    (await planConversationRequest({ content: "查看狀態" })).allowedToolIds,
    [CONVERSATION_LOCAL_TOOL_IDS.storyStateQuery],
  );
  assert.deepEqual(
    (await planConversationRequest({ content: "從附件建立學習規則", attachmentCount: 1 })).allowedToolIds,
    [CONVERSATION_LOCAL_TOOL_IDS.atomicLearningImport],
  );
  assert.deepEqual(
    (await planConversationRequest({ content: "建立 A/B/C 選項" })).allowedToolIds,
    [CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan],
  );
  assert.deepEqual(
    (await planConversationRequest({ content: "執行 RPG 回合" })).allowedToolIds,
    [CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan],
  );
  assert.throws(
    () => assertConversationPlannerToolAllowed("shell:arbitrary-command"),
    (error) => error?.code === "CONVERSATION_TOOL_NOT_ALLOWLISTED",
  );
});

harness.test("routing", "saved three-choice modes automatically continue as RPG turns", async () => {
  for (const fixedPlayMode of ["interactive", "rpg", "romance", "management"]) {
    const plan = await planConversationRequest({
      content: "繼續目前故事。",
      fixedPlayMode,
    });
    assert.equal(plan.intent, "rpg_turn", fixedPlayMode);
    assert.equal(plan.executionKind, "rpg", fixedPlayMode);
    assert.deepEqual(plan.allowedToolIds, [CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan]);
  }
  const general = await planConversationRequest({
    content: "繼續目前故事。",
    fixedPlayMode: "general",
  });
  assert.equal(general.intent, "continue_writing");
  assert.equal(general.executionKind, "closed_agent");
});

harness.test("routing", "explicit continuation outranks incidental Canon entity mentions", async () => {
  const productionGatePrompt = "請依照目前已核准的角色、世界設定與章節內容，續寫一個有後果的新場景。只建立候選，不要直接修改 Canon。";
  const continuation = await planConversationRequest({ content: productionGatePrompt });
  assert.equal(continuation.intent, "continue_writing");
  assert.equal(continuation.taskType, "chapter.continue");
  assert.equal(continuation.targetStore, "chapters");
  assert.equal(continuation.executionKind, "closed_agent");
  assert.equal(continuation.approvalRequired, true);
  assert.equal(continuation.candidateOnly, true);

  for (const firstChapterPrompt of [
    "幫我開始第一章",
    "開始第一章",
    "寫第一章",
    "請幫我開始寫第 1 章",
  ]) {
    const firstChapter = await planConversationRequest({ content: firstChapterPrompt });
    assert.equal(firstChapter.intent, "continue_writing", firstChapterPrompt);
    assert.equal(firstChapter.taskType, "chapter.continue", firstChapterPrompt);
    assert.equal(firstChapter.targetStore, "chapters", firstChapterPrompt);
    assert.equal(firstChapter.executionKind, "closed_agent", firstChapterPrompt);
    assert.equal(firstChapter.approvalRequired, true, firstChapterPrompt);
    assert.equal(firstChapter.candidateOnly, true, firstChapterPrompt);
  }
  const attachmentContinuation = await planConversationRequest({
    content: "請根據核准 Story Bible 與附件開始第一章",
    attachmentCount: 1,
  });
  assert.equal(attachmentContinuation.intent, "continue_writing");
  assert.equal(attachmentContinuation.taskType, "chapter.continue");
  assert.equal(attachmentContinuation.targetStore, "chapters");
  assert.equal(attachmentContinuation.executionKind, "closed_agent");
  assert.equal(attachmentContinuation.approvalRequired, true);
  const attachmentAnalysis = await planConversationRequest({
    content: "請分析附件內容",
    attachmentCount: 1,
  });
  assert.equal(attachmentAnalysis.intent, "attachment_analysis");
  assert.equal(attachmentAnalysis.executionKind, "attachment");
  assert.equal(attachmentAnalysis.approvalRequired, false);

  const entityCandidateCases = [
    {
      content: "請修改角色明檀的背景，讓她曾在北境修行。",
      intent: "character_candidate",
      taskType: "character.create",
      targetStore: "characters",
    },
    {
      content: "請修改世界規則，讓靈石不可逆流。",
      intent: "world_rule_candidate",
      taskType: "world.ruleCandidate",
      targetStore: "worldRules",
    },
    {
      content: "請修改角色明檀的背景，讓她曾在北境修行，然後續寫下一段。",
      intent: "character_candidate",
      taskType: "character.create",
      targetStore: "characters",
    },
    {
      content: "請修改世界規則，讓靈石不可逆流，接著寫下一段。",
      intent: "world_rule_candidate",
      taskType: "world.ruleCandidate",
      targetStore: "worldRules",
    },
    {
      content: "請修改角色明檀的背景，再幫我開始第一章。",
      intent: "character_candidate",
      taskType: "character.create",
      targetStore: "characters",
    },
    {
      content: "請修改世界規則，再開始第一章。",
      intent: "world_rule_candidate",
      taskType: "world.ruleCandidate",
      targetStore: "worldRules",
    },
    {
      content: "只建立一個候選角色，並續寫下一段。",
      intent: "character_candidate",
      taskType: "character.create",
      targetStore: "characters",
    },
    {
      content: "只建立一個候選世界規則，並續寫下一段。",
      intent: "world_rule_candidate",
      taskType: "world.ruleCandidate",
      targetStore: "worldRules",
    },
  ];
  for (const expected of entityCandidateCases) {
    const plan = await planConversationRequest({ content: expected.content });
    assert.equal(plan.intent, expected.intent, expected.content);
    assert.equal(plan.taskType, expected.taskType, expected.content);
    assert.equal(plan.targetStore, expected.targetStore, expected.content);
    assert.equal(plan.approvalRequired, true, expected.content);
  }
});

harness.test("routing", "Canon target creation returns a fresh non-canonical identity at revision zero", async () => {
  const state = await setup(`project-canon-create:${crypto.randomUUID()}`);
  const createdId = `character-candidate:${crypto.randomUUID()}`;
  const target = await resolveConversationCanonicalTarget({
    repository: state.repository,
    projectId: state.projectId,
    store: "characters",
    objective: "建立一名新的藥師角色",
    createId: () => createdId,
  });
  assert.deepEqual(target, {
    targetRecordId: createdId,
    sourceRevision: 0,
    existing: false,
  });
  assert.equal(await state.repository.get("characters", createdId), null);
});

harness.test("routing", "explicit Character alias and WorldRule title modifications resolve exact Canon revisions", async () => {
  const state = await setup(`project-canon-modify:${crypto.randomUUID()}`);
  const character = await state.repository.put("characters", {
    ...record(`character:${crypto.randomUUID()}`, state.projectId),
    name: "明檀",
    aliases: ["合歡宗主", "檀宗主"],
  });
  const revisedCharacter = await state.repository.put("characters", {
    ...character,
    aliases: [...character.aliases, "紅衣宗主"],
  }, character.revision);
  await state.repository.put("characters", {
    ...record(`character:${crypto.randomUUID()}`, state.projectId),
    name: "瑤光",
    aliases: ["月魄仙魂"],
  });
  const characterTarget = await resolveConversationCanonicalTarget({
    repository: state.repository,
    projectId: state.projectId,
    store: "characters",
    objective: "修改紅衣宗主的隱藏動機",
  });
  assert.deepEqual(characterTarget, {
    targetRecordId: revisedCharacter.id,
    sourceRevision: revisedCharacter.revision,
    existing: true,
  });

  const worldRule = await state.repository.put("worldRules", {
    ...record(`world-rule:${crypto.randomUUID()}`, state.projectId),
    title: "月魄不可逆轉",
  });
  const revisedWorldRule = await state.repository.put("worldRules", {
    ...worldRule,
    title: worldRule.title,
  }, worldRule.revision);
  await state.repository.put("worldRules", {
    ...record(`world-rule:${crypto.randomUUID()}`, state.projectId),
    title: "靈石交易守恆",
  });
  const worldRuleTarget = await resolveConversationCanonicalTarget({
    repository: state.repository,
    projectId: state.projectId,
    store: "worldRules",
    objective: "更新月魄不可逆轉的觸發條件",
  });
  assert.deepEqual(worldRuleTarget, {
    targetRecordId: revisedWorldRule.id,
    sourceRevision: revisedWorldRule.revision,
    existing: true,
  });
});

harness.test("routing", "record replacement preserves Character lifecycle and immutable WorldRule Canon", () => {
  const projectId = `project-canon-preserve:${crypto.randomUUID()}`;
  const existingCharacter = {
    ...record(`character:${crypto.randomUUID()}`, projectId),
    name: "明檀",
    aliases: ["合歡宗主", "檀宗主"],
    identity: optionalValue("合歡宗現任宗主"),
    personality: optionalValue("冷靜、謹慎"),
    goal: optionalValue("重建宗門"),
    lifeStatus: "alive",
    locationId: "location:red-hall",
  };
  const replacedCharacter = buildConversationCanonicalReplacement({
    projectId,
    store: "characters",
    targetRecordId: existingCharacter.id,
    candidateContent: "新的隱藏動機：她打算以拍賣會反向引出內鬼。",
    current: existingCharacter,
  });
  assert.equal(replacedCharacter.name, existingCharacter.name);
  assert.deepEqual(replacedCharacter.aliases, existingCharacter.aliases);
  assert.deepEqual(replacedCharacter.personality, existingCharacter.personality);
  assert.deepEqual(replacedCharacter.goal, existingCharacter.goal);
  assert.equal(replacedCharacter.lifeStatus, existingCharacter.lifeStatus);
  assert.equal(replacedCharacter.locationId, existingCharacter.locationId);

  const existingWorldRule = {
    ...record(`world-rule:${crypto.randomUUID()}`, projectId),
    title: "月魄不可逆轉",
    description: "舊規則。",
    immutable: true,
  };
  const replacedWorldRule = buildConversationCanonicalReplacement({
    projectId,
    store: "worldRules",
    targetRecordId: existingWorldRule.id,
    candidateContent: "新規則：月魄魂絲一旦抽離便不可逆轉。",
    current: existingWorldRule,
  });
  assert.equal(replacedWorldRule.title, existingWorldRule.title);
  assert.equal(replacedWorldRule.immutable, true);
  assert.equal(replacedWorldRule.description, "新規則：月魄魂絲一旦抽離便不可逆轉。");
});

harness.test("routing", "ambiguous and missing Canon modification targets fail closed without duplicate records", async () => {
  const ambiguous = await setup(`project-canon-ambiguous:${crypto.randomUUID()}`);
  for (const name of ["明檀", "沈照霜"]) {
    await ambiguous.repository.put("characters", {
      ...record(`character:${crypto.randomUUID()}`, ambiguous.projectId),
      name,
      aliases: ["宗主"],
    });
  }
  const ambiguousCount = (await ambiguous.repository.list("characters", ambiguous.projectId)).length;
  await expectErrorCode(
    () => resolveConversationCanonicalTarget({
      repository: ambiguous.repository,
      projectId: ambiguous.projectId,
      store: "characters",
      objective: "修改宗主的秘密",
    }),
    "CONVERSATION_CANON_TARGET_AMBIGUOUS",
  );
  assert.equal((await ambiguous.repository.list("characters", ambiguous.projectId)).length, ambiguousCount);

  const missing = await setup(`project-canon-missing:${crypto.randomUUID()}`);
  await missing.repository.put("characters", {
    ...record(`character:${crypto.randomUUID()}`, missing.projectId),
    name: "明檀",
    aliases: ["合歡宗主"],
  });
  const missingCount = (await missing.repository.list("characters", missing.projectId)).length;
  await expectErrorCode(
    () => resolveConversationCanonicalTarget({
      repository: missing.repository,
      projectId: missing.projectId,
      store: "characters",
      objective: "修改不存在角色的背景",
    }),
    "CONVERSATION_CANON_TARGET_NOT_FOUND",
  );
  assert.equal((await missing.repository.list("characters", missing.projectId)).length, missingCount);
});

harness.test("routing", "attachments and active RPG custom actions stay local and candidate-only", async () => {
  const attachment = await planConversationRequest({ content: "請分析", attachmentCount: 2 });
  assert.equal(attachment.executionKind, "attachment");
  assert.deepEqual(attachment.allowedToolIds, [CONVERSATION_LOCAL_TOOL_IDS.attachmentParse]);
  assert.equal(attachment.candidateOnly, true);
  const custom = await planConversationRequest({ content: "我翻窗進去找帳冊", hasActiveRpgTurn: true });
  assert.equal(custom.intent, "rpg_custom_action");
  assert.equal(custom.executionKind, "rpg");
  assert.equal(custom.approvalRequired, true);
  assert.deepEqual(custom.allowedToolIds, [CONVERSATION_LOCAL_TOOL_IDS.rpgTurn]);
});

harness.test("memory", "context includes bounded same-project summaries while raw messages stay session-scoped", async () => {
  const sharedRepository = new MemoryNovelRepository();
  const first = await setup("project-memory-a", sharedRepository);
  const second = await setup("project-memory-b", sharedRepository);
  const firstSession = await first.service.createSession({ projectId: first.projectId });
  const otherSession = await first.service.createSession({ projectId: first.projectId });
  const otherProjectSession = await second.service.createSession({ projectId: second.projectId });
  const currentMessage = await first.service.appendMessage({
    projectId: first.projectId,
    sessionId: firstSession.id,
    role: "assistant",
    content: "CURRENT_SESSION_MARKER",
  });
  const otherMessage = await first.service.appendMessage({
    projectId: first.projectId,
    sessionId: otherSession.id,
    role: "assistant",
    content: "OTHER_SESSION_SECRET",
  });
  await second.service.appendMessage({
    projectId: second.projectId,
    sessionId: otherProjectSession.id,
    role: "assistant",
    content: "OTHER_PROJECT_SECRET",
  });
  const projectRecord = await sharedRepository.get("projects", first.projectId);
  const chapterRecord = await sharedRepository.get("chapters", first.chapterId);
  const storyBibleRecord = await sharedRepository.get(
    "storyBibles",
    `bible:${first.projectId}`,
  );
  const canonRevisionDigest = await conversationCanonRevisionDigest({
    project: projectRecord,
    activeChapter: chapterRecord,
    storyBible: storyBibleRecord,
    storyState: null,
  });
  await first.service.upsertSummary({
    projectId: first.projectId,
    sessionId: firstSession.id,
    sourceMessageIds: [currentMessage.id],
    content: "CURRENT_SUMMARY_MARKER",
    canonRevisionDigest,
  });
  await first.service.upsertSummary({
    projectId: first.projectId,
    sessionId: otherSession.id,
    sourceMessageIds: [otherMessage.id],
    content: "SAME_PROJECT_APPROVED_SUMMARY_MARKER",
    canonRevisionDigest,
  });
  const composition = await composeProjectContext({
    repository: sharedRepository,
    taskType: "chapter.continue",
    projectId: first.projectId,
    privacyLevel: "device_only",
    audience: "actor",
    conversationSessionId: firstSession.id,
  });
  const text = composition.context.map((item) => item.text).join("\n");
  assert.match(text, /CURRENT_SESSION_MARKER/u);
  assert.match(text, /CURRENT_SUMMARY_MARKER/u);
  assert.match(text, /SAME_PROJECT_APPROVED_SUMMARY_MARKER/u);
  assert.doesNotMatch(text, /OTHER_SESSION_SECRET/u);
  assert.doesNotMatch(text, /OTHER_PROJECT_SECRET/u);
  assert.equal(composition.contextSourceSummary.counts.conversationMessages, 1);
  assert.equal(composition.contextSourceSummary.counts.conversationSummaries, 2);
});

harness.test("memory", "stale, invalidated, cross-project and excess conversation summaries are excluded", async () => {
  const sharedRepository = new MemoryNovelRepository();
  const first = await setup(`project-summary-scope-a:${crypto.randomUUID()}`, sharedRepository);
  const second = await setup(`project-summary-scope-b:${crypto.randomUUID()}`, sharedRepository);
  const active = await first.service.createSession({ projectId: first.projectId });
  const projectRecord = await sharedRepository.get("projects", first.projectId);
  const chapterRecord = await sharedRepository.get("chapters", first.chapterId);
  const storyBibleRecord = await sharedRepository.get(
    "storyBibles",
    `bible:${first.projectId}`,
  );
  const canonRevisionDigest = await conversationCanonRevisionDigest({
    project: projectRecord,
    activeChapter: chapterRecord,
    storyBible: storyBibleRecord,
    storyState: null,
  });
  for (let index = 0; index < 6; index += 1) {
    const session = await first.service.createSession({ projectId: first.projectId });
    const message = await first.service.appendMessage({
      projectId: first.projectId,
      sessionId: session.id,
      role: "user",
      content: `SUMMARY_SOURCE_${index}`,
    });
    const summary = await first.service.upsertSummary({
      projectId: first.projectId,
      sessionId: session.id,
      sourceMessageIds: [message.id],
      content: index === 0 ? "INVALIDATED_SUMMARY_MARKER" : `BOUNDED_SUMMARY_${index}`,
      canonRevisionDigest: index === 1 ? "stale-canon-digest" : canonRevisionDigest,
    });
    if (index === 0) {
      await sharedRepository.put("conversationSummaries", {
        ...summary,
        invalidatedAt: new Date().toISOString(),
      }, summary.revision);
    }
  }
  const otherSession = await second.service.createSession({ projectId: second.projectId });
  const otherMessage = await second.service.appendMessage({
    projectId: second.projectId,
    sessionId: otherSession.id,
    role: "user",
    content: "OTHER_PROJECT_SUMMARY_SOURCE",
  });
  await second.service.upsertSummary({
    projectId: second.projectId,
    sessionId: otherSession.id,
    sourceMessageIds: [otherMessage.id],
    content: "CROSS_PROJECT_SUMMARY_MARKER",
    canonRevisionDigest,
  });
  await sharedRepository.put("conversationSummaries", {
    ...record(`conversation-summary:${crypto.randomUUID()}`, first.projectId, "system"),
    conversationSchemaVersion: "conversation-summary-v1",
    sessionId: active.id,
    sourceMessageIds: [otherMessage.id],
    content: "CROSS_PROJECT_SOURCE_ID_SUMMARY_MARKER",
    contentDigest: await sha256Hex("CROSS_PROJECT_SOURCE_ID_SUMMARY_MARKER"),
    canonRevisionDigest,
    invalidatedAt: null,
  });
  const composition = await composeProjectContext({
    repository: sharedRepository,
    taskType: "chapter.continue",
    projectId: first.projectId,
    privacyLevel: "device_only",
    audience: "actor",
    conversationSessionId: active.id,
  });
  const text = composition.context.map((item) => item.text).join("\n");
  assert.doesNotMatch(
    text,
    /INVALIDATED_SUMMARY_MARKER|CROSS_PROJECT_SUMMARY_MARKER|CROSS_PROJECT_SOURCE_ID_SUMMARY_MARKER/u,
  );
  assert.equal(composition.contextSourceSummary.counts.conversationSummaries, 4);
});

harness.test("memory", "approved Sovereign Learning abstractions are mapped into project context without raw sources", async () => {
  const sourceId = "learning-source:approved";
  const approvedRules = await loadApprovedConversationLearningRules({
    repository: {
      isAvailable: () => true,
      listSources: async () => [{ id: sourceId, status: "active", trustScore: 0.95 }],
      listRules: async () => [{
        id: "learning-rule:approved",
        sourceId,
        status: "approved",
        family: "pacing",
        dimension: "scene_pressure",
        statement: "Escalate pressure through observable consequences.",
        recipe: {
          when: "a scene stalls",
          operation: "introduce a concrete consequence",
          constraint: "preserve approved Canon",
          evaluate: "the decision changes the next beat",
        },
        confidence: 0.9,
        abstractionScore: 0.9,
        conflictKey: null,
        revision: 3,
      }],
      getProfile: async () => null,
    },
    projectId: "learning-project",
    taskType: "chapter.continue",
  });
  assert.deepEqual(approvedRules.map((rule) => rule.id), ["learning-rule:approved"]);
  assert.match(approvedRules[0].rule, /observable consequences/u);
  assert.equal(JSON.stringify(approvedRules).includes("raw source"), false);
});

harness.test("memory", "assistant chat remains non-canonical and summaries invalidate on Canon change", async () => {
  const { repository, service, projectId, chapterId } = await setup("project-invalidation");
  const session = await service.createSession({ projectId });
  const assistant = await service.appendMessage({
    projectId,
    sessionId: session.id,
    role: "assistant",
    content: "UNAPPROVED_ASSISTANT_CANDIDATE",
  });
  await service.upsertSummary({
    projectId,
    sessionId: session.id,
    sourceMessageIds: [assistant.id],
    content: "ROLLING_SUMMARY",
    canonRevisionDigest: "old-canon-digest",
  });
  const invalidated = await service.invalidateSummariesForCanonChange(projectId, "new-canon-digest");
  assert.equal(invalidated.length, 1);
  const chapterRecord = await repository.get("chapters", chapterId);
  assert.equal(chapterRecord.content, "Canonical opening.");
  assert.equal((await repository.get("conversationSessions", session.id)).summaryDigest, null);
});

harness.test("security", "project/session/user repository boundaries fail closed", async () => {
  const repositoryA = new MemoryNovelRepository();
  const repositoryB = new MemoryNovelRepository();
  const a = await setup("project-scope-a", repositoryA);
  const b = await setup("project-scope-b", repositoryA);
  const session = await a.service.createSession({ projectId: a.projectId });
  await a.service.appendMessage({ projectId: a.projectId, sessionId: session.id, role: "user", content: "A only" });
  await expectErrorCode(
    () => b.service.listMessages(b.projectId, session.id),
    "CONVERSATION_SESSION_SCOPE_MISMATCH",
  );
  const isolatedUser = new ConversationRepositoryService(repositoryB);
  await repositoryB.put("projects", project(a.projectId));
  assert.deepEqual(await isolatedUser.listSessions(a.projectId), []);
});

harness.test("security", "raw chain-of-thought, system prompts and credentials are not storable", async () => {
  const { service, projectId } = await setup("project-security");
  const session = await service.createSession({ projectId });
  for (const content of [
    "raw chain-of-thought: hidden steps",
    "system_prompt: never retain this",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
    "github token ghp_abcdefghijklmnopqrstuvwxyz123456",
  ]) {
    await assert.rejects(
      () => service.appendMessage({ projectId, sessionId: session.id, role: "user", content }),
      (error) => /(?:HIDDEN_REASONING|CREDENTIAL)/u.test(String(error?.code ?? error?.message)),
    );
  }
  assert.equal((await service.listMessages(projectId, session.id)).length, 0);
});

harness.test("security", "actor context withholds author-only and evaluator-only material", async () => {
  const { repository, projectId } = await setup("project-audience");
  const composition = await composeProjectContext({
    repository,
    taskType: "chapter.continue",
    projectId,
    privacyLevel: "device_only",
    audience: "actor",
    supplementalContext: [
      { id: "actor", kind: "canon", text: "ACTOR_VISIBLE", visibility: "actor", privacyLevel: "device_only", approved: true },
      { id: "author", kind: "author-note", text: "AUTHOR_ONLY_SECRET", visibility: "author-only", privacyLevel: "author_only", approved: true },
      { id: "evaluator", kind: "evaluator-note", text: "EVALUATOR_ONLY_SECRET", visibility: "evaluator", privacyLevel: "device_only", approved: true },
    ],
  });
  const actorInput = composition.context
    .filter((item) => item.approved && item.visibility !== "evaluator" && item.visibility !== "author-only")
    .map((item) => item.text)
    .join("\n");
  assert.match(actorInput, /ACTOR_VISIBLE/u);
  assert.doesNotMatch(actorInput, /AUTHOR_ONLY_SECRET|EVALUATOR_ONLY_SECRET/u);
});

harness.test("security", "tool receipts and backup payloads contain no credential fields", async () => {
  const { repository, service, projectId } = await setup("project-safe-export");
  const session = await service.createSession({ projectId });
  const message = await service.appendMessage({ projectId, sessionId: session.id, role: "user", content: "Safe request" });
  const contextDigest = await sha256Hex("safe-context");
  const modelDigest = await sha256Hex("fixture-model");
  await service.saveToolInvocation({
    projectId,
    sessionId: session.id,
    messageId: message.id,
    taskId: crypto.randomUUID(),
    toolId: CONVERSATION_PLANNER_TOOL_ALLOWLIST[0],
    taskType: "chapter.continue",
    inputDigest: await sha256Hex("safe-input"),
    contextDigest,
    status: "completed",
    actualExecutor: "browser-ai",
    modelId: "fixture-model",
    modelDigest,
    executionReceipt: {
      receiptId: crypto.randomUUID(),
      modelId: "fixture-model",
      modelDigest,
      providerRunId: "fixture-local-run",
      contextDigest,
      outputDigest: await sha256Hex("safe-output"),
      externalRequest: false,
      dataLeftDevice: false,
      latencyMs: 1,
    },
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
  });
  const { payload } = await createProjectBackup(repository, projectId, "full");
  assertNoForbiddenKeys(payload, new Set([
    "authorization", "cookie", "accesstoken", "refreshtoken", "apikey",
    "pairingsecret", "systemprompt", "chainofthought", "rawreasoning",
  ]));
});

harness.test("security", "ConversationAttachment warnings accept safe diagnostics and reject credential-bearing text", async () => {
  const state = await setup(`project-warning-security:${crypto.randomUUID()}`);
  const session = await state.service.createSession({ projectId: state.projectId });
  const attachmentRecord = {
    ...record(`attachment:${crypto.randomUUID()}`, state.projectId),
    conversationSchemaVersion: "conversation-attachment-v1",
    sessionId: session.id,
    displayName: "manuscript.docx",
    safeSourceAlias: "manuscript.docx",
    format: "docx",
    byteLength: 2_048,
    contentHash: await sha256Hex("warning-security-content"),
    rightsBasis: "user_owned",
    rightsEvidenceHash: await sha256Hex("warning-security-rights"),
    localAnalysisOnly: true,
    rawContentRetained: false,
    parsingStatus: "completed",
  };
  const safe = await state.repository.put("conversationAttachments", {
    ...attachmentRecord,
    warnings: ["Mammoth converted an unsupported style to plain text."],
  });
  assert.deepEqual(safe.warnings, ["Mammoth converted an unsupported style to plain text."]);
  await expectErrorCode(
    () => state.repository.put("conversationAttachments", {
      ...attachmentRecord,
      id: `attachment:${crypto.randomUUID()}`,
      warnings: ["Authorization: Bearer abcdefghijklmnop"],
    }),
    "CONVERSATION_PRIVATE_DATA_NOT_ALLOWED",
  );
});

harness.test("security", "fresh ConversationAttachments require and bind explicit rights confirmation", async () => {
  const state = await setup(`project-attachment-rights:${crypto.randomUUID()}`);
  const session = await state.service.createSession({ projectId: state.projectId });
  const file = new File(
    ["Locally supplied reference material."],
    "owned-reference.txt",
    { type: "text/plain" },
  );
  await expectErrorCode(
    () => createConversationAttachmentRecord({
      projectId: state.projectId,
      sessionId: session.id,
      file,
      rightsBasis: "user_supplied_local_analysis",
      rightsEvidence: "composer-local-analysis-only",
      userConfirmedRights: false,
    }),
    "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED",
  );
  assert.equal((await state.repository.list("conversationAttachments", state.projectId)).length, 0);

  const created = await createConversationAttachmentRecord({
    projectId: state.projectId,
    sessionId: session.id,
    file,
    rightsBasis: "user_supplied_local_analysis",
    rightsEvidence: "composer-local-analysis-only",
    userConfirmedRights: true,
  });
  assert.equal(created.userConfirmedRights, true);
  assert.equal(
    created.rightsConfirmationSchemaVersion,
    CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_SCHEMA_VERSION,
  );
  assert.equal(created.rightsEvidenceHash, await sha256Hex("composer-local-analysis-only"));
  const stored = await state.repository.put("conversationAttachments", created);
  const completed = await state.repository.put("conversationAttachments", {
    ...stored,
    parsingStatus: "completed",
  }, stored.revision);
  const boundSource = await selectedAttachmentModelContextSource(completed);
  for (const mutation of [
    { rightsBasis: "owned_by_user" },
    { rightsEvidenceHash: await sha256Hex("different-rights-evidence") },
    { userConfirmedRights: undefined },
    { rightsConfirmationSchemaVersion: undefined },
  ]) {
    const mutated = { ...completed, ...mutation };
    const mutatedSource = await selectedAttachmentModelContextSource(mutated);
    assert.notEqual(mutatedSource.sourceRevisionDigest, boundSource.sourceRevisionDigest);
  }

  const selectedAttachment = {
    attachmentId: completed.id,
    recordRevision: completed.revision,
    summary: "A sanitized attachment summary for model context.",
    contentDigest: completed.contentHash,
    modelContextSource: boundSource,
  };
  const composition = await composeProjectContext({
    repository: state.repository,
    taskType: "chapter.continue",
    projectId: state.projectId,
    privacyLevel: "device_only",
    audience: "actor",
    conversationSessionId: session.id,
    selectedAttachmentSummaries: [selectedAttachment],
  });
  const attachmentContext = composition.context.find((item) => (
    item.id === `conversation-attachment-summary:${completed.id}`
  ));
  assert(attachmentContext);
  assert.deepEqual(attachmentContext.modelContextSource, boundSource);
  const { payload: rightsBackup } = await createProjectBackup(
    state.repository,
    state.projectId,
    "full",
  );
  const backedUpAttachment = rightsBackup.records.conversationAttachments.find(
    (attachment) => attachment.id === completed.id,
  );
  assert(backedUpAttachment);
  assert.equal(backedUpAttachment.userConfirmedRights, true);
  assert.equal(
    backedUpAttachment.rightsConfirmationSchemaVersion,
    CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_SCHEMA_VERSION,
  );
  assert.equal((await validateBackupPayload(rightsBackup)).valid, true);
  const tamperedSourceRevisionDigest = await sha256Hex("tampered-source-revision");
  await expectErrorCode(
    () => composeProjectContext({
      repository: state.repository,
      taskType: "chapter.continue",
      projectId: state.projectId,
      privacyLevel: "device_only",
      audience: "actor",
      conversationSessionId: session.id,
      selectedAttachmentSummaries: [{
        ...selectedAttachment,
        modelContextSource: {
          ...boundSource,
          sourceRevisionDigest: tamperedSourceRevisionDigest,
        },
      }],
    }),
    "CLOSED_AI_ATTACHMENT_SOURCE_INVALID",
  );

  await expectErrorCode(
    () => state.repository.put("conversationAttachments", {
      ...created,
      id: `attachment:${crypto.randomUUID()}`,
      userConfirmedRights: undefined,
    }),
    "CONVERSATION_ATTACHMENT_RECORD_INVALID",
  );
  await expectErrorCode(
    () => state.repository.put("conversationAttachments", {
      ...created,
      id: `attachment:${crypto.randomUUID()}`,
      rightsConfirmationSchemaVersion: "conversation-attachment-rights-confirmation-v0",
    }),
    "CONVERSATION_ATTACHMENT_RECORD_INVALID",
  );
});

harness.test("backup", "conversation metadata participates in semantic-hash validation", async () => {
  const { repository, service, projectId } = await setup("project-backup");
  const session = await service.createSession({ projectId, title: "Back me up" });
  await service.appendMessage({ projectId, sessionId: session.id, role: "user", content: "Persisted conversation" });
  const { payload } = await createProjectBackup(repository, projectId, "full");
  const valid = await validateBackupPayload(payload);
  assert.equal(valid.valid, true, valid.valid ? "" : valid.reason);
  assert.equal(payload.records.conversationSessions.length, 1);
  assert.equal(payload.records.conversationMessages.length, 1);
  assert(!JSON.stringify(payload).includes("rawAttachmentBytes"));
  const tampered = structuredClone(payload);
  tampered.records.conversationMessages[0].content = "tampered";
  const invalid = await validateBackupPayload(tampered);
  assert.equal(invalid.valid, false);
  assert([
    "BACKUP_HASH_MISMATCH",
    "BACKUP_CONVERSATION_MESSAGE_DIGEST_MISMATCH",
  ].includes(invalid.reason));
});

harness.test("backup", "full backup restores approved Sovereign Learning and rejects semantic tampering", async () => {
  const { repository, projectId } = await setup(`project-learning-backup:${crypto.randomUUID()}`);
  const learning = new MemorySovereignLearningRepository();
  const ingested = await ingestLearningSource(learning, {
    projectId,
    title: "Owned narrative notes",
    author: "Project author",
    sourceReference: "local-attachment:safe-alias",
    sourceKind: "personal_note",
    rightsBasis: "owned_by_user",
    rightsEvidence: "owner-attested",
    userConfirmedRights: true,
    content: [
      "Open each scene with a concrete sensory disturbance and a visible decision.",
      "Escalate conflict through consequences, then close on an unresolved relationship shift.",
      "Keep dialogue anchored to character goals and vary paragraph rhythm after each reveal.",
    ].join(" ").repeat(8),
  });
  assert(ingested.rules.length > 0);
  await approveLearningRule(learning, projectId, ingested.rules[0].id);
  const { payload } = await createProjectBackup(repository, projectId, "full", {
    sovereignLearningRepository: learning,
  });
  assert(payload.sovereignLearning);
  assert(payload.sovereignLearning.rules.some((rule) => rule.status === "approved"));
  assert.equal((await validateBackupPayload(payload)).valid, true);

  await learning.clearProject(projectId);
  assert.equal((await learning.listRules(projectId)).length, 0);
  const restoredId = await restoreProjectBackup(repository, payload, "replace", projectId, {
    sovereignLearningRepository: learning,
  });
  assert.equal(restoredId, projectId);
  const restoredRules = await learning.listRules(projectId);
  assert(restoredRules.some((rule) => rule.status === "approved"));
  assert(payload.sovereignLearning.sources.every((source) => source.rawContentRetained === false));
  assert(payload.sovereignLearning.sources.every((source) => !("content" in source)));

  const tampered = structuredClone(payload);
  tampered.sovereignLearning.rules[0].statement = "tampered rule";
  const invalid = await validateBackupPayload(tampered);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.reason, "LEARNING_BACKUP_HASH_MISMATCH");
  const crossProject = structuredClone(payload);
  crossProject.sovereignLearning.rules[0].projectId = "other-project";
  const crossProjectResult = await validateBackupPayload(crossProject);
  assert.equal(crossProjectResult.valid, false);
  assert.equal(crossProjectResult.reason, "LEARNING_BACKUP_RECORD_INVALID");
  const rawSmuggling = structuredClone(payload);
  rawSmuggling.sovereignLearning.sources[0].originalText = "raw document must not survive";
  const rawSmugglingResult = await validateBackupPayload(rawSmuggling);
  assert.equal(rawSmugglingResult.valid, false);
  assert.equal(rawSmugglingResult.reason, "LEARNING_BACKUP_SENSITIVE_DATA_NOT_ALLOWED");
});

harness.test("backup", "conversation approval safety backup binds the active learning repository", async () => {
  const state = await setupApproval({
    projectId: `project-learning-safety:${crypto.randomUUID()}`,
  });
  const learning = new MemorySovereignLearningRepository();
  const ingested = await ingestLearningSource(learning, {
    projectId: state.projectId,
    title: "Safety backup learning rules",
    author: null,
    sourceReference: "local-attachment:safety-source",
    sourceKind: "personal_note",
    rightsBasis: "owned_by_user",
    rightsEvidence: "owner-attested",
    userConfirmedRights: true,
    content: "Use observable consequences to escalate pressure, preserve viewpoint, and close scenes with a relationship shift. ".repeat(10),
  });
  await approveLearningRule(learning, state.projectId, ingested.rules[0].id);
  const boundService = new ConversationRepositoryService(state.repository, learning);
  await boundService.approveChapterArtifact(state.approvalInput);
  const backups = await state.repository.list("backups", state.projectId);
  assert.equal(backups.length, 1);
  assert(backups[0].sovereignLearningSnapshot.rules.some((rule) => rule.status === "approved"));
});

harness.test("backup", "cross-database restore failure compensates Canon and learning to the pre-restore state", async () => {
  class RestoreFaultLearningRepository extends MemorySovereignLearningRepository {
    failNextRestore = false;
    async commit(input) {
      if (this.failNextRestore && input.remove && input.rules?.length) {
        this.failNextRestore = false;
        throw Object.assign(new Error("learning restore fault"), {
          code: "TEST_LEARNING_RESTORE_FAULT",
        });
      }
      return super.commit(input);
    }
  }
  const { repository, projectId, chapterId } = await setup(`project-restore-compensation:${crypto.randomUUID()}`);
  const learning = new RestoreFaultLearningRepository();
  const ingest = (label) => ingestLearningSource(learning, {
    projectId,
    title: `Owned rules ${label}`,
    author: null,
    sourceReference: `local-attachment:${label}`,
    sourceKind: "personal_note",
    rightsBasis: "owned_by_user",
    rightsEvidence: `owner-attested:${label}`,
    userConfirmedRights: true,
    content: `Use ${label} consequences to move scenes, preserve viewpoint, and end with changed relationships. `.repeat(10),
  });
  const originalLearning = await ingest("original");
  await approveLearningRule(learning, projectId, originalLearning.rules[0].id);
  const { payload } = await createProjectBackup(repository, projectId, "full", {
    sovereignLearningRepository: learning,
  });

  const chapterBeforeMutation = await repository.get("chapters", chapterId);
  await repository.put("chapters", {
    ...chapterBeforeMutation,
    content: "Pre-restore local mutation must survive a failed restore.",
  }, chapterBeforeMutation.revision);
  await learning.clearProject(projectId);
  const replacementLearning = await ingest("replacement");
  await approveLearningRule(learning, projectId, replacementLearning.rules[0].id);
  const replacementRules = await learning.listRules(projectId);

  learning.failNextRestore = true;
  await assert.rejects(
    () => restoreProjectBackup(repository, payload, "replace", projectId, {
      sovereignLearningRepository: learning,
    }),
    (error) => error.code === "TEST_LEARNING_RESTORE_FAULT",
  );
  assert.equal(
    (await repository.get("chapters", chapterId)).content,
    "Pre-restore local mutation must survive a failed restore.",
  );
  assert.deepEqual(await learning.listRules(projectId), replacementRules);
});

harness.test("backup", "backup filters only ephemeral Closed-Agent candidate IDs and restored candidates remain approvable", async () => {
  const state = await setupApproval({
    projectId: `project-backup-candidate:${crypto.randomUUID()}`,
    candidateContent: "Restored candidate content is approved without a Closed-Agent cache.",
  });
  const ephemeralCandidateId = `closed-agent-candidate:${crypto.randomUUID()}`;
  const currentMessage = await state.repository.get("conversationMessages", state.message.id);
  assert(currentMessage);
  await state.service.updateMessageStatus({
    projectId: state.projectId,
    sessionId: state.session.id,
    messageId: currentMessage.id,
    expectedRevision: currentMessage.revision,
    status: currentMessage.status,
    candidateIds: [ephemeralCandidateId, state.artifact.id],
  });

  const { payload } = await createProjectBackup(state.repository, state.projectId, "full");
  const backupMessage = payload.records.conversationMessages
    .find((message) => message.id === state.message.id);
  assert(backupMessage);
  assert.deepEqual(backupMessage.candidateIds, [state.artifact.id]);
  assert(!JSON.stringify(payload).includes(ephemeralCandidateId));
  const validation = await validateBackupPayload(payload);
  assert.equal(validation.valid, true, validation.valid ? "" : validation.reason);

  const restoredRepository = new MemoryNovelRepository();
  const restoredProjectId = await restoredRepository.importProject(payload.records, "copy");
  const restoredService = new ConversationRepositoryService(restoredRepository);
  const [restoredSession] = await restoredRepository.list("conversationSessions", restoredProjectId);
  const [restoredMessage] = await restoredRepository.list("conversationMessages", restoredProjectId);
  const [restoredArtifact] = await restoredRepository.list("conversationArtifacts", restoredProjectId);
  const [restoredInvocation] = await restoredRepository.list("conversationToolInvocations", restoredProjectId);
  assert(restoredSession && restoredMessage && restoredArtifact && restoredInvocation);
  assert.deepEqual(restoredMessage.candidateIds, [restoredArtifact.id]);
  assert.equal(restoredArtifact.status, "candidate");
  assert.equal(restoredInvocation.status, "completed");
  assert(restoredInvocation.executionReceipt);
  assert.equal(restoredInvocation.executionReceipt.outputDigest, await sha256Hex(state.artifact.candidateContent));

  const approved = await restoredService.approveChapterArtifact({
    operationId: `restored-approval:${restoredArtifact.id}`,
    idempotencyKey: `restored-approval:${restoredArtifact.id}:${restoredArtifact.candidateDigest}`,
    projectId: restoredProjectId,
    sessionId: restoredSession.id,
    artifactId: restoredArtifact.id,
    sourceMessageId: restoredMessage.id,
    candidateDigest: restoredArtifact.candidateDigest,
    targetRecordId: restoredArtifact.targetRecordId,
    expectedSessionRevision: restoredSession.revision,
    expectedArtifactRevision: restoredArtifact.revision,
    expectedSourceMessageRevision: restoredMessage.revision,
    expectedSourceRevision: restoredArtifact.sourceRevision,
    applicationMode: "append",
  });
  assert.equal(approved.replayed, false);
  assert.equal(approved.artifact.status, "approved");
  assert.match(approved.canonicalRecord.content, /Restored candidate content is approved/u);
  assert.equal((await restoredRepository.list("conversationApprovalTransactions", restoredProjectId)).length, 1);
});

harness.test("backup", "safe attachment warnings survive backup validation and copy restore", async () => {
  const state = await setup(`project-attachment-warnings:${crypto.randomUUID()}`);
  const session = await state.service.createSession({ projectId: state.projectId });
  const attachmentId = `attachment:${crypto.randomUUID()}`;
  const warnings = [
    "Mammoth converted an unsupported style to plain text.",
    "A remote image relationship was removed without loading it.",
  ];
  const attachment = await state.repository.put("conversationAttachments", {
    ...record(attachmentId, state.projectId),
    conversationSchemaVersion: "conversation-attachment-v1",
    sessionId: session.id,
    displayName: "owned-manuscript.docx",
    safeSourceAlias: "owned-manuscript.docx",
    format: "docx",
    byteLength: 4_096,
    contentHash: await sha256Hex("owned-manuscript-docx"),
    rightsBasis: "user_owned",
    rightsEvidenceHash: await sha256Hex("user-owned-evidence"),
    localAnalysisOnly: true,
    rawContentRetained: false,
    parsingStatus: "completed",
    warnings,
  });
  await state.service.appendMessage({
    projectId: state.projectId,
    sessionId: session.id,
    role: "user",
    content: "Analyze my attached manuscript locally.",
    attachmentIds: [attachment.id],
  });

  const { payload } = await createProjectBackup(state.repository, state.projectId, "full");
  const validation = await validateBackupPayload(payload);
  assert.equal(validation.valid, true, validation.valid ? "" : validation.reason);
  assert.deepEqual(payload.records.conversationAttachments[0].warnings, warnings);
  const restoredRepository = new MemoryNovelRepository();
  const restoredProjectId = await restoredRepository.importProject(payload.records, "copy");
  const [restoredAttachment] = await restoredRepository.list("conversationAttachments", restoredProjectId);
  assert(restoredAttachment);
  assert.deepEqual(restoredAttachment.warnings, warnings);
  assert.equal(restoredAttachment.rawContentRetained, false);
  assert.equal(restoredAttachment.localAnalysisOnly, true);
});

harness.test("backup", "copy restore supersedes non-portable RPG candidates while same-project restore preserves them", async () => {
  const state = await setupRpgConversationApproval({
    label: `backup-rpg-portability:${crypto.randomUUID()}`,
  });
  const { payload } = await createProjectBackup(
    state.repository,
    state.project.id,
    "full",
    { sovereignLearningRepository: new MemorySovereignLearningRepository() },
  );

  const sameProjectRepository = new MemoryNovelRepository();
  await restoreProjectBackup(
    sameProjectRepository,
    payload,
    "replace",
    state.project.id,
    { sovereignLearningRepository: new MemorySovereignLearningRepository() },
  );
  const sameProjectArtifact = await sameProjectRepository.get(
    "conversationArtifacts",
    state.artifact.id,
  );
  assert(sameProjectArtifact);
  assert.equal(sameProjectArtifact.status, "candidate");
  assert.equal(sameProjectArtifact.candidateContent, state.artifact.candidateContent);

  const copiedRepository = new MemoryNovelRepository();
  const copiedProjectId = await restoreProjectBackup(
    copiedRepository,
    payload,
    "copy",
    undefined,
    { sovereignLearningRepository: new MemorySovereignLearningRepository() },
  );
  const [copiedArtifact] = await copiedRepository.list(
    "conversationArtifacts",
    copiedProjectId,
  );
  const [copiedMessage] = await copiedRepository.list(
    "conversationMessages",
    copiedProjectId,
  );
  assert(copiedArtifact && copiedMessage);
  assert.equal(copiedArtifact.artifactType, "rpg");
  assert.equal(copiedArtifact.status, "superseded");
  assert(copiedMessage.candidateIds.includes(copiedArtifact.id));
});

async function assertRpgConversationApprovalCommit(repository, label) {
  const state = await setupRpgConversationApproval({ repository, label });
  const first = await repository.acceptChoiceTransaction(state.input);
  assert.equal(first.replayed, false);
  assert.equal(first.chapter.revision, state.chapter.revision + 1);
  assert.match(first.chapter.content, /opens the gate/u);
  assert.equal(first.storyState.revision, state.storyState.revision + 1);
  assert.equal(first.acceptedChoice.candidateId, state.candidate.id);
  assert.equal(first.conversationArtifact?.id, state.artifact.id);
  assert.equal(first.conversationArtifact?.status, "approved");
  assert.equal(first.conversationArtifact?.approvedRevision, first.chapter.revision);
  assert.equal(first.conversationApprovalTransaction?.artifactId, state.artifact.id);
  assert.equal(first.conversationApprovalTransaction?.canonicalMutationCount, 1);
  assert.equal(first.conversationApprovalTransaction?.commitMode, "external_canonical");
  assert.equal(first.conversationApprovalTransaction?.externalCommitId, state.input.operationId);
  assert.equal((await repository.list("acceptedChoices", state.project.id)).length, 1);
  assert.equal((await repository.list("conversationApprovalTransactions", state.project.id)).length, 1);
  const invalidatedSummary = await repository.get("conversationSummaries", state.summary.id);
  assert(invalidatedSummary.invalidatedAt);

  const replay = await repository.acceptChoiceTransaction(state.input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.chapter.revision, first.chapter.revision);
  assert.equal(replay.storyState.revision, first.storyState.revision);
  assert.equal(replay.acceptedChoice.id, first.acceptedChoice.id);
  assert.equal(replay.conversationArtifact?.id, first.conversationArtifact?.id);
  assert.equal(
    replay.conversationApprovalTransaction?.id,
    first.conversationApprovalTransaction?.id,
  );
  assert.equal((await repository.list("acceptedChoices", state.project.id)).length, 1);
  assert.equal((await repository.list("conversationApprovalTransactions", state.project.id)).length, 1);
  await assert.rejects(
    () => repository.acceptChoiceTransaction({
      ...state.input,
      conversationApproval: {
        ...state.input.conversationApproval,
        candidateDigest: state.input.conversationApproval.candidateDigest === "f".repeat(64)
          ? "e".repeat(64)
          : "f".repeat(64),
      },
    }),
    errorWithCode("IDEMPOTENCY_PAYLOAD_MISMATCH"),
  );
}

harness.test("rpg", "Memory RPG acceptance atomically approves its Conversation artifact and exact-replays", async () => {
  await assertRpgConversationApprovalCommit(
    new MemoryNovelRepository(),
    `memory-rpg-conversation:${crypto.randomUUID()}`,
  );
});

harness.test("rpg", "fake-indexeddb RPG acceptance atomically approves its Conversation artifact and exact-replays", async () => {
  await assertRpgConversationApprovalCommit(
    new IndexedDbNovelRepository(),
    `indexeddb-rpg-conversation:${crypto.randomUUID()}`,
  );
});

harness.test("rpg", "RPG Conversation approval fault rolls every Canon, choice, artifact, ledger, and summary write back", async () => {
  const repository = new MemoryNovelRepository({
    approvalFaultInjector(point) {
      if (point === "after:conversationApprovalTransactions") {
        throw new Error("RC6_RPG_CONVERSATION_APPROVAL_FAULT");
      }
    },
  });
  const state = await setupRpgConversationApproval({
    repository,
    label: `rollback-rpg-conversation:${crypto.randomUUID()}`,
  });
  const before = {
    chapter: await repository.get("chapters", state.chapter.id),
    storyState: await repository.get("storyStates", state.storyState.id),
    candidate: await repository.get("candidates", state.candidate.id),
    artifact: await repository.get("conversationArtifacts", state.artifact.id),
    summary: await repository.get("conversationSummaries", state.summary.id),
    session: await repository.get("conversationSessions", state.session.id),
  };
  await assert.rejects(
    () => repository.acceptChoiceTransaction(state.input),
    /RC6_RPG_CONVERSATION_APPROVAL_FAULT/u,
  );
  assert.deepEqual(await repository.get("chapters", state.chapter.id), before.chapter);
  assert.deepEqual(await repository.get("storyStates", state.storyState.id), before.storyState);
  assert.deepEqual(await repository.get("candidates", state.candidate.id), before.candidate);
  assert.deepEqual(await repository.get("conversationArtifacts", state.artifact.id), before.artifact);
  assert.deepEqual(await repository.get("conversationSummaries", state.summary.id), before.summary);
  assert.deepEqual(await repository.get("conversationSessions", state.session.id), before.session);
  assert.equal((await repository.list("acceptedChoices", state.project.id)).length, 0);
  assert.equal((await repository.list("storyBranches", state.project.id)).length, 0);
  assert.equal((await repository.list("approvalTransactions", state.project.id)).length, 0);
  assert.equal((await repository.list("idempotencyRecords", state.project.id)).length, 0);
  assert.equal((await repository.list("conversationApprovalTransactions", state.project.id)).length, 0);
});

function storyWithParagraphs(paragraphCount, charactersPerParagraph) {
  return Array.from({ length: paragraphCount }, (_, index) => {
    const sentence = `第${index + 1}段，夜雨敲著窗紙，明檀聽見廊下腳步逼近。她沒有退，只把燈芯壓低，問來人究竟替誰送信。`;
    return `${sentence}${"局勢在沉默裡繼續改變，眾人的目光都落向門縫外那道影子。".repeat(Math.ceil(charactersPerParagraph / 32))}`;
  }).join("\n\n");
}

harness.test("rpg", "RPG story contract enforces 900–1,600 Chinese characters and 8–16 paragraphs", () => {
  const story = storyWithParagraphs(10, 82);
  const contract = validateRpgStoryTurnContract(story, "zh-TW");
  assert(contract.narrativeLength >= 900 && contract.narrativeLength <= 1_600);
  assert(contract.paragraphCount >= 8 && contract.paragraphCount <= 16);
  assert.throws(() => validateRpgStoryTurnContract(storyWithParagraphs(7, 100), "zh-TW"), /TOO_SHORT/u);
  assert.throws(() => validateRpgStoryTurnContract(storyWithParagraphs(17, 100), "zh-TW"), /TOO_LONG/u);
});

harness.test("rpg", "custom RPG action creates one candidate action without mutating Canon", () => {
  const snapshot = {
    storyBible: { protagonistIds: ["hero"] },
    characters: [{ id: "hero", name: "明檀" }],
    progression: readRpgProgression({
      protagonistStats: {},
      resources: {},
      worldFlags: { "rpg.runSeed": "rc6" },
      inventory: [],
      questStates: {},
      money: 1_200,
    }, "rc6", "adventure"),
    chapter: { title: "雪燈拍賣" },
    conflict: "青霞弟子守住入口",
  };
  const choice = buildRpgChatCustomAction({ snapshot, action: "我繞到屋頂偷聽交易" });
  assert.equal(choice.key, "custom");
  assert.match(`${choice.title} ${choice.description}`, /屋頂|偷聽/u);
  assert.equal(Object.hasOwn(choice, "canonicalMutationCount"), false);
});

await harness.run();
