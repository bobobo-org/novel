import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderPortraitResource } from "../app/canon/portrait-resource.ts";
import {
  activeStoryCast,
  activeStoryCharacters,
  activeStoryLore,
  activeStoryRelationships,
  activeStoryTimeline,
  activeStoryWorldRules,
  activeStoryWorlds,
} from "../lib/novel-ai/domain/active-story-context.ts";
import { stageAuthorToolSnapshot } from "../lib/novel-ai/author-tools.ts";
import {
  assertStoryStartedCanonMutationAllowed,
  explicitCrossEraCanonAuthorization,
} from "../lib/novel-ai/domain/story-started-canon-guard.ts";
import {
  isCharacterEraCompatible,
  suggestedCharacterPortrait,
  suggestedSocialMatrixCharacterPortrait,
} from "../lib/novel-ai/character-portraits/assignment.ts";
import {
  CHARACTER_PORTRAIT_CAPACITY,
  CHARACTER_PORTRAIT_CATALOG,
  filterCharacterPortraitCatalog,
} from "../lib/novel-ai/character-portraits/catalog.ts";
import { composeProjectContext } from "../lib/novel-ai/web/project-context-composer.ts";

const optional = (value) => ({ value, source: value ? "user_defined" : "unset" });
const record = (id) => ({
  id,
  projectId: "project:test",
  schemaVersion: "novel-domain-v1",
  revision: 1,
  parentRevision: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  deletedAt: null,
  provenance: { source: "user" },
});
const character = (id, name, identity) => ({
  ...record(id),
  name,
  aliases: [],
  identity: optional(identity),
  personality: optional("冷靜、守諾"),
  goal: optional("保護同伴"),
  lifeStatus: "alive",
  locationId: null,
  capabilities: [identity],
});
const modernProject = {
  ...record("project:test"),
  title: "都會案件",
  genrePackId: "modern",
  genreId: "mystery",
  subgenreId: null,
  coreIdea: optional("現代都市中的企業調查"),
  narrativeStyle: optional("寫實懸疑"),
};
const modernWorld = { ...record("world:modern"), name: optional("台北"), era: optional("現代"), summary: optional("都會企業") };
const cast = [
  character("character:lead", "林澄", "刑警"),
  character("character:ally", "周芷", "調查記者"),
  character("character:future", "曜七", "星艦領航員"),
];
const bible = {
  ...record("bible:test"),
  protagonistIds: ["character:lead"],
  characterIds: cast.map((item) => item.id),
  worldId: modernWorld.id,
  worldRuleIds: ["rule:one"],
  loreIds: ["lore:one"],
  timelineEventIds: ["event:one"],
};

assert.equal(CHARACTER_PORTRAIT_CAPACITY, 10_000);
const firstPortraitPage = filterCharacterPortraitCatalog({}).slice(0, 12);
assert.equal(firstPortraitPage.length, 12);
assert.equal(
  new Set(firstPortraitPage.map((portrait) => portrait.id.replace(/-v\d{3}$/u, ""))).size,
  12,
  "the unfiltered first page must show twelve different base people instead of twelve tints of one face",
);
assert.equal(
  new Set(firstPortraitPage.map((portrait) => [
    portrait.assetUri,
    portrait.atlas?.row,
    portrait.atlas?.column,
  ].join(":"))).size,
  12,
  "the unfiltered first page must expose twelve distinct local atlas crops",
);
const portraitAssetDigests = new Map(
  CHARACTER_PORTRAIT_CATALOG.map((portrait) => [portrait.assetUri, portrait.assetDigest]),
);
assert.equal(portraitAssetDigests.size, 9);
for (const [assetUri, expectedDigest] of portraitAssetDigests) {
  const bytes = await readFile(new URL(`../public${assetUri}`, import.meta.url));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    expectedDigest,
    `${assetUri} catalog digest must match the shipped WebP bytes`,
  );
}
const firstPortrait = suggestedCharacterPortrait({ character: cast[0], project: modernProject, worlds: [modernWorld] });
assert.equal(firstPortrait.themeId, "modern-mystery");
assert.deepEqual(
  suggestedCharacterPortrait({ character: cast[0], project: modernProject, worlds: [modernWorld] }),
  firstPortrait,
  "portrait assignment must be deterministic",
);
assert.notEqual(
  suggestedCharacterPortrait({ character: { ...cast[0], age: 48 }, project: modernProject, worlds: [modernWorld] }).id,
  firstPortrait.id,
  "age is part of the deterministic portrait assignment signal",
);
const allyPortrait = suggestedCharacterPortrait({ character: cast[1], project: modernProject, worlds: [modernWorld] });
assert.notEqual(allyPortrait.id, firstPortrait.id, "different approved character attributes should select a different portrait");

