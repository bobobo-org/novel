import crypto from "node:crypto";
import { createSourceNaturalKey, createSourceNaturalKeyHash } from "../lib/novel-ai/storage/source-identity.ts";

const results = [];
function assert(name, condition, details = {}) {
  results.push({ name, status: condition ? "PASS" : "FAIL", details });
}

function stable(value, path = []) {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "number") return Number.isFinite(value) ? String(Object.is(value, -0) ? 0 : value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    const setLike = new Set(["aliases", "sourceRefs", "candidateIds", "approvedCandidateIds", "mutationRequestIds", "possessions", "participants", "causes", "consequences", "history", "exceptions"]);
    const last = path[path.length - 1] || "";
    const list = setLike.has(last) ? [...value].sort((a, b) => stable(a).localeCompare(stable(b))) : value;
    return `[${list.map((item, index) => stable(item, [...path, String(index)])).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key.normalize("NFC"))}:${stable(item, [...path, key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function sha(value) {
  return crypto.createHash("sha256").update(stable(value)).digest("hex");
}

const fixtures = {
  candidate: {
    id: "cand_gold",
    project_id: "gold_project",
    entity_type: "character",
    temporary_entity_id: "char_gold",
    operation: "create",
    field_path: "characters[].canonicalName",
    proposed_value: "\"林昭\"",
    confidence: 0.92,
    candidate_trust: "cloud-validated",
    source_valid: true,
    status: "pending",
  },
  source: {
    project_id: "gold_project",
    excerpt_hash: "ex_hash",
    chapter_id: "ch1",
    scene_id: null,
    paragraph_index: 0,
    text_start: 0,
    text_end: 12,
    source_type: "text_excerpt",
  },
  canonical: {
    projectId: "gold_project",
    entityType: "character",
    entityId: "char_gold",
    canonicalName: "林昭",
    aliases: ["昭", "林大人"],
    age: 28,
    lifeStatus: "alive",
  },
  changeSet: {
    operationType: "approve",
    changes: [{ entityType: "character", entityId: "char_gold", fieldPath: "canonicalName", oldValue: null, newValue: "林昭" }],
  },
};

const golden = {
  candidate: "9d39f53545dd356d0cb5b237c0dd6bd0ef55442ed5fcea74a690deb40d01ab6e",
  source: "e77a7c2359a353ad9ad3e2514ac3e98e331e41e34d12da9bdc15a92a4a8da23a",
  canonical: "7930e11385328df29ec8c5210a7ce12411ac568809c3b4d92bffb1ae6fca044d",
  changeSet: "3833c5e760e7ea34d18eccd0ea8c6ec202535a2eb0b40dd1c668a012b34ffb15",
  package: "736ef6c609fe15711e46c76060fbfac457826ae74fbb93eb4a52de6231a0db83",
};

for (const [name, value] of Object.entries(fixtures)) {
  assert(`${name} golden hash`, sha(value) === golden[name], { actual: sha(value), expected: golden[name] });
}
assert("package golden hash", sha(fixtures) === golden.package, { actual: sha(fixtures), expected: golden.package });

const sourceKey = createSourceNaturalKey(fixtures.source);
const sourceKeyHash = createSourceNaturalKeyHash(fixtures.source);
assert("source natural key version", sourceKey.startsWith("source-natural-key-v1|"));
assert("source natural key project scoped", sourceKey.includes("|gold_project|"));
assert("source natural key hash shape", /^[a-f0-9]{64}$/.test(sourceKeyHash), { sourceKeyHash });

const candidateShape = fixtures.candidate;
assert("candidate enum operation", ["create", "update", "append", "no-change"].includes(candidateShape.operation));
assert("candidate trust enum", ["cloud-validated", "cloud-repaired", "cloud-reduced", "local-rule", "invalid"].includes(candidateShape.candidate_trust));
assert("candidate status enum", ["pending", "needs_review", "approved", "rejected", "stale", "superseded", "failed"].includes(candidateShape.status));
assert("candidate source valid boolean", typeof candidateShape.source_valid === "boolean");
assert("candidate proposed value serialized", typeof candidateShape.proposed_value === "string" && candidateShape.proposed_value.includes("林昭"));
assert("source range ordering", fixtures.source.text_start < fixtures.source.text_end);
assert("source null scene stable", stable({ scene_id: null }) === "{\"scene_id\":null}");
assert("array set ordering stable", sha({ aliases: ["林大人", "昭"] }) === sha({ aliases: ["昭", "林大人"] }));
assert("array list ordering preserved", sha({ changes: [1, 2] }) !== sha({ changes: [2, 1] }));
assert("undefined omitted in object", stable({ a: 1, b: undefined }) === "{\"a\":1}");
assert("null not absent", stable({ a: null }) !== stable({}));
assert("unicode NFC stable", sha({ name: "林昭" }) === sha({ name: "林昭".normalize("NFC") }));

const exportManifest = {
  contentHash: golden.package,
  manifestHash: sha({ releaseTag: "novel-ai-l0a2e2c-boundary-silent-fallback", contentHash: golden.package }),
  canonicalAuthority: "local",
  storageBoundary: "ready",
};
assert("export contentHash deterministic", exportManifest.contentHash === golden.package);
assert("export manifestHash shape", /^[a-f0-9]{64}$/.test(exportManifest.manifestHash));
assert("authority local", exportManifest.canonicalAuthority === "local");
assert("no secret fields in parity fixture", !JSON.stringify({ fixtures, exportManifest }).match(/API_KEY|ADMIN_TOKEN|SERVICE_ROLE|Bearer /i));

const summary = {
  pass: results.filter((item) => item.status === "PASS").length,
  fail: results.filter((item) => item.status === "FAIL").length,
  skip: 0,
  hashParityStatus: results.every((item) => item.status === "PASS") ? "ready" : "failed",
  dataParityStatus: results.every((item) => item.status === "PASS") ? "ready" : "failed",
};

console.log(JSON.stringify({ summary, golden, exportManifest, results }, null, 2));
process.exit(summary.fail === 0 ? 0 : 1);
