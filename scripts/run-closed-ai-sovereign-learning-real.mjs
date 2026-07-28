import assert from "node:assert/strict";
import crypto from "node:crypto";
import { OllamaClient } from "../lib/novel-ai/providers/ollama/ollama-client.ts";
import {
  MemorySovereignLearningRepository,
  approveLearningRule,
  buildApprovedLearningContext,
  createSovereignLearningSnapshot,
  ingestLearningSource,
} from "../lib/novel-ai/sovereign-learning/index.ts";

const endpoint = "http://127.0.0.1:11434";
const model = process.env.CLOSED_AI_LEARNING_MODEL || "qwen2.5:3b";
const projectId = "closed-ai-sovereign-learning-real-smoke";
const client = new OllamaClient({ endpoint, timeoutMs: 180_000 });
const started = Date.now();

const sourceText = [
  "At the beginning of each scene, the viewpoint character names a simple practical goal, while the reader can already see one fact that makes the goal harder than expected.",
  "The scene does not raise tension by adding random danger. Instead, every choice removes an easy option, changes a relationship, or exposes the price of an earlier promise.",
  "Dialogue stays brief when characters are hiding information. A longer answer appears only after silence or an observable action makes continued concealment more costly.",
  "The midpoint reveal changes the meaning of an earlier detail without cancelling it. The final beat creates a new question from an object that was previously ordinary.",
  "This pattern keeps character agency visible: pressure narrows the choices, but the character still decides which value to protect and which cost to accept.",
].join("\n\n");

let ollamaVersion = null;
let modelDigest = null;
let generatedResponseHash = null;
let responseShape = null;
let warningCodes = [];
let deepExtractionFailures = null;
let totalRuleCount = null;
let report;

try {
  const [version, tags] = await Promise.all([client.version(), client.tags()]);
  ollamaVersion = version.version ?? null;
  const modelInfo = tags.models?.find((entry) =>
    entry.name === model || entry.model === model);
  assert(modelInfo, `Required local model is not installed: ${model}`);
  modelDigest = modelInfo.digest ?? null;

  const repository = new MemorySovereignLearningRepository();
  const result = await ingestLearningSource(repository, {
    projectId,
    title: "Local Ollama narrative-rule smoke reference",
    sourceKind: "personal_note",
    rightsBasis: "owned_by_user",
    rightsEvidence: "Synthetic test fixture created in this repository",
    userConfirmedRights: true,
    content: sourceText,
    deepExtractor: async ({ prompt }) => {
      const response = await client.generate({
        model,
        prompt,
        format: "json",
        options: {
          temperature: 0,
          seed: 240401,
          num_ctx: 8_192,
          num_predict: 900,
        },
      });
      const content = response.response ?? "";
      generatedResponseHash = crypto.createHash("sha256").update(content).digest("hex");
      try {
        const parsed = JSON.parse(content);
        const rows = Array.isArray(parsed?.rules) ? parsed.rules : [];
        responseShape = {
          rootKeys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
          ruleCount: rows.length,
          ruleKeys: rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [],
          families: rows.map((row) => row?.family).filter((value) => typeof value === "string"),
          dimensions: rows.map((row) => row?.dimension).filter((value) => typeof value === "string"),
        };
      } catch {
        responseShape = { validJson: false };
      }
      return {
        content,
        provider: "local-ollama",
        model,
        externalRequest: false,
        dataLeftDevice: false,
      };
    },
  });
  warningCodes = result.warnings;
  deepExtractionFailures = result.deepExtractionFailures;
  totalRuleCount = result.rules.length;

  const deepRules = result.rules.filter((rule) =>
    rule.extractorKind === "local_closed_ai");
  assert(deepRules.length >= 1, "Local Ollama returned no admissible abstract rule");
  assert(deepRules.every((rule) => rule.status === "candidate"));
  assert(deepRules.every((rule) => rule.longestSourceMatch < 18));
  assert(deepRules.every((rule) => rule.sourceOverlapScore < 0.14));
  const approved = await approveLearningRule(repository, projectId, deepRules[0].id);
  const context = await buildApprovedLearningContext({
    repository,
    projectId,
    taskType: "continue_writing",
  });
  assert(context.selectedRuleIds.includes(approved.id));
  const snapshot = await createSovereignLearningSnapshot(repository, projectId);
  const serializedSnapshot = JSON.stringify(snapshot);
  assert.equal(serializedSnapshot.includes(sourceText), false);
  assert.equal(snapshot.rawSourceContentIncluded, false);
  assert.equal(result.externalRequestCount, 0);
  assert.equal(result.dataLeftDevice, false);

  report = {
    suite: "Closed AI Sovereign Learning Real Ollama Smoke",
    status: "PASS",
    elapsedMs: Date.now() - started,
    endpoint,
    ollamaVersion,
    model,
    modelDigest,
    generatedResponseHash,
    responseShape,
    warningCodes,
    deepExtractionFailures,
    totalRuleCount,
    deterministicRuleCount: result.rules.filter((rule) =>
      rule.extractorKind === "deterministic_pattern").length,
    localDeepRuleCount: deepRules.length,
    approvedRuleSelectedForGeneration: true,
    rawSourceContentStored: false,
    rawModelOutputStored: false,
    externalRequestCount: 0,
    dataLeftDevice: false,
    modelWeightTrainingStarted: false,
  };
} catch (error) {
  report = {
    suite: "Closed AI Sovereign Learning Real Ollama Smoke",
    status: "FAIL",
    elapsedMs: Date.now() - started,
    endpoint,
    ollamaVersion,
    model,
    modelDigest,
    generatedResponseHash,
    responseShape,
    warningCodes,
    deepExtractionFailures,
    totalRuleCount,
    rawSourceContentStored: false,
    rawModelOutputStored: false,
    externalRequestCount: 0,
    dataLeftDevice: false,
    modelWeightTrainingStarted: false,
    error: error instanceof Error ? error.message : String(error),
  };
  process.exitCode = 1;
}

console.log(JSON.stringify(report, null, 2));