const portraitMarkup = renderToStaticMarkup(createElement(() => renderPortraitResource({
  portrait: firstPortrait,
  className: "portrait-contract",
  label: firstPortrait.visualDescription,
  decorative: false,
})));
assert.match(portraitMarkup, /<svg[^>]+data-portrait-resource="\/character-portraits\/atlas-modern-mystery\.webp"/u, "portrait DOM must identify its bundled local atlas resource");
assert.match(portraitMarkup, /<image[^>]+href="\/character-portraits\/atlas-modern-mystery\.webp"/u, "portrait DOM must contain the actual atlas image instead of only a fallback rectangle");
assert.match(portraitMarkup, /data-portrait-atlas-cell="\d+:\d+"/u, "portrait DOM must retain the deterministic character-specific atlas crop");

const proceduralPortrait = {
  ...firstPortrait,
  id: "portrait:procedural-placeholder",
  source: "procedural",
  assetUri: "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E",
  generatedBy: "procedural-story-engine",
  approvedAt: new Date(0).toISOString(),
  approvedBy: "user",
  dataLeftDevice: false,
};
const resolvedProceduralPortrait = suggestedCharacterPortrait({
  character: { ...cast[0], portrait: proceduralPortrait },
  project: modernProject,
  worlds: [modernWorld],
});
assert.equal(resolvedProceduralPortrait.source, "catalog", "procedural SVG placeholders must resolve to a bundled portrait");
assert.match(resolvedProceduralPortrait.assetUri, /^\/character-portraits\/atlas-[a-z-]+\.webp$/u);
assert.notEqual(resolvedProceduralPortrait.assetUri, proceduralPortrait.assetUri);

const uploadedPortrait = {
  ...firstPortrait,
  id: "portrait:user-upload",
  source: "upload",
  assetUri: "data:image/png;base64,LOCAL_USER_IMAGE",
  atlas: undefined,
  generatedBy: "user-upload",
  approvedAt: new Date(0).toISOString(),
  approvedBy: "user",
  dataLeftDevice: false,
};
assert.equal(
  suggestedCharacterPortrait({ character: { ...cast[0], portrait: uploadedPortrait }, project: modernProject, worlds: [modernWorld] }),
  uploadedPortrait,
  "a user-approved upload must always take priority over automatic assignment",
);

const corporatePortrait = suggestedCharacterPortrait({
  character: {
    ...cast[0],
    id: "character:corporate-adviser",
    name: "趙衡",
    identity: optional("跨國企業風險顧問兼案件調查員"),
    personality: optional("謹慎、幹練"),
    capabilities: ["企業風險稽核"],
  },
  project: modernProject,
  worlds: [modernWorld],
});
assert.match(corporatePortrait.role, /^企業顧問/u, "approved occupation keywords should receive weighted portrait matching");
const socialMatrixCandidate = {
  characterId: "social-character:enterprise-chair",
  name: "沈雁秋",
  identity: "現代企業董事長，負責集團風險決策",
  storyAffinity: "現代 · 企業",
  institutionId: "institution:enterprise",
  institutionRole: "董事長",
  organizationUnit: "董事會",
  organizationRank: "董事長",
  organizationFaction: "創辦派",
  familyId: "family:shen",
  familyRole: "家主",
  pronouns: "她",
  age: 48,
  lifeStage: "壯年",
  location: "台北總部",
  goal: "保住家族企業與員工",
  personality: {
    traits: ["沉著", "果斷"],
    publicFace: "從容掌控會議",
    privateNeed: "守住家族信任",
  },
  abilities: { specialties: ["企業治理", "風險談判"] },
  portrait: {
    source: "procedural-original-svg",
    dataUrl: "data:image/svg+xml;charset=utf-8,GENERIC_SILHOUETTE",
  },
};
const socialCatalogPortrait = suggestedSocialMatrixCharacterPortrait({
  character: socialMatrixCandidate,
  project: modernProject,
  worlds: [modernWorld],
});
assert.equal(socialCatalogPortrait.source, "catalog");
assert.ok(socialCatalogPortrait.atlas, "social-matrix cards must use a local catalog atlas cell");
assert.match(socialCatalogPortrait.assetUri, /^\/character-portraits\/atlas-[a-z-]+\.webp$/u);
assert.notEqual(socialCatalogPortrait.assetUri, socialMatrixCandidate.portrait.dataUrl);
assert.ok((socialCatalogPortrait.visualVariant?.variant ?? -1) >= 0);
assert.ok((socialCatalogPortrait.visualVariant?.variant ?? 100) < 100);
assert.deepEqual(
  suggestedSocialMatrixCharacterPortrait({ character: socialMatrixCandidate, project: modernProject, worlds: [modernWorld] }),
  socialCatalogPortrait,
  "social-matrix portrait variants must remain deterministic",
);
assert.equal(isCharacterEraCompatible({ character: cast[2], project: modernProject, worlds: [modernWorld] }), false);
assert.equal(isCharacterEraCompatible({ character: cast[0], project: modernProject, worlds: [modernWorld] }), true);

