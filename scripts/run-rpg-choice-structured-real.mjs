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
  let generatedTokenEvents = 0;
  let firstTokenMs = null;
  const startedAt = performance.now();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "token") {
        if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - startedAt);
        generatedTokenEvents += 1;
        content += String(event.text || "");
      }
      if (event.type === "completed") completed = true;
      if (event.type === "failed") throw new Error(String(event.errorCode || "LOCAL_GENERATION_FAILED"));
    }
  }
  assert.equal(completed, true, "Bridge stream must reach completed");
  return { content, firstTokenMs, generatedTokenEvents };
}

function normalized(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function grams(value) {
  const text = normalized(value);
  const result = new Set();
  for (let index = 0; index < text.length - 2; index += 1) result.add(text.slice(index, index + 3));
  return result;
}

function similarity(left, right) {
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return normalized(left) === normalized(right) ? 1 : 0;
  let overlap = 0;
  for (const gram of a) if (b.has(gram)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function validateStructuredChoices(content) {
  const parsed = JSON.parse(content);
  assert.deepEqual(Object.keys(parsed), ["choices"]);
  assert.equal(parsed.choices.length, 3);
  const byKey = new Map(parsed.choices.map((choice) => [choice.key, choice]));
  assert.equal(byKey.size, 3);
  const choices = ["A", "B", "C"].map((key) => byKey.get(key));
  assert.ok(choices.every(Boolean), "Structured choices must contain A, B, and C");
  assert.equal(new Set(choices.map((choice) => normalized(choice.title))).size, 3);
  for (const choice of choices) {
    assert.deepEqual(
      Object.keys(choice).sort(),
      ["consequenceTeaser", "description", "key", "title"],
    );
    assert.ok(choice.title.length >= 8 && choice.title.length <= 18);
    assert.ok(choice.description.length >= 30 && choice.description.length <= 72);
    assert.ok(choice.consequenceTeaser.length >= 12 && choice.consequenceTeaser.length <= 40);
    assert.doesNotMatch(
      `${choice.title}|${choice.description}|${choice.consequenceTeaser}`,
      /8至18字|30至72字|12至40字/u,
    );
  }
  for (let left = 0; left < choices.length; left += 1) {
    for (let right = left + 1; right < choices.length; right += 1) {
      assert.ok(
        similarity(
          `${choices[left].title}${choices[left].description}`,
          `${choices[right].title}${choices[right].description}`,
        ) < 0.72,
        "Structured RPG choices must be materially distinct",
      );
    }
  }
  return choices;
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
  assert.match(String(model.modelDigest || ""), /^[a-f0-9]{64}$/iu, "qwen2.5:3b must expose a verified model digest");

  const startedAt = performance.now();
  const basePrompt = `上一章：星橋在雨夜崩裂，守塔人隱瞞巡查紀錄，主角只剩六成靈力且必須在天亮前找到失蹤同伴。

請提出 A、B、C 三條承接上下文且文案明顯不同的下一步。每個 key 的策略、成本與規則欄位已由輸入鎖定，你只能改寫 title、description、consequenceTeaser。三個 title 必須彼此不同；下方每個字串都只是提示，必須改寫成具體候選，不可照抄「8至18字」等提示。只輸出下列 JSON 物件，不要 Markdown 或說明：
{"choices":[{"key":"A","title":"八至十八字的具體行動標題","description":"寫出三十至七十二字的具體行動、對象、眼前阻力與可觀察目的","consequenceTeaser":"寫出十二至四十字的已知代價與後果提示"},{"key":"B","title":"八至十八字的不同具體標題","description":"寫出三十至七十二字的另一個具體行動、對象、眼前阻力與可觀察目的","consequenceTeaser":"寫出十二至四十字的另一項已知代價提示"},{"key":"C","title":"八至十八字的第三個具體標題","description":"寫出三十至七十二字的第三個具體行動、對象、眼前阻力與可觀察目的","consequenceTeaser":"寫出十二至四十字的第三項已知代價提示"}]}`;
  const attempts = [];
  let accepted = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const providerRunId = `rpg-structured-real-${crypto.randomUUID()}`;
    const correction = attempt === 1
      ? ""
      : "\n\n前次未通過 RPG 結構契約。請從頭產生新 JSON，逐項檢查唯一根鍵 choices、恰好 A/B/C、四個必填欄位、欄位長度與三組實質不同文案。";
    const prompt = `${basePrompt}${correction}`;
    let generated = { content: "", firstTokenMs: null, generatedTokenEvents: 0 };
    try {
      generated = await readGeneration(await fetch(`${base}/generate`, {
        method: "POST",
        headers: { ...authHeaders, "Idempotency-Key": providerRunId },
        body: JSON.stringify({
          requestId: providerRunId,
          model: model.modelId,
          taskType: "chapter.abcChoices",
          timeoutMs: 120_000,
          systemInstruction: "你是繁體中文小說 RPG 文案導演。規則引擎已鎖定策略、機率、需求、成本與效果；你只能改寫 key、title、description、consequenceTeaser 四欄並輸出合法 A/B/C JSON。",
          prompt,
          options: {
            num_predict: 420,
            temperature: attempt === 1 ? 0.45 : 0.35,
            top_p: 0.86,
            repeat_penalty: 1.16,
            seed: 240503 + (attempt - 1) * 104729,
          },
        }),
      }));
      const choices = validateStructuredChoices(generated.content);
      const metadata = {
        attempt,
        providerRunId,
        status: "PASS",
        outputDigest: crypto.createHash("sha256").update(generated.content).digest("hex"),
        contextDigest: crypto.createHash("sha256").update(prompt).digest("hex"),
        outputCharacters: generated.content.length,
        generatedTokenEvents: generated.generatedTokenEvents,
        firstTokenMs: generated.firstTokenMs,
      };
      attempts.push(metadata);
      accepted = { choices, generated, metadata };
      break;
    } catch (error) {
      lastError = error;
      attempts.push({
        attempt,
        providerRunId,
        status: "FAIL",
        errorCode: error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : "RPG_STRUCTURED_SCHEMA_INVALID",
        outputDigest: generated.content
          ? crypto.createHash("sha256").update(generated.content).digest("hex")
          : crypto.createHash("sha256").update("").digest("hex"),
        contextDigest: crypto.createHash("sha256").update(prompt).digest("hex"),
        outputCharacters: generated.content.length,
        generatedTokenEvents: generated.generatedTokenEvents,
        firstTokenMs: generated.firstTokenMs,
      });
    }
  }
  if (!accepted) {
    console.error(JSON.stringify({
      schemaVersion: "rpg-choice-structured-real-v1",
      status: "FAIL",
      errorCode: "RPG_STRUCTURED_SCHEMA_INVALID",
      attempts,
      elapsedMs: Math.round(performance.now() - startedAt),
      rawPromptStored: false,
      rawOutputStored: false,
      outputPersisted: false,
    }, null, 2));
    throw lastError;
  }
  const { choices, generated, metadata } = accepted;

  console.log(JSON.stringify({
    schemaVersion: "rpg-choice-structured-real-v1",
    status: "PASS",
    executor: "local-ollama",
    modelId: model.modelId,
    modelDigest: model.modelDigest,
    actualExecutor: "local-ollama",
    providerRunId: metadata.providerRunId,
    taskType: "chapter.abcChoices",
    choiceKeys: choices.map((choice) => choice.key),
    distinctTitles: new Set(choices.map((choice) => choice.title)).size,
    outputCharacters: generated.content.length,
    generatedTokenEvents: generated.generatedTokenEvents,
    firstTokenMs: generated.firstTokenMs,
    attemptCount: attempts.length,
    attempts,
    outputDigest: metadata.outputDigest,
    contextDigest: metadata.contextDigest,
    elapsedMs: Math.round(performance.now() - startedAt),
    externalRequest: false,
    dataLeftDevice: false,
    candidateOnly: true,
    canonicalMutationCount: 0,
    rawPromptStored: false,
    rawOutputStored: false,
    outputPersisted: false,
  }, null, 2));
} finally {
  await bridge.stop();
}
