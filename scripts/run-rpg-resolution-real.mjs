import assert from "node:assert/strict";
import crypto from "node:crypto";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";
import {
  buildSubstantiveSceneContinuationPrompt,
  mergeSubstantiveSceneContinuation,
  resolveLocalOllamaPerformanceBudget,
} from "../lib/novel-ai/providers/local-ollama/local-ollama-provider.ts";
import {
  buildClosedAIModelPrompt,
  getClosedAIModelProfile,
} from "../lib/novel-ai/providers/closed/task-profile.ts";
import {
  buildRpgResolutionDirectorPrompt,
  cleanRpgContinuation,
  validateRpgStoryTurnContract,
} from "../lib/novel-ai/web/rpg-closed-ai-director.ts";
import {
  humanizedSerialFictionInstruction,
} from "../lib/novel-ai/web/humanized-serial-fiction-profile.ts";

const origin = "http://127.0.0.1:3000";
const port = Number(process.env.RPG_RESOLUTION_REAL_TEST_PORT || 33_418);
const base = `http://127.0.0.1:${port}`;
const requestedMaxTokens = Number(process.env.RPG_REAL_REQUESTED_TOKENS || 1_792);
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
  let completed = false;
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
      if (event.type === "completed") completed = true;
    }
  }
  assert.equal(completed, true, "Bridge generation stream must reach completed");
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
  assert.match(String(model.modelDigest || ""), /^[a-f0-9]{64}$/iu, "qwen2.5:3b must expose a verified model digest");

  const profile = getClosedAIModelProfile("chapter.continue", "local-ollama");
  const budget = resolveLocalOllamaPerformanceBudget({
    taskType: "chapter.continue",
    modelId: model.modelId,
    qualityPreference: "fast",
    requestedMaxTokens,
    profileMaxTokens: profile.options.num_predict,
    profileMaxInputCharacters: profile.maxInputCharacters,
    substantiveScene: true,
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
      consequenceTeaser: "可取得關鍵證據，但也會驚動執法隊。",
      encounter: { id: "burning-log", label: "焚燒中的巡查紀錄" },
    },
    resolution: {
      outcomeLabel: "勉強成功",
      roll: 47,
      successChance: 55,
      settlement: ["行動點 -1", "靈力 -2", "金幣 -80", "EXP +45", "執法隊警戒 +1"],
    },
    language: "zh-TW",
  });
  const baseObjective = [
    resolutionPrompt,
    humanizedSerialFictionInstruction("chapter.continue", 1_600),
  ].join("\n\n");
  const startedAt = performance.now();
  const attempts = [];
  let accepted = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 1; attempt += 1) {
    const effectiveProfile = {
      ...profile,
      maxInputCharacters: budget.maxInputCharacters,
      options: {
        ...profile.options,
        num_predict: budget.maxOutputTokens,
        temperature: 0.72,
        top_p: 0.92,
        repeat_penalty: 1.12,
        num_ctx: 8_192,
        seed: 240503 + (attempt - 1) * 104729,
      },
      timeoutMs: Math.max(profile.timeoutMs, 240_000),
    };
    const built = buildClosedAIModelPrompt({
      objective: baseObjective,
      context: [
        "目前章節：雨水沿著沈曜的袖口滴進火盆，墨跡在火舌裡捲曲。守塔人後退半步，河對岸的求救燈號又亮了一次。",
        "角色：沈曜謹慎但不會拋下同伴；守塔人害怕執法隊。",
        "正式規則：不得改寫擲骰結果；不得自行新增能力值、貨幣或物品數字。",
      ],
      profile: effectiveProfile,
      qualityPhase: "draft",
    });
    const requestId = `rpg-resolution-real-${crypto.randomUUID()}`;
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
      providerRunId: requestId,
      inputCharacters: built.inputCharacters,
      outputCharacters: generated.content.trim().length,
      generatedTokenEvents: generated.generatedTokenEvents,
      firstTokenMs: generated.firstTokenMs,
      outputDigest: crypto.createHash("sha256").update(generated.content).digest("hex"),
    };
    try {
      const continuation = await cleanRpgContinuation(generated.content, [], "zh-TW");
      const contract = validateRpgStoryTurnContract(continuation, "zh-TW");
      attempts.push({ ...metrics, ...contract, status: "PASS" });
      accepted = {
        continuation,
        generated,
        built,
        contract,
        providerRunId: requestId,
        contextDigest: crypto.createHash("sha256").update(built.prompt).digest("hex"),
      };
      break;
    } catch (error) {
      lastError = error;
      const initialFailure = {
        ...metrics,
        status: error instanceof Error && error.message === "RPG_AI_CONTINUATION_TOO_SHORT"
          ? "SUPPLEMENT_REQUIRED"
          : "FAIL",
        errorCode: error instanceof Error ? error.message : String(error),
        narrativeLength: Number(error?.narrativeLength) || 0,
        paragraphCount: Number(error?.paragraphCount) || 0,
        sentenceCount: Number(error?.sentenceCount) || 0,
      };
      attempts.push(initialFailure);
      if (!(error instanceof Error) || error.message !== "RPG_AI_CONTINUATION_TOO_SHORT") continue;

      let merged = generated.content;
      let supplementTokenEvents = 0;
      const supplementPrompts = [];
      for (let supplementAttempt = 2; supplementAttempt <= 3; supplementAttempt += 1) {
        const continuationPlan = buildSubstantiveSceneContinuationPrompt(merged);
        supplementPrompts.push(continuationPlan.prompt);
        const providerRunId = `rpg-resolution-real-${crypto.randomUUID()}`;
        const remainingTimeMs = Math.floor(240_000 - (performance.now() - startedAt));
        if (remainingTimeMs < 100) {
          lastError = Object.assign(new Error("OLLAMA_TIMEOUT"), { code: "OLLAMA_TIMEOUT" });
          break;
        }
        const supplement = await readGeneration(await fetch(`${base}/generate`, {
          method: "POST",
          headers: { ...authHeaders, "Idempotency-Key": providerRunId },
          body: JSON.stringify({
            requestId: providerRunId,
            model: model.modelId,
            taskType: "chapter.continue",
            timeoutMs: Math.min(120_000, remainingTimeMs),
            systemInstruction: effectiveProfile.systemInstruction,
            prompt: continuationPlan.prompt,
            options: {
              ...effectiveProfile.options,
              num_predict: Math.min(896, effectiveProfile.options.num_predict),
              temperature: supplementAttempt === 2 ? 0.66 : 0.6,
              top_p: 0.88,
              seed: 240503 + (supplementAttempt - 1) * 104729,
            },
          }),
        }));
        supplementTokenEvents += supplement.generatedTokenEvents;
        merged = mergeSubstantiveSceneContinuation(merged, supplement.content);
        const supplementMetrics = {
          attempt: supplementAttempt,
          providerRunId,
          inputCharacters: continuationPlan.prompt.length,
          outputCharacters: supplement.content.trim().length,
          generatedTokenEvents: supplement.generatedTokenEvents,
          firstTokenMs: supplement.firstTokenMs,
          outputDigest: crypto.createHash("sha256").update(supplement.content).digest("hex"),
        };
        try {
          const continuation = await cleanRpgContinuation(merged, [], "zh-TW");
          const contract = validateRpgStoryTurnContract(continuation, "zh-TW");
          attempts.push({ ...supplementMetrics, ...contract, status: "PASS" });
          accepted = {
            continuation,
            generated: {
              ...generated,
              generatedTokenEvents: generated.generatedTokenEvents + supplementTokenEvents,
            },
            built,
            contract,
            providerRunId,
            contextDigest: crypto.createHash("sha256")
              .update([built.prompt, ...supplementPrompts].join("\n"))
              .digest("hex"),
          };
          break;
        } catch (supplementError) {
          lastError = supplementError;
          attempts.push({
            ...supplementMetrics,
            status: supplementAttempt < 3 && supplementError instanceof Error && supplementError.message === "RPG_AI_CONTINUATION_TOO_SHORT"
              ? "SUPPLEMENT_REQUIRED"
              : "FAIL",
            errorCode: supplementError instanceof Error ? supplementError.message : String(supplementError),
            narrativeLength: Number(supplementError?.narrativeLength) || 0,
            paragraphCount: Number(supplementError?.paragraphCount) || 0,
            sentenceCount: Number(supplementError?.sentenceCount) || 0,
          });
          if (!(supplementError instanceof Error) || supplementError.message !== "RPG_AI_CONTINUATION_TOO_SHORT") break;
        }
      }
      if (accepted) break;
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
      rawPromptStored: false,
      rawOutputStored: false,
      outputPersisted: false,
    }, null, 2));
    throw lastError;
  }
  const { continuation, generated, built, contract, providerRunId, contextDigest } = accepted;

  console.log(JSON.stringify({
    schemaVersion: "rpg-resolution-real-v1",
    status: "PASS",
    executor: "local-ollama",
    modelId: model.modelId,
    modelDigest: model.modelDigest,
    promptProfileVersion: profile.profileId,
    actualExecutor: "local-ollama",
    providerRunId,
    taskType: "chapter.continue",
    requestedMaxTokens,
    effectiveMaxTokens: budget.maxOutputTokens,
    inputCharacters: built.inputCharacters,
    outputCharacters: continuation.length,
    narrativeLength: contract.narrativeLength,
    paragraphCount: contract.paragraphCount,
    sentenceCount: contract.sentenceCount,
    generatedTokenEvents: generated.generatedTokenEvents,
    firstTokenMs: generated.firstTokenMs,
    attemptCount: attempts.length,
    attempts,
    elapsedMs: Math.round(performance.now() - startedAt),
    outputDigest: crypto.createHash("sha256").update(continuation).digest("hex"),
    contextDigest,
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
