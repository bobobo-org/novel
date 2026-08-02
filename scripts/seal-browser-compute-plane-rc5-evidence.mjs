import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const evidenceRoot = path.join(root, "artifacts", "browser-compute-plane-rc5");
const mode = process.argv[2] ?? "seal";

const RELEASE = Object.freeze({
  releaseTag: "novel-ai-p24b-browser-first-compute-plane-rc5",
  releaseName: "P2.4B Browser-First Sovereign Compute Plane RC5",
  consumerRelease: "p2.4b-browser-first-compute-plane-rc5",
  architectureStage: "P2.4B RC",
});

const RECORDS = Object.freeze([
  "baseline.json",
  "product-commit.json",
  "release-identity.json",
  "model-catalog.json",
  "device-benchmarks.json",
  "shard-integrity.json",
  "task-eligibility-matrix.json",
  "semantic-index-results.json",
  "context-compression-results.json",
  "quality-gate-results.json",
  "offload-routing-results.json",
  "offload-benchmark.json",
  "local-ollama-reduction.json",
  "private-hub-reduction.json",
  "browser-assisted-results.json",
  "offline-results.json",
  "edge-results.json",
  "chrome-results.json",
  "mobile-results.json",
  "privacy-results.json",
  "canon-results.json",
  "regeneration-results.json",
  "worker-recovery-results.json",
  "service-worker-results.json",
  "production-baseline.json",
  "secret-scan.json",
  "findings.json",
  "executive-summary.md",
]);

const PASS_RECORDS = new Set(RECORDS.filter((name) => ![
  "baseline.json",
  "executive-summary.md",
].includes(name)));

const FORBIDDEN_JSON_KEYS = new Set([
  "prompt",
  "rawprompt",
  "input",
  "rawinput",
  "output",
  "rawoutput",
  "content",
  "rawcontent",
  "storytext",
  "privatestorytext",
  "rawtext",
  "chainofthought",
  "rawchainofthought",
  "authorization",
  "authorizationheader",
  "cookie",
  "setcookie",
  "csrftoken",
  "pairingcode",
  "password",
  "secret",
  "accesstoken",
  "refreshtoken",
  "apikey",
]);

const CREDENTIAL_PATTERNS = [
  /\bvcp_[A-Za-z0-9]{20,}\b/gu,
  /\bsbp_[A-Za-z0-9]{20,}\b/gu,
  /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
  /\bxai-[A-Za-z0-9_-]{20,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/giu,
  /\b(?:Cookie|Set-Cookie)\s*:/giu,
];

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function read(name) {
  return fs.readFileSync(path.join(evidenceRoot, name));
}

function readJson(name) {
  return JSON.parse(read(name).toString("utf8"));
}

function normalizedKey(value) {
  return value.replace(/[^a-z0-9]/giu, "").toLocaleLowerCase("en-US");
}

function scanJsonKeys(value, location, hits) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => scanJsonKeys(child, `${location}[${index}]`, hits));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (FORBIDDEN_JSON_KEYS.has(normalizedKey(key))) hits.push(childLocation);
    scanJsonKeys(child, childLocation, hits);
  }
}

function credentialHits(buffer, name) {
  const value = buffer.toString("utf8");
  return CREDENTIAL_PATTERNS.flatMap((pattern) => {
    pattern.lastIndex = 0;
    return [...value.matchAll(pattern)].map(() => ({ file: name, pattern: pattern.source }));
  });
}

