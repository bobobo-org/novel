import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { TestDeterministicEmbeddingProvider } from "../lib/novel-ai/embeddings/test-deterministic-embedding-provider.ts";
import { RetrievalIndexManager } from "../lib/novel-ai/retrieval/retrieval-index.ts";

const h = createHarness("H2A SQLite Retrieval Index");
const storageDir = path.resolve(process.cwd(), ".tmp-h2a-retrieval");
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });
const projectId = "h2a-index-project";
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const provider = new TestDeterministicEmbeddingProvider({ dimensions: 16 });
const manager = new RetrievalIndexManager({ projectId, connection, provider, modelDigest: "test-digest", batchSize: 4 });

const chapters = [
  { chapterId: "c1", text: "第一章。\n\n沈清禾暗中調查帳冊來源。\n\n---\n對手提前換了交易地點。", entityIds: ["char_1"], eventIds: ["event_1"], sourceIds: ["source_1"] },
  { chapterId: "c2", text: "第二章。\n\n赤霄劍的劍穗被調換，盟友保持沉默。", entityIds: ["char_1", "char_2"], eventIds: ["event_2"], sourceIds: ["source_2"] },
];

const initial = await manager.initialIndexProject(chapters);
h.assert("initial index active", initial.status === "active" && initial.totalChunks > 0);
h.assert("generation row", Boolean(connection.get("SELECT id FROM retrieval_index_generations WHERE id = ?", [initial.generationId])));
h.assert("chunk rows", Number(connection.get("SELECT count(*) AS count FROM retrieval_chunks WHERE project_id = ?", [projectId])?.count ?? 0) === initial.totalChunks);
h.assert("embedding rows", Number(connection.get("SELECT count(*) AS count FROM retrieval_embeddings WHERE project_id = ?", [projectId])?.count ?? 0) === initial.embeddedChunks);
h.assert("entity links", Number(connection.get("SELECT count(*) AS count FROM retrieval_chunk_entities WHERE project_id = ?", [projectId])?.count ?? 0) > 0);
h.assert("event links", Number(connection.get("SELECT count(*) AS count FROM retrieval_chunk_events WHERE project_id = ?", [projectId])?.count ?? 0) > 0);
h.assert("source links", Number(connection.get("SELECT count(*) AS count FROM retrieval_chunk_sources WHERE project_id = ?", [projectId])?.count ?? 0) > 0);
h.assert("policy metadata rows", Number(connection.get("SELECT count(*) AS count FROM retrieval_chunk_policy_metadata WHERE project_id = ?", [projectId])?.count ?? 0) === initial.totalChunks);

const verify1 = manager.verifyIndexGeneration(initial.generationId);
h.assert("verify generation", verify1.ok && verify1.activeChunkCount === verify1.embeddingCount, verify1);
h.assert("active generation unique", Number(connection.get("SELECT count(*) AS count FROM retrieval_index_generations WHERE project_id = ? AND active = 1", [projectId])?.count ?? 0) === 1);

const repeat = await manager.reindexProject(chapters);
h.assert("unchanged reuse 100", repeat.reuseRate === 1, repeat);
h.assert("previous generation stale", Number(connection.get("SELECT count(*) AS count FROM retrieval_index_generations WHERE project_id = ? AND status = 'stale'", [projectId])?.count ?? 0) >= 1);

const edited = await manager.updateChapterIndex({ chapterId: "c1", text: chapters[0].text.replace("帳冊", "密信"), entityIds: ["char_1"], eventIds: ["event_3"], sourceIds: ["source_3"] });
h.assert("paragraph edit changes chunks", edited.reuseRate < 1, edited);

const metadataOnly = await manager.updateChapterIndex({ chapterId: "c1", text: chapters[0].text.replace("帳冊", "密信"), entityIds: ["char_1"], eventIds: ["event_3"], sourceIds: ["source_3"], policyMetadata: { contentRating: "teen", sceneType: "romance" } });
h.assert("metadata-only update reuses content", metadataOnly.reuseRate === 1, metadataOnly);

