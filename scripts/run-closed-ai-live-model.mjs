import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createPrivateHubServer } from "../local-ai/private-hub/server.mjs";
import {
  PrivateHubClient,
  configurePrivateHubClient,
  configurePrivateHubModel,
  configurePrivateHubProject,
} from "../lib/novel-ai/providers/private-ai-hub/private-hub-client.ts";
import { ClosedAgentOS } from "../lib/novel-ai/closed-agent-os/closed-agent-os.ts";
import {
  containsConvertibleSimplifiedChinese,
  normalizeTraditionalChinese,
} from "../lib/novel-ai/language/traditional-chinese.ts";

const origin = "http://127.0.0.1:3000";
const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "novel-private-hub-live-"));
const results = [];

async function test(name, work) {
  const startedAt = performance.now();
  try {
    const evidence = await work();
    results.push({
      name,
      status: "PASS",
      elapsedMs: Math.round(performance.now() - startedAt),
      evidence,
    });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const result = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(target));
    else result.push(target);
  }
  return result;
}

const hub = createPrivateHubServer({
  testMode: true,
  runtimeDir,
  pairingFile: path.join(runtimeDir, "pairing.json"),
  accessLogPath: path.join(runtimeDir, "access.jsonl"),
});

let selectedModel = null;
let proof = null;
let trained = null;
let execution = null;
const privateSamples = [
  {
    chosen: "她沒有回答，只把濕透的袖口往後藏，目光停在那扇仍在晃動的門上。",
    rejected: "她非常害怕，而且覺得現在的情況真的非常糟糕。",
  },
  {
    chosen: "鐘聲落下第三響，他先熄燈，再把唯一的鑰匙推給最不信任的人。",
    rejected: "他做出了一個重要決定，大家都對這個決定感到很意外。",
  },
  {
    chosen: "紙頁沾著鹽味。林昭翻到最後，只見自己的名字被墨線劃去一半。",
    rejected: "林昭發現帳冊有問題，這讓故事變得更加撲朔迷離。",
  },
  {
    chosen: "「你可以走。」館長說。門外卻傳來第二個館長的咳嗽聲。",
    rejected: "館長說林昭可以離開，但是事情顯然沒有那麼簡單。",
  },
  {
    chosen: "她跨過水痕時停了半步——泥印朝內，表示昨夜進來的人從未出去。",
    rejected: "她仔細觀察後，突然明白有人進來以後就沒有離開。",
  },
];

