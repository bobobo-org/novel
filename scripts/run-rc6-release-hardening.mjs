import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const expected = {
  releaseLine: "novel-ai-p24b-conversation-first-studio-rc6",
  releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.5",
  releaseRevision: "rc6.5",
  releaseName: "P2.4B Conversation-First Novel Project GPT RC6.5",
  consumerRelease: "p2.4b-conversation-first-studio-rc6.5",
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
const requiredBrowserCandidateGates = Object.freeze({
  "test:ai:browser:setup-state-machine-rc6.4":
    "node scripts/run-rc6-4-browser-setup-state-machine.mjs",
  "test:ai:browser:setup-runtime-rc6.4":
    "node --experimental-strip-types --import ./scripts/register-ts-extension-loader.mjs scripts/run-rc6-4-browser-setup-runtime.mjs",
  "test:ai:browser:setup-diagnostics-rc6.4":
    "node --experimental-strip-types --import ./scripts/register-ts-extension-loader.mjs scripts/run-rc6-4-browser-setup-diagnostics.mjs",
  "test:ai:browser:prose-candidate-v2-rc6.5":
    "node --experimental-strip-types --import ./scripts/register-ts-extension-loader.mjs scripts/run-rc6-5-browser-prose-candidate-v2-contract.mjs",
  "test:ai:browser:prose-candidate-v2-runtime-rc6.5":
    "node --experimental-strip-types --import ./scripts/register-ts-extension-loader.mjs scripts/run-rc6-5-browser-prose-candidate-v2-runtime-contract.mjs",
});

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
for (const [gate, command] of Object.entries(requiredBrowserCandidateGates)) {
  assert.equal(packageJson.scripts?.[gate], command, `${gate} package script drifted`);
  assert.match(workflow, new RegExp(`pnpm ${gate.replaceAll(".", "\\.")}`, "u"));
}
assert.match(lockfile, /\n\s{6}vercel:\r?\n\s{8}specifier: 56\.3\.2\r?\n/u);
assert.match(pnpmWorkspace, /^\s*esbuild:\s*true\s*$/mu);
assert.doesNotMatch(pnpmWorkspace, /set this to true or false/u);

assert.match(workflow, /pull_request:\s*\r?\n\s+branches:\s*\[main\]/u);
assert.match(workflow, /workflow_dispatch:\s*\r?\n\s+inputs:/u);
assert.match(workflow, /preview_ref:/u);
assert.match(
  workflow,
  /repository:\s*\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name \|\| github\.repository \}\}/u,
);
assert.match(
  workflow,
  /\n  preview:[\s\S]*?if:\s*>-\s*\n\s+github\.event_name == 'workflow_dispatch' &&\s*\n\s+inputs\.operation == 'deploy-preview' &&\s*\n\s+github\.ref_type == 'branch' &&\s*\n\s+github\.ref == 'refs\/heads\/trusted-attestation-producer' &&\s*\n\s+github\.sha == inputs\.preview_ref &&\s*\n\s+github\.workflow_sha == github\.sha/u,
);
assert.match(workflow, /VERCEL_GIT_COMMIT_SHA.*preview_ref/u);
assert.doesNotMatch(workflow, /agent\/p24b-rc6-conversation-first/u);
assert.doesNotMatch(workflow, /agent\/browser-sovereign-ai-fabric-rc5/u);
// The active release identity is Product-owned. The normal workflow must read
// and validate it from the exact checkout instead of embedding this RC's tag
// as a workflow literal (historical Recovery identities remain separate).
assert.doesNotMatch(workflow, new RegExp(expected.releaseTag, "u"));
assert.match(workflow, /readFileSync\("release-manifest\.json", "utf8"\)/u);
assert.match(workflow, /readFileSync\("release-metadata-contract\.json", "utf8"\)/u);
assert.match(workflow, /readFileSync\("generated\/release-provenance\.json", "utf8"\)/u);
assert.match(
  workflow,
  /release_tag:\s*\$\{\{ steps\.validated_release_identity\.outputs\.release_tag \}\}/u,
);
assert.match(
  workflow,
  /EXPECTED_RELEASE_TAG:\s*\$\{\{ needs\.validate\.outputs\.release_tag \}\}/u,
);
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
  previewPolicy: "trusted_manual_dispatch_branch_head_self_control_exact_sha",
  nodeRuntime: 24,
  actionPins: {
    "actions/checkout@v7.0.1": expected.checkoutPin,
    "actions/setup-node@v7.0.0": expected.setupNodePin,
    "actions/upload-artifact@v7.0.1": expected.uploadArtifactPin,
  },
  actionUseCount: actionUses.length,
  globalInstallCount: 0,
}, null, 2));
