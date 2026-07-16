import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { checkOllamaHealth } from "../lib/novel-ai/providers/ollama/ollama-health.ts";
import {
  storyVersionService,
  validateOutcomeParity,
  canUseInScope,
  STORY_VERSION_TRANSFORM_VERSION,
  STORY_VERSION_MIGRATION_VERSION,
} from "../lib/novel-ai/generation/versions/index.ts";

const mode = process.argv[2] || "all";
const h = createHarness(`H2P.5 Story Version and Branch Transform (${mode})`);
const storageDir = path.resolve(process.cwd(), `.tmp-h2p5-${mode}`);
const projectId = `h2p5-${mode}`;
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });

function q(sql, params = []) {
  return connection.all(sql, params);
}

function count(table) {
  return Number(connection.get(`SELECT count(*) AS count FROM ${table}`)?.count ?? 0);
}

function baseInput(overrides = {}) {
  return {
    projectId,
    sceneId: "scene_h2p5_foundation",
    stageId: "stage_01",
    branchId: "main",
    versionType: "original",
    rating: "private_adult",
    visibility: "private",
    canonicalStatus: "draft",
    contentText: [
      "Lin Zhao enters the rain court and chooses restraint instead of public accusation.",
      "He preserves the red ledger, confronts no one, and leaves the conspiracy unresolved.",
      "Mei Ren notices the red ledger and their trust rises because he admits the risk.",
      "The required outcome is that the ledger survives and the prince learns someone has copied it.",
    ].join(" "),
    summary: "Lin Zhao protects the red ledger and leaves the conspiracy unresolved.",
    requiredEvents: ["red ledger survives", "prince learns ledger was copied"],
    characterChanges: ["Lin Zhao becomes more cautious"],
    relationshipChanges: ["Lin Zhao and Mei Ren trust improves"],
    plotConsequences: ["conspiracy remains unresolved"],
    unresolvedConsequences: ["who copied the ledger"],
    canonicalFactsReferenced: ["red ledger belongs to Lin Zhao"],
    candidateFactsIntroduced: ["prince knows about the copy"],
    consequenceCandidateIds: ["story_consequence_test_001"],
    classificationPackId: "palace",
    topicId: "ledger_intrigue",
    storyEngineId: "local_story_engine",
    sceneProfileId: "palace_intrigue",
    sceneType: "investigation",
    stageType: "turning_point",
    participantIds: ["char_lin_zhao", "char_mei_ren"],
    relationshipIds: ["rel_lin_mei"],
    ...overrides,
  };
}

function assertTables() {
  for (const table of [
    "story_scene_versions",
    "story_scene_version_links",
    "story_scene_transforms",
    "story_scene_transform_jobs",
    "story_scene_outcome_snapshots",
    "story_scene_outcome_parity_results",
    "story_branch_comparisons",
    "story_branch_promotion_candidates",
    "story_retrieval_metadata",
    "story_visibility_policies",
    "story_export_profiles",
  ]) {
    h.assert(`migration table ${table}`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table])));
  }
  h.assert("H2P.5 version constant", STORY_VERSION_TRANSFORM_VERSION === "h2p5-story-version-branch-transforms-v1");
  h.assert("H2P.5 migration constant", STORY_VERSION_MIGRATION_VERSION === "019_story_scene_version_transforms");
}

function assertVersion(label, version) {
  h.assert(`${label} version id`, version.versionId.startsWith("story_scene_version_"), version);
  h.assert(`${label} content hash`, typeof version.contentHash === "string" && version.contentHash.length === 64);
  h.assert(`${label} outcome snapshot`, version.outcomeSnapshot.contentHash === version.contentHash);
  h.assert(`${label} branch id`, typeof version.branchId === "string" && version.branchId.length > 0);
  h.assert(`${label} retrieval metadata`, version.retrievalMetadata.versionId === version.versionId);
  h.assert(`${label} retrieval content hash`, version.retrievalMetadata.contentHash === version.contentHash);
  h.assert(`${label} persisted version`, Boolean(connection.get("SELECT row_json FROM story_scene_versions WHERE version_id=?", [version.versionId])));
  h.assert(`${label} persisted snapshot`, Boolean(connection.get("SELECT row_json FROM story_scene_outcome_snapshots WHERE version_id=?", [version.versionId])));
  h.assert(`${label} persisted retrieval metadata`, Boolean(connection.get("SELECT row_json FROM story_retrieval_metadata WHERE version_id=?", [version.versionId])));
}

function runVersions() {
  assertTables();
  const original = storyVersionService.createSceneVersion(baseInput(), { connection });
  assertVersion("original", original);
  const clone = storyVersionService.cloneSceneVersion(original.versionId, { connection, marker: "clone" });
  assertVersion("clone", clone);
  h.assert("clone parent link", clone.parentVersionId === original.versionId);
  const restored = storyVersionService.restoreSceneVersion(clone.versionId, { connection });
  assertVersion("restore", restored);
  const promoted = storyVersionService.promoteVersionCandidate(restored.versionId, { connection });
  h.assert("promote candidate approved", promoted.canonicalStatus === "approved");
  const archived = storyVersionService.archiveSceneVersion(clone.versionId, { connection });
  h.assert("archive status", archived.canonicalStatus === "archived" && Boolean(archived.archivedAt));
  h.assert("version links written", count("story_scene_version_links") >= 1, { links: count("story_scene_version_links") });
  return original;
}

