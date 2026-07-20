import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runSandboxSmoke } from "../../scripts/r5-2-desktop/local-cdp-adapter.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const artifactRoot = path.resolve(repositoryRoot, process.argv[2] || "artifacts/closed-ai-phase1-1r5-2r1d");
const profileRoot = path.join(artifactRoot, "smoke-profiles");
await mkdir(artifactRoot, { recursive: true });

const results = [];
for (const browser of ["chrome", "edge"]) {
  try {
    const result = await runSandboxSmoke({
      browser,
      profilePath: path.join(profileRoot, browser),
      artifactDirectory: artifactRoot,
    });
    results.push(result);
    await writeFile(path.join(artifactRoot, `${browser}-sandbox-smoke.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(
      path.join(artifactRoot, `${browser}-actual-command-line.txt`),
      `${result.securityAudit.rows.map((row) => row.commandLine).join("\n")}\n`,
      "utf8",
    );
  } catch (error) {
    const result = error.smokeResult || { browser, status: "FAIL", error: { code: error.code, message: error.message } };
    results.push(result);
    await writeFile(path.join(artifactRoot, `${browser}-sandbox-smoke.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
}

const failed = results.filter((result) => result.status !== "PASS");
process.stdout.write(`${JSON.stringify({ suite: "r5-2r1d-real-browser-sandbox-smoke", pass: results.length - failed.length, fail: failed.length, results }, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
