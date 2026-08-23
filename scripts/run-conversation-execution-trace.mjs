import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildConversationExecutionTrace,
  friendlyConversationExecutionError,
  friendlyFailedAssistantContent,
} from "../app/studio/project/[projectId]/chat/components/execution-trace-model.ts";

function invocation(overrides = {}) {
  return {
    id: "invocation-1",
    projectId: "project-1",
    revision: 1,
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:01.000Z",
    conversationSchemaVersion: "conversation-tool-invocation-v1",
    sessionId: "session-1",
    messageId: "message-1",
    taskId: "task-1",
    toolId: "closed-agent-os:rpg-turn",
    taskType: "chapter.continue",
    inputDigest: "a".repeat(64),
    contextDigest: "b".repeat(64),
    status: "completed",
    startedAt: "2026-08-23T00:00:00.000Z",
    completedAt: "2026-08-23T00:00:01.000Z",
    actualExecutor: "deterministic-rule-fallback",
    modelId: "rules-only",
    modelDigest: "c".repeat(64),
    executionReceipt: null,
    externalRequest: false,
    dataLeftDevice: false,
    canonicalMutationCount: 0,
    safeProgress: { stage: "candidate", percent: 100, message: "完整故事回合已成為候選" },
    safeErrorCode: null,
    ...overrides,
  };
}

const fallback = buildConversationExecutionTrace([invocation()]);
assert.ok(fallback);
assert.equal(fallback.stages.length, 4);
assert.equal(fallback.stages[2].state, "skipped");
assert.match(fallback.stages[2].description, /未由閉端 AI/u);
assert.equal(fallback.stages[3].state, "used");
assert.match(fallback.stages[3].description, /不是模型輸出/u);
assert.doesNotMatch(fallback.stages[3].description, /AI 已完成/u);

const ai = buildConversationExecutionTrace([invocation({
  actualExecutor: "local-ollama",
  modelId: "qwen-local",
})]);
assert.ok(ai);
assert.equal(ai.stages[2].state, "complete");
assert.match(ai.stages[2].description, /本機 Ollama/u);
assert.equal(ai.stages[3].state, "skipped");
assert.match(ai.stages[3].description, /沒有使用規則後備/u);

const choices = buildConversationExecutionTrace([invocation({
  toolId: "closed-agent-os:rpg-choice-plan",
})]);
assert.ok(choices);
assert.equal(choices.stages[0].state, "complete");
assert.equal(choices.stages[2].state, "skipped");
assert.equal(choices.stages[3].state, "skipped");
assert.match(choices.stages[3].description, /只建立選項/u);
assert.equal(choices.badge, "因果規則");
assert.equal(choices.executorLabel, "本機因果規則");
assert.doesNotMatch(choices.modelLabel, /故事後備/u);

const cache = buildConversationExecutionTrace([invocation({
  toolId: "closed-agent-os:conversation-plan",
  actualExecutor: "not_executed",
  modelId: "cached-model",
  executionReceipt: {
    receiptId: "receipt-1",
    modelId: "cached-model",
    modelDigest: "d".repeat(64),
    providerRunId: null,
    contextDigest: "b".repeat(64),
    outputDigest: "e".repeat(64),
    externalRequest: false,
    dataLeftDevice: false,
    latencyMs: 4,
    closedAgentCacheOrigin: { layer: "exact" },
  },
})]);
assert.ok(cache);
assert.equal(cache.stages[2].state, "skipped");
assert.match(cache.stages[2].description, /沒有重新執行閉端模型/u);

const friendly = friendlyConversationExecutionError(
  "RPG_CHAT_RULE_CHOICES_NOT_PLAYABLE",
  "RPG_CHAT_RULE_CHOICES_NOT_PLAYABLE",
);
assert.match(friendly.title, /三條故事路線/u);
assert.match(friendly.message, /正式故事與數值都維持原狀/u);
assert.doesNotMatch(`${friendly.title}${friendly.message}`, /RPG_CHAT_/u);
assert.doesNotMatch(
  friendlyFailedAssistantContent("本回合選項未完成：RPG_CHAT_RULE_CHOICES_NOT_PLAYABLE"),
  /RPG_CHAT_/u,
);

const [rowSource, timelineSource, traceSource] = await Promise.all([
  readFile("app/studio/project/[projectId]/chat/components/message-row.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/message-timeline.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/execution-trace.tsx", "utf8"),
]);
assert.match(rowSource, /<ConversationExecutionTrace/u);
assert.match(timelineSource, /friendlyConversationExecutionError/u);
assert.match(traceSource, /查看本機技術收據/u);
assert.doesNotMatch(traceSource, /safeErrorCode/u);

console.log(JSON.stringify({
  suite: "conversation-execution-trace",
  status: "PASS",
  stages: fallback.stages.map((stage) => stage.id),
  deterministicFallbackMisreportedAsAI: false,
  rawErrorCodesVisible: false,
}, null, 2));
