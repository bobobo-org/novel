import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDraft, buildProjectBundle } from "../lib/novel-ai/domain/creation.ts";
import { optionalValue } from "../lib/novel-ai/domain/index.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/index.ts";
import {
  beginSocialWorldApproval,
  checkpointSocialWorldApproval,
  defaultProjectProceduralRootSeed,
  ensureProjectProceduralRootSeed,
  resolveProjectProceduralRootSeed,
  storyBibleApprovalChanged,
  storyBibleWithCharacterApproval,
  storyBibleWithTreasureApproval,
  storyBibleWithWorldApproval,
} from "../lib/novel-ai/social-world-approval.ts";

const results = [];
async function test(name, work) {
  try {
    const evidence = await work();
    results.push({ name, status: "PASS", evidence });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

function fixtureBundle(title = "不改變根種子的作品") {
  const draft = createDraft("quick");
  draft.title = title;
  draft.genreId = "classic-topic-001";
  const stageMatrix = buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode: "general",
  });
  draft.answers.stageFamily = optionalValue(
    serializeTopicWorldFamilyDraftSelection({
      matrix: stageMatrix,
      familyId: stageMatrix.stageFamilies[0].familyId,
    }),
    "user_defined",
  );
  return buildProjectBundle(draft);
}

await test("new projects persist an immutable id-derived procedural root", () => {
  const bundle = fixtureBundle();
  const expected = defaultProjectProceduralRootSeed(bundle.project.id);
  assert.equal(bundle.project.proceduralRootSeed, expected);
  assert.equal(resolveProjectProceduralRootSeed(bundle.project), expected);
  assert.equal(bundle.initialBackup.snapshot.project.proceduralRootSeed, expected);
  return { projectId: bundle.project.id, proceduralRootSeed: expected };
});

await test("legacy project first-use backfill is stable across rename and replay", async () => {
  const bundle = fixtureBundle("舊標題");
  const legacyProject = { ...bundle.project };
  delete legacyProject.proceduralRootSeed;
  const repository = new MemoryNovelRepository();
  await repository.put("projects", legacyProject);
  const expected = defaultProjectProceduralRootSeed(legacyProject.id);
  assert.equal(resolveProjectProceduralRootSeed(legacyProject), expected);

  assert.equal(await ensureProjectProceduralRootSeed(repository, legacyProject), expected);
  const backfilled = await repository.get("projects", legacyProject.id);
  assert.equal(backfilled.proceduralRootSeed, expected);
  const backfillRevision = backfilled.revision;

  assert.equal(await ensureProjectProceduralRootSeed(repository, backfilled), expected);
  assert.equal((await repository.get("projects", legacyProject.id)).revision, backfillRevision);

  const renamed = await repository.put("projects", {
    ...backfilled,
    title: "改名後仍是同一個世界",
  }, backfilled.revision);
  const renameRevision = renamed.revision;
  assert.equal(resolveProjectProceduralRootSeed(renamed), expected);
  assert.equal(await ensureProjectProceduralRootSeed(repository, renamed), expected);
  assert.equal((await repository.get("projects", legacyProject.id)).revision, renameRevision);
  return { expected, backfillRevision, renameRevision };
});

await test("approval operation journals resume and checkpoint without revision churn", async () => {
  const bundle = fixtureBundle();
  const repository = new MemoryNovelRepository();
  await repository.put("projects", bundle.project);
  const input = {
    projectId: bundle.project.id,
    approvalKind: "character",
    sourceId: "social-character:fixture:1",
    proceduralRootSeed: bundle.project.proceduralRootSeed,
  };
  const started = await beginSocialWorldApproval(repository, input);
  const replayed = await beginSocialWorldApproval(repository, input);
  assert.equal(replayed.operationId, started.operationId);
  assert.equal(replayed.revision, started.revision);
  assert.equal((await repository.list("operationJournal", bundle.project.id)).length, 1);

  const firstCheckpoint = await checkpointSocialWorldApproval(
    repository,
    started.operationId,
    "canonical-character",
    [input.sourceId],
  );
  const duplicateCheckpoint = await checkpointSocialWorldApproval(
    repository,
    started.operationId,
    "canonical-character",
    [input.sourceId],
  );
  assert.equal(duplicateCheckpoint.revision, firstCheckpoint.revision);

  const completed = await checkpointSocialWorldApproval(
    repository,
    started.operationId,
    "complete",
    [input.sourceId],
    true,
  );
  const completedReplay = await checkpointSocialWorldApproval(
    repository,
    started.operationId,
    "complete",
    [input.sourceId],
    true,
  );
  assert.equal(completed.status, "completed");
  assert.equal(completedReplay.revision, completed.revision);
  assert.deepEqual(completed.resultingRecordIds, [input.sourceId]);
  return {
    operationId: started.operationId,
    startRevision: started.revision,
    checkpointRevision: firstCheckpoint.revision,
    completedRevision: completed.revision,
  };
});

