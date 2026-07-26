import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RC1_PRODUCT = "71bea12da90def7646efe1189f059896d3582327";
const UI_REFERENCE_BASELINE = "c784cde87cd0a6b35ef251720ca1dadf898546c3";
const UI_REFERENCE_FINAL = "e1832437b31b9b53a3399f745d602813245f938f";
const productCommit = process.env.P24B_RC2_PRODUCT_COMMIT
  || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const evidenceDir = path.resolve(
  process.env.P24B_RC2_EVIDENCE_DIR || "artifacts/p24b-rc2-unified-ui",
);
const slash = (value) => value.replaceAll("\\", "/");
const gitLines = (args) => execFileSync("git", args, { encoding: "utf8" })
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

function classifyProductFile(file) {
  if (/^(?:app\/page\.tsx|app\/professional\/page\.tsx|app\/studio\/page\.tsx|lib\/professional-frontdoor\.ts)$/.test(file)) {
    return "FRONTDOOR_ROUTE";
  }
  if (/^(?:public\/legacy\/novel-system\.html|app\/studio\/create\/create-project-client\.tsx|app\/studio\/project\/\[projectId\]\/project-navigation\.tsx|app\/studio\/read\/\[projectId\]\/reader-client\.tsx)$/.test(file)) {
    return "UI_CONVERGENCE";
  }
  if (/^scripts\/(?:run-ai-p11-consumer-convergence|run-ai-p11r2-production-frontdoor-truth|run-p24b-rc2-ui-convergence)\.mjs$/.test(file)) {
    return "UI_TEST";
  }
  if (/^(?:release-manifest\.json|app\/api\/ai\/health\/route\.ts|app\/api\/admin\/persistence\/route\.ts)$/.test(file)) {
    return "RELEASE_IDENTITY";
  }
  if (/^(?:package\.json|scripts\/(?:run-p24b-rc2-[a-z0-9-]+|resolve-p24b-rc2-action-pins|seal-p24b-rc2-evidence|verify-p24b-rc2-evidence)\.mjs)$/.test(file)) {
    return "RELEASE_TEST";
  }
  return "UNEXPECTED";
}

function classifyReferenceFile(file) {
  if (file === ".github/workflows/deploy.yml") return "DEPLOYMENT_REFERENCE_EXCLUDED";
  if (file === "README.md") return "DOCUMENTATION_REFERENCE_EXCLUDED";
  if (["app/page.tsx", "next.config.ts", "public/legacy/novel-system.html"].includes(file)) {
    return "UI_PRODUCT_REFERENCE";
  }
  if (/^scripts\/run-ai-p11(?:r2)?-/.test(file)) return "UI_TEST_REFERENCE";
  return "UNEXPECTED";
}

const parent = execFileSync("git", ["rev-parse", `${productCommit}^`], { encoding: "utf8" }).trim();
assert.equal(parent, RC1_PRODUCT, "RC2 Product must be a direct child of RC1 Product");

const referenceRows = gitLines([
  "diff",
  "--name-status",
  UI_REFERENCE_BASELINE,
  UI_REFERENCE_FINAL,
]).map((line) => {
  const [change, ...parts] = line.split(/\s+/);
  const file = slash(parts.at(-1));
  return { change, file, classification: classifyReferenceFile(file) };
});
assert.equal(referenceRows.length, 7, "Unexpected UI reference inventory size");
assert.deepEqual(
  referenceRows.filter((row) => row.classification === "UNEXPECTED"),
  [],
  "UI reference inventory contains unexpected files",
);

