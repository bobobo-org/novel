import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CLOSED_AI_CACHE_LAYERS,
  ClosedAICache,
  MemoryClosedAICacheRepository,
  assertClosedAINamespace,
  sha256Hex,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  ControlledLearningOS,
  MemoryControlledLearningRepository,
} from "../lib/novel-ai/controlled-learning-os/index.ts";
import {
  ApprovalSigner,
  MemoryVerifiableLedgerRepository,
  VerifiableLedger,
  createMerkleProof,
  merkleRoot,
  verifyMerkleProof,
} from "../lib/novel-ai/verifiable-ledger/index.ts";
import {
  ClosedAgentOS,
  ClosedAgentToolRegistry,
  MemoryClosedAgentStateRepository,
  closedAgentQualityReasonCodes,
  selectClosedAIBackend,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  capabilityStatus,
  resolveCapabilityCatalog,
} from "../lib/novel-ai/capabilities/index.ts";
import {
  CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES,
  closedAgentBrowserRuntimeEvidence,
  closedAgentBrowserRuntimeEvidenceProgress,
  safeClosedAgentBrowserRuntimeCauseCode,
} from "../lib/novel-ai/closed-agent-os/safe-runtime-diagnostics.ts";
import { createExplicitRegenerationContract } from "../lib/novel-ai/web/explicit-regeneration.ts";

const tests = [];
const results = [];
const test = (name, run) => tests.push({ name, run });

function candidateCacheCount(entries) {
  return entries.filter((entry) => (
    entry.tags.includes("closed-agent-candidate")
    || entry.tags.includes("closed-agent-semantic-candidate")
  )).length;
}

test("quality failure reasons expose only safe deterministic codes", () => {
  assert.deepEqual(closedAgentQualityReasonCodes({
    qualityReasonCodes: [
      "QUALITY_CONTEXT_ANCHOR_MISSING",
      "QUALITY_CONTEXT_ANCHOR_MISSING",
      "CHARACTER_KNOWLEDGE_BOUNDARY_LEAK",
      "secret-value",
      42,
    ],
  }), [
    "QUALITY_CONTEXT_ANCHOR_MISSING",
    "CHARACTER_KNOWLEDGE_BOUNDARY_LEAK",
  ]);
  assert.deepEqual(closedAgentQualityReasonCodes({
    reasonCodes: ["QUALITY_WORLD_REGISTER_DRIFT"],
  }), ["QUALITY_WORLD_REGISTER_DRIFT"]);
  assert.deepEqual(closedAgentQualityReasonCodes({
    qualityReasonCodes: [
      "QUALITY_TASK_FORM_MISMATCH",
      "QUALITY_SCORE_BELOW_THRESHOLD",
      "QUALITY_OUTPUT_CREDENTIAL_LEAK",
      "QUALITY_OUTPUT_RAW_REASONING_LEAK",
      "QUALITY_OUTPUT_CONTROL_TOKEN",
      "QUALITY_OUTPUT_ROLE_ENVELOPE",
      "QUALITY_OUTPUT_INTERNAL_ENVELOPE",
      "QUALITY_OUTPUT_ATTACKER_FAKE",
      "QUALITY_CONTINUATION_INTERNAL_ENVELOPE",
      "QUALITY_CONTINUATION_ATTACKER_FAKE",
    ],
  }), [
    "QUALITY_TASK_FORM_MISMATCH",
    "QUALITY_SCORE_BELOW_THRESHOLD",
    "QUALITY_OUTPUT_CREDENTIAL_LEAK",
    "QUALITY_OUTPUT_RAW_REASONING_LEAK",
    "QUALITY_OUTPUT_CONTROL_TOKEN",
    "QUALITY_OUTPUT_ROLE_ENVELOPE",
    "QUALITY_OUTPUT_INTERNAL_ENVELOPE",
    "QUALITY_CONTINUATION_INTERNAL_ENVELOPE",
  ]);
  const evaluatorCodes = [
    "CANDIDATE_EMPTY",
    "CANDIDATE_CREDENTIAL_LEAK",
    "CANDIDATE_RAW_REASONING_LEAK",
    "CANDIDATE_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
    "CANDIDATE_SIMPLIFIED_CHINESE_REMAINS",
    "CANDIDATE_PROPER_NOUN_DRIFT",
    "CANDIDATE_ONLY_CONTRACT_MISSING",
    "CANDIDATE_DEVICE_BOUNDARY_VIOLATION",
    "ABC_CHOICES_INVALID_STRUCTURE",
  ];
  assert.deepEqual(closedAgentQualityReasonCodes({
    blockingCodes: [
      ...evaluatorCodes,
      "CANDIDATE_TRADITIONAL_CHINESE_INTEGRITY_INVALID_ATTACKER",
      "CANDIDATE_ATTACKER_FAKE",
      "private-output",
    ],
  }), evaluatorCodes);
  assert.deepEqual(closedAgentQualityReasonCodes({
    causeCode: "CLOSED_AGENT_TRADITIONAL_CHINESE_POLICY_INVALID",
    reasonCodes: [
      "CLOSED_AGENT_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
      "CLOSED_AGENT_PROVIDER_NORMALIZATION_NOT_DEFERRED",
      "CLOSED_AGENT_TRADITIONAL_CHINESE_POLICY_INVALID_ATTACKER",
    ],
  }), [
    "CLOSED_AGENT_TRADITIONAL_CHINESE_INTEGRITY_INVALID",
    "CLOSED_AGENT_PROVIDER_NORMALIZATION_NOT_DEFERRED",
    "CLOSED_AGENT_TRADITIONAL_CHINESE_POLICY_INVALID",
  ]);
  assert.deepEqual(closedAgentQualityReasonCodes({
    qualityReasonCodes: ["QUALITY_ATTACKER_FAKE"],
    reasonCodes: ["QUALITY_SECRET_VALUE"],
    blockingCodes: ["CANDIDATE_ATTACKER_FAKE"],
    causeCode: "BROWSER_WEBLLM_ATTACKER_FAKE",
  }), []);
  assert.deepEqual(closedAgentQualityReasonCodes({
    causeCode: "BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED",
  }), ["BROWSER_AI_MANDATORY_PROMPT_BUDGET_EXCEEDED"]);
  assert.deepEqual(closedAgentQualityReasonCodes({
    causeCode: "private prompt and output",
  }), []);
  for (const code of CLOSED_AGENT_BROWSER_RUNTIME_DIAGNOSTIC_CODES) {
    assert.equal(safeClosedAgentBrowserRuntimeCauseCode({ code }), code);
  }
  assert.equal(
    safeClosedAgentBrowserRuntimeCauseCode({ code: "BROWSER_WEBLLM_ATTACKER_FAKE" }),
    "BROWSER_WEBLLM_GENERATION_FAILED",
  );
  const runtimeEvidence = [{
    stage: "initial",
    finishReason: "stop",
    completionTokens: 83,
    rawOutputCharacters: 91,
    normalizedOutputCharacters: 89,
    observedHanCharacters: 72,
  }, {
    stage: "repair",
    finishReason: "length",
    completionTokens: null,
    rawOutputCharacters: 130,
    normalizedOutputCharacters: 128,
    observedHanCharacters: 104,
  }, {
    stage: "recovery",
    finishReason: "stop",
    completionTokens: 246,
    rawOutputCharacters: 286,
    normalizedOutputCharacters: 284,
    observedHanCharacters: 248,
  }];
  assert.deepEqual(closedAgentBrowserRuntimeEvidence({
    browserRuntimeEvidence: runtimeEvidence,
  }), runtimeEvidence);
  assert.equal(
    closedAgentBrowserRuntimeEvidenceProgress({ browserRuntimeEvidence: runtimeEvidence }),
    "BROWSER_RUNTIME_EVIDENCE:initial:stop:83:91:89:72 BROWSER_RUNTIME_EVIDENCE:repair:length:u:130:128:104 BROWSER_RUNTIME_EVIDENCE:recovery:stop:246:286:284:248",
  );
  assert.deepEqual(closedAgentBrowserRuntimeEvidence({
    code: "BROWSER_AI_REQUIRED_GENERATIVE_EXECUTION_FAILED",
    cause: { browserRuntimeEvidence: runtimeEvidence },
  }), runtimeEvidence);
  assert.deepEqual(closedAgentBrowserRuntimeEvidence({
    browserRuntimeEvidence: [
      { ...runtimeEvidence[0], finishReason: "attacker" },
      { ...runtimeEvidence[1], completionTokens: 999_999 },
      { ...runtimeEvidence[1], stage: "private-output" },
      "raw candidate output",
    ],
  }), []);
  const cyclicCause = {};
  cyclicCause.cause = cyclicCause;
  assert.deepEqual(closedAgentBrowserRuntimeEvidence(cyclicCause), []);
});

