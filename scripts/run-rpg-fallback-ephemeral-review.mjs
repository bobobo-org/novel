import assert from "node:assert/strict";
import {
  ClosedAICache,
  MemoryClosedAICacheRepository,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  ClosedAgentOS,
  MemoryClosedAgentStateRepository,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  MemoryVerifiableLedgerRepository,
  VerifiableLedger,
} from "../lib/novel-ai/verifiable-ledger/index.ts";
import { rpgLogicalTurnGenerationTaskId } from "../lib/novel-ai/conversation/rpg-logical-turn.ts";
import { createStudioClosedAgentToolRegistry } from "../lib/novel-ai/web/studio-closed-agent-tools.ts";

const DRAFT_MARKER = "EPHEMERAL_FALLBACK_DRAFT_X9K7";
const MODEL_DIGESTS = {
  "browser-ai": "b".repeat(64),
  "local-ollama": "c".repeat(64),
  "private-ai-hub": "d".repeat(64),
};

function runtimeTruth(id, ready) {
  return {
    installed: ready,
    configured: ready,
    reachable: ready,
    modelAvailable: ready,
    runtimeVerified: ready,
    generationVerified: ready,
    verificationSource: ready
      ? id === "local-ollama"
        ? "local-bridge-generation"
        : id === "browser-ai"
          ? "browser-runtime-generation"
          : "private-hub-generation"
      : "none",
    verifiedAt: ready ? "2026-08-30T00:00:00.000Z" : null,
  };
}

class EphemeralReviewBackend {
  constructor(id, ready, maximumComplexity) {
    this.id = id;
    this.ready = ready;
    this.maximumComplexity = maximumComplexity;
    this.content = "門外的雨忽然停了。周含河把濕透的證據攤在燈下，先讓同伴看清被竄改的字跡，再決定由自己引開追兵。眾人沒有立刻相信他，但那份代價讓原本僵住的合作重新開始；遠處第二道門也在此刻打開。";
  }

  async snapshot() {
    return {
      id: this.id,
      label: this.id,
      status: this.ready ? "ready" : "runtime_unavailable",
      runtimeTruth: runtimeTruth(this.id, this.ready),
      modelId: `${this.id}-ephemeral-test-model`,
      modelDigest: MODEL_DIGESTS[this.id],
      local: this.id !== "private-ai-hub",
      dataBoundary: this.id === "private-ai-hub" ? "private-infrastructure" : "device",
      maximumComplexity: this.maximumComplexity,
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: this.ready ? "ephemeral-test-ready" : "ephemeral-test-unavailable",
    };
  }

  async execute() {
    return {
      backendId: this.id,
      modelId: `${this.id}-ephemeral-test-model`,
      modelDigest: MODEL_DIGESTS[this.id],
      content: this.content,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 7,
    };
  }
}

function namespace(projectId) {
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
    promptProfileVersion: "rpg-fallback-review-ephemeral-test-v1",
    storyBibleRevision: "current",
    knowledgeScopeRevision: "current",
    privacyLevel: "device_only",
  };
}

function request(projectId, taskId, objective, ephemeralPrompt, validator) {
  return {
    taskId,
    namespace: namespace(projectId),
    taskType: "chapter.continue",
    objective,
    context: [],
    complexity: "standard",
    qualityMode: "balanced",
    browserComputePolicy: "quality-first",
    preferredBackend: "local-ollama",
    allowedToolIds: ["acceptance-checklist", "story-context-index"],
    permissionScopes: [
      "story:read",
      "story-bible:read",
      "candidate:write",
      "candidate:read",
      "evaluation:write",
      "character:read",
      "world:read",
    ],
    ephemeralPrompt,
    ...(validator ? {
      applicationValidationBindingDigest: "e".repeat(64),
      validateBeforePersistence: validator,
    } : {}),
  };
}

async function serializedLedger(ledgerRepository, ledgerId) {
  const blocks = await ledgerRepository.list(ledgerId);
  const contents = [];
  for (const block of blocks) {
    if (!block.contentRecordId) continue;
    const content = await ledgerRepository.getContent(block.contentRecordId, {
      ledgerId,
      projectId: block.projectId,
      namespaceDigest: block.namespaceDigest,
    });
    if (content) contents.push(content);
  }
  return JSON.stringify({ blocks, contents });
}