const productFiles = gitLines(["diff", "--name-only", RC1_PRODUCT, productCommit]).map(slash);
const classifiedProductFiles = productFiles.map((file) => ({
  file,
  classification: classifyProductFile(file),
}));
const unexpected = classifiedProductFiles.filter((entry) => entry.classification === "UNEXPECTED");
assert.deepEqual(unexpected, [], "RC2 Product contains files outside the approved scope");
for (const prohibited of [
  ".github/workflows/deploy.yml",
  "README.md",
  "next.config.ts",
]) {
  assert.equal(productFiles.includes(prohibited), false, `${prohibited} must not enter RC2 Product`);
}
assert.equal(productFiles.some((file) => file.startsWith("artifacts/")), false, "Product cannot contain evidence");
assert.equal(productFiles.some((file) => file.startsWith(".github/workflows/")), false, "Product cannot contain CI");
for (const category of [
  "UI_CONVERGENCE",
  "FRONTDOOR_ROUTE",
  "UI_TEST",
  "RELEASE_IDENTITY",
  "RELEASE_TEST",
]) {
  assert.ok(
    classifiedProductFiles.some((entry) => entry.classification === category),
    `Missing approved Product category: ${category}`,
  );
}

const generatedAt = new Date().toISOString();
const uiReferenceDelta = {
  schemaVersion: "p24b-rc2-ui-reference-delta-v1",
  generatedAt,
  referenceBaseline: UI_REFERENCE_BASELINE,
  referenceFinal: UI_REFERENCE_FINAL,
  inventoryMethod: "git-diff-name-status",
  records: referenceRows,
  recordCount: referenceRows.length,
  unexpected: 0,
  status: "PASS",
};
const decisions = {
  ".github/workflows/deploy.yml": {
    decision: "EXCLUDED",
    reason: "Deployment workflow is outside RC2 Product and Production is immutable.",
  },
  "README.md": {
    decision: "EXCLUDED",
    reason: "Documentation reference is outside the approved Product scope.",
  },
  "app/page.tsx": {
    decision: "REIMPLEMENTED",
    reason: "Shared exact-route server adapter replaces the reference-only root redirect.",
  },
  "next.config.ts": {
    decision: "REIMPLEMENTED_WITHOUT_IMPORT",
    reason: "Wildcard /studio/:path* redirect is prohibited; exact app routes preserve children.",
  },
  "public/legacy/novel-system.html": {
    decision: "SELECTIVELY_REIMPLEMENTED",
    reason: "First-paint Professional layout was adapted onto RC1 Product without replacing P2.4B logic.",
  },
  "scripts/run-ai-p11-consumer-convergence.mjs": {
    decision: "REIMPLEMENTED",
    reason: "Static convergence gate now validates the RC2 Professional contract.",
  },
  "scripts/run-ai-p11r2-production-frontdoor-truth.mjs": {
    decision: "REIMPLEMENTED",
    reason: "Frontdoor truth now validates exact redirects and preserved Studio children.",
  },
};
const selectivePortMap = {
  schemaVersion: "p24b-rc2-selective-port-map-v1",
  generatedAt,
  rc1Product: RC1_PRODUCT,
  productCommit,
  referenceBaseline: UI_REFERENCE_BASELINE,
  referenceFinal: UI_REFERENCE_FINAL,
  referenceDecisions: referenceRows.map((row) => ({
    ...row,
    ...decisions[row.file],
  })),
  productFiles: classifiedProductFiles,
  categoryCounts: Object.fromEntries(
    ["UI_CONVERGENCE", "FRONTDOOR_ROUTE", "UI_TEST", "RELEASE_IDENTITY", "RELEASE_TEST", "UNEXPECTED"]
      .map((category) => [
        category,
        classifiedProductFiles.filter((entry) => entry.classification === category).length,
      ]),
  ),
  prohibitedImportedFiles: [],
  unexpected: unexpected.length,
  status: "P2.4B_RC2_SELECTIVE_UI_PORT_PASS",
};

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, "ui-reference-delta.json"),
  `${JSON.stringify(uiReferenceDelta, null, 2)}\n`,
  "utf8",
);
fs.writeFileSync(
  path.join(evidenceDir, "selective-port-map.json"),
  `${JSON.stringify(selectivePortMap, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({
  status: "PASS",
  productCommit,
  productFileCount: productFiles.length,
  referenceRecordCount: referenceRows.length,
  unexpected: unexpected.length,
}));
