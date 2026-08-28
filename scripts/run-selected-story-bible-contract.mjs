import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProjectBundle, createDraft } from "../lib/novel-ai/domain/creation.ts";
import { makeRecord, optionalValue } from "../lib/novel-ai/domain/index.ts";
import { resolveProjectStoryBible } from "../lib/novel-ai/domain/story-bible-selection.ts";
import {
  buildTopicWorldFamilyStageMatrix,
  serializeTopicWorldFamilyDraftSelection,
} from "../lib/novel-ai/game/topic-world-family-stage-matrix.ts";
import { IndexedDbNovelRepository } from "../lib/novel-ai/repository/indexeddb/indexeddb-repository.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import { ensureStudioCanonicalProject } from "../lib/novel-ai/repository/studio-canonical.ts";
import { listLocalStoryBibleReviewState } from "../lib/novel-ai/repository/story-bible-approval.ts";

const results = [];
async function test(name, work) {
  try {
    await work();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

const effect = {
  statChanges: {},
  relationshipChanges: {},
  resourceChanges: {},
  moneyChange: 0,
  worldFlags: {},
  questProgress: {},
  achievementProgress: {},
  timelineEvents: [],
};

function selectRequiredStoryStage(draft) {
  const matrix = buildTopicWorldFamilyStageMatrix({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode: "general",
  });
  const family = matrix.stageFamilies[0];
  const protagonist = family.members[0];
  draft.answers.stageFamily = optionalValue(serializeTopicWorldFamilyDraftSelection({
    matrix,
    familyId: family.familyId,
    selectedProtagonistId: protagonist.characterId,
  }), "user_defined");
  draft.protagonist = optionalValue(protagonist.name, "user_defined");
}

async function selectedFixture(repository, label) {
  const draft = createDraft("quick");
  draft.title = `Selected Story Bible ${label} ${crypto.randomUUID()}`;
  draft.genrePackId = "pack-11";
  draft.genreId = "classic-topic-001";
  draft.coreIdea = optionalValue("The selected canon must win.", "user_defined");
  selectRequiredStoryStage(draft);
  const bundle = buildProjectBundle(draft);
  await repository.createProject(bundle, `selected-bible:${bundle.project.id}`);

  const selectedStoryBible = await repository.put("storyBibles", {
    ...structuredClone(bundle.storyBible),
    id: `selected-bible:${bundle.project.id}`,
    revision: bundle.storyBible.revision + 4,
    parentRevision: null,
    theme: optionalValue("Selected canon", "user_defined"),
  });
  const projectWithSelection = await repository.put("projects", {
    ...bundle.project,
    storyBibleId: selectedStoryBible.id,
  }, bundle.project.revision);
  const canonical = await ensureStudioCanonicalProject(repository, {
    id: projectWithSelection.id,
    title: projectWithSelection.title,
    chapterTitle: "第一章",
    draft: "Opening.",
  });
  const base = makeRecord(canonical.project.id, "ai_candidate");
  const candidate = await repository.put("candidates", {
    ...base,
    provenance: {
      ...base.provenance,
      providerId: "deterministic-test",
      modelId: "rules-v1",
      taskType: "interactive_choice",
      externalRequest: false,
      dataLeftDevice: false,
      contextSources: [],
      elapsedMs: 0,
    },
    prompt: "",
    optionKey: "A",
    text: "Open",
    consequence: "",
    effect,
    status: "pending",
    chapterId: canonical.chapter.id,
    sceneId: null,
    inputRevision: canonical.project.revision,
    chapterRevision: canonical.chapter.revision,
    storyStateRevision: canonical.storyState.revision,
    storyBibleRevision: selectedStoryBible.revision,
  });
  const input = {
    operationId: `accept:${candidate.id}`,
    idempotencyKey: `${canonical.project.id}:${candidate.id}:${canonical.project.revision}`,
    projectId: canonical.project.id,
    chapterId: canonical.chapter.id,
    candidateId: candidate.id,
    acceptedText: "Open.",
    choiceLabel: "Open",
    expectedProjectRevision: canonical.project.revision,
    expectedChapterRevision: canonical.chapter.revision,
    expectedCandidateRevision: candidate.revision,
    expectedStoryStateRevision: canonical.storyState.revision,
    expectedStoryBibleRevision: selectedStoryBible.revision,
    origin: "studio",
  };
  return { canonical, selectedStoryBible, candidate, input };
}

for (const [label, createRepository] of [
  ["memory", () => new MemoryNovelRepository()],
  ["indexeddb", () => new IndexedDbNovelRepository()],
]) {
  await test(`${label} uses project.storyBibleId for commit and replay`, async () => {
    const repository = createRepository();
    const fixture = await selectedFixture(repository, label);
    assert.equal(fixture.canonical.storyBible.id, fixture.selectedStoryBible.id);
    const review = await listLocalStoryBibleReviewState(repository, fixture.canonical.project.id);
    assert.equal(review.storyBible.id, fixture.selectedStoryBible.id);
    const committed = await repository.acceptChoiceTransaction(fixture.input);
    assert.equal(committed.storyBible.id, fixture.selectedStoryBible.id);
    const replayed = await repository.acceptChoiceTransaction(fixture.input);
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.storyBible.id, fixture.selectedStoryBible.id);
  });
}

await test("legacy fallback is allowed only when one Story Bible is unambiguous", async () => {
  const repository = new MemoryNovelRepository();
  const draft = createDraft("quick");
  draft.title = `Legacy singleton ${crypto.randomUUID()}`;
  draft.genrePackId = "pack-11";
  draft.genreId = "classic-topic-001";
  selectRequiredStoryStage(draft);
  const bundle = buildProjectBundle(draft);
  await repository.createProject(bundle, `legacy-singleton:${bundle.project.id}`);
  await repository.put("projects", { ...bundle.project, storyBibleId: "legacy-missing-pointer" }, bundle.project.revision);
  const singleton = await listLocalStoryBibleReviewState(repository, bundle.project.id);
  assert.equal(singleton.storyBible.id, bundle.storyBible.id);

  await repository.put("storyBibles", {
    ...structuredClone(bundle.storyBible),
    id: `ambiguous-bible:${bundle.project.id}`,
  });
  await assert.rejects(
    () => listLocalStoryBibleReviewState(repository, bundle.project.id),
    /找不到這部作品的正式 Story Bible/,
  );
});

await test("resolver rejects ambiguous, deleted, cross-project, and invalid records", async () => {
  const draft = createDraft("quick");
  draft.title = `Resolver validation ${crypto.randomUUID()}`;
  draft.genrePackId = "pack-11";
  draft.genreId = "classic-topic-001";
  selectRequiredStoryStage(draft);
  const bundle = buildProjectBundle(draft);
  const staleProject = { ...bundle.project, storyBibleId: "missing-pointer" };
  const second = { ...structuredClone(bundle.storyBible), id: `second:${bundle.project.id}` };
  assert.equal(resolveProjectStoryBible(staleProject, [bundle.storyBible, second]), null);
  assert.equal(resolveProjectStoryBible(bundle.project, [{ ...bundle.storyBible, deletedAt: new Date().toISOString() }]), null);

  const invalidRows = [
    { ...structuredClone(bundle.storyBible), id: "deleted", deletedAt: new Date().toISOString() },
    { ...structuredClone(bundle.storyBible), id: "wrong-project", projectId: "another-project" },
    { ...structuredClone(bundle.storyBible), id: "bad-revision", revision: 0 },
    { ...structuredClone(bundle.storyBible), id: "bad-schema", schemaVersion: "legacy-schema" },
  ];
  assert.equal(
    resolveProjectStoryBible(staleProject, [bundle.storyBible, ...invalidRows])?.id,
    bundle.storyBible.id,
  );
});

async function sourceFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(absolute));
    else if (/\.(?:ts|tsx)$/u.test(entry.name)) files.push(absolute);
  }
  return files;
}