assert.deepEqual(
  activeStoryCharacters(cast, { activeCharacterIds: ["character:ally"] }, bible).map((item) => item.id),
  ["character:lead", "character:ally"],
  "explicit staging keeps the protagonist and selected supporting cast",
);
assert.deepEqual(
  activeStoryCharacters(cast, {}, bible).map((item) => item.id),
  cast.map((item) => item.id),
  "legacy stories retain their Story Bible cast",
);
assert.deepEqual(
  activeStoryCharacters(cast, { activeCharacterIds: [] }, { ...bible, protagonistIds: [] }),
  [],
  "an explicit empty cast must remain empty instead of silently selecting the first record",
);
assert.deepEqual(
  activeStoryCharacters(cast, { activeCharacterIds: ["character:stale"] }, { ...bible, protagonistIds: [] }),
  [],
  "stale staged IDs must not silently select an unrelated character",
);
assert.deepEqual(
  activeStoryRelationships([
    { fromCharacterId: "character:lead", toCharacterId: "character:ally" },
    { fromCharacterId: "character:lead", toCharacterId: "character:future" },
  ], cast.slice(0, 2)).map((item) => item.toCharacterId),
  ["character:ally"],
);

const alternateWorld = { ...record("world:alternate"), name: optional("遠星"), era: optional("未來"), summary: optional("星際") };
assert.deepEqual(activeStoryWorlds([modernWorld, alternateWorld], { activeWorldId: alternateWorld.id }, bible).map((item) => item.id), [alternateWorld.id]);
const inactiveCultivationWorld = {
  ...record("world:inactive-cultivation"),
  name: optional("玄霄宗"),
  era: optional("修仙古代"),
  summary: optional("宗門、靈根與劍修世界"),
};
const activeModernWorlds = activeStoryWorlds(
  [modernWorld, inactiveCultivationWorld],
  { activeWorldId: modernWorld.id },
  bible,
);
assert.equal(
  suggestedCharacterPortrait({ character: cast[0], project: modernProject, worlds: [modernWorld, inactiveCultivationWorld] }).themeId,
  "xianxia",
  "an inactive cultivation world can incorrectly dominate an unfiltered portrait assignment",
);
assert.equal(
  suggestedCharacterPortrait({ character: cast[0], project: modernProject, worlds: activeModernWorlds }).themeId,
  "modern-mystery",
  "chat portraits must use only the active StoryState/Story Bible world",
);
assert.deepEqual(activeStoryWorldRules([
  { id: "rule:one", immutable: true },
  { id: "rule:two", immutable: false },
  { id: "rule:three", immutable: false },
], { activeWorldRuleIds: ["rule:two"] }, bible).map((item) => item.id), ["rule:one", "rule:two"], "immutable Canon rules always remain active");
assert.deepEqual(activeStoryLore([{ id: "lore:one" }, { id: "lore:two" }], { activeLoreIds: [] }, bible), []);
assert.deepEqual(activeStoryTimeline([{ id: "event:one" }, { id: "event:two" }], { activeTimelineEventIds: ["event:two"] }, bible).map((item) => item.id), ["event:two"]);