const canonical = await manager.updateCanonicalIndex({ entityId: "char_1", entityType: "canonical_entity", text: "沈清禾：侯府主母，擅長隱忍布局。" });
h.assert("canonical index", canonical.status === "active" && canonical.totalChunks === 1);

const deleted = manager.deleteChapterIndex("c1");
h.assert("delete chapter tombstones", deleted.deletedChunks > 0, deleted);
const restored = manager.restoreChapterIndex("c1");
h.assert("restore chapter", restored.restoredChunks > 0, restored);

connection.run("INSERT INTO retrieval_index_jobs(id, project_id, status, total, row_json) VALUES(?,?,?,?,?)", ["job-cancel", projectId, "running", 1, "{}"]);
h.assert("cancel job", manager.cancelIndexJob("job-cancel") === true);
h.assert("resume job", manager.resumeIndexJob("job-cancel") === true);

const verifyActive = manager.verifyIndexGeneration();
h.assert("verify active index", verifyActive.ok, verifyActive);
h.assert("no orphan embeddings", verifyActive.noOrphanEmbedding === true);
h.assert("dimensions persisted", Number(connection.get("SELECT dimensions FROM retrieval_embeddings LIMIT 1")?.dimensions ?? 0) === 16);
h.assert("vector checksum persisted", String(connection.get("SELECT vector_checksum FROM retrieval_embeddings LIMIT 1")?.vector_checksum ?? "").length === 64);
h.assert("model digest persisted", String(connection.get("SELECT model_digest FROM retrieval_embeddings LIMIT 1")?.model_digest) === "test-digest");
h.assert("chunking version persisted", String(connection.get("SELECT chunking_version FROM retrieval_chunks LIMIT 1")?.chunking_version) === "novel-chunking-v1");
h.assert("metadata hash persisted", String(connection.get("SELECT metadata_hash FROM retrieval_chunks LIMIT 1")?.metadata_hash ?? "").length === 64);
h.assert("embedding input hash persisted", String(connection.get("SELECT embedding_input_hash FROM retrieval_chunks LIMIT 1")?.embedding_input_hash ?? "").length === 64);
h.assert("project isolation", Number(connection.get("SELECT count(*) AS count FROM retrieval_chunks WHERE project_id != ?", [projectId])?.count ?? 0) === 0);
h.assert("job completed", Number(connection.get("SELECT count(*) AS count FROM retrieval_index_jobs WHERE project_id = ? AND status = 'completed'", [projectId])?.count ?? 0) > 0);
h.assert("failed generation not active", Number(connection.get("SELECT count(*) AS count FROM retrieval_index_generations WHERE project_id = ? AND status = 'failed' AND active = 1", [projectId])?.count ?? 0) === 0);
h.assert("backup tables present", ["retrieval_chunks","retrieval_embeddings","retrieval_index_generations","retrieval_chunk_policy_metadata"].every((table) => connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table])));
h.assert("schema migration 13", Boolean(connection.get("SELECT version FROM schema_migrations WHERE version = 13")));
h.assert("active chunks not deleted", Number(connection.get("SELECT count(*) AS count FROM retrieval_chunks WHERE project_id = ? AND status = 'deleted' AND generation_id = ?", [projectId, canonical.generationId])?.count ?? 0) === 0);
h.assert("cleanup query stable", Number(connection.get("SELECT count(*) AS count FROM retrieval_chunks WHERE project_id = ?", [projectId])?.count ?? 0) > 0);

connection.close();
fs.rmSync(storageDir, { recursive: true, force: true });
h.assert("cleanup", !fs.existsSync(storageDir));

printAndExit(h.summary({ expectedPass: 35, incrementalIndexStatus: "ready", sqliteEmbeddingStorageStatus: "ready" }));
