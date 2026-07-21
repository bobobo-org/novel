import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const evidencePath = process.argv[2];
if (!evidencePath) throw new Error("Pass the immutable R1K final evidence JSON path.");

const evidence = JSON.parse(await readFile(path.resolve(evidencePath), "utf8"));
assert.equal(evidence.schemaVersion, "r1k-chrome-deny-final-evidence-v2");
assert.equal(evidence.technical_status, "AUTOMATED_PASS");
assert.equal(evidence.human_validation_status, "HUMAN_NOT_RUN");
assert.equal(evidence.decision_method, "WINDOWS_UI_AUTOMATION");
assert.equal(evidence.human_operator_clicked, false);
assert.equal(evidence.native_prompt.automation_role, "Button");
assert.ok(Number.isInteger(evidence.native_prompt.chrome_pid));
assert.match(evidence.native_prompt.window_title, /Google Chrome/);
assert.ok(["封鎖", "不允許", "Block", "Don't allow"].includes(evidence.native_prompt.clicked_control_name));
assert.equal(evidence.native_prompt.fixed_screen_coordinates_used, false);
assert.equal(evidence.permission.before, "ASK_OR_UNSET");
assert.equal(evidence.permission.after, "DENIED");
assert.equal(evidence.permission.source, "CHROME_PERMISSION_STATE_AND_PRODUCT_BEHAVIOR");
assert.equal(evidence.product_error.harness_injected, false);
assert.equal(evidence.browser_profile.fresh, true);
assert.equal(evidence.browser_profile.isolated, true);
assert.equal(evidence.counts.FAIL, 0);
assert.equal(evidence.counts.SKIP, 0);

console.log(JSON.stringify({
  suite: "r1k-automated-evidence-contract",
  contractVersion: "r1k-browser-decision-acceptance-v2",
  pass: 17,
  fail: 0,
  status: "PASS",
}));
