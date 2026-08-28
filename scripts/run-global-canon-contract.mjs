import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  runGlobalCanonCopyBoundaryContract,
  runGlobalStoryBibleCopyContract,
  runIndexedDbBlockedLateSuccessContract,
  runIndexedDbGlobalCanonReloadContract,
  runMemoryGlobalCanonContract,
  runProjectCanonImportContract,
} from "../lib/novel-ai/global-canon/contract-tests.ts";

await runMemoryGlobalCanonContract();
await runGlobalCanonCopyBoundaryContract();
await runGlobalStoryBibleCopyContract();
await runProjectCanonImportContract();
await runIndexedDbBlockedLateSuccessContract();
await runIndexedDbGlobalCanonReloadContract();

const storyStageSource = await readFile(
  new URL("../app/studio/project/[projectId]/story-stage-selector.tsx", import.meta.url),
  "utf8",
);
assert.match(storyStageSource, /crossEraAuthorization:\s*crossEraCanon/gu, "story-stage era checks must receive formal cross-era authorization");
assert.match(storyStageSource, /data-era-compatible=\{!incompatible\}/u, "story-stage cards expose the enforced compatibility result");

const globalEditorSource = await readFile(
  new URL("../app/canon/canon-client.tsx", import.meta.url),
  "utf8",
);
assert.match(globalEditorSource, /importProjectCanonToGlobal/u, "global editor must expose explicit project Canon import");
assert.match(globalEditorSource, /來源作品沒有被修改，也沒有自動上場/u, "global import UI must preserve the non-mutation boundary");
assert.match(globalEditorSource, /data-testid="global-canon-story-bibles"/u, "Story Bible must be editable from the global editor");
assert.match(globalEditorSource, /copyGlobalStoryBibleToProject/u, "global Story Bible bundles can be copied into a project as candidates");
assert.match(globalEditorSource, /projectImportRef:\s*current\.projectImportRef/u, "editing an imported global record must retain its project import reference");
assert.match(storyStageSource, /data-testid="story-stage-bible-candidate"/u, "story workspace exposes read-only Story Bible candidate selection");
assert.match(storyStageSource, /storyBibleId:\s*storyBible\.id/u, "Story Bible selection updates only the project's active candidate pointer");

console.log(JSON.stringify({
  suite: "global-canon-contract",
  status: "PASS",
  assertions: [
    "revision-safe-crud",
    "atomic-memory-and-indexeddb-batches",
    "whole-import-preflight-conflict",
    "blocked-indexeddb-late-success-close",
    "independent-indexeddb-reload",
    "explicit-project-copy",
    "complete-story-bible-candidate-copy",
    "revisioned-story-bible-copy-creates-immutable-snapshot",
    "revisioned-dependency-copy-isolation",
    "relationship-endpoint-snapshot-consistency",
    "same-revision-story-bible-copy-idempotence",
    "story-bible-copy-preflights-all-references",
    "story-bible-selection-only-updates-project-pointer",
    "idempotent-project-canon-import",
    "project-import-never-mutates-or-auto-stages",
    "project-import-source-provenance",
    "imported-record-edit-retains-source-reference",
    "story-stage-explicit-era-authorization",
    "global-editor-explicit-project-import",
    "global-editor-story-bible",
    "never-auto-stages-story",
  ],
}, null, 2));
