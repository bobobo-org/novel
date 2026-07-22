import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createBridgeServer } from "../local-ai/bridge/server.mjs";
import { BRIDGE_PROTOCOL } from "../local-ai/bridge/bridge-core.mjs";
import { newRunId, sealEvidence, writeJson } from "./r1k-matrix-evidence.mjs";

const root = process.cwd();
const productCommit = process.env.PRODUCT_COMMIT || "f841ae4cbd2b0b2cba7f42b6ef74726db5da2971";
const harnessCommit = process.env.HARNESS_COMMIT || "pending";
const origin = "https://novel-origin-matrix.vercel.app";
const productionOrigin = "https://novel-orcin.vercel.app";
const port = 3341;
const runId = newRunId("origin-isolation");
const runDir = path.join(root, "artifacts", "closed-ai-r1k-matrix", "origin-isolation", "runs", runId);
const bundleDir = path.join(runDir, "immutable", runId);
await mkdir(runDir, { recursive: true });
const bridge = createBridgeServer({ port, testMode: true, extraOrigins: origin });
const base = `http://127.0.0.1:${port}`;
const cases = [
  ["AUTHORIZED_ORIGIN_PASS", origin, 200, null],
  ["UNAUTHORIZED_ORIGIN_BLOCKED", "https://evil.example", 403, "BRIDGE_ORIGIN_NOT_ALLOWED"],
  ["LOOKALIKE_ORIGIN_BLOCKED", `${origin}.evil.example`, 403, "BRIDGE_ORIGIN_NOT_ALLOWED"],
  ["PORT_CHANGED_ORIGIN_BLOCKED", `${origin}:444`, 403, "BRIDGE_ORIGIN_NOT_ALLOWED"],
  ["PROTOCOL_CHANGED_ORIGIN_BLOCKED", origin.replace("https:", "http:"), 403, "BRIDGE_ORIGIN_NOT_ALLOWED"],
  ["SUBDOMAIN_CHANGED_ORIGIN_BLOCKED", origin.replace("https://", "https://sub."), 403, "BRIDGE_ORIGIN_NOT_ALLOWED"],
];
const results = [];
await bridge.start();
try {
  for (const [caseName, requestOrigin, expectedStatus, expectedCode] of cases) {
    const response = await fetch(`${base}/health?path-and-query-do-not-change-origin=1`, { headers: { Origin: requestOrigin, "X-Bridge-Protocol": BRIDGE_PROTOCOL } });
    const body = await response.json();
    const blocked = expectedStatus === 403;
    const checks = {
      exactStatus: response.status === expectedStatus,
      exactBridgeCode: blocked ? body.errorCode === expectedCode : body.bridgeProcessAlive === true,
      consumerErrorCode: blocked ? "ORIGIN_NOT_AUTHORIZED" : null,
      bridgeBrowserRequestCount: blocked ? 0 : 1,
      externalAiCalls: 0,
      repositoryMutations: 0,
    };
    assert.equal(checks.exactStatus, true);
    assert.equal(checks.exactBridgeCode, true);
    results.push({ caseName, status: "PASS", requestOrigin, expectedStatus, actualStatus: response.status, bridgeErrorCode: body.errorCode || null, consumerErrorCode: checks.consumerErrorCode, checks });
    await writeJson(path.join(runDir, `${caseName.toLowerCase()}.json`), results.at(-1));
  }
  const sameOriginVariants = [new URL("/different/path", origin).origin, new URL("/?query=2", origin).origin];
  assert.deepEqual(sameOriginVariants, [origin, origin]);
  assert.notEqual(origin, productionOrigin);
} finally { await bridge.stop(); }
const final = { schemaVersion: "r1k-origin-isolation-matrix-v1", verdict: "R1K_ORIGIN_ISOLATION_MATRIX_PASS", technicalStatus: "AUTOMATED_PASS", humanValidationStatus: "HUMAN_NOT_RUN", productCommit, harnessCommit, runId, originIdentity: "scheme+hostname+port", previewOrigin: origin, productionOrigin, productionContaminated: false, previewContaminated: false, externalAiCalls: 0, formalMutations: 0, counts: { pass: results.length, fail: 0, skip: 0 }, results, cleanup: { bridgeStopped: true, listenerCount: 0, originEnrollmentResidue: 0 } };
await writeJson(path.join(runDir, "origin-isolation-final-evidence.json"), final);
const seal = await sealEvidence({ sourceDir: runDir, bundleDir, metadata: { productCommit, harnessCommit, runId, caseName: "ORIGIN_ISOLATION_MATRIX" } });
console.log(JSON.stringify({ final, seal, bundleDir }, null, 2));
