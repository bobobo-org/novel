import { spawnSync } from "node:child_process";

const started = Date.now();
const results = [];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(name, command, args) {
  const t0 = Date.now();
  const child = spawnSync(command, args, { cwd: process.cwd(), env: process.env, encoding: "utf8", shell: true });
  const elapsedMs = Date.now() - t0;
  const ok = child.status === 0;
  results.push({ name, status: ok ? "PASS" : "FAIL", details: { elapsedMs, stdoutTail: child.stdout?.slice(-1200), stderrTail: child.stderr?.slice(-1200) } });
}

run("Build", pnpm, ["build"]);
run("Storage Boundary", pnpm, ["check:storage-boundaries"]);
run("L0B Regression", pnpm, ["test:story-bible:l0b:full"]);
run("Provider Contract", pnpm, ["test:ai:h1:provider-contract"]);
run("Router", pnpm, ["test:ai:h1:router"]);
run("Privacy and Context Budget", pnpm, ["test:ai:h1:privacy-context"]);
run("Ollama Mock", pnpm, ["test:ai:h1:ollama-mock"]);
run("Ollama Local Integration", pnpm, ["test:ai:h1:ollama-local"]);
run("Offline Matrix", pnpm, ["test:ai:h1:offline"]);

const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const summary = {
  suite: "H1 Aggregate",
  pass,
  fail,
  skip: 0,
  elapsedMs: Date.now() - started,
  providerContractExpectedPass: 30,
  routerExpectedPass: 50,
  privacyContextExpectedPass: 25,
  ollamaMockExpectedPass: 40,
  offlineExpectedPass: 20,
  fullOfflineAIStatus: "not_implemented",
  ollamaBridgeStatus: "contract_ready",
  results,
};
console.log(JSON.stringify(summary, null, 2));
if (fail > 0) process.exit(1);
