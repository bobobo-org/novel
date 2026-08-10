import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const expected = {
  releaseLine: "novel-ai-p24b-conversation-first-studio-rc6",
  releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.2",
  releaseRevision: "rc6.2",
  releaseName: "P2.4B Conversation-First Novel Project GPT RC6.2",
  consumerRelease: "p2.4b-conversation-first-studio-rc6.2",
  architectureStage: "P2.4B RC",
  packageManager: "pnpm@10.34.5",
  vercelVersion: "56.3.2",
  checkoutPin: "3d3c42e5aac5ba805825da76410c181273ba90b1",
  setupNodePin: "820762786026740c76f36085b0efc47a31fe5020",
  uploadArtifactPin: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
};
const requiredConversationGates = [
  "test:studio:conversation-first-contract",
  "test:studio:conversation-first-browser",
  "test:studio:conversation-mobile",
  "test:studio:conversation-persistence",
  "test:studio:conversation-backup",
  "test:studio:conversation-branching",
  "test:studio:conversation-approval",
  "test:studio:conversation-rpg",
  "test:ai:conversation-project-memory",
  "test:ai:conversation-tool-routing",
  "test:ai:conversation-security",
  "test:ai:manual-learning-file-contract",
  "test:ai:manual-learning-import-transaction",
  "test:ai:manual-learning-worker",
  "test:ai:manual-learning-global-synthesis",
];

const [
  manifestText,
  packageText,
  lockfile,
  pnpmWorkspace,
  workflow,
  serviceWorker,
  supabaseBootstrap,
  externalBootstrap,
] = await Promise.all([
  readFile(new URL("../release-manifest.json", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"),
  readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
  readFile(new URL("../public/legacy/service-worker.js", import.meta.url), "utf8"),
  readFile(new URL("./bootstrap-production-supabase-env.mjs", import.meta.url), "utf8"),
  readFile(new URL("./bootstrap-production-external-ai-env.mjs", import.meta.url), "utf8"),
]);
const manifest = JSON.parse(manifestText);
const packageJson = JSON.parse(packageText);

assert.deepEqual({
  releaseLine: manifest.releaseLine,
  releaseTag: manifest.releaseTag,
  releaseRevision: manifest.releaseRevision,
  releaseName: manifest.releaseName,
  consumerRelease: manifest.consumerRelease,
  architectureStage: manifest.architectureStage,
}, {
  releaseLine: expected.releaseLine,
  releaseTag: expected.releaseTag,
  releaseRevision: expected.releaseRevision,
  releaseName: expected.releaseName,
  consumerRelease: expected.consumerRelease,
  architectureStage: expected.architectureStage,
});
assert.equal(packageJson.packageManager, expected.packageManager);
assert.equal(packageJson.devDependencies?.vercel, expected.vercelVersion);
assert.equal(packageJson.scripts?.["lint:ci"], "node scripts/run-eslint-warning-ratchet.mjs");
assert.equal(
  packageJson.scripts?.["test:ci:rc6-release-hardening"],
  "node scripts/run-rc6-release-hardening.mjs",
);
assert.equal(
  packageJson.scripts?.["test:ai:conversation-ollama-real"],
  "node --import ./scripts/register-rc6-test-loader.mjs scripts/run-conversation-first-ollama-real-rc6.mjs",
);
for (const gate of requiredConversationGates) {
  assert.equal(typeof packageJson.scripts?.[gate], "string", `${gate} package script is required`);
  assert.match(workflow, new RegExp(`pnpm ${gate}`, "u"));
}
assert.match(lockfile, /\n\s{6}vercel:\r?\n\s{8}specifier: 56\.3\.2\r?\n/u);
assert.match(pnpmWorkspace, /^\s*esbuild:\s*true\s*$/mu);
assert.doesNotMatch(pnpmWorkspace, /set this to true or false/u);

assert.match(workflow, /pull_request:\s*\r?\n\s+branches:\s*\[main\]/u);
assert.match(workflow, /workflow_dispatch:\s*\r?\n\s+inputs:/u);
assert.match(workflow, /preview_ref:/u);
assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u);
assert.match(workflow, /VERCEL_GIT_COMMIT_SHA.*preview_ref/u);
assert.doesNotMatch(workflow, /agent\/p24b-rc6-conversation-first/u);
assert.doesNotMatch(workflow, /agent\/browser-sovereign-ai-fabric-rc5/u);
assert.match(workflow, new RegExp(expected.releaseTag, "u"));
assert.match(workflow, /pnpm test:ci:rc6-release-hardening/u);
assert.doesNotMatch(workflow, /conversation-ollama-real/u);
assert.match(workflow, /pnpm lint:ci/u);
assert.doesNotMatch(workflow, /npm install --global/u);
assert.match(workflow, /corepack prepare pnpm@10\.34\.5 --activate/u);
assert.match(workflow, /pnpm exec playwright install --with-deps chromium/u);
assert.match(
  workflow,
  new RegExp(`actions/upload-artifact@${expected.uploadArtifactPin}`, "u"),
);
assert.match(workflow, /p24b-rc6-validation-\$\{\{ env\.VERCEL_GIT_COMMIT_SHA \}\}/u);
assert.match(workflow, /--arg headSha "\$VERCEL_GIT_COMMIT_SHA"/u);
assert.match(workflow, /rawUploadsIncluded:false/u);
assert.match(workflow, /pnpm exec vercel pull/u);
assert.match(workflow, /pnpm exec vercel build/u);
assert.match(workflow, /pnpm exec vercel deploy/u);
assert.doesNotMatch(workflow, /run:\s*vercel\b/u);
assert.doesNotMatch(workflow, /output="\$\(vercel\b/u);

const actionUses = [...workflow.matchAll(/uses:\s*(actions\/(?:checkout|setup-node))@([a-f0-9]{40})/gu)]
  .map((match) => ({ action: match[1], pin: match[2] }));
assert.ok(actionUses.length >= 4);
assert.ok(actionUses.every(({ action, pin }) => (
  action === "actions/checkout"
    ? pin === expected.checkoutPin
    : pin === expected.setupNodePin
)));
const setupNodeUseCount = actionUses.filter(({ action }) => action === "actions/setup-node").length;
const node24Count = [...workflow.matchAll(/node-version:\s*24\s*$/gmu)].length;
assert.equal(node24Count, setupNodeUseCount);

for (const source of [supabaseBootstrap, externalBootstrap]) {
  assert.match(source, /\["exec", "vercel", \.\.\.args\]/u);
  assert.doesNotMatch(source, /spawnSync\("vercel"/u);
}
assert.match(serviceWorker, /novel-system-conversation-first-studio-rc6/u);
assert.doesNotMatch(serviceWorker, /browser-sovereign-ai-fabric-rc5/u);

console.log(JSON.stringify({
  schemaVersion: "p24b-rc6-release-hardening-result-v1",
  status: "PASS",
  releaseTag: expected.releaseTag,
  packageManager: expected.packageManager,
  vercelVersion: expected.vercelVersion,
  previewPolicy: "trusted_same_repository_exact_sha",
  nodeRuntime: 24,
  actionPins: {
    "actions/checkout@v7.0.1": expected.checkoutPin,
    "actions/setup-node@v7.0.0": expected.setupNodePin,
    "actions/upload-artifact@v7.0.1": expected.uploadArtifactPin,
  },
  actionUseCount: actionUses.length,
  globalInstallCount: 0,
}, null, 2));