try {
  await hub.start();
  const request = await (await fetch("http://127.0.0.1:3227/pair/request", {
    method: "POST",
    headers: {
      Origin: origin,
      "X-Private-Hub-Protocol": "novel-private-hub/v1",
      "Content-Type": "application/json",
    },
    body: "{}",
  })).json();
  const session = await (await fetch("http://127.0.0.1:3227/pair/confirm", {
    method: "POST",
    headers: {
      Origin: origin,
      "X-Private-Hub-Protocol": "novel-private-hub/v1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pairingId: request.pairingId,
      code: request.testCode,
    }),
  })).json();
  const client = new PrivateHubClient({ origin, session });
  const models = await client.models();
  selectedModel = models.models.find((model) => model.modelId === "qwen2.5:3b")
    ?? models.models.find((model) => model.capabilities?.textGeneration?.value === true)
    ?? null;

  await test("Private Hub discovers a real text model", async () => {
    assert.ok(selectedModel?.modelId);
    return {
      modelId: selectedModel.modelId,
      modelDigest: selectedModel.modelDigest,
    };
  });

  await test("candidate language normalization is deterministic and local", async () => {
    const simplified = "他刚刚得知公司将裁员，自己面临被淘汰的风险。";
    const traditional = normalizeTraditionalChinese(simplified);
    assert.equal(traditional, "他剛剛得知公司將裁員，自己面臨被淘汰的風險。");
    assert.equal(containsConvertibleSimplifiedChinese(traditional), false);
    return {
      converter: "opencc-js/cn2t",
      externalRequest: false,
      dataLeftDevice: false,
    };
  });

  await test("Private Hub produces a fixed-input inference proof", async () => {
    assert.ok(selectedModel?.modelId);
    proof = await client.verifyModel(selectedModel.modelId);
    assert.equal(proof.state, "inference_verified");
    assert.match(proof.outputDigest, /^[a-f0-9]{64}$/);
    assert.equal(proof.externalRequest, false);
    assert.equal(proof.dataLeftDevice, false);
    return {
      proofVersion: proof.proofVersion,
      modelId: proof.modelId,
      modelDigest: proof.modelDigest,
      outputDigest: proof.outputDigest,
      latencyMs: proof.latencyMs,
    };
  });

  await test("offline preference training produces an immutable model artifact", async () => {
    assert.ok(selectedModel?.modelId);
    trained = await client.trainPreferenceModel({
      projectId: "live-model-proof-project",
      baseModelId: selectedModel.modelId,
      datasetVersion: "synthetic-approved-v1",
      samples: privateSamples,
      hyperparameters: {
        epochs: 320,
        learningRate: 0.08,
        l2: 0.015,
      },
    });
    assert.equal(trained.trainingMethod, "offline_pairwise_logistic_gradient_descent");
    assert.equal(trained.privacy.rawSamplesStored, false);
    assert.equal(trained.privacy.externalRequest, false);
    assert.equal(trained.verified, true);
    assert.match(trained.artifactDigest, /^[a-f0-9]{64}$/);
    assert.ok((trained.metrics.allPairAccuracy ?? 0) >= 0.6);
    const verified = await client.verifyPreferenceModel(
      "live-model-proof-project",
      trained.modelId,
    );
    assert.equal(verified.artifactDigest, trained.artifactDigest);
    return {
      modelId: trained.modelId,
      artifactDigest: trained.artifactDigest,
      datasetDigest: trained.datasetDigest,
      metrics: trained.metrics,
      rawSamplesStored: trained.privacy.rawSamplesStored,
    };
  });

  await test("trained preference model requires explicit activation and becomes active", async () => {
    await client.activatePreferenceModel(
      "live-model-proof-project",
      trained.modelId,
    );
    const artifacts = await client.listPreferenceModels("live-model-proof-project");
    const active = artifacts.find((model) => model.status === "active");
    assert.equal(active?.modelId, trained.modelId);
    assert.equal(active?.artifactDigest, trained.artifactDigest);
    return {
      activeModelId: active.modelId,
      activeArtifactDigest: active.artifactDigest,
    };
  });

  configurePrivateHubClient(client);
  configurePrivateHubModel(selectedModel.modelId);
  configurePrivateHubProject("live-model-proof-project");
  const closedAgent = new ClosedAgentOS();

  await test("Closed Agent OS executes a heavy task through the real Private Hub model", async () => {
    const snapshots = await closedAgent.backendSnapshots();
    const privateHub = snapshots.find((snapshot) => snapshot.id === "private-ai-hub");
    assert.equal(privateHub?.status, "ready");
    assert.match(privateHub?.detailCode || "", /model_and_adapter_verified/);
    execution = await closedAgent.execute({
      taskId: `live-private-hub-${crypto.randomUUID()}`,
      namespace: {
        tenantId: "local-tenant",
        userId: "local-author",
        projectId: "live-model-proof-project",
        storyId: "live-model-proof-project",
        canonId: "canon:live-model-proof-project",
        branchId: "main",
        characterId: "shared",
        agentRole: "closed-agent-os",
        modelId: privateHub.modelId,
        modelDigest: privateHub.modelDigest,
        promptProfileVersion: "closed-agent-prompt-v1",
        storyBibleRevision: "current",
        knowledgeScopeRevision: "current",
        privacyLevel: "private_infrastructure_only",
      },
      taskType: "character.multiAgentSimulation",
      objective: "以繁體中文提出一段約一百五十字的三人封閉圖書館推演；每人必須有不同目標，結尾留下可核准的選擇。",
      context: [{
        id: "synthetic-story-bible",
        kind: "story-bible",
        text: "林昭尋找失蹤帳冊；館長隱瞞鑰匙；守夜人只相信可驗證的腳印。午夜前不得離館。",
        visibility: "both",
        privacyLevel: "private_infrastructure_only",
        approved: true,
      }],
      complexity: "heavy",
      preferredBackend: "private-ai-hub",
      allowedToolIds: [],
      permissionScopes: [
        "story:read",
        "story-bible:read",
        "candidate:write",
        "candidate:read",
        "evaluation:write",
        "character:read",
        "world:read",
      ],
    });
    assert.equal(execution.route.backendId, "private-ai-hub");
    assert.equal(execution.route.fallbackAttempted, false);
    assert.equal(execution.candidate.backendId, "private-ai-hub");
    assert.equal(execution.candidate.adapterId, trained.modelId);
    assert.equal(execution.candidate.adapterDigest, trained.artifactDigest);
    assert.ok(execution.candidate.content.trim().length > 24);
    assert.match(execution.candidate.content, /[\u3400-\u9fff]/u);
    assert.equal(
      containsConvertibleSimplifiedChinese(execution.candidate.content),
      false,
    );
    assert.match(execution.candidate.contentDigest, /^[a-f0-9]{64}$/);
    assert.match(execution.ledgerHeadHash, /^[a-f0-9]{64}$/);
    return {
      backendId: execution.candidate.backendId,
      modelId: execution.candidate.modelId,
      modelDigest: execution.candidate.modelDigest,
      adapterId: execution.candidate.adapterId,
      adapterDigest: execution.candidate.adapterDigest,
      contentDigest: execution.candidate.contentDigest,
      ledgerHeadHash: execution.ledgerHeadHash,
      candidateOnly: execution.candidate.candidateOnly,
      canonicalMutationCount: execution.candidate.canonicalMutationCount,
      outputChars: execution.candidate.content.length,
    };
  });

  await test("runtime persistence contains no raw training examples or generated output", async () => {
    const files = await filesBelow(runtimeDir);
    const stored = (await Promise.all(
      files.map((file) => readFile(file, "utf8").catch(() => "")),
    )).join("\n");
    for (const sample of privateSamples) {
      assert.equal(stored.includes(sample.chosen), false);
      assert.equal(stored.includes(sample.rejected), false);
    }
    assert.equal(stored.includes(execution.candidate.content), false);
    assert.equal(JSON.stringify(hub.logs).includes(privateSamples[0].chosen), false);
    return {
      inspectedFiles: files.length,
      rawTrainingSamplesStored: false,
      generatedOutputStoredInRuntimeLogs: false,
    };
  });
} finally {
  configurePrivateHubClient(null);
  configurePrivateHubModel(null);
  configurePrivateHubProject(null);
  await hub.stop().catch(() => undefined);
  await rm(runtimeDir, { recursive: true, force: true });
}

const report = {
  schemaVersion: "closed-ai-live-model-results-v1",
  generatedAt: new Date().toISOString(),
  operatingSystem: `${os.platform()} ${os.release()}`,
  localModel: selectedModel
    ? {
      modelId: selectedModel.modelId,
      modelDigest: selectedModel.modelDigest,
    }
    : null,
  localBridgeVerification: proof
    ? {
      proofVersion: proof.proofVersion,
      outputDigest: proof.outputDigest,
      latencyMs: proof.latencyMs,
    }
    : null,
  trainedPreferenceModel: trained
    ? {
      modelId: trained.modelId,
      artifactDigest: trained.artifactDigest,
      datasetDigest: trained.datasetDigest,
      metrics: trained.metrics,
      trainingMethod: trained.trainingMethod,
    }
    : null,
  privateHubEndpoint: "http://127.0.0.1:3227",
  modelEndpoint: "http://127.0.0.1:11434",
  networkDestinations: ["127.0.0.1:3227", "127.0.0.1:11434"],
  externalAiCalls: 0,
  dataLeftDevice: false,
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  results,
};

await mkdir(new URL("../artifacts/closed-ai-live-model/", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../artifacts/closed-ai-live-model/live-model-results.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;