await test("Story Bible approvals are idempotent and a new world replaces old rules", () => {
  const bundle = fixtureBundle();
  const base = {
    ...bundle.storyBible,
    characterIds: ["character:existing"],
    relationshipIds: ["relationship:existing"],
    loreIds: ["treasure:existing"],
    worldId: "world:old",
    worldRuleIds: ["world-rule:old-a", "world-rule:old-b"],
  };
  const withCharacter = storyBibleWithCharacterApproval(base, {
    characterId: "character:new",
    relationshipIds: ["relationship:new"],
    loreIds: ["treasure:new"],
  });
  const replayedCharacter = storyBibleWithCharacterApproval(withCharacter, {
    characterId: "character:new",
    relationshipIds: ["relationship:new"],
    loreIds: ["treasure:new"],
  });
  assert.deepEqual(replayedCharacter.characterIds, ["character:existing", "character:new"]);
  assert.deepEqual(replayedCharacter.relationshipIds, ["relationship:existing", "relationship:new"]);
  assert.equal(storyBibleApprovalChanged(withCharacter, replayedCharacter), false);

  const withTreasure = storyBibleWithTreasureApproval(replayedCharacter, "treasure:new");
  assert.equal(storyBibleApprovalChanged(replayedCharacter, withTreasure), false);

  const withSecondWorld = storyBibleWithWorldApproval(
    withTreasure,
    "world:second",
    ["world-rule:second-a", "world-rule:second-b", "world-rule:second-a"],
  );
  assert.equal(withSecondWorld.worldId, "world:second");
  assert.deepEqual(withSecondWorld.worldRuleIds, ["world-rule:second-a", "world-rule:second-b"]);
  assert.equal(withSecondWorld.worldRuleIds.some((id) => id.includes("old")), false);
  return {
    characters: withSecondWorld.characterIds.length,
    relationships: withSecondWorld.relationshipIds.length,
    lore: withSecondWorld.loreIds.length,
    activeWorldRules: withSecondWorld.worldRuleIds,
  };
});

await test("social-world UI exposes truthful virtual capacity and recoverable approvals", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const [source, projectSource] = await Promise.all([
    readFile(new URL("../app/studio/project/[projectId]/social-world-library.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/project/[projectId]/project-section-client.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(source, /1,000\+/u);
  assert.match(source, /容量數字不是已儲存筆數/u);
  assert.match(source, /沒有整批寫入/u);
  assert.equal(
    source.includes("data-testid={`approve-treasure-${treasure.ordinal}`}"),
    true,
  );
  assert.match(source, /核准世界與五條規則/u);
  assert.match(source, /for \(const source of canonicalCharacters\)/u);
  assert.match(source, /canonicalFromCharacterId/u);
  assert.match(projectSource, /approvedLore=\{data\.lore\}/u);
  assert.match(projectSource, /approvalJournals=\{data\.approvalJournals\}/u);
  assert.match(
    projectSource,
    /repo\.list<SocialWorldApprovalJournal>\("operationJournal", projectId\)/u,
  );
  return {
    source: root,
    truthfulCapacityCopy: true,
    treasureApproval: true,
    relationshipBackfill: true,
    approvalJournalLoaded: true,
  };
});

for (const result of results) {
  console.log(`${result.status} ${result.name}`);
  if (result.status === "FAIL") console.error(result.error);
}

const failures = results.filter((result) => result.status === "FAIL");
if (failures.length > 0) process.exitCode = 1;
