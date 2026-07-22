import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const evidencePath = process.argv[2];
if (!evidencePath) throw new Error("Pass the immutable R1K Chrome Grant evidence JSON path.");

const evidence = JSON.parse(await readFile(path.resolve(evidencePath), "utf8"));
assert.equal(evidence.schemaVersion, "r1k-chrome-grant-final-evidence-v1");
assert.equal(evidence.verdict, "R1K_CHROME_GRANT_AUTOMATED_PASS");
assert.equal(evidence.technical_status, "AUTOMATED_PASS");
assert.equal(evidence.human_validation_status, "HUMAN_NOT_RUN");
assert.equal(evidence.decision_method, "WINDOWS_UI_AUTOMATION");
assert.equal(evidence.human_operator_clicked, false);
assert.equal(evidence.native_prompt.automation_role, "Button");
assert.ok(Number.isInteger(evidence.native_prompt.chrome_pid));
assert.match(evidence.native_prompt.window_title, /Google Chrome/);
assert.ok(["允許", "Allow"].includes(evidence.native_prompt.clicked_control_name));
assert.equal(evidence.native_prompt.fixed_screen_coordinates_used, false);
assert.equal(evidence.permission.before, "ASK_OR_UNSET");
assert.equal(evidence.permission.after, "GRANTED");
assert.equal(evidence.bridge.origin_authorized, true);
assert.equal(evidence.bridge.paired, true);
assert.ok(evidence.bridge.browser_request_count > 0);
assert.equal(evidence.repository.formal_mutation_count, 0);
assert.equal(evidence.counts.FAIL, 0);
assert.equal(evidence.counts.SKIP, 0);

console.log(JSON.stringify({
  suite: "r1k-automated-grant-evidence-contract",
  contractVersion: "r1k-browser-decision-acceptance-v2",
  pass: 20,
  fail: 0,
  skip: 0,
  status: "PASS",
}));
