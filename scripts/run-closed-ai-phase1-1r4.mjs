import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  LOCAL_MODEL_INSUFFICIENT_FOR_TASK,
  extractionAttemptBudget,
  runLocalExtractionWithRetry,
} from "../lib/novel-ai/providers/local-ollama/local-extraction-runtime.ts";
import {
  LOCAL_QUALITY_SCHEMA_VERSION,
  safelyRepairModelExtraction,
  parseAndValidateModelExtraction,
} from "../lib/novel-ai/providers/local-ollama/local-quality-guard.ts";

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const artifactDir = path.join(root, "artifacts", "closed-ai-phase1-1r4");
const results = [];
const now = () => new Date().toISOString();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function test(name, work) {
  const startedAt = Date.now();
  try {
    const evidence = await work();
    results.push({ name, status: "PASS", elapsedMs: Date.now() - startedAt, evidence });
  } catch (error) {
    results.push({ name, status: "FAIL", elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
  }
}

const source = { chapterId: "chapter-r4", text: "林昭二十八歲，現在住在京城。" };
const compactFact = JSON.stringify({
  schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION,
  facts: [{ entityId: "character:林昭", field: "age", value: 28, evidenceText: "林昭二十八歲", confidence: 0.99 }],
});

await mkdir(artifactDir, { recursive: true });

await test("R4 attempt budgets are bounded and reserve validation time", async () => {
  const normal = extractionAttemptBudget(120_000);
  const short = extractionAttemptBudget(1_000);
  assert.deepEqual(normal.attemptTimeoutMs, [35_000, 25_000, 25_000]);
  assert.equal(normal.validationReserveMs, 15_000);
  assert.ok(short.attemptTimeoutMs.every((value) => value > 0));
  assert.ok(short.attemptTimeoutMs.reduce((sum, value) => sum + value, 0) + short.validationReserveMs <= 1_000);
  return { normal, short, maximumAttempts: 3 };
});

await test("compact model output is repaired into evidence-backed schema", async () => {
  const repaired = safelyRepairModelExtraction(compactFact, [source], "qwen2.5:3b", "req-r4-repair");
  assert.ok(repaired);
  const validation = parseAndValidateModelExtraction(repaired, [source]);
  assert.equal(validation.status, "accept");
  assert.equal(validation.validated[0].evidenceSpans[0].text, "林昭二十八歲");
  return { schemaValid: validation.schemaValid, evidenceValid: true, factCount: validation.validated.length };
});

await test("an attempt timeout advances to a distinct repair strategy", async () => {
  const value = await runLocalExtractionWithRetry({
    logicalRequestId: "req-r4-timeout-retry",
    taskType: "character.extract",
    modelId: "qwen2.5:3b",
    sourceRevision: "revision-1",
    sources: [source],
    totalTimeoutMs: 1_000,
    getCurrentSourceRevision: () => "revision-1",
    executeAttempt: async ({ attempt, signal, strategy, timeoutMs, maxOutputTokens }) => {
      if (attempt === 1) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, timeoutMs + 500);
          signal.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("attempt timeout"), { code: "ATTEMPT_ABORTED" })); }, { once: true });
        });
      }
      assert.equal(strategy, "evidence_only_extraction");
      assert.equal(maxOutputTokens, 96);
      return compactFact;
    },
  });
  assert.equal(value.attempts.length, 2);
  assert.equal(value.attempts[0].status, "timeout");
  assert.equal(value.attempts[1].status, "accepted");
  return { attempts: value.attempts, finalFactCount: value.facts.length };
});

await test("three rejected attempts return honest local-model insufficiency", async () => {
  let caught;
  try {
    await runLocalExtractionWithRetry({
      logicalRequestId: "req-r4-insufficient",
      taskType: "character.extract",
      modelId: "qwen2.5:3b",
      sourceRevision: "revision-1",
      sources: [source],
      totalTimeoutMs: 5_000,
      getCurrentSourceRevision: () => "revision-1",
      executeAttempt: async () => "not-json",
    });
  } catch (error) { caught = error; }
  assert.equal(caught?.code, LOCAL_MODEL_INSUFFICIENT_FOR_TASK);
  assert.equal(caught?.attempts?.length, 3);
  assert.match(String(caught?.suggestedAction), /stronger local model|Private Hub/i);
  return { errorCode: caught.code, attempts: caught.attempts.length, suggestedAction: caught.suggestedAction };
});

