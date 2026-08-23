import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import {
  DeterministicSocialMatrix,
  approveSocialCharacterCandidate,
  createSocialCharacterCandidate,
  isApprovedSocialCharacter,
} from "../lib/novel-ai/social-matrix/index.ts";
import {
  PROCEDURAL_CHARACTER_CAPACITY,
  PROCEDURAL_ORIGIN_POLICY,
  PROCEDURAL_STORY_LIBRARY_VERSION,
  PROCEDURAL_TREASURE_CAPACITY,
  proceduralCharacterAt,
  proceduralTreasureAt,
} from "../lib/novel-ai/game/procedural-story-library.ts";
import {
  PROCEDURAL_TREASURE_OWNERSHIP_VERSION,
  treasureHolderPopulationIndex,
} from "../lib/novel-ai/game/procedural-treasure-ownership.ts";
import {
  PROCEDURAL_TREASURE_CLASSIFICATION_VERSION,
  proceduralTreasureClassificationAt,
} from "../lib/novel-ai/game/procedural-treasure-classification.ts";

const results = [];
async function test(name, work) {
  try {
    const evidence = await work();
    results.push({ name, status: "PASS", evidence });
  } catch (error) {
    results.push({ name, status: "FAIL", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  }
}

await test("100k population is virtual, paged, and cache-bounded", () => {
  const matrix = new DeterministicSocialMatrix({ seed: "project-social-alpha", cacheLimit: 32 });
  assert.deepEqual(matrix.indexMetadata(), {
    sourceLibraryVersion: PROCEDURAL_STORY_LIBRARY_VERSION,
    sourceCharacterCapacity: PROCEDURAL_CHARACTER_CAPACITY,
    sourceTreasureCapacity: PROCEDURAL_TREASURE_CAPACITY,
    sourceOwnershipVersion: PROCEDURAL_TREASURE_OWNERSHIP_VERSION,
    sourceClassificationVersion: PROCEDURAL_TREASURE_CLASSIFICATION_VERSION,
    originPolicy: PROCEDURAL_ORIGIN_POLICY,
    populationSize: 100_000,
    institutionCount: 256,
    familyCount: 4096,
    indexStrategy: "deterministic-invertible-virtual-index",
    eagerlyMaterializedCharacters: 0,
    maximumPageSize: 100,
    cacheLimit: 32,
  });
  const first = matrix.listCharacters({ limit: 37 });
  const second = matrix.listCharacters({ cursor: first.nextCursor, limit: 37 });
  assert.equal(first.items.length, 37);
  assert.equal(second.items.length, 37);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.characterId)).size, 74);
  for (let index = 0; index < 500; index += 1) matrix.getCharacter(index);
  assert.ok(matrix.cacheStats().materializedCharacters <= 32);
  assert.ok(matrix.cacheStats().evictions > 0);
  assert.equal(matrix.getCharacter(99_999).populationIndex, 99_999);
  const performanceMatrix = new DeterministicSocialMatrix({ seed: "social-matrix-performance", cacheLimit: 32 });
  const startedAt = performance.now();
  for (let index = 0; index < 1_000; index += 1) performanceMatrix.getCharacter(index);
  const thousandMaterializationsMs = performance.now() - startedAt;
  assert.ok(thousandMaterializationsMs < 3_000, `1,000 on-demand characters took ${thousandMaterializationsMs.toFixed(2)}ms`);
  return {
    ...matrix.indexMetadata(),
    cache: matrix.cacheStats(),
    thousandMaterializationsMs: Number(thousandMaterializationsMs.toFixed(2)),
  };
});

await test("seed replay is deterministic while different seeds diverge", () => {
  const first = new DeterministicSocialMatrix({ seed: "same-seed", cacheLimit: 0 });
  const replay = new DeterministicSocialMatrix({ seed: "same-seed", cacheLimit: 0 });
  const other = new DeterministicSocialMatrix({ seed: "other-seed", cacheLimit: 0 });
  for (const index of [0, 7, 7821, 99_999]) {
    const character = first.getCharacter(index);
    assert.deepEqual(character, replay.getCharacter(index));
    assert.notDeepEqual(first.getCharacter(index), other.getCharacter(index));
    const storyCharacter = proceduralCharacterAt({ seed: first.seed, ordinal: index });
    assert.equal(character.characterId, storyCharacter.id);
    assert.equal(character.storyProfileId, storyCharacter.storyProfileId);
    assert.equal(character.portrait.storyLibraryVisualSeed, storyCharacter.portrait.visualSeed);
    assert.deepEqual(first.getCharacterById(character.characterId), character);
  }
  return { replayed: 4, existingCharacterLibraryReused: true, otherSeedChanged: true };
});

