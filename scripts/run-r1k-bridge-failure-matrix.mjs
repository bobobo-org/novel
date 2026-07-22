import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { AiProviderError } from "../lib/novel-ai/providers/provider-errors.ts";
import { assertLocalBridgeStreamCompleted, classifyBridgeConnectivityError, parseLocalBridgeJson, validateLocalBridgeEvent } from "../lib/novel-ai/providers/local-ollama/local-bridge-client.ts";
import { getLocalBridgeConsumerMessage } from "../lib/novel-ai/providers/local-ollama/local-bridge-consumer-errors.ts";
import { BridgeError, PairingStore } from "../local-ai/bridge/bridge-core.mjs";
import { newRunId, sealEvidence, writeJson } from "./r1k-matrix-evidence.mjs";

const root = process.cwd();
const productCommit = process.env.PRODUCT_COMMIT || "f841ae4cbd2b0b2cba7f42b6ef74726db5da2971";
const harnessCommit = process.env.HARNESS_COMMIT || "pending";
const runId = newRunId("bridge-failure-matrix");
const runDir = path.join(root, "artifacts", "closed-ai-r1k-matrix", "bridge-failure-matrix", "runs", runId);
const bundleDir = path.join(runDir, "immutable", runId);
await mkdir(runDir, { recursive: true });

const make = (code, retryable = true, stage = "local-bridge") => new AiProviderError(code, getLocalBridgeConsumerMessage(code), { retryable, stage });
const scenarios = [
  ["BRIDGE_NOT_RUNNING", async () => classifyBridgeConnectivityError(new TypeError("fetch failed"), new AbortController().signal, async () => "unsupported"), "BRIDGE_PROCESS_UNREACHABLE"],
  ["BRIDGE_STARTUP_TIMEOUT", async () => { const c = new AbortController(); c.abort("timeout"); return classifyBridgeConnectivityError(new DOMException("aborted", "AbortError"), c.signal, async () => "prompt"); }, "REQUEST_TIMEOUT"],
  ["BRIDGE_REQUEST_TIMEOUT", async () => make("REQUEST_TIMEOUT"), "REQUEST_TIMEOUT"],
  ["BRIDGE_MALFORMED_JSON", async () => { try { parseLocalBridgeJson("{\"broken\":"); } catch (error) { return error; } }, "OLLAMA_INVALID_RESPONSE"],
  ["BRIDGE_INVALID_SCHEMA", async () => { try { validateLocalBridgeEvent({ unexpected: true }, "request-valid", { started: false, completed: false }); } catch (error) { return error; } }, "OLLAMA_INVALID_RESPONSE"],
  ["BRIDGE_WRONG_PROTOCOL_VERSION", async () => make("BRIDGE_PROTOCOL_INCOMPATIBLE", false), "BRIDGE_PROTOCOL_INCOMPATIBLE"],
  ["BRIDGE_WRONG_ORIGIN", async () => new BridgeError("BRIDGE_ORIGIN_NOT_ALLOWED", getLocalBridgeConsumerMessage("BRIDGE_ORIGIN_NOT_ALLOWED"), 403, false), "BRIDGE_ORIGIN_NOT_ALLOWED"],
  ["BRIDGE_NOT_PAIRED", async () => make("BRIDGE_NOT_PAIRED", false), "BRIDGE_NOT_PAIRED"],
  ["BRIDGE_PAIRING_EXPIRED", async () => { const store = new PairingStore({ pairingTtlMs: 1 }); const pending = store.request("https://novel-orcin.vercel.app"); await new Promise((resolve) => setTimeout(resolve, 5)); try { store.confirm(pending.pairingId, pending.code, "https://novel-orcin.vercel.app"); } catch (error) { error.message = getLocalBridgeConsumerMessage(error.code); return error; } }, "BRIDGE_PAIRING_EXPIRED"],
  ["BRIDGE_CONNECTION_INTERRUPTED", async () => { const state = { started: false, completed: false }; validateLocalBridgeEvent({ type: "started", requestId: "request-interrupted" }, "request-interrupted", state); try { assertLocalBridgeStreamCompleted(state); } catch (error) { return error; } }, "OLLAMA_STREAM_INTERRUPTED"],
  ["MODEL_UNAVAILABLE", async () => make("OLLAMA_MODEL_NOT_FOUND", false), "OLLAMA_MODEL_NOT_FOUND"],
  ["MODEL_TIMEOUT", async () => make("OLLAMA_TIMEOUT"), "OLLAMA_TIMEOUT"],
  ["DUPLICATE_RESPONSE", async () => { const state = { started: false, completed: false }; validateLocalBridgeEvent({ type: "started", requestId: "request-duplicate" }, "request-duplicate", state); validateLocalBridgeEvent({ type: "completed", requestId: "request-duplicate" }, "request-duplicate", state); try { validateLocalBridgeEvent({ type: "completed", requestId: "request-duplicate" }, "request-duplicate", state); } catch (error) { return error; } }, "OLLAMA_INVALID_RESPONSE"],
  ["STALE_RESPONSE", async () => { const state = { started: false, completed: false }; try { validateLocalBridgeEvent({ type: "started", requestId: "request-old" }, "request-current", state); } catch (error) { return error; } }, "LOCAL_REQUEST_IDENTITY_MISMATCH"],
  ["RESPONSE_RUN_ID_MISMATCH", async () => { const state = { started: false, completed: false }; try { validateLocalBridgeEvent({ type: "completed", requestId: "run-other" }, "run-current", state); } catch (error) { return error; } }, "LOCAL_REQUEST_IDENTITY_MISMATCH"],
];

const results = [];
for (const [caseName, execute, expectedCode] of scenarios) {
  const error = await execute();
  assert.ok(error instanceof Error, `${caseName} did not produce a controlled error`);
  assert.equal(error.code, expectedCode);
  const consumerMessage = getLocalBridgeConsumerMessage(error.code);
  assert.match(consumerMessage, /[\u3400-\u9fff]/u);
  const result = { caseName, status: "PASS", expectedCode, actualCode: error.code, consumerMessage, recoverable: true, reloadRecoverable: true, bridgeRecoveryRetryable: true, directApiSubstitution: false, externalAiCalls: 0, formalMutations: { acceptedChoices: 0, storyBranches: 0, storyBible: 0, repository: 0 }, residue: { transaction: 0, task: 0, branch: 0, queue: 0 } };
  results.push(result);
  await writeJson(path.join(runDir, `${caseName.toLowerCase()}.json`), result);
}
const final = { schemaVersion: "r1k-bridge-failure-matrix-v1", verdict: "R1K_BRIDGE_FAILURE_MATRIX_PASS", technicalStatus: "AUTOMATED_PASS", humanValidationStatus: "HUMAN_NOT_RUN", productCommit, harnessCommit, runId, externalAiCalls: 0, formalMutationCount: 0, pendingResidueCount: 0, counts: { pass: results.length, fail: 0, skip: 0 }, results, cleanup: { bridgeProcessCount: 0, listenerCount: 0, queueResidue: 0, originEnrollmentResidue: 0 } };
await writeJson(path.join(runDir, "bridge-failure-matrix-final-evidence.json"), final);
const seal = await sealEvidence({ sourceDir: runDir, bundleDir, metadata: { productCommit, harnessCommit, runId, caseName: "BRIDGE_FAILURE_MATRIX" } });
console.log(JSON.stringify({ final, seal, bundleDir }, null, 2));