const cacheRepository = new MemoryClosedAICacheRepository();
const stateRepository = new MemoryClosedAgentStateRepository();
const ledgerRepository = new MemoryVerifiableLedgerRepository();
const localBackend = new EphemeralReviewBackend("local-ollama", true, "standard");
const os = new ClosedAgentOS({
  cache: new ClosedAICache({ repository: cacheRepository }),
  state: stateRepository,
  ledger: new VerifiableLedger({ repository: ledgerRepository }),
  tools: createStudioClosedAgentToolRegistry(),
  backends: [
    new EphemeralReviewBackend("browser-ai", false, "light"),
    localBackend,
    new EphemeralReviewBackend("private-ai-hub", false, "heavy"),
  ],
});

const projectId = "project-rpg-ephemeral-review";
const taskId = "task-rpg-ephemeral-review";
const rejectedProjectId = "project-rpg-ephemeral-review-rejected";
const rejectedTaskId = "task-rpg-ephemeral-review-rejected";

// P0: even an OS-evaluator-passing model echo is held in memory until the RPG
// application validator accepts it. The marker must be absent from every
// durable state/ledger/cache surface after rejection.
localBackend.content = `${DRAFT_MARKER} 門外的雨停了，這份內容故意回聲內部草稿。`;
let observedBeforePersistence = false;
await assert.rejects(
  () => os.execute(request(
    rejectedProjectId,
    rejectedTaskId,
    `${DRAFT_MARKER} 必須比較三份內部草稿；不得保存本句或任何草稿。`,
    true,
    async (candidate) => {
      observedBeforePersistence = true;
      assert.equal(candidate.content.includes(DRAFT_MARKER), true);
      const recordsDuringValidation = await stateRepository.list(rejectedProjectId);
      assert.equal(recordsDuringValidation.some((record) => record.kind === "candidate"), false);
      const blocksDuringValidation = await ledgerRepository.list(
        `closed-agent:${rejectedProjectId}:${rejectedTaskId}`,
      );
      assert.equal(blocksDuringValidation.some((block) => block.eventType === "candidate-generated"), false);
      throw Object.assign(new Error("echo rejected by RPG application gate"), {
        code: "RPG_FALLBACK_CLOSED_REVIEW_UNCHANGED",
      });
    },
  )),
  (error) => error?.code === "RPG_FALLBACK_CLOSED_REVIEW_UNCHANGED",
);
assert.equal(observedBeforePersistence, true);
const rejectedStorage = JSON.stringify({
  cache: await cacheRepository.list(),
  state: await stateRepository.list(rejectedProjectId),
  ledger: await serializedLedger(
    ledgerRepository,
    `closed-agent:${rejectedProjectId}:${rejectedTaskId}`,
  ),
});
assert.equal(rejectedStorage.includes(DRAFT_MARKER), false);
assert.equal(
  (await stateRepository.list(rejectedProjectId)).some((record) => record.kind === "candidate"),
  false,
);

localBackend.content = "門外的雨忽然停了。周含河把濕透的證據攤在燈下，先讓同伴看清被竄改的字跡，再決定由自己引開追兵。眾人沒有立刻相信他，但那份代價讓原本僵住的合作重新開始；遠處第二道門也在此刻打開。";
const result = await os.execute(request(
  projectId,
  taskId,
  `${DRAFT_MARKER} 必須比較三份內部草稿；不得保存本句或任何草稿。`,
  true,
  async (candidate) => {
    assert.equal(candidate.content.includes(DRAFT_MARKER), false);
    assert.equal(
      (await stateRepository.list(projectId)).some((record) => record.kind === "candidate"),
      false,
    );
  },
));

assert.equal(result.cache.planHit, false);
assert.equal(result.cache.candidateHit, false);
assert.equal(result.candidate.executionReceipt?.proofState, "verified");
assert.equal(result.candidate.executionReceipt?.taskId, taskId);
assert.equal(result.candidate.executionReceipt?.modelDigest, MODEL_DIGESTS["local-ollama"]);
assert.equal(result.candidate.content.includes(DRAFT_MARKER), false);

const ephemeralCache = await cacheRepository.list();
assert.equal(ephemeralCache.some((entry) => [
  "agent-plan",
  "tool-result",
  "exact",
  "semantic",
].includes(entry.layer)), false);

const persistentRecords = JSON.stringify({
  cache: ephemeralCache,
  state: await stateRepository.list(projectId),
  ledger: await serializedLedger(
    ledgerRepository,
    `closed-agent:${projectId}:${taskId}`,
  ),
  receipt: result.candidate.executionReceipt,
});
assert.equal(persistentRecords.includes(DRAFT_MARKER), false);

