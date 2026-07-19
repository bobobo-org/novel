import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const htmlPath = path.join(root, "public", "legacy", "novel-system.html");
const swPath = path.join(root, "public", "legacy", "service-worker.js");
const boundaryPath = path.join(root, "public", "legacy", "legacy-security-boundary.js");
const manifestPath = path.join(root, "public", "legacy", "novel-system.build.json");
const html = fs.readFileSync(htmlPath, "utf8");
const serviceWorker = fs.readFileSync(swPath, "utf8");
const boundary = fs.readFileSync(boundaryPath, "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const prohibitedText = [
  "OpenAI-compatible Chat Completions",
  "Ollama Generate",
  "LM Studio Chat Completions",
  "workspaceScriptLoaded",
  "workspaceInitialized",
  "workspaceMounted",
  "workspaceVisible",
  "三路閉端 AI 架構",
];
const prohibitedScripts = [
  "./ai-service.js",
  "./phase1-manager.js",
  "./novel-local-runtime-client.js",
  "./novel-segmented-workspace.js",
  "./novel-whole-novel-workspace.js",
  "./local-training-service.js",
];

for (const marker of prohibitedText) assert(!html.includes(marker), `public HTML contains prohibited marker: ${marker}`);
for (const src of prohibitedScripts) assert(!html.includes(`src=\"${src}`), `public HTML loads unsafe legacy runtime: ${src}`);
assert(!/fetch\s*\(\s*(?:endpoint|ep)\b/.test(html), "public HTML contains arbitrary endpoint fetch");
assert(!/localStorage\.setItem\(\s*['\"]novel_external_ai_cfg/.test(html), "public HTML persists legacy provider settings");
assert(/function askExternalAI\(\)\{throw Object\.assign\(new Error/.test(html), "askExternalAI is not a hard rejection");
assert(/function miniAiAskLocal\(\)\{throw Object\.assign\(new Error/.test(html), "miniAiAskLocal is not a hard rejection");
assert(!prohibitedScripts.some((src) => serviceWorker.includes(`\"${src}\"`)), "service worker precaches an unsafe legacy runtime");
assert(boundary.includes("LEGACY_PROVIDER_PATH_DISABLED"), "legacy security boundary error code missing");
assert(boundary.includes("Object.defineProperty(window, \"fetch\""), "legacy fetch guard missing");
assert(boundary.includes("configurable: false"), "legacy guards are not locked");
for (const handler of ["cloudNovelAiFetch", "cloudNovelAiHealth", "cloudNovelAiAnalyze", "cloudNovelAiPlan", "cloudNovelAiReview"]) {
  assert(boundary.includes(`\"${handler}\"`), `legacy cloud handler is not locked: ${handler}`);
}
assert(boundary.includes('cloudPanel.hidden = true'), "legacy cloud panel is not hidden");
const scriptSources = [...html.matchAll(/<script[^>]+src=[\"']([^\"']+)[\"'][^>]*>/g)].map((match) => match[1]);
assert(scriptSources.at(-1)?.startsWith("./legacy-security-boundary.js"), "legacy security boundary must be the final external script");

if (failures.length) {
  console.error(JSON.stringify({ errorCode: "BUILD_FAIL_LEGACY_UNSAFE", failures }, null, 2));
  process.exit(1);
}

let commit = process.env.VERCEL_GIT_COMMIT_SHA || "";
if (!commit) {
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
  catch { commit = "unknown"; }
}
const manifest = {
  schemaVersion: "legacy-build-truth-v1",
  sourcePath: "public/legacy/novel-system.html",
  deployedRoute: "/legacy/novel-system.html",
  sourceSha256: sha256(html),
  buildArtifactSha256: sha256(html),
  commit,
  assertions: {
    prohibitedStringsAbsent: true,
    unsafeScriptsNotLoaded: true,
    directProviderHandlersRejected: true,
    unsafeServiceWorkerCacheEntriesAbsent: true,
    boundaryLoadedLast: true,
  },
};
if (process.argv.includes("--write-manifest")) fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