function namespace(overrides = {}) {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    projectId: "project-a",
    storyId: "story-a",
    canonId: "canon-a",
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "runtime-selection",
    modelDigest: "runtime-digest",
    promptProfileVersion: "prompt-v1",
    storyBibleRevision: "bible-1",
    knowledgeScopeRevision: "knowledge-1",
    privacyLevel: "device_only",
    ...overrides,
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

function errorCode(code) {
  return (error) => error?.code === code;
}

function verifiedRuntimeTruth(id, ready) {
  const source = {
    "browser-ai": "browser-runtime-generation",
    "local-ollama": "local-bridge-generation",
    "private-ai-hub": "private-hub-generation",
  }[id];
  return {
    installed: ready,
    configured: ready,
    reachable: ready,
    modelAvailable: ready,
    runtimeVerified: ready,
    generationVerified: ready,
    verificationSource: ready ? source : "none",
    verifiedAt: ready ? "2026-08-10T00:00:00.000Z" : null,
  };
}

function modelDigestForBackend(id) {
  return {
    "browser-ai": "b".repeat(64),
    "local-ollama": "c".repeat(64),
    "private-ai-hub": "d".repeat(64),
  }[id];
}

class MockBackend {
  constructor(id, maximumComplexity, calls, options = {}) {
    this.id = id;
    this.maximumComplexity = maximumComplexity;
    this.calls = calls;
    this.options = options;
  }

  async snapshot() {
    const status = this.options.status ?? "ready";
    return {
      id: this.id,
      label: this.id,
      status,
      runtimeTruth: verifiedRuntimeTruth(this.id, status === "ready"),
      modelId: `${this.id}-model`,
      modelDigest: modelDigestForBackend(this.id),
      local: this.id !== "private-ai-hub",
      dataBoundary: this.id === "private-ai-hub" ? "private-infrastructure" : "device",
      maximumComplexity: this.maximumComplexity,
      capabilities: ["text"],
      supportedTaskTypes: this.id === "browser-ai"
        ? ["story.summary", "character.dialogueConsistency"]
        : "all",
      detailCode: "mock-ready",
    };
  }

  async execute(input) {
    this.calls.push({
      backendId: this.id,
      actorContext: structuredClone(input.actorContext),
      taskId: input.request.taskId,
      qualityPhase: input.qualityPhase,
      workingMaterials: structuredClone(input.workingMaterials),
      learningConfiguration: structuredClone(input.request.learningConfiguration ?? {}),
    });
    if (this.options.progressEvent) {
      input.request.onProgress?.({
        taskId: input.request.taskId,
        phase: "generating",
        label: `${this.id} generated content`,
        percent: 50,
        occurredAt: "2026-08-10T00:00:00.000Z",
        backendId: this.id,
        ...structuredClone(this.options.progressEvent),
      });
    }
    if (this.options.executeError) throw this.options.executeError;
    const content = this.options.contentByPhase?.[input.qualityPhase]
      ?? `這是由 ${this.id} 產生的安全候選內容，包含足夠長度以供評估與人工核准。`;
    return {
      backendId: this.id,
      modelId: `${this.id}-model`,
      modelDigest: modelDigestForBackend(this.id),
      content,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 5,
    };
  }
}

function createMockOS(options = {}) {
  const calls = [];
  const cache = new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
    semanticThreshold: 0.2,
  });
  const ledger = new VerifiableLedger({
    repository: options.ledgerRepository ?? new MemoryVerifiableLedgerRepository(),
    signer: new ApprovalSigner(),
  });
  const backends = [
    new MockBackend("browser-ai", "light", calls, options.browser),
    new MockBackend("local-ollama", "standard", calls, options.local),
    new MockBackend("private-ai-hub", "heavy", calls, options.privateHub),
  ];
  const os = new ClosedAgentOS({
    backends,
    cache,
    ledger,
    state: options.state ?? new MemoryClosedAgentStateRepository(),
  });
  return { os, calls, backends };
}

function request(taskId, taskType, complexity, overrides = {}) {
  const { namespace: namespaceOverrides, ...requestOverrides } = overrides;
  return {
    taskId,
    namespace: namespace(namespaceOverrides),
    taskType,
    objective: "請依照已核准的故事資料建立一個可供作者審核的候選。",
    context: [],
    complexity,
    allowedToolIds: [],
    permissionScopes: permissions(),
    ...requestOverrides,
  };
}

test("cache namespace requires all fourteen non-wildcard identity fields", () => {
  assert.doesNotThrow(() => assertClosedAINamespace(namespace()));
  assert.throws(
    () => assertClosedAINamespace(namespace({ canonId: "*" })),
    errorCode("CLOSED_AI_NAMESPACE_INVALID"),
  );
  assert.throws(
    () => assertClosedAINamespace(namespace({ modelDigest: "" })),
    errorCode("CLOSED_AI_NAMESPACE_INVALID"),
  );
});

test("all six cache layers store candidate-only non-canonical entries", async () => {
  const cache = new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
  });
  for (const layer of CLOSED_AI_CACHE_LAYERS) {
    const entry = await cache.put({
      layer,
      namespace: namespace(),
      input: { layer, prompt: "not retained" },
      value: { candidate: layer },
      semanticText: layer === "semantic" ? "角色在壓力下揭露秘密" : undefined,
    });
    assert.equal(entry.candidateOnly, true);
    assert.equal(entry.canonicalMutation, false);
  }
  const stats = await cache.stats();
  assert.deepEqual(
    Object.values(stats.layerEntries),
    [1, 1, 1, 1, 1, 1],
  );
  assert.equal(stats.rawPromptStored, false);
  assert.equal(stats.canonicalMutationCount, 0);
});

test("cache isolation and targeted invalidation never cross project or canon", async () => {
  const cache = new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
  });
  const first = namespace();
  const second = namespace({ projectId: "project-b", storyId: "story-b", canonId: "canon-b" });
  await cache.put({ layer: "exact", namespace: first, input: "same", value: "first" });
  await cache.put({ layer: "exact", namespace: second, input: "same", value: "second" });
  assert.equal((await cache.get("exact", first, "same")).entry?.value, "first");
  assert.equal((await cache.get("exact", second, "same")).entry?.value, "second");
  assert.equal(await cache.invalidate({ projectId: "project-a" }), 1);
  assert.equal((await cache.get("exact", first, "same")).hit, false);
  assert.equal((await cache.get("exact", second, "same")).entry?.value, "second");
});

