import assert from "node:assert/strict";
import {
  ClosedAICache,
  MemoryClosedAICacheRepository,
  sha256Hex,
  stableStringify,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  ApprovalSigner,
  MemoryVerifiableLedgerRepository,
  VerifiableLedger,
} from "../lib/novel-ai/verifiable-ledger/index.ts";
import {
  ClosedAgentOS,
  MemoryClosedAgentStateRepository,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  assessRegenerationDistinctness,
  createExplicitRegenerationContract,
  explicitRegenerationInstruction,
} from "../lib/novel-ai/web/explicit-regeneration.ts";
import { runStudioClosedAI } from "../lib/novel-ai/web/studio-closed-ai.ts";

const mode = process.argv[2] || "all";
const tests = [];
const results = [];
const test = (name, run) => tests.push({ name, run });

function namespace() {
  return {
    tenantId: "tenant-rc3-1",
    userId: "author-rc3-1",
    projectId: "project-rc3-1",
    storyId: "story-rc3-1",
    canonId: "canon-rc3-1",
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "runtime-selection",
    modelDigest: "runtime-digest",
    promptProfileVersion: "studio-explicit-regeneration-v4",
    storyBibleRevision: "1",
    knowledgeScopeRevision: "1",
    privacyLevel: "device_only",
  };
}

function permissions() {
  return [
    "story:read",
    "story-bible:read",
    "candidate:write",
    "candidate:read",
    "evaluation:write",
    "character:read",
    "world:read",
  ];
}

class TestBackend {
  constructor(id, calls, status = "ready") {
    this.id = id;
    this.calls = calls;
    this.status = status;
  }

  async snapshot() {
    return {
      id: this.id,
      label: this.id,
      status: this.status,
      modelId: this.status === "ready" ? `${this.id}-model` : null,
      modelDigest: this.status === "ready" ? `${this.id}-digest` : null,
      local: this.id !== "private-ai-hub",
      dataBoundary: this.id === "private-ai-hub"
        ? "private-infrastructure"
        : "device",
      maximumComplexity: this.id === "browser-ai"
        ? "light"
        : this.id === "local-ollama"
          ? "standard"
          : "heavy",
      capabilities: ["text"],
      supportedTaskTypes: this.id === "browser-ai"
        ? ["story.summary"]
        : "all",
      detailCode: this.status === "ready" ? "mock-ready" : "mock-unavailable",
    };
  }

  async execute(input) {
    const regeneration = input.request.regeneration;
    this.calls.push({
      backendId: this.id,
      taskIdDigest: await sha256Hex(input.request.taskId),
      regenerationAttempt: regeneration?.regenerationAttempt ?? null,
      modelSeed: regeneration?.modelSeed ?? null,
      externalRequest: this.id === "private-ai-hub",
    });
    const content = regeneration
      ? regeneration.regenerationAttempt % 2 === 1
        ? "暴雨擊打藏書塔的銅窗，林澈改由密道潛入。他先切斷警鈴，再把假名冊留在守衛桌上，迫使追兵分成兩路，真正的證人則趁混亂離開北門。"
        : "晨霧封住河港，林澈沒有靠近倉庫。他說服船匠製造失火假象，利用疏散時交換證物，並讓對手誤以為線索已沉入航道，新的危機因此轉向議會。"
      : "鐘樓敲過午夜，林澈沿著石階追查失竊名冊。他避開巡邏，在暗門前找到帶泥的徽章，決定先保護證人，再回頭揭開城主隱瞞的交易。";
    return {
      backendId: this.id,
      modelId: `${this.id}-model`,
      modelDigest: `${this.id}-digest`,
      content,
      candidateOnly: true,
      dataLeftDevice: this.id === "private-ai-hub",
      externalRequest: this.id === "private-ai-hub",
      elapsedMs: 4,
      generatedTokenEvents: 5,
      outputCharacters: content.length,
    };
  }
}

function createOS(options = {}) {
  const calls = [];
  const os = new ClosedAgentOS({
    backends: [
      new TestBackend("browser-ai", calls, options.browserStatus ?? "ready"),
      new TestBackend("local-ollama", calls, options.localStatus ?? "ready"),
      new TestBackend("private-ai-hub", calls, options.privateStatus ?? "ready"),
    ],
    cache: new ClosedAICache({
      repository: new MemoryClosedAICacheRepository(),
      semanticThreshold: 0.2,
    }),
    ledger: new VerifiableLedger({
      repository: new MemoryVerifiableLedgerRepository(),
      signer: new ApprovalSigner(),
    }),
    state: new MemoryClosedAgentStateRepository(),
  });
  return { os, calls };
}

function baseRequest(taskId, overrides = {}) {
  return {
    taskId,
    namespace: namespace(),
    taskType: "chapter.continue",
    objective: "依照已核准的故事資料續寫下一個具體場景，供作者審核。",
    context: [],
    complexity: "standard",
    qualityMode: "fast",
    preferredBackend: "local-ollama",
    allowedToolIds: [],
    permissionScopes: permissions(),
    sourceChapterId: "chapter-1",
    sourceRevision: 1,
    ...overrides,
  };
}

