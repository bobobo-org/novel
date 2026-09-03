import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedHubVersion = "1.5.0-public-lounge-attestation-v5";
const [installer, starter, manifest] = await Promise.all([
  readFile(path.join(root, "local-ai/companion/install.ps1"), "utf8"),
  readFile(path.join(root, "local-ai/companion/start-companion.ps1"), "utf8"),
  readFile(path.join(root, "local-ai/companion/manifest.json"), "utf8").then(JSON.parse),
]);

assert.equal(manifest.privateHubVersion, expectedHubVersion);
assert.match(installer, /\$nativeExitCode\s*=\s*\$LASTEXITCODE/u);
assert.match(installer, /Wait-CompanionServiceReleased/u);
assert.match(installer, /Get-Process\s+-Id\s+\$ProcessIdentifier/u);
assert.match(installer, /Test-LoopbackPortOpen\s+\$Port/u);
assert.match(installer, /COMPANION_OLD_SERVICE_NOT_RELEASED/u);
assert.match(installer, /Get-PrivateHubHealth/u);
assert.match(installer, /\$verifiedHubVersion\s+-ne\s+\$expectedPrivateHubVersion/u);
assert.match(installer, /WriteAllBytes\(\$currentPath,\s*\$oldCurrentBytes\)/u);
assert.match(installer, /Restore-ShortcutSnapshot\s+\$startupShortcut\s+\$oldShortcut/u);
assert.match(installer, /COMPANION_ROLLBACK_OLD_START_FAILED/u);
assert.match(starter, /COMPANION_HUB_VERSION_MISMATCH/u);
assert.ok(starter.includes(expectedHubVersion));

const powershell = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const { stdout, stderr } = await execFileAsync(powershell, [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  path.join(root, "scripts/run-companion-upgrade-safety.ps1"),
  "-RepositoryRoot",
  root,
], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
  windowsHide: true,
});

assert.equal(stderr.trim(), "");
const result = JSON.parse(stdout.trim());
assert.equal(result.status, "PASS");
assert.equal(result.pass, 4);
assert.equal(result.nativeStopExitFailFast, true);
assert.equal(result.pidAndPortReleaseRequired, true);
assert.equal(result.exactHubVersionRequired, expectedHubVersion);
assert.equal(result.currentAndShortcutRollback, true);
assert.equal(result.oldReleaseRestartAttempted, true);

process.stdout.write(`${JSON.stringify({
  suite: "companion-upgrade-safety",
  status: "PASS",
  staticContract: true,
  powershellIntegration: result,
}, null, 2)}\n`);