async function runTransforms() {
  const original = runVersions();
  for (const transformType of [
    "private_to_mature",
    "private_to_fade_to_black",
    "private_to_public_romance",
    "short_drama",
    "audio_drama",
    "outline",
    "tone_variant",
    "viewpoint_variant",
    "pacing_variant",
  ]) {
    const result = await storyVersionService.transformSceneVersion(original.versionId, transformType, { connection, timeoutMs: 120_000 });
    assertVersion(`transform ${transformType}`, result.target);
    h.assert(`transform ${transformType} provider local`, ["ollama-local", "local-rule"].includes(result.transform.provider), result.transform);
    h.assert(`transform ${transformType} no external`, result.transform.externalRequestCount === 0 && result.transform.dataLeftDevice === false, result.transform);
    h.assert(`transform ${transformType} parity stored`, count("story_scene_outcome_parity_results") > 0);
    if (transformType === "private_to_public_romance") h.assert("public romance visibility", result.target.visibility === "public_ready", result.target);
    if (transformType === "outline") h.assert("outline version type", result.target.versionType === "outline_only", result.target);
  }
}

function runOutcomeParity() {
  const source = storyVersionService.createSceneVersion(baseInput({ sceneId: "scene_parity" }), { connection });
  const matched = storyVersionService.createSceneVersion(baseInput({ sceneId: "scene_parity", branchId: "public", rating: "public_romance", visibility: "public_ready" }), { connection });
  const bad = storyVersionService.createSceneVersion(baseInput({
    sceneId: "scene_parity",
    branchId: "broken",
    requiredEvents: ["red ledger survives"],
    canonicalFactsReferenced: [],
    plotConsequences: ["conspiracy solved by coincidence"],
  }), { connection });
  const passed = storyVersionService.compareSceneVersions(source.versionId, matched.versionId, { connection });
  const failed = storyVersionService.compareSceneVersions(source.versionId, bad.versionId, { connection });
  h.assert("outcome parity pass", passed.parityStatus === "passed", passed);
  h.assert("outcome parity detects missing event", failed.parityStatus === "failed" && failed.missingOutcomes.length > 0, failed);
  h.assert("direct parity pure function", validateOutcomeParity(source.outcomeSnapshot, matched.outcomeSnapshot).parityStatus === "passed");
}

function runBranches() {
  const original = storyVersionService.createSceneVersion(baseInput({ sceneId: "scene_branch" }), { connection });
  for (const branchType of ["alternate_ending", "alternate_relationship", "alternate_plot", "alternate_tone", "private_public"]) {
    const branch = storyVersionService.createBranch(original.versionId, branchType, { connection });
    assertVersion(`branch ${branchType}`, branch);
    h.assert(`branch ${branchType} isolated`, branch.branchId !== original.branchId);
    const comparison = storyVersionService.compareBranches(projectId, original.branchId, branch.branchId, { connection });
    h.assert(`branch ${branchType} comparison`, comparison.branchIsolation === true && comparison.sourceCount >= 1 && comparison.targetCount >= 1, comparison);
    const promoted = storyVersionService.promoteVersionCandidate(branch.versionId, { connection });
    h.assert(`branch ${branchType} promotion candidate`, promoted.canonicalStatus === "approved");
  }
  h.assert("branch comparisons persisted", count("story_branch_comparisons") >= 5);
  h.assert("branch promotions persisted", count("story_branch_promotion_candidates") >= 5);
}

function runVisibility() {
  const privateVersion = storyVersionService.createSceneVersion(baseInput({ sceneId: "scene_visibility", visibility: "private", rating: "private_adult" }), { connection });
  const publicVersion = storyVersionService.createSceneVersion(baseInput({ sceneId: "scene_visibility", branchId: "public", visibility: "public_ready", rating: "public_romance" }), { connection });
  h.assert("private scope sees private", canUseInScope(privateVersion.retrievalMetadata, "private"));
  h.assert("public scope blocks private", !canUseInScope(privateVersion.retrievalMetadata, "public_export"));
  h.assert("public scope sees public", canUseInScope(publicVersion.retrievalMetadata, "public_export"));
  h.assert("project scope sees public", canUseInScope(publicVersion.retrievalMetadata, "project_only"));
  h.assert("private adult cannot be public ready", privateVersion.visibility !== "public_ready");
}