// Idempotency remains available from the verified final candidate. The
// ephemeral plan is reconstructed and verified in memory; replay must not
// recreate any prompt-derived cache record.
const replay = await os.execute(request(
  projectId,
  taskId,
  `${DRAFT_MARKER} 必須比較三份內部草稿；不得保存本句或任何草稿。`,
  true,
  async () => undefined,
));
assert.equal(replay.route.reasonCode, "IDEMPOTENT_REPLAY");
assert.equal(replay.candidate.id, result.candidate.id);
assert.equal(replay.candidate.contentDigest, result.candidate.contentDigest);
assert.equal(replay.plan.planDigest, result.plan.planDigest);
assert.equal(replay.cache.candidateHit, true);
assert.equal(replay.cache.planHit, false);
assert.deepEqual(
  replay.candidate.executionReceipt,
  result.candidate.executionReceipt,
);
const replayCache = await cacheRepository.list();
assert.equal(replayCache.some((entry) => [
  "agent-plan",
  "tool-result",
  "exact",
  "semantic",
].includes(entry.layer)), false);
assert.equal(JSON.stringify({
  cache: replayCache,
  state: await stateRepository.list(projectId),
  ledger: await serializedLedger(
    ledgerRepository,
    `closed-agent:${projectId}:${taskId}`,
  ),
  receipt: replay.candidate.executionReceipt,
}).includes(DRAFT_MARKER), false);

// A rejected or caller-aborted run is scoped to one deterministic attempt.
// A later attempt under the same logical RPG turn must reach the real OS seam
// instead of replaying the first task's integrity state forever.
const convergenceProjectId = "project-rpg-provider-attempt-convergence";
const convergenceLogicalTurnId = "message-rpg-provider-attempt-convergence";
const rejectedAttemptTaskId = await rpgLogicalTurnGenerationTaskId(
  convergenceLogicalTurnId,
  1,
);
const successfulAttemptTaskId = await rpgLogicalTurnGenerationTaskId(
  convergenceLogicalTurnId,
  2,
);
assert.notEqual(rejectedAttemptTaskId, successfulAttemptTaskId);
localBackend.content = "第一個候選故意不通過 RPG 應用層驗證，但仍由真正的 ClosedAgentOS 執行。";
await assert.rejects(
  () => os.execute(request(
    convergenceProjectId,
    rejectedAttemptTaskId,
    "第一個 RPG provider attempt。",
    true,
    async () => {
      throw Object.assign(new Error("first application candidate rejected"), {
        code: "RPG_AI_CONTINUATION_FRAGMENT_VISIBLE",
      });
    },
  )),
  (error) => error?.code === "RPG_AI_CONTINUATION_FRAGMENT_VISIBLE",
);
localBackend.content = "門外雨聲退遠，周含河把新驗出的封泥交給林澄。兩人沿著真正的搬運路追向河岸，既沒有重演失敗，也沒有讓第一份候選的狀態擋住下一次嘗試。";
const convergedAttempt = await os.execute(request(
  convergenceProjectId,
  successfulAttemptTaskId,
  "第二個 RPG provider attempt。",
  true,
  async () => undefined,
));
assert.equal(convergedAttempt.candidate.taskId, successfulAttemptTaskId);
assert.equal(
  convergedAttempt.candidate.executionReceipt?.taskId,
  successfulAttemptTaskId,
);
assert.equal(convergedAttempt.route.reasonCode === "IDEMPOTENT_REPLAY", false);
assert.equal(
  (await stateRepository.list(convergenceProjectId))
    .filter((record) => record.kind === "candidate").length,
  1,
);

// Opt-in boundary: an ordinary Closed AI request still populates the existing
// plan/tool/candidate caches. The privacy fix must not weaken general caching.
const normalProjectId = "project-rpg-standard-cache";
await os.execute(request(
  normalProjectId,
  "task-rpg-standard-cache",
  "請依照已核准資料繼續故事，必須保留人物動機與直接後果。",
  false,
));
const normalLayers = new Set((await cacheRepository.list()).map((entry) => entry.layer));
for (const layer of ["agent-plan", "tool-result", "exact", "semantic"]) {
  assert.equal(normalLayers.has(layer), true, `ordinary request keeps ${layer} cache`);
}

console.log("PASS rpg fallback review prompt remains ephemeral while final proof persists");
