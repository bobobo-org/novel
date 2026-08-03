import assert from "node:assert/strict";
import crypto from "node:crypto";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";

const origin = "http://127.0.0.1:3000";
const port = Number(process.env.RPG_REAL_TEST_PORT || 33_417);
const base = `http://127.0.0.1:${port}`;
const bridge = createBridgeServer({ testMode: true, port });

const publicHeaders = {
  Origin: origin,
  "X-Bridge-Protocol": BRIDGE_PROTOCOL,
  "Content-Type": "application/json",
};

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
}

async function readGeneration(response) {
  if (!response.ok) throw new Error(JSON.stringify(await response.json().catch(() => ({}))));
  const reader = response.body?.getReader();
  assert.ok(reader, "Bridge generation response must be streamed");
  const decoder = new TextDecoder();
  let pending = "";
  let content = "";
  let completed = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "token") content += String(event.text || "");
      if (event.type === "completed") completed = true;
      if (event.type === "failed") throw new Error(String(event.errorCode || "LOCAL_GENERATION_FAILED"));
    }
  }
  assert.equal(completed, true, "Bridge stream must reach completed");
  return content;
}

await bridge.start();
try {
  const requested = await json(await fetch(`${base}/pair/request`, {
    method: "POST",
    headers: publicHeaders,
    body: "{}",
  }));
  const session = await json(await fetch(`${base}/pair/confirm`, {
    method: "POST",
    headers: publicHeaders,
    body: JSON.stringify({ pairingId: requested.pairingId, code: requested.testCode }),
  }));
  const authHeaders = {
    ...publicHeaders,
    Authorization: `Bearer ${session.token}`,
    "X-Bridge-CSRF": session.csrf,
  };
  const models = await json(await fetch(`${base}/models`, {
    headers: {
      Origin: origin,
      "X-Bridge-Protocol": BRIDGE_PROTOCOL,
      Authorization: `Bearer ${session.token}`,
    },
  }));
  const model = models.models.find((item) => /^qwen2\.5:3b$/iu.test(item.modelId))
    ?? models.models.find((item) => /qwen2\.5.*3b/iu.test(item.modelId));
  assert.ok(model?.modelId, "qwen2.5:3b must be installed for the real RPG gate");

  const requestId = `rpg-structured-real-${Date.now()}`;
  const startedAt = performance.now();
  const content = await readGeneration(await fetch(`${base}/generate`, {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": requestId },
    body: JSON.stringify({
      requestId,
      model: model.modelId,
      taskType: "chapter.abcChoices",
      timeoutMs: 240_000,
      systemInstruction: "你是繁體中文小說 RPG 導演。嚴守既有角色、世界規則與未解伏筆，只提出可執行且有代價的不同策略。各欄務必精煉：title 3–18 字、description 18–72 字、consequence 8–44 字、continuityReason 8–50 字。",
      prompt: "上一章：星橋在雨夜崩裂，守塔人隱瞞巡查紀錄，主角只剩六成靈力且必須在天亮前找到失蹤同伴。請提出 A、B、C 三條承接上下文但風險與代價不同的下一步。",
      options: {
        num_predict: 420,
        temperature: 0.82,
        top_p: 0.94,
        repeat_penalty: 1.16,
        seed: 240503,
      },
    }),
  }));

  const parsed = JSON.parse(content);
  assert.deepEqual(Object.keys(parsed), ["choices"]);
  assert.equal(parsed.choices.length, 3);
  assert.deepEqual(parsed.choices.map((choice) => choice.key), ["A", "B", "C"]);
  assert.equal(new Set(parsed.choices.map((choice) => choice.title)).size, 3);
  for (const choice of parsed.choices) {
    assert.ok(choice.title.length >= 3);
    assert.ok(choice.description.length >= 18);
    assert.ok(choice.consequence.length >= 8);
    assert.ok(choice.continuityReason.length >= 8);
  }

  console.log(JSON.stringify({
    schemaVersion: "rpg-choice-structured-real-v1",
    status: "PASS",
    executor: "local-ollama",
    modelId: model.modelId,
    taskType: "chapter.abcChoices",
    choiceKeys: parsed.choices.map((choice) => choice.key),
    distinctTitles: new Set(parsed.choices.map((choice) => choice.title)).size,
    outputDigest: crypto.createHash("sha256").update(content).digest("hex"),
    elapsedMs: Math.round(performance.now() - startedAt),
    externalAiCalls: 0,
    dataLeftDevice: false,
    outputPersisted: false,
  }, null, 2));
} finally {
  await bridge.stop();
}