test("semantic cache uses hashed fingerprints and honours namespace", async () => {
  const repository = new MemoryClosedAICacheRepository();
  const cache = new ClosedAICache({ repository, semanticThreshold: 0.2 });
  await cache.put({
    layer: "semantic",
    namespace: namespace(),
    input: { id: "semantic-source" },
    semanticText: "角色在巨大壓力下逐步揭露秘密",
    value: { answer: "cached" },
  });
  const hit = await cache.getSemantic(namespace(), "巨大壓力使角色揭露秘密");
  assert.equal(hit.hit, true);
  const serialized = JSON.stringify(await repository.list());
  assert.equal(serialized.includes("巨大壓力使角色揭露秘密"), false);
});

test("cache single-flight executes one factory for concurrent callers", async () => {
  const cache = new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
  });
  let calls = 0;
  const factory = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { content: "one result" };
  };
  await Promise.all([
    cache.compute("retrieval", namespace(), { query: "one" }, factory),
    cache.compute("retrieval", namespace(), { query: "one" }, factory),
    cache.compute("retrieval", namespace(), { query: "one" }, factory),
  ]);
  assert.equal(calls, 1);
  assert.equal((await cache.stats()).singleFlightJoins, 2);
});

test("controlled learning is fail-closed until explicit consent", async () => {
  const learning = new ControlledLearningOS({
    repository: new MemoryControlledLearningRepository(),
  });
  await assert.rejects(
    () => learning.collectExperience({
      namespace: namespace(),
      outcome: "accepted",
      taskType: "chapter.continue",
      featureText: "safe feature",
    }),
    errorCode("CONTROLLED_LEARNING_CONSENT_REQUIRED"),
  );
  await learning.setConsent({ namespace: namespace(), enabled: true });
  const experience = await learning.collectExperience({
    namespace: namespace(),
    outcome: "accepted",
    taskType: "chapter.continue",
    featureText: "safe feature",
    resultText: "safe result",
  });
  assert.equal(experience.rawInputStored, false);
  assert.equal(experience.rawOutputStored, false);
  assert.equal(experience.rawChainOfThoughtStored, false);
});

test("learning privacy filter blocks credentials, raw reasoning and private scopes", async () => {
  const learning = new ControlledLearningOS({
    repository: new MemoryControlledLearningRepository(),
  });
  await learning.setConsent({ namespace: namespace(), enabled: true });
  const fakeCredential = `vcp_${"A".repeat(32)}`;
  let caught;
  try {
    await learning.collectExperience({
      namespace: namespace(),
      outcome: "accepted",
      taskType: "chapter.continue",
      featureText: fakeCredential,
    });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.code, "CONTROLLED_LEARNING_PRIVACY_FILTER_BLOCKED");
  assert.equal(String(caught?.message).includes(fakeCredential), false);
  await assert.rejects(
    () => learning.collectExperience({
      namespace: namespace(),
      outcome: "accepted",
      taskType: "chapter.continue",
      authorOnly: true,
    }),
    errorCode("CONTROLLED_LEARNING_PRIVACY_FILTER_BLOCKED"),
  );
  await assert.rejects(
    () => learning.collectExperience({
      namespace: namespace(),
      outcome: "accepted",
      taskType: "chapter.continue",
      rawChainOfThought: true,
    }),
    errorCode("CONTROLLED_LEARNING_PRIVACY_FILTER_BLOCKED"),
  );
});

test("abandoned work is stored only as a negative label", async () => {
  const learning = new ControlledLearningOS({
    repository: new MemoryControlledLearningRepository(),
  });
  await learning.setConsent({ namespace: namespace(), enabled: true });
  const record = await learning.collectExperience({
    namespace: namespace(),
    outcome: "abandoned",
    taskType: "chapter.continue",
    tags: ["abandoned"],
  });
  assert.equal(record.outcomeLabel, "negative");
  assert.equal(record.abandonedAsNegativeOnly, true);
});

test("learning candidate requires evaluator, human approval and passing A/B before adoption", async () => {
  const learning = new ControlledLearningOS({
    repository: new MemoryControlledLearningRepository(),
    verifyApprovalTransaction: async () => true,
  });
  await learning.setConsent({ namespace: namespace(), enabled: true });
  const experience = await learning.collectExperience({
    namespace: namespace(),
    outcome: "accepted",
    taskType: "chapter.continue",
    tags: ["pacing"],
  });
  const candidate = await learning.createCandidate({
    namespace: namespace(),
    level: "L0",
    candidateType: "preference",
    experienceIds: [experience.id],
    proposal: { pacingWeight: 0.2 },
  });
  await assert.rejects(
    () => learning.approveCandidate(candidate.id, {
      approvedBy: "author",
      approvalId: "approval-1",
      humanApproved: true,
    }),
    errorCode("CONTROLLED_LEARNING_EVALUATION_GATE_FAILED"),
  );
  await learning.evaluateCandidate(candidate.id, { score: 0.9 });
  const approved = await learning.approveCandidate(candidate.id, {
    approvedBy: "author",
    approvalId: "approval-1",
    approvalTransactionId: "approval-transaction-1",
    approvalTransactionDigest: "a".repeat(64),
    humanApproved: true,
  });
  const dataset = await learning.createDataset(approved.id, true);
  assert.equal(dataset.rawContentStored, false);
  const ab = await learning.startABTest({
    candidateId: approved.id,
    minimumSamples: 2,
    requiredImprovement: 0.02,
  });
  await learning.recordABSample(ab.id, 0.5, 0.7);
  const passed = await learning.recordABSample(ab.id, 0.6, 0.8);
  assert.equal(passed.status, "passed");
  const version = await learning.adoptCandidate(approved.id, passed.id);
  assert.equal(version.status, "active");
  const active = await learning.activeConfiguration(namespace());
  assert.equal(active.applied, true);
  assert.equal(active.versionId, version.id);
  assert.equal(active.configuration.pacingWeight, 0.2);
  assert.equal(await learning.rollbackVersion(version.id), null);
  assert.equal((await learning.activeConfiguration(namespace())).applied, false);
});

test("learning kill switch, export and delete are operational", async () => {
  const learning = new ControlledLearningOS({
    repository: new MemoryControlledLearningRepository(),
  });
  await learning.setConsent({ namespace: namespace(), enabled: true });
  await learning.setKillSwitch("project-a", true);
  await assert.rejects(
    () => learning.collectExperience({
      namespace: namespace(),
      outcome: "accepted",
      taskType: "chapter.continue",
    }),
    errorCode("CONTROLLED_LEARNING_KILL_SWITCH_ENGAGED"),
  );
  await learning.setKillSwitch("project-a", false);
  await learning.collectExperience({
    namespace: namespace(),
    outcome: "accepted",
    taskType: "chapter.continue",
  });
  const exported = await learning.exportProject("project-a");
  assert.equal(exported.rawContentIncluded, false);
  assert.match(exported.contentDigest, /^[a-f0-9]{64}$/u);
  await learning.deleteProject("project-a");
  assert.equal((await learning.dashboard("project-a")).experiences, 0);
});

