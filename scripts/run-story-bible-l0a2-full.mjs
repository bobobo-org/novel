import { spawnSync } from "node:child_process";

const steps = [
  { name: "build", command: "pnpm", args: ["build"] },
  { name: "storage-boundaries", command: "pnpm", args: ["check:storage-boundaries"] },
  { name: "l0a2e2-existing", command: "pnpm", args: ["test:story-bible:l0a2e2:all"] },
  { name: "full-regression", command: "pnpm", args: ["test:story-bible:l0a2:regression"] },
  { name: "hash-data-parity", command: "pnpm", args: ["test:story-bible:l0a2:parity"] },
  { name: "performance-baseline", command: "pnpm", args: ["test:story-bible:l0a2:performance"] },
];

const results = [];
const started = Date.now();

for (const step of steps) {
  const stepStarted = Date.now();
  const res = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 1024 * 1024 * 40,
  });
  results.push({
    name: step.name,
    status: res.status === 0 ? "PASS" : "FAIL",
    elapsedMs: Date.now() - stepStarted,
    stdoutTail: (res.stdout || "").slice(-1600),
    stderrTail: (res.stderr || "").slice(-1600),
  });
  if (res.status !== 0) break;
}

const summary = {
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  skip: steps.length - results.length,
  elapsedMs: Date.now() - started,
  coreGateReady: results.length === steps.length && results.every((item) => item.status === "PASS"),
  productionSmokeStatus: process.env.ADMIN_TOKEN ? "not_run" : "blocked_missing_admin_token",
  fullAdoptionReady: false,
  fullAdoptionBlocker: "production smoke gate is intentionally outside this aggregate script",
};

console.log(JSON.stringify({ summary, results }, null, 2));
process.exit(summary.coreGateReady ? 0 : 1);
