import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";
import { createPrivateHubServer } from "../local-ai/private-hub/server.mjs";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../lib/novel-ai/providers/closed/task-profile.ts";

const origin = "http://127.0.0.1:3000";
const localPort = 33_217;
const hubPort = 33_227;
const localBase = `http://127.0.0.1:${localPort}`;
const hubBase = `http://127.0.0.1:${hubPort}`;
const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "novel-closed-ai-optimization-"));
const results = [];

function headers(protocolHeader, protocol, session, write = false) {
  return {
    Origin: origin,
    [protocolHeader]: protocol,
    ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    ...(session && write
      ? protocolHeader === "X-Bridge-Protocol"
        ? { "X-Bridge-CSRF": session.csrf }
        : { "X-Hub-CSRF": session.csrf }
      : {}),
  };
}

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.message || `HTTP ${response.status}`), {
      code: body.errorCode,
      status: response.status,
    });
  }
  return body;
}

async function pair(base, protocolHeader, protocol) {
  const common = headers(protocolHeader, protocol);
  const request = await json(await fetch(`${base}/pair/request`, {
    method: "POST",
    headers: { ...common, "Content-Type": "application/json" },
    body: "{}",
  }));
  return json(await fetch(`${base}/pair/confirm`, {
    method: "POST",
    headers: { ...common, "Content-Type": "application/json" },
    body: JSON.stringify({
      pairingId: request.pairingId,
      code: request.testCode,
    }),
  }));
}

async function generate({
  base,
  protocolHeader,
  protocol,
  session,
  body,
}) {
  const startedAt = performance.now();
  const response = await fetch(`${base}/generate`, {
    method: "POST",
    headers: {
      ...headers(protocolHeader, protocol, session, true),
      "Content-Type": "application/json",
      "Idempotency-Key": body.requestId,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) await json(response);
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let firstTokenMs = null;
  let completed = false;
  let tokenEvents = 0;
  let metadata = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "token") {
        if (firstTokenMs === null) {
          firstTokenMs = Math.round(performance.now() - startedAt);
        }
        tokenEvents += 1;
        content += event.text || "";
      }
      if (event.type === "metadata") metadata = event;
      if (event.type === "completed") completed = true;
      if (event.type === "failed" || event.type === "cancelled") {
        throw Object.assign(new Error(event.errorCode || event.type), {
          code: event.errorCode,
        });
      }
    }
  }
  return {
    content: content.trim(),
    completed,
    firstTokenMs,
    elapsedMs: Math.round(performance.now() - startedAt),
    tokenEvents,
    metadata,
  };
}

async function test(name, run) {
  const startedAt = performance.now();
  try {
    const evidence = await run();
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
      errorCode: error?.code ?? null,
    });
  }
}

const local = createBridgeServer({
  port: localPort,
  testMode: true,
  extraOrigins: origin,
  runtimeDir: path.join(runtimeRoot, "bridge"),
});
const hub = createPrivateHubServer({
  port: hubPort,
  testMode: true,
  extraOrigins: origin,
  runtimeDir: path.join(runtimeRoot, "hub"),
});

