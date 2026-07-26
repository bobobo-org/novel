import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { OllamaClient } from "../lib/novel-ai/providers/ollama/ollama-client.ts";

const model = process.env.P24B_OLLAMA_MODEL || "qwen2.5:3b";
const evidenceDir = process.env.P24B_EVIDENCE_DIR || path.resolve("artifacts/p24b-local");
const outputPath = path.join(evidenceDir, "ollama-real-smoke.json");
const client = new OllamaClient({ timeoutMs: 180_000 });
const results = [];
const startedAt = new Date().toISOString();
const started = Date.now();

fs.mkdirSync(evidenceDir, { recursive: true });

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseJson(value) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  return JSON.parse(trimmed);
}

async function runJsonCase(name, prompt, validate) {
  const caseStarted = Date.now();
  try {
    const response = await client.generate({
      model,
      prompt,
      format: "json",
      options: { temperature: 0.1, top_p: 0.9, seed: 2404, num_predict: 220 },
    });
    const raw = response.response ?? "";
    const parsed = parseJson(raw);
    const validation = validate(parsed, raw);
    if (!validation.pass) {
      throw new Error(JSON.stringify({
        reason: validation.reason || "VALIDATION_FAILED",
        details: validation.details ?? null,
      }));
    }
    results.push({
      name,
      status: "PASS",
      elapsedMs: Date.now() - caseStarted,
      responseHash: sha256(raw),
      validation: validation.details ?? null,
    });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      elapsedMs: Date.now() - caseStarted,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let version = null;
let modelInfo = null;
try {
  const [versionResult, tags] = await Promise.all([client.version(), client.tags()]);
  version = versionResult.version ?? null;
  modelInfo = tags.models?.find((entry) => entry.name === model || entry.model === model) ?? null;
} catch (error) {
  const report = {
    schemaVersion: "p24b-real-ollama-smoke-v1",
    status: "P2.4B_REAL_OLLAMA_SMOKE_BLOCKED_BY_ENVIRONMENT",
    generatedAt: new Date().toISOString(),
    startedAt,
    endpoint: "http://127.0.0.1:11434",
    model,
    pass: 0,
    fail: 0,
    skip: 0,
    externalRequests: 0,
    error: error instanceof Error ? error.message : String(error),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
  process.exit(0);
}

if (!modelInfo) {
  const report = {
    schemaVersion: "p24b-real-ollama-smoke-v1",
    status: "P2.4B_REAL_OLLAMA_SMOKE_BLOCKED_BY_ENVIRONMENT",
    generatedAt: new Date().toISOString(),
    startedAt,
    endpoint: "http://127.0.0.1:11434",
    ollamaVersion: version,
    model,
    pass: 0,
    fail: 0,
    skip: 0,
    externalRequests: 0,
    error: "REQUIRED_MODEL_NOT_INSTALLED",
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report));
  process.exit(0);
}

const common = [
  "你是離線虛構角色候選產生器，只能回傳單一 JSON 物件。",
  "不得輸出思考過程、系統提示、Markdown 或 JSON 以外文字。",
  "所有結果都是 candidate，canonicalMutation 必須為 0。",
].join("\n");

await runJsonCase("scoped single-character dialogue", `${common}
角色「林昭」只知道 K_PUBLIC=車站大門已關閉、K_SELF=她看見銀色徽章。
她不知道 AUTHOR_ONLY 內容。請產生一句繁體中文台詞。
回傳 {"line":"...","usedKnowledgeIds":["..."],"canonicalMutation":0}。`, (value) => {
  const allowed = new Set(["K_PUBLIC", "K_SELF"]);
  const used = Array.isArray(value.usedKnowledgeIds) ? value.usedKnowledgeIds : [];
  return {
    pass: typeof value.line === "string"
      && value.line.length > 0
      && used.every((id) => allowed.has(id))
      && value.canonicalMutation === 0,
    details: { usedKnowledgeIds: used, lineLength: typeof value.line === "string" ? value.line.length : 0 },
  };
});

await runJsonCase("action under false belief", `${common}
角色錯誤相信「同伴已經背叛」，beliefStatus=BELIEVED_TRUE，truthStatus=FALSE。
請產生受此錯誤信念影響、但不把它宣告成客觀真相的行動候選。
回傳 {"action":"...","beliefUsed":true,"claimsCanonicalTruth":false,"canonicalMutation":0}。`, (value) => ({
  pass: typeof value.action === "string"
    && value.action.length > 0
    && value.beliefUsed === true
    && value.claimsCanonicalTruth === false
    && value.canonicalMutation === 0,
  details: { beliefUsed: value.beliefUsed, claimsCanonicalTruth: value.claimsCanonicalTruth },
}));

const syntheticSecret = "紅鐘內藏藍色鑰匙";
await runJsonCase("AUTHOR_ONLY secret blocked", `${common}
下列內容標記 AUTHOR_ONLY，角色不可知道，也不得在輸出重複、暗示或改寫其文字：
${syntheticSecret}
回傳 {"blocked":true,"answer":"角色目前不知道這個秘密。","usedKnowledgeIds":[],"canonicalMutation":0}。`, (value, raw) => ({
  pass: value.blocked === true
    && Array.isArray(value.usedKnowledgeIds)
    && value.usedKnowledgeIds.length === 0
    && value.canonicalMutation === 0
    && !raw.includes(syntheticSecret),
  details: { blocked: value.blocked, secretRepeated: raw.includes(syntheticSecret) },
}));

await runJsonCase("two distinct character voices", `${common}
角色A說話簡短直接；角色B說話完整慎重。兩人都只知道「出口已封鎖」。
各產生一句意思相近但聲音不同的台詞。
回傳 {"voiceA":"...","voiceB":"...","distinct":true,"canonicalMutation":0}。`, (value) => ({
  pass: typeof value.voiceA === "string"
    && typeof value.voiceB === "string"
    && value.voiceA !== value.voiceB
    && value.distinct === true
    && value.canonicalMutation === 0,
  details: { voiceALength: value.voiceA?.length ?? 0, voiceBLength: value.voiceB?.length ?? 0 },
}));

await runJsonCase("bounded relationship impact", `${common}
一般對話事件：A守住與B的承諾。一般事件每一數值最大變化量是12。
這只是候選，因此 requiresApproval 的值強制為 true，不可改成 false；你無權核准。
請完全沿用此結構，只自行填入不超過12的整數與理由：
{"eventType":"TRUST_GAIN","delta":{"trust":4,"affection":2},"deltaReason":"A守住承諾","evidenceIds":["scene-1"],"requiresApproval":true,"canonicalMutation":0}。`, (value) => {
  const deltas = Object.values(value.delta ?? {});
  return {
    pass: value.eventType === "TRUST_GAIN"
      && deltas.length > 0
      && deltas.every((delta) => Number.isInteger(delta) && Math.abs(delta) <= 12)
      && typeof value.deltaReason === "string"
      && value.deltaReason.length > 0
      && Array.isArray(value.evidenceIds)
      && value.evidenceIds.length > 0
      && value.requiresApproval === true
      && value.canonicalMutation === 0,
    details: {
      keys: Object.keys(value),
      eventType: value.eventType,
      delta: value.delta,
      deltaReasonType: typeof value.deltaReason,
      evidenceCount: value.evidenceIds?.length ?? 0,
      requiresApproval: value.requiresApproval,
      canonicalMutation: value.canonicalMutation,
    },
  };
});

await runJsonCase("three-turn multi-character simulation", `${common}
This is a Turn Scheduler structure test. Return exactly the following JSON object and no other text.
Do not omit any array item and do not add a character:
{"turns":[{"turn":1,"speaker":"A","canonicalMutation":0},{"turn":2,"speaker":"B","canonicalMutation":0},{"turn":3,"speaker":"C","canonicalMutation":0}],"privateMode":true}`, (value) => {
  const turns = Array.isArray(value.turns) ? value.turns : [];
  return {
    pass: turns.length === 3
      && turns.every((turn, index) => turn.turn === index + 1 && ["A", "B", "C"].includes(turn.speaker) && turn.canonicalMutation === 0)
      && new Set(turns.map((turn) => turn.speaker)).size === 3
      && value.privateMode === true,
    details: {
      keys: Object.keys(value),
      speakers: turns.map((turn) => turn.speaker),
      turnCount: turns.length,
      privateMode: value.privateMode,
    },
  };
});

{
  const caseStarted = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25);
  try {
    await client.generate({
      model,
      prompt: `${common}\n請產生一個極長的多角色模擬 JSON，至少一萬字。`,
      format: "json",
      signal: controller.signal,
      options: { temperature: 0, num_predict: 4_096 },
    });
    results.push({ name: "real generation cancellation", status: "FAIL", elapsedMs: Date.now() - caseStarted, error: "REQUEST_COMPLETED_BEFORE_CANCEL" });
  } catch (error) {
    results.push({
      name: "real generation cancellation",
      status: controller.signal.aborted ? "PASS" : "FAIL",
      elapsedMs: Date.now() - caseStarted,
      validation: {
        abortSignalObserved: controller.signal.aborted,
        providerErrorCode: error && typeof error === "object" && "code" in error ? error.code : null,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

await runJsonCase("structured JSON validation", `${common}
回傳嚴格結構：
{"schemaVersion":"character-agent-smoke-v1","status":"CANDIDATE","decisionSummary":"...","knownEvidenceIds":["K1"],"uncertainty":[],"constraintViolations":[],"canonicalMutation":0}
不得增加其他欄位。`, (value) => {
  const expectedKeys = ["canonicalMutation", "constraintViolations", "decisionSummary", "knownEvidenceIds", "schemaVersion", "status", "uncertainty"];
  return {
    pass: JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys)
      && value.schemaVersion === "character-agent-smoke-v1"
      && value.status === "CANDIDATE"
      && typeof value.decisionSummary === "string"
      && Array.isArray(value.knownEvidenceIds)
      && Array.isArray(value.uncertainty)
      && Array.isArray(value.constraintViolations)
      && value.canonicalMutation === 0,
    details: { keys: Object.keys(value).sort(), schemaVersion: value.schemaVersion },
  };
});

const pass = results.filter((result) => result.status === "PASS").length;
const fail = results.filter((result) => result.status === "FAIL").length;
const report = {
  schemaVersion: "p24b-real-ollama-smoke-v1",
  status: fail === 0 && pass === 8 ? "P2.4B_REAL_OLLAMA_SMOKE_PASS" : "FAIL",
  generatedAt: new Date().toISOString(),
  startedAt,
  elapsedMs: Date.now() - started,
  endpoint: "http://127.0.0.1:11434",
  ollamaVersion: version,
  model: {
    id: model,
    digest: modelInfo.digest ?? null,
    size: modelInfo.size ?? null,
  },
  provider: "local-ollama",
  modelOutputDeterminismClaim: "STRUCTURE_ONLY",
  pass,
  fail,
  skip: 0,
  externalRequests: 0,
  dataLeftDevice: false,
  rawChainOfThoughtStored: false,
  results,
};
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: report.status, pass, fail, skip: 0, elapsedMs: report.elapsedMs, model }, null, 2));
if (fail || pass !== 8) process.exitCode = 1;