await test("invented evidence is rejected even when compact JSON is valid", async () => {
  const invented = JSON.stringify({ schemaVersion: LOCAL_QUALITY_SCHEMA_VERSION, facts: [{ entityId: "character:林昭", field: "age", value: 35, evidenceText: "林昭三十五歲", confidence: 0.99 }] });
  const repaired = safelyRepairModelExtraction(invented, [source], "qwen2.5:3b", "req-r4-invented");
  assert.equal(repaired, null);
  const validation = parseAndValidateModelExtraction(invented, [source]);
  assert.equal(validation.status, "reject");
  return { rejected: true, errorCode: validation.errorCode, repairRefusedUnsupportedFact: true };
});

await test("launcher rejects wildcard preview origin", async () => {
  let caught;
  try {
    await execFileAsync(process.execPath, [path.join(root, "local-ai", "bridge", "launcher.mjs"), "status", "--origin", "https://*.vercel.app"], { cwd: root, env: { ...process.env, NOVEL_BRIDGE_RUNTIME_DIR: path.join(root, ".tmp-r4-launcher") } });
  } catch (error) { caught = error; }
  const output = `${caught?.stdout || ""}${caught?.stderr || ""}`;
  assert.match(output, /LAUNCHER_ORIGIN_INVALID/);
  return { wildcardAllowed: false, errorCode: "LAUNCHER_ORIGIN_INVALID" };
});

await test("legacy build source and generated manifest have identical hashes", async () => {
  await execFileAsync(process.execPath, [path.join(root, "scripts", "check-legacy-build-truth.mjs"), "--write-manifest"], { cwd: root });
  const html = await readFile(path.join(root, "public", "legacy", "novel-system.html"));
  const manifest = JSON.parse(await readFile(path.join(root, "public", "legacy", "novel-system.build.json"), "utf8"));
  assert.equal(manifest.buildArtifactRawSha256, sha256(html));
  assert.equal(manifest.buildArtifactSha256, manifest.sourceSha256);
  assert.ok(Object.values(manifest.assertions).every(Boolean));
  return manifest;
});

const tracked = (await execFileAsync("git", ["ls-files", "*novel-system*", "*legacy*"], { cwd: root })).stdout.split(/\r?\n/).filter(Boolean);
const sourceMap = [];
for (const relativePath of tracked) {
  let content = "";
  try { content = await readFile(path.join(root, relativePath), "utf8"); } catch { continue; }
  sourceMap.push({
    path: relativePath.replaceAll("\\", "/"),
    gitTracked: true,
    classification: relativePath === "public/legacy/novel-system.html" ? "deployed_source" : relativePath.startsWith("artifacts/") ? "generated_evidence" : relativePath.startsWith("public/") ? "public_asset" : "source_or_test",
    deployedRoute: relativePath === "public/legacy/novel-system.html" ? "/legacy/novel-system.html" : null,
    sha256: sha256(Buffer.from(content)),
    prohibitedStrings: ["Ollama Generate", "LM Studio Chat Completions", "OpenAI-compatible Chat Completions", "workspaceScriptLoaded"].filter((value) => content.includes(value)),
  });
}

const report = {
  schemaVersion: "closed-ai-phase1-1r4-results-v1",
  generatedAt: now(),
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  results,
  realModelCalls: 0,
  formalStoryBibleWrites: 0,
};
await writeFile(path.join(artifactDir, "legacy-source-of-truth-map.json"), JSON.stringify({ schemaVersion: "legacy-source-of-truth-map-v1", generatedAt: now(), deployedSource: "public/legacy/novel-system.html", entries: sourceMap }, null, 2));
await writeFile(path.join(artifactDir, "legacy-runtime-bypass-tests.json"), JSON.stringify({ schemaVersion: "legacy-runtime-bypass-tests-v1", generatedAt: now(), results: results.filter((item) => /launcher|legacy build/.test(item.name)) }, null, 2));
await writeFile(path.join(artifactDir, "story-bible-time-budget.json"), JSON.stringify({ schemaVersion: "story-bible-time-budget-v1", generatedAt: now(), results: results.filter((item) => /attempt|model|evidence/.test(item.name)) }, null, 2));
await writeFile(path.join(artifactDir, "full-regression-results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;