async function createScenario() {
  const { os, calls } = createOS();
  const canon = {
    projectId: "project-rc3-1",
    chapterId: "chapter-1",
    revision: 1,
    content: "林澈在鐘樓下收到匿名信。",
  };
  const preGenerationCanonHash = await sha256Hex(stableStringify(canon));
  const first = await os.execute(baseRequest("task-initial"));
  const preRejectCanonHash = await sha256Hex(stableStringify(canon));
  await os.rejectCandidate(first.candidate.id);
  const contract = createExplicitRegenerationContract({
    previousCandidateDigest: first.candidate.contentDigest,
    regenerationAttempt: 1,
  });
  const second = await os.execute(baseRequest("task-regenerated", {
    objective: `${baseRequest("unused").objective}${explicitRegenerationInstruction(contract)}`,
    regeneration: contract,
  }));
  const preApprovalCanonHash = await sha256Hex(stableStringify(canon));
  const distinctness = await assessRegenerationDistinctness(
    first.candidate.content,
    second.candidate.content,
  );
  return {
    os,
    calls,
    canon,
    first,
    second,
    contract,
    distinctness,
    preGenerationCanonHash,
    preRejectCanonHash,
    preApprovalCanonHash,
  };
}

test("explicit-regeneration-distinct", async () => {
  const scenario = await createScenario();
  assert.equal(scenario.distinctness.normalizedDigestDifferent, true);
  assert.equal(scenario.distinctness.similarityMetric, "character_trigram_jaccard");
  assert.ok(scenario.distinctness.similarityScore < 0.95);
  assert.equal(scenario.distinctness.distinct, true);
  assert.notEqual(
    scenario.first.candidate.contentDigest,
    scenario.second.candidate.contentDigest,
  );
});

test("regeneration-cache-bypass", async () => {
  const scenario = await createScenario();
  assert.equal(scenario.second.cache.candidateHit, false);
  assert.equal(scenario.second.cache.bypassReason, "explicit_regeneration");
  assert.equal(scenario.second.candidate.regeneration?.cacheBypassed, true);
  assert.equal(scenario.second.candidate.regeneration?.previousContentReused, false);
  const stateBytes = JSON.stringify(await scenario.os.state.list(
    "project-rc3-1",
    "candidate",
  ));
  const ledgerBytes = JSON.stringify(
    await scenario.os.ledger.repository.list("closed-agent:project-rc3-1:task-regenerated"),
  );
  assert.equal(stateBytes.includes(scenario.contract.regenerationNonce), false);
  assert.equal(ledgerBytes.includes(scenario.contract.regenerationNonce), false);
});

test("regeneration-new-task-candidate", async () => {
  const scenario = await createScenario();
  assert.notEqual(scenario.first.task.id, scenario.second.task.id);
  assert.notEqual(scenario.first.candidate.id, scenario.second.candidate.id);
  assert.equal(scenario.second.candidate.regeneration?.newCandidate, true);
  assert.equal(scenario.second.candidate.regeneration?.nonceStored, false);
  assert.equal(scenario.second.candidate.regeneration?.regenerationAttempt, 1);
});

test("regeneration-canon-zero-before-approval", async () => {
  const scenario = await createScenario();
  assert.equal(scenario.first.candidate.canonicalMutationCount, 0);
  assert.equal(scenario.second.candidate.canonicalMutationCount, 0);
  assert.equal(scenario.preGenerationCanonHash, scenario.preRejectCanonHash);
  assert.equal(scenario.preGenerationCanonHash, scenario.preApprovalCanonHash);

  const approved = await scenario.os.approveCandidate({
    candidateId: scenario.second.candidate.id,
    approvedBy: "author-rc3-1",
    humanApproved: true,
    canonicalCommit: async ({ candidate, approvalId }) => {
      if (candidate.sourceRevision !== scenario.canon.revision) {
        throw Object.assign(new Error("stale revision"), {
          code: "STUDIO_SOURCE_REVISION_STALE",
        });
      }
      scenario.canon.content = `${scenario.canon.content}\n\n${candidate.content}`;
      scenario.canon.revision += 1;
      return { commitId: `canon:${approvalId}` };
    },
  });
  assert.equal(approved.canonicalMutationCount, 1);
  const reloaded = JSON.parse(JSON.stringify(scenario.canon));
  assert.equal(reloaded.revision, 2);
  assert.ok(reloaded.content.includes(scenario.second.candidate.content));
  await assert.rejects(
    () => scenario.os.approveCandidate({
      candidateId: scenario.second.candidate.id,
      approvedBy: "author-rc3-1",
      humanApproved: true,
    }),
    (error) => error?.code === "CLOSED_AGENT_APPROVAL_GATE_FAILED",
  );

  const stale = await scenario.os.execute(baseRequest("task-stale", {
    sourceRevision: 1,
  }));
  await assert.rejects(
    () => scenario.os.approveCandidate({
      candidateId: stale.candidate.id,
      approvedBy: "author-rc3-1",
      humanApproved: true,
      canonicalCommit: async ({ candidate }) => {
        if (candidate.sourceRevision !== scenario.canon.revision) {
          throw Object.assign(new Error("stale revision"), {
            code: "STUDIO_SOURCE_REVISION_STALE",
          });
        }
        throw new Error("unexpected canonical commit");
      },
    }),
    (error) => error?.code === "STUDIO_SOURCE_REVISION_STALE",
  );
  assert.equal(scenario.canon.revision, 2);
});