const storyState = {
  ...record("state:test"),
  activeCharacterIds: ["character:lead", "character:ally"],
  activeWorldId: modernWorld.id,
  activeWorldRuleIds: [],
  activeLoreIds: [],
  activeTimelineEventIds: [],
};
const canonicalBible = {
  ...bible,
  theme: optional("信任"),
  style: optional("懸疑"),
  relationshipIds: ["formal-relationship:lead-ally", "formal-relationship:lead-future"],
  foreshadowing: [],
  unresolvedThreads: [],
  forbiddenContradictions: [],
  authorPreferences: [],
};

const requestedCrossEraWorld = {
  ...record("world:requested-cross-era"),
  name: optional("自稱時空城"),
  era: optional("cross-era"),
  summary: optional("候選世界自稱跨時代"),
};
const noCrossEraAuthorization = explicitCrossEraCanonAuthorization({
  project: modernProject,
  storyBible: canonicalBible,
  worldRules: [],
  baselineWorld: modernWorld,
});
assert.equal(
  noCrossEraAuthorization.authorized,
  false,
  "a requested cross-era world is not itself Canon authorization",
);
assert.equal(isCharacterEraCompatible({ character: cast[2], project: modernProject, worlds: [requestedCrossEraWorld] }), true);
assert.equal(
  isCharacterEraCompatible({
    character: { ...cast[2], eraContext: "future" },
    project: modernProject,
    worlds: [requestedCrossEraWorld],
    crossEraAuthorization: noCrossEraAuthorization,
  }),
  false,
  "story staging must fail closed when a cross-era world has no formal authorization",
);
const explicitFutureSnapshot = {
  ...cast[0],
  id: "character:global-future-snapshot",
  eraContext: "future",
  identity: optional("在現代公司偽裝的星艦領航員"),
};
assert.equal(
  isCharacterEraCompatible({
    character: explicitFutureSnapshot,
    project: modernProject,
    worlds: [modernWorld],
    crossEraAuthorization: noCrossEraAuthorization,
  }),
  false,
  "an explicit imported era must override misleading identity keywords",
);
assert.equal(
  isCharacterEraCompatible({
    character: explicitFutureSnapshot,
    project: modernProject,
    worlds: [modernWorld],
    crossEraAuthorization: { authorized: true, sources: [] },
  }),
  false,
  "an authorization flag without a formal source is not valid",
);
const authorizedCrossEraCanon = explicitCrossEraCanonAuthorization({
  project: modernProject,
  storyBible: { ...canonicalBible, theme: optional("古今穿越後的信任") },
  worldRules: [],
  baselineWorld: modernWorld,
});
assert.equal(
  authorizedCrossEraCanon.authorized,
  true,
  "an existing Story Bible can explicitly authorize cross-era selection",
);
assert.equal(
  isCharacterEraCompatible({
    character: explicitFutureSnapshot,
    project: modernProject,
    worlds: [modernWorld],
    crossEraAuthorization: authorizedCrossEraCanon,
  }),
  true,
  "a traceable formal cross-era authorization can admit a different-era character",
);
const authorizedStoryBible = {
  ...canonicalBible,
  theme: optional("古今穿越後的信任"),
  characterIds: [cast[0].id, explicitFutureSnapshot.id],
  relationshipIds: ["relationship:lead-future"],
};
const authorizedStoryState = {
  ...storyState,
  activeCharacterIds: [cast[0].id, explicitFutureSnapshot.id],
  activeWorldId: modernWorld.id,
};
const authorizedActiveCast = activeStoryCast({
  project: modernProject,
  storyBible: authorizedStoryBible,
  storyState: authorizedStoryState,
  worldRules: [],
  worlds: [modernWorld],
  characters: [cast[0], explicitFutureSnapshot],
});
assert.deepEqual(
  authorizedActiveCast.characters.map((character) => character.id),
  [cast[0].id, explicitFutureSnapshot.id],
  "the shared consumer boundary keeps a formally authorized future character active in a modern world",
);
const deniedActiveCast = activeStoryCast({
  project: modernProject,
  storyBible: { ...authorizedStoryBible, theme: optional("現代城市中的信任") },
  storyState: authorizedStoryState,
  worldRules: [],
  worlds: [modernWorld],
  characters: [cast[0], explicitFutureSnapshot],
});
assert.deepEqual(
  deniedActiveCast.characters.map((character) => character.id),
  [cast[0].id],
  "the shared consumer boundary still rejects an unauthorized different-era character",
);
const authorizedAuthorSnapshot = stageAuthorToolSnapshot({
  project: modernProject,
  chapters: [],
  characters: [cast[0], explicitFutureSnapshot],
  relationships: [{
    ...record("relationship:lead-future"),
    fromCharacterId: cast[0].id,
    toCharacterId: explicitFutureSnapshot.id,
    kind: "穿越盟友",
    summary: "兩人在跨時代危機中結盟",
    trust: 65,
  }],
  worldRules: [],
  storyBible: authorizedStoryBible,
  storyState: authorizedStoryState,
  timeline: [],
  worlds: [modernWorld],
});
assert.deepEqual(
  authorizedAuthorSnapshot.characters.map((character) => character.id),
  [cast[0].id, explicitFutureSnapshot.id],
  "author tools consume the same formally authorized cross-era cast",
);
assert.equal(authorizedAuthorSnapshot.relationships.length, 1);
assert.deepEqual(
  explicitCrossEraCanonAuthorization({
    project: modernProject,
    storyBible: { ...canonicalBible, worldRuleIds: ["rule:cross-era"] },
    worldRules: [{ ...record("rule:cross-era"), title: "時空裂縫", description: "角色可穿越時代", immutable: true }],
    baselineWorld: modernWorld,
  }).sources,
  ["world-rule"],
);
assert.equal(
  explicitCrossEraCanonAuthorization({
    project: modernProject,
    storyBible: { ...canonicalBible, worldRuleIds: ["rule:no-cross-era"] },
    worldRules: [{ ...record("rule:no-cross-era"), title: "禁止穿越", description: "本作不得跨越時代", immutable: true }],
    baselineWorld: modernWorld,
  }).authorized,
  false,
  "a prohibition mentioning time travel is not authorization",
);
assert.deepEqual(
  explicitCrossEraCanonAuthorization({
    project: { ...modernProject, coreIdea: optional("現代刑警穿越古代") },
    storyBible: canonicalBible,
    worldRules: [],
    baselineWorld: modernWorld,
  }).sources,
  ["project"],
);
assert.throws(() => assertStoryStartedCanonMutationAllowed({
  storyStarted: true,
  mutation: "create-world",
}), /STORY_STARTED_NEW_WORLD_LOCKED/u);
assert.throws(() => assertStoryStartedCanonMutationAllowed({
  storyStarted: true,
  mutation: "approve-social-character",
}), /STORY_STARTED_SOCIAL_CHARACTER_APPROVAL_LOCKED/u);
assert.throws(() => assertStoryStartedCanonMutationAllowed({
  storyStarted: true,
  mutation: "update-world",
  existingRecord: true,
  existingWorldEra: "現代",
  requestedWorldEra: "未來",
}), /STORY_STARTED_WORLD_ERA_LOCKED/u);
assert.doesNotThrow(() => assertStoryStartedCanonMutationAllowed({
  storyStarted: true,
  mutation: "update-world",
  existingRecord: true,
  existingWorldEra: "現代",
  requestedWorldEra: "現代",
}));