try {
  await Promise.all([local.start(), hub.start()]);
  const localProtocol = "novel-local-bridge/v1";
  const hubProtocol = "novel-private-hub/v1";
  const [localSession, hubSession] = await Promise.all([
    pair(localBase, "X-Bridge-Protocol", localProtocol),
    pair(hubBase, "X-Private-Hub-Protocol", hubProtocol),
  ]);
  const [localModels, hubModels] = await Promise.all([
    json(await fetch(`${localBase}/models`, {
      headers: headers("X-Bridge-Protocol", localProtocol, localSession),
    })),
    json(await fetch(`${hubBase}/models`, {
      headers: headers("X-Private-Hub-Protocol", hubProtocol, hubSession),
    })),
  ]);
  const localModel = localModels.models.find((model) => model.modelId === "qwen2.5:3b")
    ?? localModels.models.find((model) => model.capabilities?.textGeneration?.value);
  const hubModel = hubModels.models.find((model) => model.modelId === "qwen2.5:3b")
    ?? hubModels.models.find((model) => model.capabilities?.textGeneration?.value);

  await test("isolated optimization runtimes discover the same real Ollama model", async () => {
    assert.ok(localModel?.modelId);
    assert.ok(hubModel?.modelId);
    assert.equal(localModel.modelId, hubModel.modelId);
    return {
      modelId: localModel.modelId,
      modelDigest: localModel.modelDigest,
      externalAiCalls: 0,
    };
  });

  await test("runtime health exposes queue and cache resource governance", async () => {
    const [localHealth, hubHealth] = await Promise.all([
      json(await fetch(`${localBase}/health`, {
        headers: headers("X-Bridge-Protocol", localProtocol),
      })),
      json(await fetch(`${hubBase}/health`, {
        headers: headers("X-Private-Hub-Protocol", hubProtocol),
      })),
    ]);
    assert.equal(localHealth.runtimeReady, true);
    assert.equal(hubHealth.runtimeReady, true);
    assert.deepEqual(localHealth.workload, {
      active: 0,
      queued: 0,
      maxConcurrent: 1,
      maxQueue: 2,
    });
    assert.deepEqual(hubHealth.workload, {
      active: 0,
      queued: 0,
      maxConcurrent: 2,
      maxQueue: 4,
    });
    return {
      local: { workload: localHealth.workload, cache: localHealth.cache },
      hub: { workload: hubHealth.workload, cache: hubHealth.cache },
    };
  });

  await test("Local Bridge executes the optimized standard profile with real tokens", async () => {
    const profile = getClosedAIModelProfile("chapter.continue", "local-ollama");
    const prompt = buildClosedAIModelPrompt({
      objective: "續寫一小段，讓林昭在遵守規則的前提下做出選擇並承擔代價。",
      context: [
        "林昭是二十八歲的調查員，正在封閉圖書館尋找失蹤帳冊。",
        "已核准規則：午夜前任何人不得離開圖書館。",
      ],
      profile,
    });
    const output = await generate({
      base: localBase,
      protocolHeader: "X-Bridge-Protocol",
      protocol: localProtocol,
      session: localSession,
      body: {
        requestId: "optimization-local-real-0001",
        model: localModel.modelId,
        prompt: prompt.prompt,
        systemInstruction: profile.systemInstruction,
        taskType: "chapter.continue",
        timeoutMs: profile.timeoutMs,
        options: { ...profile.options, num_predict: 180 },
      },
    });
    assert.equal(output.completed, true);
    assert(output.content.length >= 40);
    assert.match(output.content, /[\u3400-\u9fff]/u);
    assert(output.firstTokenMs !== null);
    return {
      profileId: profile.profileId,
      firstTokenMs: output.firstTokenMs,
      elapsedMs: output.elapsedMs,
      outputCharacters: output.content.length,
      tokenEvents: output.tokenEvents,
      promptCharacters: prompt.inputCharacters,
    };
  });

  await test("Private Hub executes the optimized heavy profile with real tokens", async () => {
    const profile = getClosedAIModelProfile(
      "character.multiAgentSimulation",
      "private-ai-hub",
    );
    const prompt = buildClosedAIModelPrompt({
      objective: "模擬林昭與周遠對失蹤帳冊的短暫交鋒，輸出可供作者核准的場景候選。",
      context: [
        "林昭只知道帳冊失蹤，不知道周遠藏起了備份。",
        "周遠想保護第三人，因此不能直接說出備份位置。",
      ],
      profile,
    });
    const output = await generate({
      base: hubBase,
      protocolHeader: "X-Private-Hub-Protocol",
      protocol: hubProtocol,
      session: hubSession,
      body: {
        requestId: "optimization-hub-real-0001",
        projectId: "optimization-real-project",
        model: hubModel.modelId,
        prompt: prompt.prompt,
        systemInstruction: profile.systemInstruction,
        taskType: "character.multiAgentSimulation",
        timeoutMs: profile.timeoutMs,
        options: { ...profile.options, num_predict: 220 },
      },
    });
    assert.equal(output.completed, true);
    assert(output.content.length >= 40);
    assert.match(output.content, /[\u3400-\u9fff]/u);
    assert(output.firstTokenMs !== null);
    return {
      profileId: profile.profileId,
      firstTokenMs: output.firstTokenMs,
      elapsedMs: output.elapsedMs,
      outputCharacters: output.content.length,
      tokenEvents: output.tokenEvents,
      promptCharacters: prompt.inputCharacters,
    };
  });
} finally {
  await Promise.allSettled([local.stop(), hub.stop()]);
  await rm(runtimeRoot, { recursive: true, force: true });
}

const pass = results.filter((item) => item.status === "PASS").length;
const fail = results.length - pass;
console.log(JSON.stringify({
  suite: "Closed AI Optimization Real Model",
  runAt: new Date().toISOString(),
  pass,
  fail,
  skipped: 0,
  existingRuntimePortsModified: false,
  temporaryPorts: [localPort, hubPort],
  externalAiCalls: 0,
  results,
}, null, 2));
if (fail) process.exitCode = 1;