test("knowledge sources become non-copying L1 candidates with signed lineage and rollback", async () => {
  const { os } = createMockOS();
  const boundNamespace = namespace({
    modelId: "local-ollama-model",
    modelDigest: modelDigestForBackend("local-ollama"),
  });
  await os.learning.setConsent({ namespace: boundNamespace, enabled: true });
  const sourceText = [
    "故事開場先建立日常秩序，再以一個無法忽略的事件破壞平衡。",
    "角色每次做選擇都會失去某項資源，衝突因此逐步升高。",
    "答案不一次揭露，而是讓線索在不同場景互相驗證。",
    "結尾保留一個已被前文支持、但尚未解決的新問題。",
  ].join("");
  const transformed = await os.createKnowledgeRulePackCandidate({
    namespace: boundNamespace,
    sourceText,
    sourceTitle: "敘事結構參考",
    sourceType: "user-provided-article",
    humanConfirmedRights: true,
    rules: [
      {
        id: "rule-pressure-choice",
        category: "character",
        statement: "讓主角的關鍵決策同時改變關係與可用資源，並在下一幕驗證代價。",
      },
      {
        id: "rule-evidence-ladder",
        category: "structure",
        statement: "每次揭露只解開一層問題，下一層必須由先前可追溯的證據支撐。",
      },
    ],
  });
  assert.equal(transformed.sourceContentStored, false);
  assert.equal(transformed.verbatimCopyStored, false);
  assert.equal(transformed.candidate.status, "candidate");

  const approved = await os.approveLearningCandidate({
    candidateId: transformed.candidate.id,
    score: 0.91,
    approvedBy: "author",
    humanApproved: true,
  });
  assert.equal(approved.dataset.rawContentStored, false);
  const ab = await os.startLearningABTest({
    candidateId: approved.candidate.id,
    minimumSamples: 2,
    requiredImprovement: 0.01,
  });
  await os.recordLearningABSample(ab.id, 0.55, 0.72);
  const passed = await os.recordLearningABSample(ab.id, 0.61, 0.77);
  assert.equal(passed.status, "passed");
  const adopted = await os.adoptLearningCandidate(approved.candidate.id, passed.id);
  assert.equal(adopted.version.status, "active");
  assert.equal((await os.learning.activeConfiguration(boundNamespace)).applied, true);

  const verification = await os.ledger.verify(transformed.ledgerId);
  assert.equal(verification.valid, true);
  assert.equal(verification.signedApprovalCount, 1);
  const rollback = await os.rollbackLearningVersion(adopted.version.id);
  assert.equal(rollback.rolledBackVersionId, adopted.version.id);
  assert.equal((await os.learning.activeConfiguration(boundNamespace)).applied, false);

  await assert.rejects(
    () => os.createKnowledgeRulePackCandidate({
      namespace: boundNamespace,
      sourceText,
      sourceTitle: "逐字風險",
      sourceType: "reference-notes",
      humanConfirmedRights: true,
      rules: [{
        id: "copied-rule",
        category: "structure",
        statement: "故事開場先建立日常秩序，再以一個無法忽略的事件破壞平衡。",
      }],
    }),
    errorCode("CONTROLLED_LEARNING_VERBATIM_COPY_RISK"),
  );
});

test("Merkle root and proof verify and reject a different leaf", async () => {
  const leaves = ["one", "two", "three", "four"];
  const root = await merkleRoot(leaves);
  const { proof } = await createMerkleProof(leaves, 2);
  assert.equal(await verifyMerkleProof("three", proof, root), true);
  assert.equal(await verifyMerkleProof("tampered", proof, root), false);
});

test("ledger verifies hash chain, Merkle roots, content addresses and signed approval", async () => {
  const repository = new MemoryVerifiableLedgerRepository();
  const ledger = new VerifiableLedger({ repository });
  await ledger.append({
    ledgerId: "ledger-a",
    namespace: namespace(),
    eventType: "candidate-generated",
    payload: { candidateDigest: await sha256Hex("candidate") },
    retainContent: true,
  });
  await ledger.append({
    ledgerId: "ledger-a",
    namespace: namespace(),
    eventType: "approval-signed",
    payload: { humanApproved: true, approvalId: "approval-a" },
    signApproval: true,
  });
  const verification = await ledger.verify("ledger-a");
  assert.equal(verification.valid, true);
  assert.equal(verification.blockCount, 2);
  assert.equal(verification.signedApprovalCount, 1);
  const blocks = await repository.list("ledger-a");
  assert(await repository.getContent(blocks[0].contentRecordId, {
    ledgerId: blocks[0].ledgerId,
    projectId: blocks[0].namespace.projectId,
    namespaceDigest: blocks[0].namespaceDigest,
  }));
  const evidence = await ledger.exportEvidence("ledger-a", "project-a");
  assert.equal(evidence.contentIncluded, false);
  assert.match(evidence.evidenceDigest, /^[a-f0-9]{64}$/u);
  assert.equal((await ledger.verifyEvidence(evidence)).valid, true);
});

test("ledger detects tampered immutable block", async () => {
  const base = new MemoryVerifiableLedgerRepository();
  const ledger = new VerifiableLedger({ repository: base });
  await ledger.append({
    ledgerId: "ledger-tamper",
    namespace: namespace(),
    eventType: "task-accepted",
    payload: { safe: true },
  });
  const tampered = await base.list("ledger-tamper");
  tampered[0].payloadDigest = "0".repeat(64);
  const maliciousRepository = {
    kind: "memory",
    async append() {},
    async list() { return structuredClone(tampered); },
    async putContent() {},
    async getContent() { return null; },
  };
  const tamperedLedger = new VerifiableLedger({ repository: maliciousRepository });
  const verification = await tamperedLedger.verify("ledger-tamper");
  assert.equal(verification.valid, false);
  assert(verification.errorCodes.some((code) => code.startsWith("LEDGER_BLOCK_HASH_INVALID")));
});

test("policy-aware light, quality-first standard and heavy routing use the three distinct backends", async () => {
  const { os, calls } = createMockOS();
  const light = await os.execute(request("task-light", "story.summary", "light"));
  const standard = await os.execute(request(
    "task-standard",
    "chapter.continue",
    "standard",
    { browserComputePolicy: "quality-first" },
  ));
  const heavy = await os.execute(request(
    "task-heavy",
    "character.multiAgentSimulation",
    "heavy",
    { namespace: { privacyLevel: "private_infrastructure_only" } },
  ));
  assert.equal(light.route.backendId, "browser-ai");
  assert.equal(standard.route.backendId, "local-ollama");
  assert.equal(heavy.route.backendId, "private-ai-hub");
  assert.equal(light.candidate.generationTelemetry.qualityPasses, 1);
  assert.equal(standard.candidate.generationTelemetry.qualityPasses, 2);
  assert.equal(heavy.candidate.generationTelemetry.qualityPasses, 3);
  assert.deepEqual(calls.map((call) => call.backendId), [
    "browser-ai",
    "local-ollama",
    "local-ollama",
    "private-ai-hub",
    "private-ai-hub",
    "private-ai-hub",
  ]);
});

