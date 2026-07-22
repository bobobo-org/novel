import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
const [caseArg, grantRunId, bundleArg, productCommit, harnessCommit, contractCommit, browserArg = "chrome", accessArg = ""] = process.argv.slice(2);
if (![caseArg, grantRunId, bundleArg, productCommit, harnessCommit, contractCommit].every(Boolean)) throw new Error("caseRoot, grantRunId, bundle, commits are required.");
const caseRoot = path.resolve(caseArg), grantRoot = path.join(caseRoot, "grant-stage"), revokeRoot = path.join(caseRoot, "revoke-stage"), bundle = path.resolve(bundleArg), browser = browserArg.toLowerCase();
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const hash = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const grantSummary = await readJson(path.join(grantRoot, "automated-grant-summary.json"));
const grantFinal = await readJson(path.join(grantRoot, "runs", grantRunId, "final-result.json"));
const mutation = await readJson(path.join(grantRoot, "runs", grantRunId, "repository-mutation-audit.json"));
const before = await readJson(path.join(revokeRoot, "permission-before-revoke.json"));
const action = await readJson(path.join(revokeRoot, "native-revoke-action.json"));
const after = await readJson(path.join(revokeRoot, "permission-after-revoke.json"));
const restart = await readJson(path.join(revokeRoot, `${browser}-revoke-restart-verification.json`));
const regrant = await readJson(path.join(revokeRoot, "regrant-native-prompt-evidence.json"));
const cleanup = await readJson(path.join(revokeRoot, "cleanup-verification.json"));
let accessRows = [];
if (accessArg) accessRows = (await readFile(path.resolve(accessArg), "utf8")).split(/\r?\n/).filter(Boolean).map(JSON.parse).filter((row) => row.origin === grantFinal.origin && Date.parse(row.timestamp) >= Date.parse(action.capturedAt) && Date.parse(row.timestamp) <= Date.parse(regrant.capturedAt) + 2_000);
const browserRows = accessRows.filter((row) => !/^node$/i.test(row.user_agent || ""));
const checks = [
  ["grantPrecondition", grantSummary.technical_status === "AUTOMATED_PASS" && before.status === "GRANTED" && grantSummary.permissionSetting === 1],
  ["grantBridgeRoundTrip", grantFinal.finalLiveness?.bridgeProcessAlive === true && grantFinal.finalLiveness?.originEnrolled === true],
  ["nativeRevokeAction", action.status === "INVOKED" && action.automationRole === "ControlType.Button" && action.fixedCoordinatesUsed === false],
  ["permissionRevoked", after.status === "REVOKED" && after.profileExceptionPresent === false],
  ["restartRemainsRevoked", restart.status === "PASS" && restart.permission === "REVOKED"],
  ["postRevokeBrowserResponsesZero", restart.loopbackResponses === 0 && browserRows.length === 0],
  ["externalAiCallsZero", restart.externalAiCalls === 0],
  ["formalMutationsZero", mutation.status === "PASS" && mutation.sensitiveStoreCountChanges.length === 0],
  ["regrantPromptAvailable", regrant.status === "PASS" && regrant.controlName && regrant.decisionTaken === false],
  ["cleanupPass", cleanup.status === "PASS"],
];
const failures = checks.filter(([, pass]) => !pass);
if (failures.length) throw new Error(`Revoke evidence checks failed: ${failures.map(([name]) => name).join(", ")}`);
const runId = `${browser}-revoke-${createHash("sha256").update(`${grantRunId}:${action.capturedAt}`).digest("hex").slice(0, 32)}`;
const evidence = {
  schemaVersion: "r1k-browser-revoke-final-evidence-v1", verdict: `R1K_${browser.toUpperCase()}_REVOKE_AUTOMATED_PASS`, technical_status: "AUTOMATED_PASS", human_validation_status: "HUMAN_NOT_RUN",
  productCommit, harnessCommit, evidenceContractCommit: contractCommit, runId, grantRunId, browser, createdAt: new Date().toISOString(),
  decision: { method: "WINDOWS_UI_AUTOMATION", human_operator_clicked: false, browser_pid: action.processId, automation_role: action.automationRole, control_name: action.controlName, fixed_coordinates_used: false },
  permission: { before: "GRANTED", after: "REVOKED", after_restart: "REVOKED", beforeEvidence: before, afterEvidence: after, restartEvidence: restart },
  bridge: { origin_authorized_before: true, reachable_before: true, origin_authorized_after_cleanup: false, pairing_after_cleanup: "CLEARED", post_revoke_browser_request_count: browserRows.length, post_revoke_browser_response_count: restart.loopbackResponses },
  regrant: { native_prompt_available: true, decision_taken: false, browser_pid: regrant.browserPid, control_name: regrant.controlName }, external_ai_calls: 0,
  formal_mutations: { acceptedChoices: 0, storyBranches: 0, storyBible: 0, total: 0 }, cleanup,
  checks: checks.map(([name]) => ({ name, status: "PASS" })), counts: { pass: checks.length, fail: 0, skip: 0 },
};
await mkdir(bundle, { recursive: true });
const evidenceName = `r1k-${browser}-revoke-final-evidence.json`;
await writeFile(path.join(bundle, evidenceName), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await writeFile(path.join(bundle, "bridge-access-after-revoke.json"), `${JSON.stringify({ runId, rows: accessRows }, null, 2)}\n`, "utf8");
const files = ["permission-before-revoke.json", "native-revoke-action.json", "permission-after-revoke.json", `${browser}-revoke-restart-verification.json`, `${browser}-revoke-restart-verification.png`, "regrant-native-prompt-evidence.json", "regrant-native-prompt.png", "native-site-info-before-revoke.png", "native-site-info-after-revoke.png", "cleanup-verification.json"];
for (const name of files) await copyFile(path.join(revokeRoot, name), path.join(bundle, name));
const names = (await readdir(bundle)).filter((name) => !["evidence-manifest.json", "checksums.sha256", "bundle-seal.json"].includes(name)).sort();
const records = []; for (const name of names) records.push({ file: name, bytes: (await readFile(path.join(bundle, name))).length, sha256: await hash(path.join(bundle, name)) });
const manifest = { schemaVersion: "r1k-browser-revoke-immutable-manifest-v1", createdAt: new Date().toISOString(), productCommit, harnessCommit, evidenceContractCommit: contractCommit, runId, browser, records };
await writeFile(path.join(bundle, "evidence-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(path.join(bundle, "checksums.sha256"), `${records.map((row) => `${row.sha256}  ${row.file}`).join("\n")}\n`, "utf8");
const seal = { schemaVersion: "r1k-browser-revoke-bundle-seal-v1", sealedAt: new Date().toISOString(), manifestSha256: await hash(path.join(bundle, "evidence-manifest.json")), checksumsSha256: await hash(path.join(bundle, "checksums.sha256")), recordCount: records.length, mismatchCount: 0, status: "SEALED" };
await writeFile(path.join(bundle, "bundle-seal.json"), `${JSON.stringify(seal, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ evidence, seal, bundle }));
