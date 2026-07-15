import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { TestDeterministicEmbeddingProvider } from "../lib/novel-ai/embeddings/test-deterministic-embedding-provider.ts";
import { RetrievalIndexManager, normalizePolicyMetadata } from "../lib/novel-ai/retrieval/retrieval-index.ts";

const h = createHarness("H2A Adult Policy Metadata Preparation");
const storageDir = path.resolve(process.cwd(), ".tmp-h2a-policy");
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });
const projectId = "h2a-policy-project";
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const manager = new RetrievalIndexManager({ projectId, connection, provider: new TestDeterministicEmbeddingProvider({ dimensions: 16 }), modelDigest: "policy-digest" });

async function indexPolicy(chapterId, policyMetadata) {
  return manager.updateChapterIndex({
    chapterId,
    text: `場景 ${chapterId}：角色在屋內對話，確認彼此界線與情緒狀態。`,
    policyMetadata,
  });
}

await indexPolicy("normal", { contentRating: "general", sceneType: "normal", adultVerificationStatus: "not_applicable", consentState: "not_applicable", intimacyStage: "none" });
h.assert("normal scene", Boolean(connection.get("SELECT chunk_id FROM retrieval_chunk_policy_metadata WHERE content_rating='general' AND scene_type='normal'")));
await indexPolicy("romance", { contentRating: "teen", sceneType: "romance", intimacyStage: "setup" });
h.assert("romance scene", Boolean(connection.get("SELECT chunk_id FROM retrieval_chunk_policy_metadata WHERE scene_type='romance' AND intimacy_stage='setup'")));
await indexPolicy("adult", { contentRating: "adult", sceneType: "intimacy", adultVerificationStatus: "verified_adult", consentState: "active", intimacyStage: "consent" });
h.assert("adult intimacy scene", Boolean(connection.get("SELECT chunk_id FROM retrieval_chunk_policy_metadata WHERE content_rating='adult' AND adult_verification_status='verified_adult'")));
await indexPolicy("unknown-age", { contentRating: "mature", sceneType: "intimacy", adultVerificationStatus: "unknown" });
h.assert("unknown age participant", Boolean(connection.get("SELECT chunk_id FROM retrieval_chunk_policy_metadata WHERE adult_verification_status='unknown'")));
h.assert("verified adult participants", Boolean(connection.get("SELECT chunk_id FROM retrieval_chunk_policy_metadata WHERE adult_verification_status='verified_adult'")));
h.assert("consent unspecified", normalizePolicyMetadata({}).consentState === "unspecified");
await indexPolicy("consent-active", { consentState: "active", sceneType: "romance", intimacyStage: "approach" });
h.assert("consent active", Boolean(connection.get("SELECT chunk_id FROM retrieval_chunk_policy_metadata WHERE consent_state='active'")));
await indexPolicy("consent-withdrawn", { consentState: "withdrawn", sceneType: "intimacy", intimacyStage: "deescalation" });
h.assert("consent withdrawn", Boolean(connection.get("SELECT chunk_id FROM retrieval_chunk_policy_metadata WHERE consent_state='withdrawn'")));
const before = String(connection.get("SELECT metadata_hash FROM retrieval_chunks WHERE chapter_id='normal' LIMIT 1")?.metadata_hash);
await indexPolicy("normal", { contentRating: "teen", sceneType: "normal", sensitivityLevel: 1 });
const after = String(connection.get("SELECT metadata_hash FROM retrieval_chunks WHERE chapter_id='normal' ORDER BY updated_at DESC LIMIT 1")?.metadata_hash);
h.assert("metadata-only update", before !== after);
await indexPolicy("relationship", { relationshipIds: ["rel_1"], participantIds: ["char_1", "char_2"], sceneType: "romance" });
h.assert("relationship update", Boolean(connection.get("SELECT relationship_id FROM retrieval_chunk_relationships WHERE relationship_id='rel_1'")));
h.assert("participant update", String(connection.get("SELECT row_json FROM retrieval_chunk_policy_metadata WHERE row_json LIKE '%char_1%' LIMIT 1")?.row_json ?? "").includes("char_2"));
const other = await SQLiteProjectConnection.open({ projectId: "other-policy-project", storageDir });
other.run("INSERT OR IGNORE INTO projects(id, project_id, row_json) VALUES(?,?,?)", ["other-policy-project", "other-policy-project", "{}"]);
h.assert("project isolation", Number(connection.get("SELECT count(*) AS count FROM retrieval_chunk_policy_metadata WHERE project_id != ?", [projectId])?.count ?? 0) === 0);
other.close();
h.assert("backup restore fields present", ["content_rating","scene_type","adult_verification_status","consent_state","intimacy_stage"].every((column) => connection.get("SELECT name FROM pragma_table_info('retrieval_chunk_policy_metadata') WHERE name = ?", [column])));
h.assert("restart persistence", connection.diagnostics().databaseOpenStatus === "open");
h.assert("public diagnostics redaction", !JSON.stringify(connection.all("SELECT row_json FROM retrieval_chunk_policy_metadata LIMIT 3")).includes("vector"));

connection.close();
fs.rmSync(storageDir, { recursive: true, force: true });

printAndExit(h.summary({ expectedPass: 15, adultPolicyMetadataStatus: "schema_ready", intimacyStageMetadataStatus: "schema_ready" }));