const composerStores = {
  projects: [{
    ...modernProject,
    storyBibleId: canonicalBible.id,
    storyStateId: storyState.id,
    activeChapterId: null,
    creationMode: "novel",
    narrativeStyle: optional("繁體中文小說"),
    adultMode: false,
  }],
  storyBibles: [canonicalBible],
  storyStates: [storyState],
  worlds: [modernWorld, alternateWorld],
  characters: cast,
  relationships: [{
    ...record("formal-relationship:lead-ally"),
    fromCharacterId: "character:lead",
    toCharacterId: "character:ally",
    kind: "盟友",
    summary: "STAGED_FORMAL_RELATIONSHIP",
    trust: 78,
  }, {
    ...record("formal-relationship:lead-future"),
    fromCharacterId: "character:lead",
    toCharacterId: "character:future",
    kind: "跨時代聯絡",
    summary: "OFFSTAGE_FORMAL_RELATIONSHIP_SECRET",
    trust: 12,
  }],
  characterAgentProfiles: [
    { ...record("profile:lead"), characterId: "character:lead", name: "林澄", identity: "ACTIVE_PROFILE" },
    { ...record("profile:ally"), characterId: "character:ally", name: "周芷", identity: "ALLY_PARTICIPANT_PROFILE" },
    { ...record("profile:future"), characterId: "character:future", name: "曜七", identity: "OFFSTAGE_PROFILE_SECRET" },
  ],
  characterKnowledge: [{
    ...record("knowledge:future"),
    knowledgeId: "knowledge:future",
    subjectEntityIds: ["character:future"],
    authorizedCharacterIds: ["character:future"],
    claim: "OFFSTAGE_KNOWLEDGE_SECRET",
    status: "CURRENT",
    scope: "PUBLIC",
  }],
  characterRelationships: [{
    ...record("agent-relationship:lead-ally"),
    relationshipId: "agent-relationship:lead-ally",
    fromCharacterId: "character:lead",
    toCharacterId: "character:ally",
    relationshipTypes: ["私人信任投影"],
    publicStatus: "STAGED_PRIVATE_RELATIONSHIP_PROJECTION",
  }, {
    ...record("agent-relationship:future"),
    relationshipId: "agent-relationship:future",
    fromCharacterId: "character:lead",
    toCharacterId: "character:future",
    relationshipTypes: ["跨時代"],
    publicStatus: "OFFSTAGE_RELATIONSHIP_SECRET",
  }],
  characterPrivateArcs: [{
    ...record("arc:future"),
    characterId: "character:future",
    title: "OFFSTAGE_PRIVATE_ARC_SECRET",
  }],
};
const fakeRepository = {
  kind: "indexeddb",
  async get(store, id) {
    return (composerStores[store] ?? []).find((item) => item.id === id) ?? null;
  },
  async list(store, projectId) {
    return (composerStores[store] ?? []).filter((item) => item.projectId === projectId);
  },
};
const composed = await composeProjectContext({
  repository: fakeRepository,
  taskType: "novel.continuation",
  projectId: modernProject.id,
  privacyLevel: "local-private",
  tokenBudget: 16_000,
  audience: "author",
});
const composedText = composed.context.map((item) => item.text).join("\n");
assert.match(composedText, /林澄|ACTIVE_PROFILE/u);
assert.match(composedText, /STAGED_CANONICAL_RELATIONSHIPS/u);
assert.match(composedText, /STAGED_FORMAL_RELATIONSHIP/u);
assert.match(composedText, /formal-canon/u);
assert.match(composedText, /CHARACTER_AGENT_PRIVATE_RELATIONSHIP_PROJECTIONS/u);
assert.match(composedText, /private-character-ai-projection/u);
assert.match(composedText, /formal-relationship:lead-ally/u);
assert.doesNotMatch(composedText, /formal-relationship:lead-future/u);
assert.doesNotMatch(composedText, /曜七|OFFSTAGE_PROFILE_SECRET|OFFSTAGE_KNOWLEDGE_SECRET|OFFSTAGE_RELATIONSHIP_SECRET|OFFSTAGE_FORMAL_RELATIONSHIP_SECRET|OFFSTAGE_PRIVATE_ARC_SECRET/u);
assert.equal(composed.contextSourceSummary.counts.formalRelationships, 1);