test("failed Browser execution exposes only finite transient runtime evidence", async () => {
  const runtimeError = Object.assign(new Error("private prompt and raw output"), {
    code: "BROWSER_AI_QUALITY_INSUFFICIENT",
    qualityReasonCodes: ["QUALITY_NARRATIVE_TOO_SHORT"],
    browserRuntimeEvidence: [{
      stage: "initial",
      finishReason: "stop",
      completionTokens: 83,
      rawOutputCharacters: 91,
      normalizedOutputCharacters: 89,
      observedHanCharacters: 72,
    }, {
      stage: "repair",
      finishReason: "unavailable",
      completionTokens: null,
      rawOutputCharacters: null,
      normalizedOutputCharacters: null,
      observedHanCharacters: null,
    }],
  });
  const progress = [];
  const { os } = createMockOS({ browser: { executeError: runtimeError } });
  await assert.rejects(
    () => os.execute(request("task-browser-runtime-evidence", "story.summary", "light", {
      onProgress: (event) => progress.push(event),
    })),
    (error) => error === runtimeError,
  );
  const failed = progress.findLast((event) => event.phase === "failed");
  assert.ok(failed);
  assert.match(failed.label, /QUALITY_NARRATIVE_TOO_SHORT/u);
  assert.match(failed.label, /BROWSER_RUNTIME_EVIDENCE:initial:stop:83:91:89:72/u);
  assert.match(failed.label, /BROWSER_RUNTIME_EVIDENCE:repair:unavailable:u:u:u:u/u);
  assert.doesNotMatch(failed.label, /private prompt|raw output/iu);
});

test("quality progress strips unapproved model deltas before every consumer", async () => {
  const rejectedDeltaSentinel = "REJECTED_PROGRESS_DELTA_X9";
  const progress = [];
  const { os } = createMockOS({
    browser: {
      progressEvent: {
        generatedCharacters: 37,
        generatedTokenEvents: 11,
        delta: rejectedDeltaSentinel,
      },
    },
  });
  const value = await os.execute(request(
    "task-browser-progress-sanitized",
    "story.summary",
    "light",
    { onProgress: (event) => progress.push(event) },
  ));
  assert.ok(value.candidate);
  const generation = progress.find((event) =>
    event.generatedCharacters === 37 && event.generatedTokenEvents === 11);
  assert.ok(generation, "numeric Browser progress must remain observable");
  assert.equal(Object.hasOwn(generation, "delta"), false);
  assert.doesNotMatch(JSON.stringify(progress), new RegExp(rejectedDeltaSentinel, "u"));
});

test("unsafe raw passes stop before working material and durable candidate writes", async () => {
  const unsafeFixtures = [{
    label: "generic-control",
    content: "<|begin_of_text|>不可保存的控制內容",
    reason: "QUALITY_OUTPUT_CONTROL_TOKEN",
  }, {
    label: "mistral-control",
    content: "[INST] 不可保存的控制內容 [/INST]",
    reason: "QUALITY_OUTPUT_CONTROL_TOKEN",
  }, {
    label: "zero-width-role",
    content: "\u200Bsystem: 不可保存的角色內容",
    reason: "QUALITY_OUTPUT_ROLE_ENVELOPE",
  }, {
    label: "role-xml",
    content: "<assistant>不可保存的角色內容</assistant>",
    reason: "QUALITY_OUTPUT_ROLE_ENVELOPE",
  }, {
    label: "simplified-role",
    content: "用户：不可保存的角色內容",
    reason: "QUALITY_OUTPUT_ROLE_ENVELOPE",
  }, {
    label: "simplified-internal-envelope",
    content: "<作者目标>不可保存的提示內容</作者目标>",
    reason: "QUALITY_OUTPUT_INTERNAL_ENVELOPE",
  }, {
    label: "credential",
    content: `sk-proj-${"a".repeat(24)}`,
    reason: "QUALITY_OUTPUT_CREDENTIAL_LEAK",
  }, {
    label: "private-key",
    content: ["-----BEGIN ", "PRIVATE KEY-----"].join(""),
    reason: "QUALITY_OUTPUT_CREDENTIAL_LEAK",
  }, {
    label: "reasoning",
    content: "<think>private reasoning</think>",
    reason: "QUALITY_OUTPUT_RAW_REASONING_LEAK",
  }, {
    label: "escaped-reasoning",
    content: "&lt;analysis&gt;hidden steps&lt;/analysis&gt;",
    reason: "QUALITY_OUTPUT_RAW_REASONING_LEAK",
  }];
  const backendCases = [{
    id: "browser-ai",
    option: "browser",
    taskType: "story.summary",
    complexity: "light",
    namespace: {},
  }, {
    id: "local-ollama",
    option: "local",
    taskType: "chapter.continue",
    complexity: "standard",
    namespace: {},
  }, {
    id: "private-ai-hub",
    option: "privateHub",
    taskType: "character.multiAgentSimulation",
    complexity: "heavy",
    namespace: { privacyLevel: "private_infrastructure_only" },
  }];
  let index = 0;
  for (const backendCase of backendCases) {
    for (const fixture of unsafeFixtures) {
      index += 1;
      const options = {
        [backendCase.option]: {
          contentByPhase: { draft: fixture.content },
        },
      };
      const { os, calls } = createMockOS(options);
      const taskId = `unsafe-pass-${backendCase.id}-${fixture.label}-${index}`;
      let failure;
      await assert.rejects(
        () => os.execute(request(
          taskId,
          backendCase.taskType,
          backendCase.complexity,
          {
            preferredBackend: backendCase.id,
            namespace: backendCase.namespace,
          },
        )),
        (error) => {
          failure = error;
          return error?.code === "CLOSED_AGENT_QUALITY_PASS_UNSAFE";
        },
      );
      assert.deepEqual(closedAgentQualityReasonCodes(failure), [fixture.reason]);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].workingMaterials, []);
      const ledgerId = `closed-agent:project-a:${taskId}`;
      const durable = JSON.stringify({
        blocks: await os.ledger.repository.list(ledgerId),
        candidates: await os.state.list("project-a", "candidate"),
        cache: await os.cache.repository.list(),
      });
      assert.equal(durable.includes(fixture.content), false);
      assert.equal(durable.includes(await sha256Hex(fixture.content)), false);
      assert.equal((await os.state.list("project-a", "candidate")).length, 0);
      assert.equal(candidateCacheCount(await os.cache.repository.list()), 0);
    }
  }

  for (const phaseCase of [{
    option: "local",
    backendId: "local-ollama",
    taskType: "chapter.continue",
    complexity: "standard",
    phase: "revision",
    unsafe: "analysis: hidden steps",
    expectedCalls: 2,
    namespace: {},
  }, {
    option: "privateHub",
    backendId: "private-ai-hub",
    taskType: "character.multiAgentSimulation",
    complexity: "heavy",
    phase: "critic",
    unsafe: `Bearer ${"b".repeat(24)}`,
    expectedCalls: 2,
    namespace: { privacyLevel: "private_infrastructure_only" },
  }, {
    option: "privateHub",
    backendId: "private-ai-hub",
    taskType: "character.multiAgentSimulation",
    complexity: "heavy",
    phase: "revision",
    unsafe: "<analysis>hidden steps</analysis>",
    expectedCalls: 3,
    namespace: { privacyLevel: "private_infrastructure_only" },
  }]) {
    const options = {
      [phaseCase.option]: {
        contentByPhase: { [phaseCase.phase]: phaseCase.unsafe },
      },
    };
    const { os, calls } = createMockOS(options);
    const taskId = `unsafe-${phaseCase.backendId}-${phaseCase.phase}`;
    await assert.rejects(
      () => os.execute(request(
        taskId,
        phaseCase.taskType,
        phaseCase.complexity,
        {
          preferredBackend: phaseCase.backendId,
          namespace: phaseCase.namespace,
        },
      )),
      errorCode("CLOSED_AGENT_QUALITY_PASS_UNSAFE"),
    );
    assert.equal(calls.length, phaseCase.expectedCalls);
    assert.equal(calls.at(-1).qualityPhase, phaseCase.phase);
    assert.equal(JSON.stringify(calls).includes(phaseCase.unsafe), false);
    const durable = JSON.stringify({
      blocks: await os.ledger.repository.list(`closed-agent:project-a:${taskId}`),
      candidates: await os.state.list("project-a", "candidate"),
      cache: await os.cache.repository.list(),
    });
    assert.equal(durable.includes(phaseCase.unsafe), false);
    assert.equal(durable.includes(await sha256Hex(phaseCase.unsafe)), false);
  }
});