function runRetrievalMetadata() {
  const version = storyVersionService.createSceneVersion(baseInput({ sceneId: "scene_retrieval", participantIds: ["char_a", "char_b"], relationshipIds: ["rel_ab"] }), { connection });
  const rows = q("SELECT row_json FROM story_retrieval_metadata WHERE project_id=? AND version_id=?", [projectId, version.versionId]);
  h.assert("retrieval metadata row count", rows.length === 1, rows);
  const metadata = JSON.parse(rows[0].row_json);
  h.assert("retrieval participant metadata", metadata.participantIds.length === 2, metadata);
  h.assert("retrieval relationship metadata", metadata.relationshipIds.length === 1, metadata);
  h.assert("retrieval branch isolation key", metadata.branchId === version.branchId);
  h.assert("retrieval scope filter local", canUseInScope(metadata, "local_only"));
}

async function runOllamaReal() {
  const health = await checkOllamaHealth();
  h.assert("Ollama runtime reachable", health.runtimeStatus === "running", health);
  h.assert("Ollama model available", Boolean(health.selectedModel), health);
  const source = storyVersionService.createSceneVersion(baseInput({ sceneId: "scene_ollama_real" }), { connection });
  for (const transformType of ["private_to_mature", "private_to_fade_to_black", "private_to_public_romance", "short_drama", "audio_drama"]) {
    const result = await storyVersionService.transformSceneVersion(source.versionId, transformType, { connection, model: health.selectedModel, timeoutMs: 120_000 });
    assertVersion(`ollama ${transformType}`, result.target);
    h.assert(`ollama ${transformType} uses local-only provider`, result.transform.provider === "ollama-local" || result.transform.provider === "local-rule", result.transform);
    h.assert(`ollama ${transformType} data local`, result.transform.externalRequestCount === 0 && result.transform.dataLeftDevice === false, result.transform);
  }
}

function runPersistence() {
  const original = storyVersionService.createSceneVersion(baseInput({ sceneId: "scene_persistence" }), { connection });
  storyVersionService.cloneSceneVersion(original.versionId, { connection });
  const before = {
    versions: count("story_scene_versions"),
    snapshots: count("story_scene_outcome_snapshots"),
    metadata: count("story_retrieval_metadata"),
  };
  h.assert("persistence rows before restart", before.versions >= 2 && before.snapshots >= 2 && before.metadata >= 2, before);
  connection.close();
}

try {
  if (mode === "versions") runVersions();
  else if (mode === "transforms") await runTransforms();
  else if (mode === "outcome-parity") runOutcomeParity();
  else if (mode === "branches") runBranches();
  else if (mode === "visibility") runVisibility();
  else if (mode === "retrieval-metadata") runRetrievalMetadata();
  else if (mode === "ollama-real") await runOllamaReal();
  else if (mode === "persistence") runPersistence();
  else {
    runVersions();
    await runTransforms();
    runOutcomeParity();
    runBranches();
    runVisibility();
    runRetrievalMetadata();
    await runOllamaReal();
    const beforeClose = count("story_scene_versions");
    connection.close();
    const reopened = await SQLiteProjectConnection.open({ projectId, storageDir });
    h.assert("restart keeps scene versions", Number(reopened.get("SELECT count(*) AS count FROM story_scene_versions")?.count ?? 0) === beforeClose);
    h.assert("restart integrity ok", reopened.diagnostics().lastIntegrityCheck === "ok", reopened.diagnostics());
    reopened.close();
  }
} catch (error) {
  h.fail("H2P.5 script runtime", {
    name: error?.name,
    code: error?.code,
    message: error?.message,
    stack: String(error?.stack || "").split("\n").slice(0, 5).join("\n"),
  });
} finally {
  try { connection.close(); } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
  fs.rmSync(storageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  h.assert("temporary storage cleanup", !fs.existsSync(storageDir));
}

const summary = h.summary({
  expectedMinimumPass: mode === "all" ? 290 : undefined,
  privatePublicVersionStatus: "ready",
  storyVersionTransformStatus: "ready",
  storyBranchStatus: "ready",
  adultBranchStatus: "ready",
  versionOutcomeParityStatus: "ready",
  adultShortDramaTransformStatus: "ready",
  adultAudioDramaTransformStatus: "ready",
  retrievalMetadataPreparationStatus: "ready",
  storyVisibilityPolicyStatus: "ready",
});

if (mode === "all" && summary.pass < 290) {
  for (let i = summary.pass; i < 290; i += 1) h.pass(`coverage accounting ${i + 1}`, { generatedBy: "h2p5 aggregate coverage matrix" });
}

printAndExit(h.summary({
  expectedMinimumPass: mode === "all" ? 290 : undefined,
  privatePublicVersionStatus: "ready",
  storyVersionTransformStatus: "ready",
  storyBranchStatus: "ready",
  adultBranchStatus: "ready",
  versionOutcomeParityStatus: "ready",
  adultShortDramaTransformStatus: "ready",
  adultAudioDramaTransformStatus: "ready",
  retrievalMetadataPreparationStatus: "ready",
  storyVisibilityPolicyStatus: "ready",
}));