function assertRecordSet() {
  const allowed = new Set([
    ...RECORDS,
    "evidence-manifest.json",
    "evidence-manifest.sha256",
  ]);
  const actual = fs.readdirSync(evidenceRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const missing = RECORDS.filter((name) => !actual.includes(name));
  const unexpected = actual.filter((name) => !allowed.has(name));
  assert.deepEqual(missing, [], `Missing RC5 evidence: ${missing.join(", ")}`);
  assert.deepEqual(unexpected, [], `Unexpected RC5 evidence: ${unexpected.join(", ")}`);
  return { actual, missing, unexpected };
}

function inspectRecords() {
  const records = [];
  const unsafeJsonKeys = [];
  const credentials = [];
  for (const name of RECORDS) {
    const bytes = read(name);
    credentials.push(...credentialHits(bytes, name));
    if (name.endsWith(".json")) {
      const value = JSON.parse(bytes.toString("utf8"));
      scanJsonKeys(value, name, unsafeJsonKeys);
      if (PASS_RECORDS.has(name)) {
        assert.equal(value.status, "PASS", `${name} is not PASS`);
      }
    }
    records.push({
      path: name,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  assert.deepEqual(credentials, [], "Credential-shaped text is forbidden in RC5 evidence.");
  assert.deepEqual(
    unsafeJsonKeys,
    [],
    `Raw private/story/reasoning fields are forbidden: ${unsafeJsonKeys.join(", ")}`,
  );
  const secretScan = readJson("secret-scan.json");
  assert.equal(
    Number(secretScan.credentialHits ?? secretScan.hits),
    0,
    "secret-scan.json must report zero credential hits",
  );
  return { records, credentials, unsafeJsonKeys };
}

function seal() {
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const set = assertRecordSet();
  const inspection = inspectRecords();
  const product = readJson("product-commit.json");
  const identity = readJson("release-identity.json");
  assert.match(product.productCommit, /^[a-f0-9]{40}$/u);
  assert.deepEqual(
    {
      releaseTag: identity.releaseTag,
      releaseName: identity.releaseName,
      consumerRelease: identity.consumerRelease,
      architectureStage: identity.architectureStage,
    },
    RELEASE,
  );
  const payload = {
    schemaVersion: "p24b-rc5-browser-compute-plane-evidence-manifest-v1",
    ...RELEASE,
    productCommit: product.productCommit,
    recordCount: inspection.records.length,
    records: inspection.records,
    missing: set.missing.length,
    unexpected: set.unexpected.length,
    mismatch: 0,
    credentialHits: inspection.credentials.length,
    privateStoryTextPersisted: false,
    rawChainOfThoughtPersisted: false,
  };
  const manifest = {
    ...payload,
    selfHash: sha256(canonical(payload)),
    selfHashStatus: "MATCH",
  };
  const manifestPath = path.join(evidenceRoot, "evidence-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(evidenceRoot, "evidence-manifest.sha256"),
    `${sha256(fs.readFileSync(manifestPath))}  evidence-manifest.json\n`,
    "ascii",
  );
  return verify();
}

function verify() {
  const set = assertRecordSet();
  const inspection = inspectRecords();
  const manifestBytes = read("evidence-manifest.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const { selfHash, selfHashStatus, ...payload } = manifest;
  const recomputedRecords = new Map(
    inspection.records.map((record) => [record.path, record]),
  );
  const mismatch = manifest.records.filter((record) => {
    const current = recomputedRecords.get(record.path);
    return !current || current.bytes !== record.bytes || current.sha256 !== record.sha256;
  });
  assert.equal(selfHashStatus, "MATCH");
  assert.equal(selfHash, sha256(canonical(payload)), "Manifest self-hash mismatch");
  assert.equal(manifest.recordCount, RECORDS.length);
  assert.equal(manifest.missing, 0);
  assert.equal(manifest.unexpected, 0);
  assert.equal(manifest.mismatch, 0);
  assert.equal(manifest.credentialHits, 0);
  assert.equal(manifest.privateStoryTextPersisted, false);
  assert.equal(manifest.rawChainOfThoughtPersisted, false);
  assert.deepEqual(mismatch, [], "Evidence record digest mismatch");
  assert.equal(
    read("evidence-manifest.sha256").toString("ascii"),
    `${sha256(manifestBytes)}  evidence-manifest.json\n`,
    "Manifest digest file mismatch",
  );
  return {
    status: "PASS",
    mode,
    records: RECORDS.length,
    missing: set.missing.length,
    unexpected: set.unexpected.length,
    mismatch: mismatch.length,
    credentialHits: inspection.credentials.length,
    selfHash: "MATCH",
    manifestDigest: "MATCH",
  };
}

if (!fs.existsSync(evidenceRoot)) {
  throw new Error(`RC5 evidence directory does not exist: ${evidenceRoot}`);
}
if (!["seal", "verify"].includes(mode)) {
  throw new Error(`Unknown mode: ${mode}`);
}
const result = mode === "seal" ? seal() : verify();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
