import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const evidencePath = process.argv[2];
if (!evidencePath) throw new Error("Pass the immutable R1K browser Revoke evidence JSON path.");
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));

assert.equal(evidence.schemaVersion, "r1k-browser-revoke-final-evidence-v1");
assert.match(evidence.verdict, /^R1K_(CHROME|EDGE)_REVOKE_AUTOMATED_PASS$/);
assert.equal(evidence.technical_status, "AUTOMATED_PASS");
assert.equal(evidence.human_validation_status, "HUMAN_NOT_RUN");
assert.equal(evidence.decision.method, "WINDOWS_UI_AUTOMATION");
assert.equal(evidence.decision.human_operator_clicked, false);
assert.equal(evidence.decision.fixed_coordinates_used, false);
assert.equal(evidence.permission.before, "GRANTED");
assert.equal(evidence.permission.after, "REVOKED");
assert.equal(evidence.permission.after_restart, "REVOKED");
assert.equal(evidence.bridge.origin_authorized_after_cleanup, false);
assert.equal(evidence.bridge.pairing_after_cleanup, "CLEARED");
assert.equal(evidence.bridge.post_revoke_browser_request_count, 0);
assert.equal(evidence.external_ai_calls, 0);
assert.equal(evidence.formal_mutations.total, 0);
assert.equal(evidence.cleanup.status, "PASS");
assert.equal(evidence.counts.fail, 0);
assert.equal(evidence.counts.skip, 0);
assert.ok(evidence.counts.pass > 0);
assert.ok(evidence.checks.every((row) => row.status === "PASS"));

console.log(JSON.stringify({ suite: "r1k-automated-revoke-evidence-contract", pass: 19, fail: 0, skip: 0 }));
