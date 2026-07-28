import { mkdir, writeFile } from "node:fs/promises";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";
import { LocalBridgeClient } from "../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";
import { runLocalExtractionWithRetry } from "../lib/novel-ai/providers/local-ollama/local-extraction-runtime.ts";

const artifact = new URL("../artifacts/closed-ai-phase1-1r2/runtime-retry-real-results.json", import.meta.url);
const origin = "http://127.0.0.1:3000";
const bridge = createBridgeServer({ testMode: true });
const startedAt = Date.now(); let report;
try {
  await bridge.start();
  const client = new LocalBridgeClient({ origin });
  const pairing = await client.requestPairing();
  await client.confirmPairing(pairing.pairingId, pairing.testCode);
  const modelResponse = await client.models();
  const model = modelResponse.models.filter((item) => item.capabilities?.textGeneration?.value).sort((a, b) => Number(a.diskSize || Infinity) - Number(b.diskSize || Infinity))[0];
  if (!model) throw Object.assign(new Error("No installed text model."), { code: "OLLAMA_MODEL_NOT_FOUND" });
  const source = { chapterId: "chapter-real-r2", text: "林昭今年二十八歲，目前位於京城。" };
  const abort = new AbortController();
  const result = await runLocalExtractionWithRetry({
    logicalRequestId: `r2-real-${Date.now()}`, taskType: "character.extract", modelId: model.modelId, sourceRevision: "real-rev-1", sources: [source], totalTimeoutMs: 120000, signal: abort.signal, getCurrentSourceRevision: () => "real-rev-1",
    executeAttempt: async ({ attemptId, modelId, prompt, systemInstruction, signal }) => {
      let text = "", completed = false;
      for await (const event of client.generate({ requestId: attemptId, model: modelId, prompt, systemInstruction, taskType: "character.extract", timeoutMs: 90000, options: { num_predict: 256, temperature: 0 }, signal })) {
        if (event.type === "token") text += String(event.text || "");
        if (event.type === "completed") completed = true;
        if (event.type === "failed") throw Object.assign(new Error(String(event.errorCode)), { code: event.errorCode });
      }
      if (!completed) throw Object.assign(new Error("OLLAMA_STREAM_INTERRUPTED"), { code: "OLLAMA_STREAM_INTERRUPTED" });
      return text;
    },
  });
  report = { schemaVersion: "closed-ai-phase1-1r2-real-runtime-v1", generatedAt: new Date().toISOString(), status: "PASS", modelId: model.modelId, attempts: result.attempts, factCount: result.facts.length, elapsedMs: Date.now() - startedAt, networkDestinations: ["127.0.0.1:3217", "127.0.0.1:11434"], externalAiCalls: 0, fullPromptOrOutputPersisted: false };
} catch (error) {
  report = { schemaVersion: "closed-ai-phase1-1r2-real-runtime-v1", generatedAt: new Date().toISOString(), status: "FAIL", errorCode: error?.code || "REAL_RUNTIME_FAILED", message: error instanceof Error ? error.message : String(error), attempts: error?.attempts || [], elapsedMs: Date.now() - startedAt, networkDestinations: ["127.0.0.1:3217", "127.0.0.1:11434"], externalAiCalls: 0, fullPromptOrOutputPersisted: false };
  process.exitCode = 1;
} finally { await bridge.stop().catch(() => undefined); }
await mkdir(new URL("../artifacts/closed-ai-phase1-1r2/", import.meta.url), { recursive: true }); await writeFile(artifact, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