await test("virtual faction and family indexes return only matching members", () => {
  const matrix = new DeterministicSocialMatrix({ seed: "index-proof", cacheLimit: 64 });
  const institution = matrix.getInstitution(17);
  const institutionPage = matrix.listInstitutionMembers(17, { limit: 40 });
  assert.equal(institutionPage.total, institution.memberCount);
  assert.ok(institutionPage.items.every((character) => character.institutionId === institution.institutionId));
  const family = matrix.getFamily(91);
  const familyPage = matrix.listFamilyMembers(91, { limit: 40 });
  assert.equal(familyPage.total, family.memberCount);
  assert.ok(familyPage.items.every((character) => character.familyId === family.familyId));
  assert.ok(institution.allyInstitutionIds.every((id) => id !== institution.institutionId));
  assert.ok(institution.rivalInstitutionIds.every((id) => id !== institution.institutionId));
  return { institutionMembers: institutionPage.total, familyMembers: familyPage.total };
});

await test("undirected social edges are exact reciprocal pairs with a verifiable API", () => {
  const matrix = new DeterministicSocialMatrix({
    seed: "reciprocal-social-proof",
    populationSize: 2_003,
    institutionCount: 37,
    familyCount: 211,
    cacheLimit: 64,
  });
  let undirectedEdges = 0;
  let directedEdges = 0;
  for (let populationIndex = 0; populationIndex < 250; populationIndex += 1) {
    const character = matrix.getCharacter(populationIndex);
    const reciprocalPairs = matrix.verifyCharacterRelationshipReciprocity(
      populationIndex,
    );
    assert.equal(
      reciprocalPairs.length,
      character.relationships.filter((relationship) => !relationship.directed).length,
    );
    for (const pair of reciprocalPairs) {
      assert.equal(pair.reciprocity, "EXACT_RECIPROCAL");
      assert.ok(pair.forward);
      assert.ok(pair.reverse);
      assert.deepEqual(pair.effectiveForward, pair.forward);
      assert.deepEqual(pair.effectiveReverse, pair.reverse);
      assert.equal(pair.forward.relationshipId, pair.reverse.relationshipId);
      assert.equal(pair.forward.kind, pair.reverse.kind);
      assert.equal(pair.forward.trust, pair.reverse.trust);
      assert.equal(pair.forward.tension, pair.reverse.tension);
      assert.equal(pair.forward.obligation, pair.reverse.obligation);
      assert.equal(pair.forward.historyHook, pair.reverse.historyHook);
      undirectedEdges += 1;
    }
    const directed = character.relationships.find(
      (relationship) => relationship.directed,
    );
    if (directed) {
      const target = matrix.getCharacterById(directed.targetCharacterId);
      assert.ok(target);
      const pair = matrix.getRelationshipPair(
        populationIndex,
        target.populationIndex,
      );
      assert.equal(pair.forward.relationshipId, directed.relationshipId);
      assert.equal(pair.reciprocity, "DIRECTED_NOT_REQUIRED");
      directedEdges += 1;
    }
  }
  assert.ok(undirectedEdges >= 250);
  assert.ok(directedEdges >= 200);
  return {
    sampledCharacters: 250,
    exactReciprocalEdges: undirectedEdges,
    directedEdges,
    synthesizedMirrorContract: true,
  };
});

await test("treasure ownership is reciprocal, indexed, and independently paged", () => {
  const matrix = new DeterministicSocialMatrix({
    seed: "ownership-proof",
    populationSize: 17,
    institutionCount: 5,
    familyCount: 7,
    cacheLimit: 4,
  });
  const character = matrix.getCharacter(6);
  const first = matrix.listCharacterPossessions(6, { limit: 73 });
  const second = matrix.listCharacterPossessions(6, { cursor: first.nextCursor, limit: 73 });
  assert.equal(character.ownedTreasureCount, first.total);
  assert.equal(character.possessions.length, 4);
  assert.equal(first.items.length, 73);
  assert.equal(second.items.length, 73);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.treasureOrdinal)).size, 146);
  for (const item of [...first.items, ...second.items]) {
    assert.equal(treasureHolderPopulationIndex({
      storySeed: matrix.seed,
      treasureOrdinal: item.treasureOrdinal,
      populationSize: matrix.populationSize,
    }), character.populationIndex);
  }
  return {
    holder: character.characterId,
    heldTreasureTotal: first.total,
    firstTwoPages: first.items.length + second.items.length,
    lookupComplexity: "O(pageSize)",
  };
});