test("native browser generator without a cryptographic model digest fails closed", () => {
  assert.throws(
    () => selectClosedAIBackend(
      request("task-native-browser", "chapter.continue", "standard"),
      [
      {
        id: "browser-ai",
        label: "瀏覽器 AI",
        status: "ready",
        runtimeTruth: verifiedRuntimeTruth("browser-ai", true),
        modelId: "chrome-built-in-language-model",
        modelDigest: "browser-managed-model-digest-unavailable",
        local: true,
        dataBoundary: "device",
        maximumComplexity: "standard",
        capabilities: ["text", "offline"],
        supportedTaskTypes: "all",
        detailCode: "browser_hybrid_runtime_native_prompt_ready",
      },
      {
        id: "local-ollama",
        label: "個人本機 Ollama",
        status: "runtime_required",
        runtimeTruth: verifiedRuntimeTruth("local-ollama", false),
        modelId: null,
        modelDigest: null,
        local: true,
        dataBoundary: "device",
        maximumComplexity: "standard",
        capabilities: ["text", "offline"],
        supportedTaskTypes: "all",
        detailCode: "pairing_required",
      },
      {
        id: "private-ai-hub",
        label: "私有 AI Hub",
        status: "runtime_required",
        runtimeTruth: verifiedRuntimeTruth("private-ai-hub", false),
        modelId: null,
        modelDigest: null,
        local: true,
        dataBoundary: "private-infrastructure",
        maximumComplexity: "heavy",
        capabilities: ["text"],
        supportedTaskTypes: "all",
        detailCode: "pairing_required",
      },
      ],
    ),
    errorCode("CLOSED_AI_REQUIRED_BACKEND_NOT_READY"),
  );
});

test("shared OS uses semantic and retrieval caches without promoting cache authority", async () => {
  const { os, calls } = createMockOS();
  const context = [{
    id: "approved-story-bible",
    kind: "story-bible",
    text: "The locked archive contains one approved clue.",
    visibility: "both",
    privacyLevel: "device_only",
    approved: true,
  }];
  await os.execute(request(
    "task-semantic-first",
    "story.summary",
    "light",
    { objective: "Summarize the approved locked archive clue.", context },
  ));
  const reused = await os.execute(request(
    "task-semantic-second",
    "story.summary",
    "light",
    { objective: "Summarize the approved locked archive clue.", context },
  ));
  assert.equal(reused.cache.candidateHit, true);
  assert.equal(calls.length, 1);
  const stats = await os.cache.stats();
  assert.equal(stats.layerEntries.semantic, 1);
  assert.equal(stats.layerEntries.retrieval, 1);
  const entries = await os.cache.repository.list();
  assert(entries.every((entry) =>
    entry.authority === "cache_candidate_only"
    && entry.approvalTransactionId === null
    && entry.memoryMutation === false
    && entry.learningMutation === false
    && entry.canonicalMutation === false));
});

test("semantic candidate cache is bound to the evaluated context digest", async () => {
  const { os, calls } = createMockOS();
  const context = (text) => [{
    id: "approved-story-bible",
    kind: "story-bible",
    text,
    visibility: "both",
    privacyLevel: "device_only",
    approved: true,
  }];
  await os.execute(request(
    "task-semantic-context-a",
    "story.summary",
    "light",
    {
      objective: "Summarize the approved clue.",
      context: context("The approved clue is the silver key."),
    },
  ));
  const changedContext = await os.execute(request(
    "task-semantic-context-b",
    "story.summary",
    "light",
    {
      objective: "Summarize the approved clue.",
      context: context("The approved clue is the obsidian gate."),
    },
  ));
  assert.equal(changedContext.cache.candidateHit, false);
  assert.equal(calls.length, 2);
  const repeatedContext = await os.execute(request(
    "task-semantic-context-b-repeat",
    "story.summary",
    "light",
    {
      objective: "Summarize the approved clue.",
      context: context("The approved clue is the obsidian gate."),
    },
  ));
  assert.equal(repeatedContext.cache.candidateHit, true);
  assert.equal(calls.length, 2);
});

test("an existing cache-hit candidate retains immutable lineage while rejected origins stop new reuse", async () => {
  const { os, calls, backends } = createMockOS();
  const context = [{
    id: "approved-cache-origin-context",
    kind: "story-bible",
    text: "The approved clue is the sealed bronze key.",
    visibility: "both",
    privacyLevel: "device_only",
    approved: true,
  }];
  const sharedInput = {
    objective: "Summarize the approved sealed bronze key clue.",
    context,
  };
  const origin = await os.execute(request(
    "task-cache-origin-a",
    "story.summary",
    "light",
    sharedInput,
  ));
  const callsAfterOrigin = calls.length;
  const cached = await os.execute(request(
    "task-cache-origin-b",
    "story.summary",
    "light",
    sharedInput,
  ));
  assert.equal(cached.cache.candidateHit, true);
  assert.equal(calls.length, callsAfterOrigin);
  assert.equal(cached.candidate.actualExecutor, "not_executed");
  assert.equal(cached.candidate.executionReceipt, null);
  assert.equal(cached.candidate.cacheOrigin?.originCandidateId, origin.candidate.id);
  assert.equal(await os.verifyCandidateIntegrity(cached.candidate.id), true);

  await os.rejectCandidate(origin.candidate.id);
  assert.equal(await os.verifyCandidateIntegrity(cached.candidate.id), true);
  backends.find((backend) => backend.id === "browser-ai").options.contentByPhase = {
    draft: "A fresh regeneration follows a different consequence and ends with a newly opened route.",
  };
  const regenerated = await os.execute(request(
    "task-cache-origin-c-regenerated",
    "story.summary",
    "light",
    {
      ...sharedInput,
      preferredBackend: "browser-ai",
      regeneration: createExplicitRegenerationContract({
        previousCandidateId: cached.candidate.id,
        previousTaskId: cached.candidate.taskId,
        previousCandidateDigest: cached.candidate.contentDigest,
        regenerationAttempt: 1,
      }),
    },
  ));
  assert.equal(regenerated.cache.candidateHit, false);
  assert.equal(regenerated.candidate.actualExecutor, "browser-ai");
  assert.equal(regenerated.candidate.executionReceipt?.proofState, "verified");
  assert.equal(
    regenerated.candidate.regeneration?.previousCandidateId,
    cached.candidate.id,
  );
  assert.equal(calls.length, callsAfterOrigin + 1);

  const approvedCached = await os.approveCandidate({
    candidateId: cached.candidate.id,
    approvedBy: "author",
    humanApproved: true,
  });
  assert.equal(approvedCached.candidate.status, "approved");
  const freshAfterRejection = await os.execute(request(
    "task-cache-origin-d-after-rejection",
    "story.summary",
    "light",
    sharedInput,
  ));
  assert.equal(freshAfterRejection.cache.candidateHit, false);
  assert.equal(freshAfterRejection.candidate.actualExecutor, "browser-ai");
  assert.equal(calls.length, callsAfterOrigin + 2);
});