const multiParticipantComposition = await composeProjectContext({
  repository: fakeRepository,
  taskType: "character.multiAgentSimulation",
  projectId: modernProject.id,
  characterId: "character:lead",
  characterIds: ["character:lead", "character:ally"],
  privacyLevel: "local-private",
  tokenBudget: 16_000,
  audience: "actor",
});
const multiParticipantText = multiParticipantComposition.context.map((item) => item.text).join("\n");
assert.match(multiParticipantText, /林澄|ACTIVE_PROFILE/u);
assert.match(multiParticipantText, /周芷|ALLY_PARTICIPANT_PROFILE/u);
assert.match(multiParticipantText, /STAGED_FORMAL_RELATIONSHIP/u);
assert.doesNotMatch(multiParticipantText, /曜七|OFFSTAGE_PROFILE_SECRET|OFFSTAGE_FORMAL_RELATIONSHIP_SECRET/u);
assert.equal(multiParticipantComposition.contextSourceSummary.counts.characters, 2);

const crossEraComposerBible = {
  ...canonicalBible,
  theme: optional("現代刑警與未來領航員穿越時代合作"),
  characterIds: cast.map((character) => character.id),
};
const crossEraComposerState = {
  ...storyState,
  activeCharacterIds: [cast[0].id, cast[2].id],
};
const crossEraComposerStores = {
  ...composerStores,
  storyBibles: [crossEraComposerBible],
  storyStates: [crossEraComposerState],
  characters: [cast[0], cast[1], { ...cast[2], eraContext: "future" }],
};
const crossEraRepository = {
  kind: "indexeddb",
  async get(store, id) {
    return (crossEraComposerStores[store] ?? []).find((item) => item.id === id) ?? null;
  },
  async list(store, projectId) {
    return (crossEraComposerStores[store] ?? []).filter((item) => item.projectId === projectId);
  },
};
const crossEraComposition = await composeProjectContext({
  repository: crossEraRepository,
  taskType: "novel.continuation",
  projectId: modernProject.id,
  privacyLevel: "local-private",
  tokenBudget: 16_000,
  audience: "author",
});
const crossEraCompositionText = crossEraComposition.context.map((item) => item.text).join("\n");
assert.match(crossEraCompositionText, /曜七|OFFSTAGE_PROFILE_SECRET/u, "model context keeps a formally authorized different-era character");
assert.match(crossEraCompositionText, /OFFSTAGE_FORMAL_RELATIONSHIP_SECRET/u, "authorized cross-era formal relationships reach the model context");
assert.equal(crossEraComposition.contextSourceSummary.counts.characters, 2);