test("regeneration-no-external-fallback", async () => {
  const scenario = await createScenario();
  assert.equal(scenario.second.candidate.actualExecutor, "local-ollama");
  assert.equal(scenario.second.candidate.externalRequest, false);
  assert.equal(scenario.second.candidate.dataLeftDevice, false);
  assert.deepEqual(
    [...new Set(scenario.calls.map((call) => call.backendId))],
    ["local-ollama"],
  );

  const unavailable = createOS({ localStatus: "runtime_unavailable" });
  const contract = createExplicitRegenerationContract({
    previousCandidateDigest: "a".repeat(64),
    regenerationAttempt: 1,
  });
  await assert.rejects(
    () => unavailable.os.execute(baseRequest("task-no-fallback", {
      regeneration: contract,
    })),
    (error) =>
      error?.code === "CLOSED_AI_SELECTED_BACKEND_NOT_READY"
      && error?.fallbackAttempted === false,
  );
  assert.equal(unavailable.calls.length, 0);
});

test("studio-regeneration-locks-local-ollama", async () => {
  const contract = createExplicitRegenerationContract({
    previousCandidateDigest: "b".repeat(64),
    regenerationAttempt: 2,
  });
  const observedRequests = [];
  const execute = async (request) => {
    observedRequests.push(request);
    return {
      requestId: request.requestId,
      providerId: "local-ollama",
      modelId: "qwen2.5:3b",
      modelDigest: "c".repeat(64),
      content: "新的候選沿著上一版未解決的衝突前進，並以不同場景與後果展開。",
      candidateOnly: true,
      externalRequest: false,
      dataLeavesDevice: false,
      elapsedMs: 12,
      outputCharacters: 31,
      generatedTokenEvents: 8,
      executor: "local-ollama",
      provenance: {
        providerId: "local-ollama",
        modelId: "qwen2.5:3b",
        modelDigest: "c".repeat(64),
        privacyMode: "strict-local",
        reason: "explicit regeneration local lock",
        contextSources: [],
        externalRequest: false,
        dataLeavesDevice: false,
        fallbackChain: [],
        warnings: [],
      },
    };
  };
  const result = await runStudioClosedAI({
    projectId: "project-regeneration-route",
    task: "continue",
    input: "延續目前章節，但不要重複上一個候選。",
    browserComputePolicy: "browser-first",
    regeneration: contract,
  }, execute);

  assert.equal(observedRequests.length, 1);
  assert.equal(observedRequests[0].preferredProvider, "local-ollama");
  assert.equal(observedRequests[0].browserComputePolicy, "browser-first");
  assert.equal(observedRequests[0].generationOptions.seed, contract.modelSeed);
  assert.equal(result.provider, "local-ollama");
  assert.equal(result.externalRequest, false);
  assert.equal(result.dataLeftDevice, false);

  await assert.rejects(
    () => runStudioClosedAI({
      projectId: "project-regeneration-route",
      task: "continue",
      input: "延續目前章節，但不要重複上一個候選。",
      regeneration: contract,
    }, async (request) => ({
      ...(await execute(request)),
      providerId: "browser-ai",
      executor: "browser-task-model",
    })),
    (error) => error?.code === "CLOSED_AI_BOUNDARY_VIOLATION",
  );
});

const selected = mode === "all"
  ? tests
  : tests.filter((entry) => entry.name === mode);
if (selected.length === 0) {
  throw new Error(`Unknown RC3.1 regeneration test mode: ${mode}`);
}

for (const entry of selected) {
  const started = performance.now();
  try {
    await entry.run();
    results.push({
      name: entry.name,
      status: "PASS",
      elapsedMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    results.push({
      name: entry.name,
      status: "FAIL",
      code: String(error?.code || error?.name || "ERROR"),
      message: String(error?.message || error),
      elapsedMs: Math.round(performance.now() - started),
    });
  }
}

const failed = results.filter((entry) => entry.status === "FAIL").length;
console.log(JSON.stringify({
  suite: "P2.4B_RC3_1_EXPLICIT_REGENERATION",
  mode,
  pass: results.length - failed,
  fail: failed,
  blockingSkip: 0,
  results,
}, null, 2));
if (failed > 0) process.exitCode = 1;
