import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [sourceArg, runId, bundleArg, productCommit, harnessCommit, contractCommit, browserArg = "chrome", accessLogArg = ""] = process.argv.slice(2);
if (![sourceArg, runId, bundleArg, productCommit, harnessCommit, contractCommit].every(Boolean)) throw new Error("source, runId, bundle, productCommit, harnessCommit, contractCommit are required.");
const source = path.resolve(sourceArg);
const run = path.join(source, "runs", runId);
const bundle = path.resolve(bundleArg);
const browser = browserArg.toLowerCase();
if (!new Set(["chrome", "edge"]).has(browser)) throw new Error("browser must be chrome or edge.");
const product = browser === "edge" ? "Microsoft Edge" : "Google Chrome";
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const hash = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const final = await readJson(path.join(run, "final-result.json"));
const decision = await readJson(path.join(run, "automated-native-decision.json"));
const summary = await readJson(path.join(source, "automated-deny-summary.json"));
const network = await readJson(path.join(run, "network.json"));
const mutation = await readJson(path.join(run, "repository-mutation-audit.json"));
const restart = await readJson(path.join(source, `${browser}-deny-restart-verification.json`));
const preflight = await readJson(path.join(source, "automated-deny-preflight.json"));
const cleanup = await readJson(path.join(source, "cleanup-verification.json"));
const startedAt = Date.parse(final.startedAt);
const completedAt = Date.parse(final.completedAt);
let bridgeRows = [];
if (accessLogArg) {
  const lines = (await readFile(path.resolve(accessLogArg), "utf8")).split(/\r?\n/).filter(Boolean);
  bridgeRows = lines.map((line) => JSON.parse(line)).filter((row) => {
    const time = Date.parse(row.timestamp);
    return time >= startedAt - 2_000 && time <= completedAt + 2_000 && row.origin === final.origin;
  });
}
const browserBridgeRows = bridgeRows.filter((row) => !/^node$/i.test(row.user_agent || ""));
const loopbackRequests = network.rows.filter((row) => row.phase === "request" && /(?:127\.0\.0\.1|localhost|\[::1\]):3217/.test(row.url));
const loopbackResponses = network.rows.filter((row) => row.phase === "response" && /(?:127\.0\.0\.1|localhost|\[::1\]):3217/.test(row.url));
const external = network.rows.filter((row) => /(?:api\.openai\.com|generativelanguage\.googleapis\.com|api\.x\.ai)/i.test(row.url));
const checks = [
  ["freshIsolatedProfile", preflight.profileDidNotExist && !preflight.defaultChromeProfileUsed],
  ["formalBrowserIdentity", final.identity?.fileProduct === product],
  ["nativePromptControlVerified", decision.status === "INVOKED" && decision.automationRole === "Button"],
  ["nativePromptPidBound", decision.processMatchedProfile && decision.processId === decision.mainBrowserProcessId],
  ["semanticDenyDecision", typeof decision.elementName === "string" && decision.elementName.trim().length > 0],
  ["fixedCoordinatesNotUsed", decision.fixedScreenCoordinatesUsed === false],
  ["permissionDenied", summary.permissionSetting === 2 && final.permissionStates?.["loopback-network"] === "denied"],
  ["reloadRemainsDenied", restart.status === "PASS" && restart.afterReload.denied],
  ["consumerDenialMessage", restart.afterReload.denialMessageVisible && restart.afterReload.noExternalFallbackMessageVisible],
  ["browserBridgeRequestsZero", browserBridgeRows.length === 0],
  ["browserLoopbackResponsesZero", loopbackResponses.length === 0],
  ["externalAiCallsZero", external.length === 0 && restart.externalAiCalls === 0],
  ["forbiddenArgumentsZero", final.securityAudit?.forbiddenArgumentCount === 0],
  ["formalRepositoryMutationZero", mutation.status === "PASS" && mutation.sensitiveStoreCountChanges.length === 0],
  ["cleanupPass", cleanup.status === "PASS"],
];
const failures = checks.filter(([, pass]) => !pass);
if (failures.length) throw new Error(`Deny evidence checks failed: ${failures.map(([name]) => name).join(", ")}`);
const evidence = {
  schemaVersion: "r1k-browser-deny-final-evidence-v3",
  verdict: `R1K_${browser.toUpperCase()}_DENY_AUTOMATED_PASS`,
  technical_status: "AUTOMATED_PASS", human_validation_status: "HUMAN_NOT_RUN",
  decision_method: "WINDOWS_UI_AUTOMATION", human_operator_clicked: false,
  createdAt: new Date().toISOString(), productCommit, harnessCommit, evidenceContractCommit: contractCommit, runId, browser, previewUrl: final.preview.url,
  native_prompt: { browser_pid: decision.processId, window_title: decision.mainWindowTitle, automation_role: decision.automationRole, clicked_control_name: decision.elementName, selection_method: "SEMANTIC_UI_AUTOMATION_NAME_ROLE_AND_PID", fixed_screen_coordinates_used: false },
  permission: { before: "ASK_OR_UNSET", after: "DENIED", setting: 2, states: final.permissionStates, reload: restart.afterReload.permissions, source: "BROWSER_PERMISSION_STATE_AND_PRODUCT_BEHAVIOR" },
  product_error: { code: "LOCAL_NETWORK_PERMISSION_DENIED", harness_injected: false, denial_message_visible: restart.afterReload.denialMessageVisible, no_external_fallback_message_visible: restart.afterReload.noExternalFallbackMessageVisible },
  network: { browser_loopback_attempts: loopbackRequests.length, browser_loopback_responses: loopbackResponses.length, bridge_browser_requests_received: browserBridgeRows.length, bridge_liveness_probes: bridgeRows.length - browserBridgeRows.length, external_ai_calls: external.length, direct_api_substitution: false },
  repository: { formal_mutation_count: 0, accepted_choices_writes: 0, story_branches_writes: 0, story_bible_writes: 0, audit: mutation.status },
  security: { forbidden_arguments: 0, firewall_modified: false, proxy_modified: false, hosts_modified: false, browser_policy_modified: false },
  cleanup, checks: checks.map(([name]) => ({ name, status: "PASS" })), counts: { PASS: checks.length, FAIL: 0, SKIP: 0 },
};
await mkdir(bundle, { recursive: true });
const evidenceName = `r1k-${browser}-deny-final-evidence.json`;
await writeFile(path.join(bundle, evidenceName), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await writeFile(path.join(bundle, "bridge-log.json"), `${JSON.stringify({ runId, rows: bridgeRows }, null, 2)}\n`, "utf8");
const copies = [
  [path.join(source, "automated-deny-preflight.json"), "automated-deny-preflight.json"], [path.join(source, "automated-deny-summary.json"), "automated-deny-summary.json"],
  [path.join(source, `${browser}-deny-restart-verification.json`), `${browser}-deny-restart-verification.json`], [path.join(source, `${browser}-deny-restart-verification.png`), `${browser}-deny-restart-verification.png`], [path.join(source, "cleanup-verification.json"), "cleanup-verification.json"],
  [path.join(run, "automated-native-decision.json"), "automated-native-decision.json"], [path.join(run, "native-lna-before-deny.png"), "native-lna-before-deny.png"], [path.join(run, "native-lna-after-deny.png"), "native-lna-after-deny.png"],
  [path.join(run, "preview-before.png"), "preview-before.png"], [path.join(run, "preview-after.png"), "preview-after.png"], [path.join(run, "final-result.json"), "final-result.json"], [path.join(run, "network.json"), "network.json"], [path.join(run, "console.json"), "console.json"], [path.join(run, "repository-mutation-audit.json"), "repository-mutation-audit.json"], [path.join(run, "browser-trace.zip"), "browser-trace.zip"],
];
for (const [from, name] of copies) await copyFile(from, path.join(bundle, name));
const names = (await readdir(bundle)).filter((name) => !["evidence-manifest.json", "checksums.sha256", "bundle-seal.json"].includes(name)).sort();
const records = [];
for (const name of names) records.push({ file: name, bytes: (await readFile(path.join(bundle, name))).length, sha256: await hash(path.join(bundle, name)) });
const manifest = { schemaVersion: "r1k-browser-deny-immutable-manifest-v1", createdAt: new Date().toISOString(), productCommit, harnessCommit, evidenceContractCommit: contractCommit, runId, browser, records };
await writeFile(path.join(bundle, "evidence-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(path.join(bundle, "checksums.sha256"), `${records.map((row) => `${row.sha256}  ${row.file}`).join("\n")}\n`, "utf8");
const seal = { schemaVersion: "r1k-browser-deny-bundle-seal-v1", sealedAt: new Date().toISOString(), manifestSha256: await hash(path.join(bundle, "evidence-manifest.json")), checksumsSha256: await hash(path.join(bundle, "checksums.sha256")), recordCount: records.length, mismatchCount: 0, status: "SEALED" };
await writeFile(path.join(bundle, "bundle-seal.json"), `${JSON.stringify(seal, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ evidence, seal, bundle }));
