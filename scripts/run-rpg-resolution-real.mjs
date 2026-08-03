import assert from "node:assert/strict";
import crypto from "node:crypto";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";
import {
  resolveLocalOllamaPerformanceBudget,
} from "../lib/novel-ai/providers/local-ollama/local-ollama-provider.ts";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../lib/novel-ai/providers/closed/task-profile.ts";
import {
  buildRpgResolutionDirectorPrompt,
  cleanRpgContinuation,
} from "../lib/novel-ai/web/rpg-closed-ai-director.ts";
import {
  humanizedSerialFictionInstruction,
} from "../lib/novel-ai/web/humanized-serial-fiction-profile.ts";

const origin = "http://127.0.0.1:3000";
const port = Number(process.env.RPG_RESOLUTION_REAL_TEST_PORT || 33_418);
const base = `http://127.0.0.1:${port}`;
const requestedMaxTokens = Number(process.env.RPG_REAL_REQUESTED_TOKENS || 288);
const bridge = createBridgeServer({ testMode: true, port });

const publicHeaders = {
  Origin: origin,
  "X-Bridge-Protocol": BRIDGE_PROTOCOL,
  "Content-Type": "application/json",
};

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(JSON.stringify(body)), body);
  return body;
}

async function readGeneration(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(JSON.stringify(body)), body);
  }
  const reader = response.body?.getReader();
  assert.ok(reader, "Bridge generation response must be streamed");
  const decoder = new TextDecoder();
  let pending = "";
  let content = "";
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
      if (event.type === "failed") {
        throw Object.assign(
          new Error(String(event.message || event.errorCode || "LOCAL_GENERATION_FAILED")),
          { code: event.errorCode || "LOCAL_GENERATION_FAILED" },
        );
      }
    }
  }
  return { content, firstTokenMs, generatedTokenEvents };
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

  const profile = getClosedAIModelProfile("chapter.continue", "local-ollama");
  const budget = resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: model.modelId,
    qualityPreference: "fast",
    requestedMaxTokens,
    profileMaxTokens: profile.options.num_predict,
    profileMaxInputCharacters: profile.maxInputCharacters,
  });
  const resolutionPrompt = buildRpgResolutionDirectorPrompt({
    context: {
      currentChapter: "雨夜裡，沈曜發現星橋斷裂，守塔人正把巡查紀錄投入火盆。失蹤同伴的求救燈號在河對岸一閃而逝。",
      protagonist: { name: "沈曜", goal: "天亮前找到失蹤同伴" },
      worldRules: ["靈力只能透過星燈補充", "破壞巡查紀錄會引來執法隊"],
      unresolvedThreads: ["守塔人為何隱瞞紀錄", "河對岸的燈號是否為陷阱"],
      recentTurns: [],
    },
    choice: {
      key: "A",
      title: "搶救半頁紀錄",
      description: "沈曜撲向火盆搶出尚未燒盡的巡查紀錄，同時逼守塔人說出燈號來源。",
      consequence: "可取得證據，但會驚動執法隊。",
      aiContinuityReason: "直接承接火盆、失蹤同伴與夜間時限。",
      encounter: { id: "burning-log", label: "焚燒中的巡查紀錄" },
    },
    resolution: {
      outcomeLabel: "勉強成功",
      roll: 47,
      successChance: 55,
      settlement: ["行動點 -1", "靈力 -2", "金幣 -80", "EXP +45", "執法隊警戒 +1"],
    },
  });
  const baseObjective = [
    resolutionPrompt,
    "請將候選正文寫到約 240 個中文字，至少 150 字；必須完成本場景的新事件與直接後果。",
    humanizedSerialFictionInstruction("chapter.continue", 240),
  ].join("\n\n");
  const startedAt = performance.now();
  const attempts = [];
  let accepted = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const repairRequirement = attempt === 1
      ? ""
      : "\n\n前一版不合格。務必寫滿四個連續段落，每段至少兩句，依序呈現行動落地、人物反應、代價發生，以及下回合可處理的新局勢；只輸出小說正文。";
    const effectiveProfile = {
      ...profile,
      maxInputCharacters: budget.maxInputCharacters,
      options: {
        ...profile.options,
        num_predict: budget.maxOutputTokens,
        temperature: 0.84,
        top_p: 0.94,
        repeat_penalty: 1.18,
        num_ctx: 4_096,
        seed: 240503 + (attempt - 1) * 104729,
      },
    };
    const built = buildClosedAIModelPrompt({
      objective: `${baseObjective}${repairRequirement}`,
      context: [
        "目前章節：雨水沿著沈曜的袖口滴進火盆，墨跡在火舌裡捲曲。守塔人後退半步，河對岸的求救燈號又亮了一次。",
        "角色：沈曜謹慎但不會拋下同伴；守塔人害怕執法隊。",
        "正式規則：不得改寫擲骰結果；不得自行新增能力值、貨幣或物品數字。",
      ],
      profile: effectiveProfile,
      qualityPhase: "draft",
    });
    const requestId = `rpg-resolution-real-${Date.now()}-${attempt}`;
    const generated = await readGeneration(await fetch(`${base}/generate`, {
      method: "POST",
      headers: { ...authHeaders, "Idempotency-Key": requestId },
      body: JSON.stringify({
        requestId,
        model: model.modelId,
        taskType: "chapter.continue",
        timeoutMs: effectiveProfile.timeoutMs,
        systemInstruction: effectiveProfile.systemInstruction,
        prompt: built.prompt,
        options: effectiveProfile.options,
      }),
    }));
    const metrics = {
      attempt,
      inputCharacters: built.inputCharacters,
      outputCharacters: generated.content.trim().length,
      generatedTokenEvents: generated.generatedTokenEvents,
      firstTokenMs: generated.firstTokenMs,
      outputDigest: crypto.createHash("sha256").update(generated.content).digest("hex"),
    };
    try {
      const continuation = cleanRpgContinuation(generated.content, []);
      attempts.push({ ...metrics, status: "PASS" });
      accepted = { continuation, generated, built };
      break;
    } catch (error) {
      lastError = error;
      attempts.push({
        ...metrics,
        status: "FAIL",
        errorCode: error instanceof Error ? error.message : String(error),
      });
      if (process.env.RPG_REAL_DEBUG_OUTPUT === "1") {
        console.error(`--- SYNTHETIC RPG OUTPUT ${attempt} ---`);
        console.error(generated.content);
        console.error("--- END SYNTHETIC RPG OUTPUT ---");
      }
    }
  }
  if (!accepted) {
    console.error(JSON.stringify({
      schemaVersion: "rpg-resolution-real-v1",
      status: "FAIL",
      errorCode: lastError instanceof Error ? lastError.message : String(lastError),
      requestedMaxTokens,
      effectiveMaxTokens: budget.maxOutputTokens,
      attempts,
      elapsedMs: Math.round(performance.now() - startedAt),
      outputPersisted: false,
    }, null, 2));
    throw lastError;
  }
  const { continuation, generated, built } = accepted;

  console.log(JSON.stringify({
    schemaVersion: "rpg-resolution-real-v1",
    status: "PASS",
    executor: "local-ollama",
    modelId: model.modelId,
    taskType: "chapter.continue",
    requestedMaxTokens,
    effectiveMaxTokens: budget.maxOutputTokens,
    inputCharacters: built.inputCharacters,
    outputCharacters: continuation.length,
    generatedTokenEvents: generated.generatedTokenEvents,
    firstTokenMs: generated.firstTokenMs,
    attemptCount: attempts.length,
    attempts,
    elapsedMs: Math.round(performance.now() - startedAt),
    outputDigest: crypto.createHash("sha256").update(continuation).digest("hex"),
    externalAiCalls: 0,
    dataLeftDevice: false,
    outputPersisted: false,
  }, null, 2));
} finally {
  await bridge.stop();
}