const [
  projectSectionSource,
  homeSource,
  socialLibrarySource,
  chatCharacterSource,
  rpgWorkspaceSource,
  messageTimelineSource,
  conversationSessionSource,
  rpgChatTurnSource,
  projectContextComposerSource,
  authorToolsSource,
  characterAgentWorkspaceSource,
] = await Promise.all([
  readFile(new URL("../app/studio/project/[projectId]/project-section-client.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/character-relationship-workbench.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/social-world-library.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/chat/components/story-character-reference.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/rpg/rpg-workspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/chat/components/message-timeline.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/chat/hooks/use-conversation-session.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/web/rpg-chat-turn.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/web/project-context-composer.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/novel-ai/author-tools.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/project/[projectId]/character-ai/character-agent-workspace.tsx", import.meta.url), "utf8"),
]);
assert.match(projectSectionSource, /mutation: existing \? "update-world" : "create-world"/u);
assert.match(projectSectionSource, /disabled=\{storyStarted && !worldEditingId\}/u);
assert.match(homeSource, /explicitCrossEraCanonAuthorization/u);
assert.match(homeSource, /crossEraAuthorization:\s*crossEraCanon/u, "relationship workbench must apply its formal authorization to cast filtering");
assert.doesNotMatch(homeSource, /baselineEra === "cross-era" \|\| requestedEra === "cross-era"/u);
for (const [consumer, source] of [
  ["rpg-chat-turn", rpgChatTurnSource],
  ["project-context-composer", projectContextComposerSource],
  ["author-tools", authorToolsSource],
  ["character-agent-workspace", characterAgentWorkspaceSource],
]) {
  assert.match(source, /activeStoryCast\(\{/u, `${consumer} must consume the centralized era-authorized story cast`);
}
assert.match(homeSource, /data-canon-edit-surface="home"/u);
assert.match(homeSource, /無論故事是否已開始，都可修改人物、能力值、世界、Story Bible、規則、記憶與時間線/u);
assert.match(homeSource, /createCharacterRpgProfile\(\{/u);
assert.match(homeSource, /aria-label="首頁正式能力值編修"/u);
assert.doesNotMatch(homeSource, /storyStarted/u, "home Canon editor must not inherit story-started locks");
const homeWorldSaveHandler = homeSource.slice(
  homeSource.indexOf("async function saveWorld"),
  homeSource.indexOf("async function removeSelectedWorld"),
);
assert.ok(homeWorldSaveHandler.indexOf("repository.put<World>") >= 0);
assert.doesNotMatch(homeWorldSaveHandler, /assertStoryStartedCanonMutationAllowed/u);
assert.match(socialLibrarySource, /mode = "reference-only"/u);
assert.match(socialLibrarySource, /data-library-mode=\{mode\}/u);
assert.match(socialLibrarySource, /故事內查詢模式/u);
const socialCharacterGridStart = socialLibrarySource.indexOf('data-testid="social-character-grid"');
const socialCharacterGridEnd = socialLibrarySource.indexOf('view === "treasures"', socialCharacterGridStart);
assert.ok(socialCharacterGridStart >= 0 && socialCharacterGridEnd > socialCharacterGridStart);
const socialCharacterGridSource = socialLibrarySource.slice(socialCharacterGridStart, socialCharacterGridEnd);
assert.match(socialCharacterGridSource, /suggestedSocialMatrixCharacterPortrait\(\{/u);
assert.match(socialCharacterGridSource, /<CharacterPortraitImage portrait=\{portrait\} className=\{styles\.socialCharacterPortrait\} \/>/u);
assert.doesNotMatch(
  socialCharacterGridSource,
  /character\.portrait\.dataUrl/u,
  "the visible social-matrix character grid must not render procedural SVG silhouettes",
);
assert.match(chatCharacterSource, /suggestedCharacterPortrait\(\{ character, project, worlds \}\)/u);
assert.match(chatCharacterSource, /portrait=\{portrait\}/u);
assert.doesNotMatch(chatCharacterSource, /portrait=\{character\.portrait\}/u, "chat cards must not render procedural placeholders directly");
assert.match(conversationSessionSource, /repository\.list<StoryBible>\("storyBibles", projectId\)/u);
assert.match(messageTimelineSource, /activeStoryWorlds\(worlds, storyState, storyBible\)/u);
assert.match(messageTimelineSource, /worlds=\{portraitWorlds\}/u);
assert.doesNotMatch(messageTimelineSource, /worlds=\{worlds\}/u, "chat must not pass every project world into portrait assignment");
assert.match(projectSectionSource, /activeStoryWorlds\(data\.worlds, storyState, storyBible\)/u);
assert.match(projectSectionSource, /portrait=\{displayPortrait\}/u);
assert.doesNotMatch(projectSectionSource, /portrait=\{item\.portrait\}/u, "the main character list must resolve procedural placeholders");
assert.match(rpgWorkspaceSource, /activeStoryWorlds\(data\.worlds, data\.storyState, data\.storyBible\)/u);
assert.match(rpgWorkspaceSource, /portrait=\{protagonistPortrait\}/u);
assert.doesNotMatch(rpgWorkspaceSource, /portrait=\{protagonist\.portrait\}/u, "the RPG dashboard must resolve procedural placeholders");
const worldSaveHandler = projectSectionSource.slice(
  projectSectionSource.indexOf("async function saveWorld"),
  projectSectionSource.indexOf("async function removeWorld"),
);
assert.ok(worldSaveHandler.indexOf("assertStoryStartedCanonMutationAllowed") < worldSaveHandler.indexOf("createNovelRepository"));
const socialCharacterApprovalHandler = socialLibrarySource.slice(
  socialLibrarySource.indexOf("async function approveCharacter"),
  socialLibrarySource.indexOf("async function approveTreasure"),
);
assert.ok(socialCharacterApprovalHandler.indexOf("ensureHomeEdit") < socialCharacterApprovalHandler.indexOf("createNovelRepository"));
const socialTreasureApprovalHandler = socialLibrarySource.slice(
  socialLibrarySource.indexOf("async function approveTreasure"),
  socialLibrarySource.indexOf("async function approveWorld"),
);
assert.ok(socialTreasureApprovalHandler.indexOf("ensureHomeEdit") < socialTreasureApprovalHandler.indexOf("createNovelRepository"));
const socialWorldApprovalHandler = socialLibrarySource.slice(
  socialLibrarySource.indexOf("async function approveWorld"),
  socialLibrarySource.indexOf("function pageControls"),
);
assert.ok(socialWorldApprovalHandler.indexOf("ensureHomeEdit") < socialWorldApprovalHandler.indexOf("createNovelRepository"));

console.log(JSON.stringify({
  status: "PASS",
  portraitCapacity: CHARACTER_PORTRAIT_CAPACITY,
  deterministicPortraitId: firstPortrait.id,
  activeCast: ["character:lead", "character:ally"],
  eraGate: "modern-blocks-future",
}, null, 2));