await test("characters include rich social, ability, possession, and original portrait data", () => {
  const matrix = new DeterministicSocialMatrix({ seed: "rich-characters", cacheLimit: 16 });
  const characters = matrix.listCharacters({ cursor: "characters:120", limit: 60 }).items;
  assert.ok(characters.every((character) => character.fictional && character.canonicalStatus === "VIRTUAL_CANDIDATE"));
  assert.ok(characters.every((character) => character.originPolicy === PROCEDURAL_ORIGIN_POLICY));
  assert.ok(characters.every((character) => character.relationships.length >= 6));
  assert.ok(characters.every((character) => character.relationships.length <= 10));
  assert.ok(characters.every((character) => character.relationships.every((edge) => edge.targetCharacterId !== character.characterId)));
  assert.ok(characters.every((character) => Object.values(character.abilities).length >= 10 && character.personality.traits.length === 3));
  assert.ok(characters.some((character) => character.possessions.length > 0));
  const possessions = characters.flatMap((character) => character.possessions);
  assert.ok(possessions.every((item) => item.treasureRef.startsWith("treasure-")));
  for (const item of possessions) {
    const storyTreasure = proceduralTreasureAt({ seed: matrix.seed, ordinal: item.treasureOrdinal });
    assert.equal(item.treasureRef, storyTreasure.id);
    assert.equal(item.name, storyTreasure.name);
    assert.equal(item.function, storyTreasure.function);
    assert.equal(item.limitation, storyTreasure.limitation);
    assert.equal(item.cost, storyTreasure.cost);
    const classification = proceduralTreasureClassificationAt({
      storySeed: matrix.seed,
      treasureOrdinal: item.treasureOrdinal,
    });
    if (classification.kind === "pill") {
      assert.ok(["丹藥", "藥丸"].includes(item.kind));
    } else {
      assert.equal(item.kind, ({
        weapon: "武器",
        talisman: "符籙",
        formation: "陣法",
        "special-opportunity": "特殊機緣",
      })[classification.kind]);
    }
    assert.equal(item.rarity, ({
      common: "常見",
      uncommon: "稀有",
      rare: "珍品",
      epic: "傳承",
      legendary: "唯一機緣",
      mythic: "唯一機緣",
    })[classification.rarity]);
    const holder = treasureHolderPopulationIndex({
      storySeed: matrix.seed,
      treasureOrdinal: item.treasureOrdinal,
      populationSize: matrix.populationSize,
    });
    const character = characters.find((candidate) => candidate.possessions.includes(item));
    assert.equal(holder, character.populationIndex);
  }
  assert.ok(characters.every((character) => character.portrait.source === "procedural-original-svg"));
  assert.ok(characters.every((character) => character.portrait.dataUrl.startsWith("data:image/svg+xml;charset=utf-8,")));
  assert.equal(new Set(characters.map((character) => character.portrait.dataUrl)).size, characters.length);
  return {
    characters: characters.length,
    relationships: characters.reduce((sum, character) => sum + character.relationships.length, 0),
    possessions: possessions.length,
    existingTreasureLibraryReused: true,
    externalPortraitRequests: 0,
  };
});

await test("a virtual character cannot enter Canon before explicit human approval", async () => {
  const matrix = new DeterministicSocialMatrix({ seed: "approval-gate", cacheLimit: 8 });
  const candidate = await createSocialCharacterCandidate({
    projectId: "project-approval",
    matrix,
    populationIndex: 4242,
    proposedAt: "2026-08-24T01:00:00.000Z",
  });
  assert.equal(candidate.status, "PENDING_APPROVAL");
  assert.equal(candidate.canonicalMutation, 0);
  assert.equal(candidate.evidence.storyLibraryVersion, PROCEDURAL_STORY_LIBRARY_VERSION);
  assert.equal(candidate.evidence.ownershipIndexVersion, PROCEDURAL_TREASURE_OWNERSHIP_VERSION);
  assert.equal(candidate.evidence.treasureClassificationVersion, PROCEDURAL_TREASURE_CLASSIFICATION_VERSION);
  assert.equal(isApprovedSocialCharacter(candidate.character), false);
  await assert.rejects(() => approveSocialCharacterCandidate({
    candidate,
    expectedPayloadFingerprint: "tampered",
    approvedBy: "author",
    approvedAt: "2026-08-24T01:01:00.000Z",
  }), /SOCIAL_CHARACTER_CANDIDATE_FINGERPRINT_MISMATCH/u);
  const approved = await approveSocialCharacterCandidate({
    candidate,
    expectedPayloadFingerprint: candidate.payloadFingerprint,
    approvedBy: "author",
    approvedAt: "2026-08-24T01:01:00.000Z",
  });
  assert.equal(approved.canonicalRecord.canonicalStatus, "APPROVED");
  assert.equal(isApprovedSocialCharacter(approved.canonicalRecord), true);
  assert.equal(approved.approval.canonicalMutation, 1);
  assert.equal(approved.canonicalRecord.sourceCandidateId, candidate.candidateId);
  return { candidateMutation: 0, approvedMutation: 1, fingerprintLength: candidate.payloadFingerprint.length };
});

const failed = results.filter((result) => result.status === "FAIL");
console.log(JSON.stringify({ schemaVersion: "social-matrix-test-v1", generatedAt: new Date().toISOString(), results }, null, 2));
if (failed.length) process.exitCode = 1;
