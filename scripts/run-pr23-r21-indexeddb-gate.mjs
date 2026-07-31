import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  canPersistStudioShell,
  hydrateCanonicalWithNonDestructiveFallback,
  runDailyBackupAndMark,
} from "../lib/novel-ai/web/studio-canonical-runtime-gate.ts";

const selected = process.argv[2] ?? "all";
const results = [];

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function test(name, run) {
  if (selected !== "all" && selected !== name) return;
  await run();
  results.push(name);
}

await test("indexeddb-blocked-byte-preservation", async () => {
  const original = JSON.stringify({
    schemaVersion: 3,
    projects: [{
      id: "novel-a",
      draft: "不可遺失的正文",
      versions: [{ content: "前一版" }],
    }],
    gameStates: { "novel-a": { stats: { level: 9 } } },
    branches: [{ projectId: "novel-a", choice: "A" }],
    backups: [{ backupId: "backup-a" }],
  });
  const storage = new Map([["novel_p12_studio_state", original]]);
  const before = sha256(storage.get("novel_p12_studio_state"));
  const result = await hydrateCanonicalWithNonDestructiveFallback({
    originalStorageBytes: storage.get("novel_p12_studio_state"),
    legacyState: JSON.parse(original),
    fallbackSnapshot: "{}",
    hydrate: async () => {
      throw Object.assign(new Error("INDEXEDDB_BLOCKED"), {
        code: "INDEXEDDB_BLOCKED",
      });
    },
  });
  assert.equal(result.gate.canonicalHydrationSucceeded, false);
  assert.equal(result.gate.localCanonicalWritable, false);
  assert.equal(result.gate.legacySnapshotPreserved, true);
  assert.equal(result.recoverySnapshot, original);
  assert.equal(canPersistStudioShell(result.gate), false);
  const after = sha256(storage.get("novel_p12_studio_state"));
  assert.equal(after, before);
});

await test("indexeddb-blocked-ui-write-gate", async () => {
  const source = await readFile(
    new URL("../app/studio/studio-client.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /data-canonical-hydration-succeeded/);
  assert.match(source, /data-local-canonical-writable/);
  assert.match(source, /data-legacy-snapshot-preserved/);
  assert.match(source, /data-testid="studio-write-gate"/);
  assert.match(source, /disabled=\{!canonicalRuntimeGate\.localCanonicalWritable\}/);
  assert.match(source, /data-testid="backup-read-only-gate"/);
  assert.match(source, /download-migration-recovery-snapshot/);
  assert.match(source, /canPersistStudioShell\(canonicalRuntimeGate\)/);
  assert.doesNotMatch(
    source,
    /localStorage\.setItem\("novel_p21r1_interaction_migration_preview"/,
  );
});

await test("daily-backup-marker-after-success", async () => {
  let markerWrites = 0;
  await assert.rejects(
    runDailyBackupAndMark({
      createBackup: async () => {
        throw new Error("BACKUP_FAILED");
      },
      markCompleted: () => {
        markerWrites += 1;
      },
    }),
    /BACKUP_FAILED/,
  );
  assert.equal(markerWrites, 0);
  const record = await runDailyBackupAndMark({
    createBackup: async () => ({ backupId: "backup-ok" }),
    markCompleted: () => {
      markerWrites += 1;
    },
  });
  assert.deepEqual(record, { backupId: "backup-ok" });
  assert.equal(markerWrites, 1);
});

console.log(JSON.stringify({
  status: "PASS",
  selected,
  tests: results,
}, null, 2));
