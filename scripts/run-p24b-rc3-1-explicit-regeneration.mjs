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
  closedBackendPlatformRequest,
  ClosedAgentOS,
  MemoryClosedAgentStateRepository,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  assessRegenerationDistinctness,
  createExplicitRegenerationContract,
} from "../lib/novel-ai/web/explicit-regeneration.ts";
import { runStudioClosedAI } from "../lib/novel-ai/web/studio-closed-ai.ts";
import { buildPrivateHubClosedGenerationRequest } from "../lib/novel-ai/providers/private-ai-hub/private-hub-client.ts";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../lib/novel-ai/providers/closed/task-profile.ts";
import {
  estimateBrowserTokens,
  fitBrowserPromptToTokenBudget,
} from "../lib/novel-ai/providers/browser-ai/browser-performance-policy.ts";
import { conversationContentDigest } from "../lib/novel-ai/conversation/approval-transaction.ts";
import { hasVerifiedClosedRegenerationProof } from "../app/studio/project/[projectId]/chat/components/conversation-regeneration-proof.ts";

const mode = process.argv[2] || "all";
const tests = [];
const results = [];
const test = (name, run) => tests.push({ name, run });
const BACKEND_IDS = ["browser-ai", "local-ollama", "private-ai-hub"];

function modelDigestForBackend(id) {
  return {
    "browser-ai": "b".repeat(64),
    "local-ollama": "c".repeat(64),
    "private-ai-hub": "d".repeat(64),
  }[id];
}