await test("all app/lib production consumers contain no arbitrary Story Bible fallback", async () => {
  const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
  const files = [
    ...await sourceFiles(path.join(repositoryRoot, "app")),
    ...await sourceFiles(path.join(repositoryRoot, "lib")),
  ];
  const resolverFile = path.normalize(path.join(repositoryRoot, "lib/novel-ai/domain/story-bible-selection.ts"));
  for (const file of files) {
    if (path.normalize(file) === resolverFile) continue;
    const source = await readFile(file, "utf8");
    const label = path.relative(repositoryRoot, file);
    assert.doesNotMatch(
      source,
      /\b(?:storyBibles|bibles|loadedStoryBibles|sourceStoryBibles)\s*\[\s*0\s*\]/u,
      `${label} must not use the first Story Bible`,
    );
    assert.doesNotMatch(
      source,
      /\b(?:storyBibles|bibles|loadedStoryBibles|sourceStoryBibles)\.at\(0\)/u,
      `${label} must not use an arbitrary Story Bible`,
    );
    assert.doesNotMatch(
      source,
      /\.find\([^\n]*\.id\s*===\s*(?:project|source|loadedProject|currentProject)\.storyBibleId[^\n]*\)/u,
      `${label} must use the centralized Story Bible resolver`,
    );
  }
  const indexedDbSource = await readFile(
    path.join(repositoryRoot, "lib/novel-ai/repository/indexeddb/indexeddb-repository.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    indexedDbSource,
    /objectStore\("storyBibles"\)\.index\("projectId"\)\.get\(input\.projectId\)/u,
    "IndexedDB must load all project Story Bibles before resolving the selected id",
  );
});

console.log(JSON.stringify({
  suite: "selected-story-bible-contract",
  pass: results.filter((row) => row.status === "PASS").length,
  fail: results.filter((row) => row.status === "FAIL").length,
  results,
}, null, 2));
if (results.some((row) => row.status === "FAIL")) process.exitCode = 1;