test("a failed final state write recovers one durable candidate without rerunning", async () => {
  let failCandidateStateOnce = true;
  const state = new MemoryClosedAgentStateRepository({
    faultInjector(point) {
      if (failCandidateStateOnce && point === "before:candidate") {
        failCandidateStateOnce = false;
        throw new Error("TRANSIENT_CANDIDATE_STATE_WRITE_FAILED");
      }
    },
  });
  const { os, calls, backends } = createMockOS({ state });
  const retriedRequest = request(
    "task-state-recovery",
    "story.summary",
    "light",
  );
  await assert.rejects(
    () => os.execute(retriedRequest),
    /TRANSIENT_CANDIDATE_STATE_WRITE_FAILED/u,
  );
  assert.equal(calls.length, 1);
  backends.find((backend) => backend.id === "browser-ai").options.status = "unreachable";
  const recovered = await os.execute(retriedRequest);
  assert.equal(recovered.task.state, "awaiting-approval");
  assert.equal(recovered.route.reasonCode, "DURABLE_CANDIDATE_RECOVERY");
  assert.equal(calls.length, 1);
  const blocks = await os.ledger.repository.list(
    "closed-agent:project-a:task-state-recovery",
  );
  assert.equal(blocks.filter((block) =>
    block.eventType === "candidate-generated").length, 1);
  assert.equal(blocks.filter((block) =>
    block.eventType === "candidate-evaluated").length, 1);
  const approved = await os.approveCandidate({
    candidateId: recovered.candidate.id,
    approvedBy: "author",
    humanApproved: true,
  });
  assert.equal(approved.candidate.status, "approved");
});

test("a failed evaluated append is completed from the retained generated snapshot", async () => {
  let failEvaluationOnce = true;
  class FailOnceEvaluationLedgerRepository extends MemoryVerifiableLedgerRepository {
    async append(block) {
      if (failEvaluationOnce && block.eventType === "candidate-evaluated") {
        failEvaluationOnce = false;
        throw new Error("TRANSIENT_EVALUATION_LEDGER_APPEND_FAILED");
      }
      return super.append(block);
    }
  }
  const { os, calls } = createMockOS({
    ledgerRepository: new FailOnceEvaluationLedgerRepository(),
  });
  const retriedRequest = request(
    "task-evaluation-recovery",
    "story.summary",
    "light",
  );
  await assert.rejects(
    () => os.execute(retriedRequest),
    /TRANSIENT_EVALUATION_LEDGER_APPEND_FAILED/u,
  );
  assert.equal(calls.length, 1);
  const recovered = await os.execute(retriedRequest);
  assert.equal(recovered.route.reasonCode, "DURABLE_CANDIDATE_RECOVERY");
  assert.equal(calls.length, 1);
  const blocks = await os.ledger.repository.list(
    "closed-agent:project-a:task-evaluation-recovery",
  );
  assert.equal(blocks.filter((block) =>
    block.eventType === "candidate-generated").length, 1);
  assert.equal(blocks.filter((block) =>
    block.eventType === "candidate-evaluated").length, 1);
  assert.equal(await os.verifyCandidateIntegrity(recovered.candidate.id), true);
});

test("explicit incompatible backend fails without silent fallback", async () => {
  const { os, calls } = createMockOS();
  await assert.rejects(
    () => os.execute(request("task-no-fallback", "chapter.continue", "standard", {
      preferredBackend: "browser-ai",
    })),
    (error) =>
      error?.code === "CLOSED_AI_SELECTED_BACKEND_NOT_READY"
      && error?.fallbackAttempted === false,
  );
  assert.equal(calls.length, 0);
});

test("required backend outage fails closed instead of downgrading", async () => {
  const { os, calls } = createMockOS({
    privateHub: { status: "contract_ready_runtime_not_connected" },
  });
  await assert.rejects(
    () => os.execute(request(
      "task-hub-outage",
      "character.multiAgentSimulation",
      "heavy",
      { namespace: { privacyLevel: "private_infrastructure_only" } },
    )),
    (error) =>
      error?.code === "CLOSED_AI_REQUIRED_BACKEND_NOT_READY"
      && error?.fallbackAttempted === false,
  );
  assert.equal(calls.length, 0);
});

test("actor never receives evaluator-only or author-only context", async () => {
  const { os, calls } = createMockOS();
  await os.execute(request("task-context", "story.summary", "light", {
    context: [
      {
        id: "actor",
        kind: "canon",
        text: "actor-visible",
        visibility: "actor",
        privacyLevel: "device_only",
        approved: true,
      },
      {
        id: "evaluator",
        kind: "evaluator-note",
        text: "evaluator-secret",
        visibility: "evaluator",
        privacyLevel: "device_only",
        approved: true,
      },
      {
        id: "author",
        kind: "author-note",
        text: "author-secret",
        visibility: "author-only",
        privacyLevel: "author_only",
        approved: true,
      },
    ],
  }));
  assert.deepEqual(calls[0].actorContext.map((item) => item.text), ["actor-visible"]);
});

test("candidate approval is signed before memory and optional canonical commit", async () => {
  const { os } = createMockOS();
  const result = await os.execute(request(
    "task-approval",
    "chapter.continue",
    "standard",
    { browserComputePolicy: "quality-first" },
  ));
  await assert.rejects(
    () => os.approveCandidate({
      candidateId: result.candidate.id,
      approvedBy: "author",
      humanApproved: false,
    }),
    errorCode("CLOSED_AGENT_HUMAN_APPROVAL_REQUIRED"),
  );
  const approved = await os.approveCandidate({
    candidateId: result.candidate.id,
    approvedBy: "author",
    humanApproved: true,
    canonicalCommit: async ({ approvalId }) => ({
      commitId: `canon-commit:${approvalId}`,
      storyBibleRevision: "bible-2",
    }),
  });
  assert.equal(approved.canonicalMutationCount, 1);
  assert.equal(approved.memory.canonical, true);
  const verification = await os.ledger.verify("closed-agent:project-a:task-approval");
  assert.equal(verification.valid, true);
  assert.equal(verification.signedApprovalCount, 1);
});

test("concurrent approval attempts serialize to one signed state transition", async () => {
  const { os } = createMockOS();
  const result = await os.execute(request(
    "task-concurrent-approval",
    "chapter.continue",
    "standard",
    { browserComputePolicy: "quality-first" },
  ));
  const attempts = await Promise.allSettled([
    os.approveCandidate({
      candidateId: result.candidate.id,
      approvedBy: "author",
      humanApproved: true,
    }),
    os.approveCandidate({
      candidateId: result.candidate.id,
      approvedBy: "author",
      humanApproved: true,
    }),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) =>
    item.status === "rejected"
    && item.reason?.code === "CLOSED_AGENT_APPROVAL_GATE_FAILED").length, 1);
  const verification = await os.ledger.verify(
    "closed-agent:project-a:task-concurrent-approval",
  );
  assert.equal(verification.valid, true);
  assert.equal(verification.signedApprovalCount, 1);
});