function namespace(backendId = "local-ollama", overrides = {}) {
  return {
    tenantId: "tenant-rc6-2",
    userId: "author-rc6-2",
    projectId: "project-rc6-2",
    storyId: "story-rc6-2",
    canonId: "canon-rc6-2",
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "runtime-selection",
    modelDigest: "runtime-digest",
    promptProfileVersion: "studio-explicit-regeneration-v5",
    storyBibleRevision: "1",
    knowledgeScopeRevision: "1",
    privacyLevel: backendId === "private-ai-hub"
      ? "private_infrastructure_only"
      : "device_only",
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

class TestBackend {
  constructor(id, calls, status = "ready") {
    this.id = id;
    this.calls = calls;
    this.status = status;
    this.executionCount = 0;
    this.executionOverrides = {};
  }

  async snapshot() {
    const generationVerified = this.status === "ready";
    return {
      id: this.id,
      label: this.id,
      status: this.status,
      runtimeTruth: {
        installed: generationVerified,
        configured: generationVerified,
        reachable: generationVerified,
        modelAvailable: generationVerified,
        runtimeVerified: generationVerified,
        generationVerified,
        verificationSource: generationVerified
          ? {
              "browser-ai": "browser-runtime-generation",
              "local-ollama": "local-bridge-generation",
              "private-ai-hub": "private-hub-generation",
            }[this.id]
          : "none",
        verifiedAt: generationVerified ? "2026-08-10T00:00:00.000Z" : null,
      },
      modelId: generationVerified ? `${this.id}-model` : null,
      modelDigest: generationVerified ? modelDigestForBackend(this.id) : null,
      local: this.id !== "private-ai-hub",
      dataBoundary: this.id === "private-ai-hub"
        ? "private-infrastructure"
        : "device",
      maximumComplexity: this.id === "private-ai-hub" ? "heavy" : "standard",
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: generationVerified ? "fixture-ready" : "fixture-unavailable",
    };
  }

  async execute(input) {
    this.executionCount += 1;
    const regeneration = input.request.regeneration;
    const content = this.executionOverrides.content ?? (regeneration
      ? `Regenerated candidate ${regeneration.regenerationAttempt} from ${this.id}: a locked execution opens a different conflict, consequence, and chapter direction.`
      : `Initial candidate from ${this.id}: rain crosses the station while the protagonist chooses a dangerous promise and a concrete next action.`);
    this.calls.push({
      backendId: this.id,
      taskId: input.request.taskId,
      regenerationAttempt: regeneration?.regenerationAttempt ?? null,
      modelSeed: regeneration?.modelSeed ?? null,
      externalRequest: this.executionOverrides.externalRequest ?? false,
    });
    if (this.executionOverrides.waitFor) {
      await this.executionOverrides.waitFor;
    }
    return {
      backendId: this.id,
      modelId: this.executionOverrides.modelId ?? `${this.id}-model`,
      modelDigest: this.executionOverrides.modelDigest ?? modelDigestForBackend(this.id),
      adapterId: this.executionOverrides.adapterId ?? null,
      adapterDigest: this.executionOverrides.adapterDigest ?? null,
      content,
      candidateOnly: true,
      dataLeftDevice: this.executionOverrides.dataLeftDevice ?? false,
      externalRequest: this.executionOverrides.externalRequest ?? false,
      elapsedMs: 4,
      generatedTokenEvents: 5,
      outputCharacters: this.executionOverrides.outputCharacters ?? content.length,
      qualityMode: input.plan.qualityMode,
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }
}

function createOS(options = {}) {
  const calls = [];
  const cacheRepository = new MemoryClosedAICacheRepository();
  const backends = {
    "browser-ai": new TestBackend("browser-ai", calls, options.browserStatus ?? "ready"),
    "local-ollama": new TestBackend("local-ollama", calls, options.localStatus ?? "ready"),
    "private-ai-hub": new TestBackend("private-ai-hub", calls, options.privateStatus ?? "ready"),
  };
  const os = new ClosedAgentOS({
    backends: Object.values(backends),
    cache: new ClosedAICache({
      repository: cacheRepository,
      semanticThreshold: 0.2,
    }),
    ledger: new VerifiableLedger({
      repository: new MemoryVerifiableLedgerRepository(),
      signer: new ApprovalSigner(),
    }),
    state: new MemoryClosedAgentStateRepository(),
  });
  return { os, calls, backends, cacheRepository };
}

function baseRequest(taskId, backendId = "local-ollama", overrides = {}) {
  return {
    taskId,
    namespace: namespace(backendId),
    taskType: "chapter.continue",
    objective: "Continue the chapter with a concrete new conflict and consequence.",
    context: [],
    complexity: backendId === "private-ai-hub" ? "heavy" : "standard",
    qualityMode: "fast",
    preferredBackend: backendId,
    allowedToolIds: [],
    permissionScopes: permissions(),
    sourceChapterId: "chapter-1",
    sourceRevision: 1,
    ...overrides,
  };
}

function contractFor(candidate, attempt = (candidate.regeneration?.regenerationAttempt ?? 0) + 1) {
  return createExplicitRegenerationContract({
    previousCandidateId: candidate.id,
    previousTaskId: candidate.taskId,
    previousCandidateDigest: candidate.contentDigest,
    regenerationAttempt: attempt,
  });
}

async function createScenario(backendId = "local-ollama", options = {}) {
  const runtime = createOS();
  const canon = { revision: 1, content: "Canonical chapter remains unchanged." };
  const canonBefore = await sha256Hex(stableStringify(canon));
  const first = await runtime.os.execute(baseRequest(`source:${backendId}`, backendId));
  if (options.rejectSource) await runtime.os.rejectCandidate(first.candidate.id);
  const cacheEntriesBefore = await runtime.cacheRepository.list();
  const contract = contractFor(first.candidate);
  const second = await runtime.os.execute(baseRequest(`regenerated:${backendId}`, backendId, {
    regeneration: contract,
  }));
  return {
    ...runtime,
    canon,
    canonBefore,
    cacheEntriesBefore,
    first,
    second,
    contract,
  };
}

async function expectCode(operation, code) {
  await assert.rejects(
    operation,
    (error) => error?.code === code && error?.fallbackAttempted === false,
  );
}

function candidateCacheCount(entries) {
  return entries.filter((entry) => (
    entry.tags.includes("closed-agent-candidate")
    || entry.tags.includes("closed-agent-semantic-candidate")
  )).length;
}

test("explicit-regeneration-distinct", async () => {
  const scenario = await createScenario();
  const distinctness = await assessRegenerationDistinctness(
    scenario.first.candidate.content,
    scenario.second.candidate.content,
  );
  assert.equal(distinctness.normalizedDigestDifferent, true);
  assert.equal(distinctness.similarityMetric, "character_trigram_jaccard");
  assert.ok(distinctness.similarityScore < 0.95);
  assert.equal(distinctness.distinct, true);
  assert.notEqual(scenario.first.candidate.contentDigest, scenario.second.candidate.contentDigest);

  const fullwidthContent = "Ａ，這是保留全形標記的合法閉端候選；下一幕以不同衝突、後果與具體行動繼續。";
  const fullwidthRuntime = createOS();
  fullwidthRuntime.backends["browser-ai"].executionOverrides.content = fullwidthContent;
  const fullwidthSource = await fullwidthRuntime.os.execute(
    baseRequest("fullwidth-source", "browser-ai"),
  );
  const normalizedMessageDigest = await conversationContentDigest(fullwidthContent);
  assert.notEqual(fullwidthSource.candidate.contentDigest, normalizedMessageDigest);
  const verifiedInvocation = {
    status: "completed",
    toolId: "closed-agent-os:chapter.continue",
    actualExecutor: "browser-ai",
    modelId: fullwidthSource.candidate.modelId,
    modelDigest: fullwidthSource.candidate.modelDigest,
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
    taskId: fullwidthSource.candidate.taskId,
    contextDigest: fullwidthSource.candidate.contextDigest,
    executionReceipt: {
      receiptId: `conversation-receipt:${fullwidthSource.candidate.taskId}`,
      providerRunId: fullwidthSource.candidate.taskId,
      modelId: fullwidthSource.candidate.modelId,
      modelDigest: fullwidthSource.candidate.modelDigest,
      contextDigest: fullwidthSource.candidate.contextDigest,
      outputDigest: fullwidthSource.candidate.contentDigest,
      externalRequest: false,
      dataLeftDevice: false,
    },
  };
  assert.equal(hasVerifiedClosedRegenerationProof({
    message: {
      id: "fullwidth-message",
      candidateIds: [fullwidthSource.candidate.id, "conversation-artifact:fullwidth"],
      contentDigest: normalizedMessageDigest,
    },
    invocations: [verifiedInvocation],
    artifacts: [{
      id: "conversation-artifact:fullwidth",
      sourceMessageId: "fullwidth-message",
      status: "candidate",
      candidateDigest: normalizedMessageDigest,
    }],
  }), true, "NFKC-normalized message digest must not hide a raw-digest verified candidate");
  assert.equal(hasVerifiedClosedRegenerationProof({
    message: {
      id: "fullwidth-message-no-artifact",
      candidateIds: [fullwidthSource.candidate.id],
      contentDigest: normalizedMessageDigest,
    },
    invocations: [verifiedInvocation],
    artifacts: [],
  }), true, "verified non-approval Closed Agent messages remain regenerable without an artifact");
  assert.equal(hasVerifiedClosedRegenerationProof({
    message: {
      id: "fullwidth-message-mismatched-artifact",
      candidateIds: [fullwidthSource.candidate.id],
      contentDigest: normalizedMessageDigest,
    },
    invocations: [verifiedInvocation],
    artifacts: [{
      id: "conversation-artifact:mismatch",
      sourceMessageId: "fullwidth-message-mismatched-artifact",
      status: "candidate",
      candidateDigest: "0".repeat(64),
    }],
  }), false, "an existing artifact must remain NFKC-bound to its source message");
  const callsBeforeWrongDomain = fullwidthRuntime.calls.length;
  await expectCode(
    () => fullwidthRuntime.os.execute(baseRequest("fullwidth-wrong-digest", "browser-ai", {
      regeneration: createExplicitRegenerationContract({
        previousCandidateId: fullwidthSource.candidate.id,
        previousTaskId: fullwidthSource.candidate.taskId,
        previousCandidateDigest: normalizedMessageDigest,
        regenerationAttempt: 1,
      }),
    })),
    "CLOSED_AGENT_REGENERATION_SOURCE_NOT_VERIFIED",
  );
  assert.equal(fullwidthRuntime.calls.length, callsBeforeWrongDomain);
  fullwidthRuntime.backends["browser-ai"].executionOverrides.content =
    "A different continuation uses a fresh consequence, new action, and an unmistakably distinct ending.";
  const fullwidthRegeneration = await fullwidthRuntime.os.execute(
    baseRequest("fullwidth-regeneration", "browser-ai", {
      regeneration: contractFor(fullwidthSource.candidate),
    }),
  );
  assert.equal(fullwidthRegeneration.candidate.regeneration?.previousCandidateDigest,
    fullwidthSource.candidate.contentDigest);
  assert.equal(fullwidthRegeneration.candidate.backendId, "browser-ai");
  assert.equal(fullwidthRegeneration.candidate.externalRequest, false);
});

test("regeneration-cache-bypass", async () => {
  const scenario = await createScenario();
  assert.equal(scenario.second.cache.candidateHit, false);
  assert.equal(scenario.second.cache.bypassReason, "explicit_regeneration");
  assert.equal(scenario.second.candidate.regeneration?.cacheBypassed, true);
  assert.equal(scenario.second.candidate.regeneration?.previousContentReused, false);
  const cacheAfter = await scenario.cacheRepository.list();
  assert.equal(candidateCacheCount(cacheAfter), candidateCacheCount(scenario.cacheEntriesBefore));
  const stateBytes = JSON.stringify(await scenario.os.state.list("project-rc6-2", "candidate"));
  const ledgerBytes = JSON.stringify(
    await scenario.os.ledger.repository.list("closed-agent:project-rc6-2:regenerated:local-ollama"),
  );
  assert.equal(stateBytes.includes(scenario.contract.regenerationNonce), false);
  assert.equal(ledgerBytes.includes(scenario.contract.regenerationNonce), false);
  assert.equal(scenario.calls.length, 2, "prewarmed candidate cache must not replay regeneration");
});

test("regeneration-new-task-candidate", async () => {
  const scenario = await createScenario("local-ollama", { rejectSource: false });
  assert.notEqual(scenario.first.task.id, scenario.second.task.id);
  assert.notEqual(scenario.first.candidate.id, scenario.second.candidate.id);
  assert.equal(scenario.second.candidate.regeneration?.newCandidate, true);
  assert.equal(scenario.second.candidate.regeneration?.nonceStored, false);
  assert.equal(scenario.second.candidate.regeneration?.regenerationAttempt, 1);
  assert.equal(scenario.second.candidate.regeneration?.previousCandidateId, scenario.first.candidate.id);
  assert.equal(scenario.second.candidate.regeneration?.previousTaskId, scenario.first.task.id);
  assert.equal(
    (await scenario.os.state.get(scenario.first.candidate.id))?.status,
    "awaiting-approval",
    "direct regeneration preserves the verified source as a comparable sibling",
  );

  const third = await scenario.os.execute(baseRequest("regenerated:local-ollama:2", "local-ollama", {
    regeneration: contractFor(scenario.second.candidate),
  }));
  assert.equal(third.candidate.regeneration?.regenerationAttempt, 2);
  assert.equal(third.candidate.regeneration?.previousCandidateId, scenario.second.candidate.id);
  assert.equal(third.candidate.regeneration?.previousTaskId, scenario.second.task.id);
  assert.equal(third.candidate.regeneration?.previousCandidateDigest, scenario.second.candidate.contentDigest);
  assert.notEqual(third.candidate.id, scenario.second.candidate.id);
  assert.notEqual(third.task.id, scenario.second.task.id);
  const candidates = await scenario.os.state.list("project-rc6-2", "candidate");
  assert.deepEqual(
    candidates.map((candidate) => candidate.id).sort(),
    [scenario.first.candidate.id, scenario.second.candidate.id, third.candidate.id].sort(),
  );
  assert.equal((await scenario.os.state.get(scenario.second.candidate.id))?.status, "awaiting-approval");
  assert.equal((await scenario.os.state.get(third.candidate.id))?.status, "awaiting-approval");
});

test("regeneration-canon-zero-before-approval", async () => {
  const scenario = await createScenario();
  assert.equal(scenario.first.candidate.canonicalMutationCount, 0);
  assert.equal(scenario.second.candidate.canonicalMutationCount, 0);
  assert.equal(await sha256Hex(stableStringify(scenario.canon)), scenario.canonBefore);
  const approved = await scenario.os.approveCandidate({
    candidateId: scenario.second.candidate.id,
    approvedBy: "author-rc6-2",
    humanApproved: true,
    canonicalCommit: async ({ candidate, approvalId }) => {
      assert.equal(candidate.sourceRevision, scenario.canon.revision);
      scenario.canon.content = `${scenario.canon.content}\n\n${candidate.content}`;
      scenario.canon.revision += 1;
      return { commitId: `canon:${approvalId}` };
    },
  });
  assert.equal(approved.canonicalMutationCount, 1);
  assert.equal(scenario.canon.revision, 2);
  assert.ok(scenario.canon.content.includes(scenario.second.candidate.content));
});

test("regeneration-no-external-fallback", async () => {
  for (const backendId of BACKEND_IDS) {
    const scenario = await createScenario(backendId, {
      rejectSource: backendId === "local-ollama",
    });
    const candidate = scenario.second.candidate;
    assert.equal(candidate.backendId, backendId);
    assert.equal(candidate.actualExecutor, backendId);
    assert.equal(candidate.modelId, `${backendId}-model`);
    assert.equal(candidate.modelDigest, modelDigestForBackend(backendId));
    assert.equal(candidate.externalRequest, false);
    assert.equal(candidate.dataLeftDevice, false);
    assert.equal(candidate.canonicalMutationCount, 0);
    assert.equal(candidate.executionReceipt?.proofState, "verified");
    assert.equal(candidate.executionReceipt?.taskId, candidate.taskId);
    assert.equal(candidate.executionReceipt?.backendId, backendId);
    assert.equal(candidate.executionReceipt?.actualExecutor, backendId);
    assert.equal(candidate.executionReceipt?.modelId, candidate.modelId);
    assert.equal(candidate.executionReceipt?.modelDigest, candidate.modelDigest);
    assert.equal(candidate.executionReceipt?.contentDigest, candidate.contentDigest);
    assert.equal(candidate.executionReceipt?.contextDigest, candidate.contextDigest);
    assert.deepEqual([...new Set(scenario.calls.map((call) => call.backendId))], [backendId]);
    const outgoing = closedBackendPlatformRequest({
      request: baseRequest(`platform-request:${backendId}`, backendId, {
        regeneration: scenario.contract,
      }),
      plan: scenario.second.plan,
      actorContext: [],
      toolResults: [],
      qualityPhase: "draft",
      workingMaterials: [],
    });
    const outgoingPrompt = [outgoing.input, ...outgoing.context].join("\n");
    const sanitizedDirection = scenario.contract.direction
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 600);
    assert.equal(outgoing.generationOptions?.seed, scenario.contract.modelSeed);
    assert.ok(outgoingPrompt.includes(sanitizedDirection));
    assert.ok(outgoingPrompt.includes(scenario.contract.previousCandidateDigest));
    assert.ok(outgoingPrompt.includes("regenerationAttempt=1"));
    assert.equal(outgoingPrompt.includes(scenario.contract.regenerationNonce), false);
    assert.equal(outgoingPrompt.includes(scenario.contract.previousCandidateId), false);
    assert.equal(outgoingPrompt.includes(scenario.contract.previousTaskId), false);
    if (backendId !== "private-ai-hub") {
      const finalPrompt = buildClosedAIModelPrompt({
        objective: outgoing.input,
        context: ["x".repeat(80_000)],
        profile: getClosedAIModelProfile("chapter.continue", backendId),
      }).prompt;
      assert.ok(finalPrompt.includes(sanitizedDirection));
      assert.ok(finalPrompt.includes(outgoing.input));
      assert.equal(finalPrompt.includes(scenario.contract.regenerationNonce), false);
      if (backendId === "browser-ai") {
        const fitted = fitBrowserPromptToTokenBudget(finalPrompt, 448, {
          trustedClosedPrompt: true,
        });
        assert.ok(
          fitted.prompt.includes(`<作者目標>\n${outgoing.input}\n</作者目標>`),
          "ECO fitting dropped or truncated the complete author objective",
        );
        assert.ok(fitted.prompt.includes("<工作類型>chapter.continue</工作類型>"));
        const outputStart = finalPrompt.lastIndexOf("<最終輸出契約>");
        const outputEnd = finalPrompt.lastIndexOf("</最終輸出契約>")
          + "</最終輸出契約>".length;
        assert.ok(fitted.prompt.includes(finalPrompt.slice(outputStart, outputEnd)));
        assert.equal(
          fitted.prompt.includes("<最終輸出契約>"),
          fitted.prompt.includes("</最終輸出契約>"),
          "ECO fitting emitted a malformed partial output-contract tag",
        );
        assert.ok(estimateBrowserTokens(fitted.prompt) <= 448);
        assert.equal(fitted.prompt.includes(scenario.contract.regenerationNonce), false);
        assert.equal(fitted.prompt.includes(scenario.contract.previousCandidateId), false);
        assert.equal(fitted.prompt.includes(scenario.contract.previousTaskId), false);
      }
    }
    if (backendId === "private-ai-hub") {
      const privateOutgoingRequest = baseRequest("private-outgoing-request", backendId, {
        regeneration: scenario.contract,
      });
      const privateGeneration = buildPrivateHubClosedGenerationRequest({
        request: privateOutgoingRequest,
        plan: scenario.second.plan,
        actorContext: [{
          id: "near-max-context",
          kind: "retrieval",
          text: "x".repeat(80_000),
          visibility: "actor",
          privacyLevel: "private_infrastructure_only",
          approved: true,
        }],
        toolResults: [],
        qualityPhase: "draft",
        workingMaterials: [],
      });
      assert.equal(privateGeneration.options.seed, scenario.contract.modelSeed);
      assert.ok(privateGeneration.prompt.prompt.includes(privateOutgoingRequest.objective));
      assert.ok(privateGeneration.prompt.prompt.includes(sanitizedDirection));
      assert.ok(privateGeneration.prompt.prompt.includes(
        scenario.contract.previousCandidateDigest,
      ));
      assert.equal(
        privateGeneration.prompt.prompt.includes(scenario.contract.regenerationNonce),
        false,
      );
    }
  }

  const locked = await createScenario("browser-ai");
  const sourceContract = contractFor(locked.first.candidate);
  const callsBefore = locked.calls.length;
  await expectCode(
    () => locked.os.execute(baseRequest("wrong-backend", "browser-ai", {
      preferredBackend: "local-ollama",
      regeneration: sourceContract,
    })),
    "CLOSED_AGENT_REGENERATION_BACKEND_MISMATCH",
  );
  await expectCode(
    () => locked.os.execute(baseRequest("missing-backend", "browser-ai", {
      preferredBackend: undefined,
      regeneration: sourceContract,
    })),
    "CLOSED_AGENT_REGENERATION_BACKEND_REQUIRED",
  );
  await expectCode(
    () => locked.os.execute(baseRequest(locked.first.task.id, "browser-ai", {
      regeneration: sourceContract,
    })),
    "CLOSED_AGENT_REGENERATION_TASK_ID_REUSE",
  );
  await expectCode(
    () => locked.os.execute(baseRequest("missing-source", "browser-ai", {
      regeneration: createExplicitRegenerationContract({
        previousCandidateId: "missing-candidate",
        previousTaskId: locked.first.task.id,
        previousCandidateDigest: locked.first.candidate.contentDigest,
        regenerationAttempt: 1,
      }),
    })),
    "CLOSED_AGENT_REGENERATION_SOURCE_NOT_FOUND",
  );
  assert.equal(locked.calls.length, callsBefore);

  const unavailable = createOS();
  const unavailableSource = await unavailable.os.execute(baseRequest("unavailable-source", "browser-ai"));
  unavailable.backends["browser-ai"].status = "runtime_unavailable";
  await expectCode(
    () => unavailable.os.execute(baseRequest("unavailable-regeneration", "browser-ai", {
      regeneration: contractFor(unavailableSource.candidate),
    })),
    "CLOSED_AI_SELECTED_BACKEND_NOT_READY",
  );
  assert.equal(unavailable.calls.length, 1);

  const tampered = createOS();
  const tamperedSource = await tampered.os.execute(baseRequest("tampered-source", "local-ollama"));
  const forgedDigest = "f".repeat(64);
  await tampered.os.state.put({
    ...tamperedSource.candidate,
    modelDigest: forgedDigest,
    executionReceipt: {
      ...tamperedSource.candidate.executionReceipt,
      modelDigest: forgedDigest,
    },
  });
  await expectCode(
    () => tampered.os.execute(baseRequest("tampered-regeneration", "local-ollama", {
      regeneration: contractFor({
        ...tamperedSource.candidate,
        modelDigest: forgedDigest,
      }),
    })),
    "CLOSED_AGENT_REGENERATION_SOURCE_NOT_VERIFIED",
  );
  assert.equal(tampered.calls.length, 1);

  const legacyOrigin = createOS();
  const legacySource = await legacyOrigin.os.execute(baseRequest("legacy-source", "local-ollama"));
  const legacy = createOS();
  await legacy.os.state.putMany([legacySource.task, legacySource.candidate]);
  const legacyTelemetry = legacySource.candidate.generationTelemetry;
  await legacy.os.ledger.append({
    ledgerId: `closed-agent:project-rc6-2:${legacySource.task.id}`,
    namespace: legacySource.candidate.namespace,
    eventType: "candidate-generated",
    payload: {
      taskId: legacySource.task.id,
      backendId: legacySource.candidate.backendId,
      modelId: legacySource.candidate.modelId,
      modelDigest: legacySource.candidate.modelDigest,
      adapterId: legacySource.candidate.adapterId ?? null,
      adapterDigest: legacySource.candidate.adapterDigest ?? null,
      contentDigest: legacySource.candidate.contentDigest,
      candidateOnly: true,
      qualityMode: legacyTelemetry.qualityMode,
      qualityPasses: legacyTelemetry.qualityPasses,
      draftDigest: legacyTelemetry.draftDigest,
      criticDigest: legacyTelemetry.criticDigest,
    },
    result: {
      elapsedMs: legacyTelemetry.elapsedMs,
      dataLeftDevice: legacySource.candidate.dataLeftDevice,
      externalRequest: legacySource.candidate.externalRequest,
      profileId: null,
      firstTokenMs: legacyTelemetry.firstTokenMs,
      inputCharacters: null,
      outputCharacters: legacyTelemetry.outputCharacters,
      omittedInputCharacters: legacyTelemetry.omittedInputCharacters,
      qualityMode: legacyTelemetry.qualityMode,
      qualityPasses: legacyTelemetry.qualityPasses,
      draftDigest: legacyTelemetry.draftDigest,
      criticDigest: legacyTelemetry.criticDigest,
      actualExecutor: legacySource.candidate.actualExecutor,
      executionReceipt: legacySource.candidate.executionReceipt,
      regeneration: null,
    },
  });
  const migrated = await legacy.os.execute(baseRequest("legacy-regeneration", "local-ollama", {
    regeneration: contractFor(legacySource.candidate),
  }));
  assert.equal(migrated.candidate.backendId, "local-ollama");
  assert.equal(migrated.candidate.regeneration?.previousCandidateId, legacySource.candidate.id);
  assert.equal(legacy.calls.length, 1, "verified pre-RC6.2 ledger source must regenerate once");

  for (const failure of ["content", "adapter", "receipt", "privacy"]) {
    const runtime = createOS();
    const backend = runtime.backends["local-ollama"];
    if (failure === "adapter") {
      backend.executionOverrides.adapterId = "adapter-one";
      backend.executionOverrides.adapterDigest = "e".repeat(64);
    }
    const source = await runtime.os.execute(baseRequest(`negative-source:${failure}`, "local-ollama"));
    if (failure === "content") backend.executionOverrides.content = `${source.candidate.content} !!!`;
    if (failure === "adapter") {
      backend.executionOverrides.adapterId = "adapter-two";
      backend.executionOverrides.adapterDigest = "a".repeat(64);
    }
    if (failure === "receipt") backend.executionOverrides.outputCharacters = 0;
    if (failure === "privacy") backend.executionOverrides.externalRequest = true;
    const taskId = `negative-regeneration:${failure}`;
    const cacheBefore = await runtime.cacheRepository.list();
    await expectCode(
      () => runtime.os.execute(baseRequest(taskId, "local-ollama", {
        regeneration: contractFor(source.candidate),
      })),
      failure === "content"
        ? "CLOSED_AGENT_REGENERATION_CONTENT_REUSED"
        : failure === "adapter"
          ? "CLOSED_AGENT_REGENERATION_EXECUTION_IDENTITY_MISMATCH"
          : "CLOSED_AGENT_REGENERATION_EXECUTION_RECEIPT_INVALID",
    );
    assert.equal((await runtime.os.state.list("project-rc6-2", "candidate")).length, 1);
    const failedLedger = JSON.stringify(
      await runtime.os.ledger.repository.list(`closed-agent:project-rc6-2:${taskId}`),
    );
    assert.equal(failedLedger.includes("candidate-generated"), false);
    assert.equal(
      candidateCacheCount(await runtime.cacheRepository.list()),
      candidateCacheCount(cacheBefore),
    );
  }

  const lateCancelled = createOS();
  const lateSource = await lateCancelled.os.execute(
    baseRequest("late-cancel-source", "browser-ai"),
  );
  let releaseIgnoredAbort;
  lateCancelled.backends["browser-ai"].executionOverrides.waitFor = new Promise((resolve) => {
    releaseIgnoredAbort = resolve;
  });
  const abortController = new AbortController();
  const cancelledTaskId = "late-cancel-regeneration";
  const cancelledOperation = lateCancelled.os.execute(baseRequest(
    cancelledTaskId,
    "browser-ai",
    {
      regeneration: contractFor(lateSource.candidate),
      signal: abortController.signal,
    },
  ));
  while (lateCancelled.calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 0));
  abortController.abort("RC6_2_TEST_LATE_CANCEL");
  delete lateCancelled.backends["browser-ai"].executionOverrides.waitFor;
  const immediateRetry = lateCancelled.os.execute(baseRequest(
    "late-cancel-immediate-retry",
    "browser-ai",
    { regeneration: contractFor(lateSource.candidate) },
  ));
  releaseIgnoredAbort();
  await assert.rejects(
    cancelledOperation,
    (error) => error?.code === "CLOSED_AGENT_TASK_CANCELLED",
  );
  const retryResult = await immediateRetry;
  assert.notEqual(retryResult.candidate.taskId, cancelledTaskId);
  assert.equal(retryResult.candidate.backendId, "browser-ai");
  assert.equal(
    (await lateCancelled.os.state.get(cancelledTaskId))?.state,
    "cancelled",
  );
  assert.equal(
    (await lateCancelled.os.state.list("project-rc6-2", "candidate")).length,
    2,
    "late-cancel must leave only the source and successful retry candidates",
  );
  const cancelledLedger = JSON.stringify(
    await lateCancelled.os.ledger.repository.list(
      `closed-agent:project-rc6-2:${cancelledTaskId}`,
    ),
  );
  assert.equal(cancelledLedger.includes("candidate-generated"), false);
  assert.equal(cancelledLedger.includes("candidate-evaluated"), false);
});

test("studio-injected-regeneration-seam-fails-closed", async () => {
  for (const backendId of BACKEND_IDS) {
    const contract = createExplicitRegenerationContract({
      previousCandidateId: `candidate:${backendId}`,
      previousTaskId: `task:${backendId}`,
      previousCandidateDigest: modelDigestForBackend(backendId),
      regenerationAttempt: 1,
    });
    let calls = 0;
    await assert.rejects(
      () => runStudioClosedAI({
        projectId: "project-regeneration-route",
        task: "continue_story",
        input: "Generate a distinct continuation candidate.",
        regeneration: contract,
        preferredBackend: backendId,
        regenerationSourceModelId: `${backendId}-model`,
        regenerationSourceModelDigest: modelDigestForBackend(backendId),
      }, async () => {
        calls += 1;
        throw new Error("injected executor must not run");
      }),
      (error) => error?.code === "REGENERATION_PLATFORM_EXECUTOR_UNVERIFIED"
        && error?.fallbackAttempted === false,
    );
    assert.equal(calls, 0);
  }
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
  contractRevision: "RC6.2-source-backend-lock",
  mode,
  pass: results.length - failed,
  fail: failed,
  blockingSkip: 0,
  results,
}, null, 2));
if (failed > 0) process.exitCode = 1;