test("shared Agent OS applies adopted learning and records only consented outcomes", async () => {
  const { os, calls } = createMockOS();
  const boundNamespace = namespace({
    modelId: "local-ollama-model",
    modelDigest: modelDigestForBackend("local-ollama"),
  });
  await os.learning.setConsent({ namespace: boundNamespace, enabled: true });
  const seed = await os.learning.collectExperience({
    namespace: boundNamespace,
    outcome: "accepted",
    taskType: "chapter.continue",
    tags: ["pacing"],
  });
  const learningCandidate = await os.learning.createCandidate({
    namespace: boundNamespace,
    level: "L0",
    candidateType: "preference",
    experienceIds: [seed.id],
    proposal: { pacingWeight: 0.35 },
  });
  await os.learning.evaluateCandidate(learningCandidate.id, { score: 0.9 });
  await assert.rejects(
    () => os.learning.approveCandidate(learningCandidate.id, {
      approvedBy: "author",
      approvalId: "forged-approval-1",
      approvalTransactionId: "forged-transaction-1",
      approvalTransactionDigest: "f".repeat(64),
      humanApproved: true,
    }),
    errorCode("CONTROLLED_LEARNING_APPROVAL_TRANSACTION_UNVERIFIED"),
  );
  const learningApproval = await os.approveLearningCandidate({
    candidateId: learningCandidate.id,
    score: 0.9,
    approvedBy: "author",
    humanApproved: true,
  });
  const approvedLearning = learningApproval.candidate;
  const ab = await os.learning.startABTest({
    candidateId: approvedLearning.id,
    minimumSamples: 2,
    requiredImprovement: 0.01,
  });
  await os.learning.recordABSample(ab.id, 0.5, 0.7);
  const passed = await os.learning.recordABSample(ab.id, 0.6, 0.8);
  await os.learning.adoptCandidate(approvedLearning.id, passed.id);

  const first = await os.execute(request(
    "task-learning-integrated",
    "chapter.continue",
    "standard",
    { browserComputePolicy: "quality-first" },
  ));
  assert.equal(first.learning.applied, true);
  assert.equal(calls[0].learningConfiguration.pacingWeight, 0.35);
  const approved = await os.approveCandidate({
    candidateId: first.candidate.id,
    approvedBy: "author",
    humanApproved: true,
  });
  assert.equal(approved.learningSignal.collected, true);
  assert.equal(approved.learningSignal.ledgerRecorded, true);

  const second = await os.execute(request(
    "task-learning-rejected",
    "chapter.continue",
    "standard",
    { browserComputePolicy: "quality-first" },
  ));
  await os.rejectCandidate(second.candidate.id);
  const dashboard = await os.learning.dashboard("project-a");
  assert.equal(dashboard.experiences, 7);
  const runtimeSignals = await os.learning.repository.list("project-a", "experience");
  assert.equal(
    runtimeSignals.filter((signal) => signal.outcome === "planner_result").length,
    2,
  );
  assert.equal(
    runtimeSignals.filter((signal) => signal.outcome === "plot_continuity_result").length,
    2,
  );

  const { os: noConsentOS } = createMockOS();
  const noConsent = await noConsentOS.execute(request(
    "task-learning-no-consent",
    "chapter.continue",
    "standard",
    { browserComputePolicy: "quality-first" },
  ));
  assert.equal(noConsent.learning.applied, false);
  const noConsentApproval = await noConsentOS.approveCandidate({
    candidateId: noConsent.candidate.id,
    approvedBy: "author",
    humanApproved: true,
  });
  assert.equal(noConsentApproval.learningSignal.collected, false);
  assert.equal(
    noConsentApproval.learningSignal.reasonCode,
    "CONTROLLED_LEARNING_CONSENT_REQUIRED",
  );
  assert.equal((await noConsentOS.learning.dashboard("project-a")).experiences, 0);
});

test("tool registry rejects direct shell, database, filesystem and network capabilities", () => {
  const registry = new ClosedAgentToolRegistry();
  for (const id of ["shell.exec", "raw-db.query", "filesystem.read", "network.fetch"]) {
    assert.throws(
      () => registry.register({
        id,
        label: id,
        capability: "local-metadata",
        requiredScopes: ["story:read"],
        localOnly: true,
        projectBound: true,
        async execute() { return {}; },
      }),
      errorCode("CLOSED_AGENT_TOOL_FORBIDDEN"),
    );
  }
});

test("dashboard reports one shared system and truthful training states", async () => {
  const { os } = createMockOS();
  const dashboard = await os.dashboard("project-a");
  assert.equal(dashboard.oneSharedSystem, true);
  assert.equal(dashboard.backends.length, 3);
  assert.equal(dashboard.silentFallback, false);
  assert.equal(dashboard.learning.modelTraining, "started");
  assert.equal(dashboard.learning.distillation, "started");
  assert.equal(dashboard.rawChainOfThoughtStored, false);
});

test("product UI and health expose the unified system truth", () => {
  const root = process.cwd();
  const capabilityCatalog = resolveCapabilityCatalog();
  const ui = fs.readFileSync(
    path.join(root, "app", "studio", "project", "[projectId]", "closed-ai", "closed-ai-workspace.tsx"),
    "utf8",
  );
  const navigation = fs.readFileSync(
    path.join(root, "app", "studio", "project", "[projectId]", "project-navigation.tsx"),
    "utf8",
  );
  const health = fs.readFileSync(
    path.join(root, "app", "api", "ai", "health", "route.ts"),
    "utf8",
  );
  assert.match(ui, /三個閉端 AI/);
  assert.match(ui, /六層 AI Cache/);
  assert.match(ui, /可控自我學習/);
  assert.match(ui, /區塊鏈式可驗證機制/);
  assert.match(ui, /Private Hub Runtime：\{hubProof \? "self_hosted_private_node_ready"/);
  assert.match(ui, /尚未取得此網站的短期工作階段/);
  assert.match(ui, /Ollama 尚未啟動或沒有可用模型/);
  assert.match(ui, /automaticConnectionFailure\(error, "Local Ollama"\)/);
  assert.match(ui, /裝置內生成模型已就緒/);
  assert.match(navigation, /\["closed-ai","閉端 AI 中心"\]/);
  assert.match(health, /threeClosedAISharedSystemStatus: "not_verified"/);
  assert.match(
    health,
    /privateAIHubRuntimeTruthStatus: "self_hosted_loopback_runtime_ready_pairing_required"/,
  );
  assert.match(health, /browserAiStatus: "client_probe_required"/);
  assert.match(health, /browserClosedAiStatus: "setup_required"/);
  assert.match(health, /threeClosedAiArchitectureStatus: "not_verified"/);
  assert.match(health, /closedAiGenerationVerifiedBackends: CLOSED_AI_SERVER_RUNTIME_TRUTH\.generationVerifiedBackends/);
  assert.match(health, /continualLearningStatus: "ready_l0_l1_controlled"/);
  assert.match(
    health,
    /offlinePreferenceTrainingStatus: capabilityStatus\(\s*capabilityCatalog,\s*"offlinePreferenceTraining",\s*\)/,
  );
  assert.equal(
    capabilityStatus(capabilityCatalog, "offlinePreferenceTraining"),
    "client_dependent",
  );
  assert.match(health, /adapterTrainingStatus: "offline_preference_adapter_ready"/);
  assert.match(health, /modelTraining: capabilityStatus\(capabilityCatalog, "modelTraining"\)/);
  assert.match(health, /distillation: capabilityStatus\(capabilityCatalog, "distillation"\)/);
});

for (const item of tests) {
  const started = Date.now();
  try {
    await item.run();
    results.push({ name: item.name, status: "PASS", elapsedMs: Date.now() - started });
  } catch (error) {
    results.push({
      name: item.name,
      status: "FAIL",
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

const report = {
  suite: "Three Closed AI + Closed Agent OS + Cache + Controlled Learning + Verifiable Ledger",
  runAt: new Date().toISOString(),
  pass: results.filter((row) => row.status === "PASS").length,
  fail: results.filter((row) => row.status === "FAIL").length,
  oneSharedSystem: true,
  backendIds: ["browser-ai", "local-ollama", "private-ai-hub"],
  silentFallback: false,
  modelTraining: "started",
  distillation: "started",
  rawChainOfThoughtStored: false,
  results,
};

console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;
