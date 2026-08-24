import {
  makeRecord,
  optionalValue,
  type Character,
  type CharacterRelationship,
  type ProjectBundle,
  type ProjectCreationDraft,
  type ProjectSeed,
} from "./index";
import {
  isStoryPlayModeId,
  selectedStoryPlayMode,
} from "./play-mode";
import {
  topicWorldContractAt,
  type TopicWorldContract,
  type TopicWorldPlayMode,
} from "../game/topic-world-contract";
import {
  approveTopicWorldFamilyCanonCandidate,
  restoreTopicWorldFamilyDraftSelection,
  type ApprovedTopicWorldFamilyCanon,
  type TopicWorldFamilyStageMatrix,
  type TopicWorldStageFamily,
  type TopicWorldStageMember,
} from "../game/topic-world-family-stage-matrix";
import { PROCEDURAL_CAUSAL_DIMENSIONS } from "../game/procedural-story-library";
import { listProceduralWorldTopics } from "../game/procedural-world-library";

export function createDraft(mode: ProjectCreationDraft["mode"] = "quick"): ProjectCreationDraft {
  const projectId = crypto.randomUUID();
  return {
    ...makeRecord(projectId),
    mode,
    step: 1,
    title: "",
    genrePackId: null,
    genreId: null,
    subgenreId: null,
    coreIdea: optionalValue(),
    protagonist: optionalValue(),
    style: optionalValue(),
    answers: { language: optionalValue("zh-TW", "user_defined") },
    seedCandidate: null,
  };
}

export function buildSeedCandidate(draft: ProjectCreationDraft): ProjectSeed {
  const hero = draft.protagonist.value?.trim()
    || draft.answers.protagonist?.value?.trim()
    || null;
  const idea = draft.coreIdea.value?.trim()
    || draft.answers.story?.value?.trim()
    || null;
  const conflict = draft.answers.conflict?.value?.trim()
    || draft.answers.obstacle?.value?.trim()
    || draft.answers.goal?.value?.trim()
    || null;
  return {
    ...makeRecord(draft.projectId, "system"),
    titleCandidates: [draft.title.trim() || "未命名作品"],
    logline: optionalValue(idea, idea ? "user_defined" : "deferred"),
    protagonist: optionalValue(hero, hero ? "user_defined" : "deferred"),
    goal: optionalValue(draft.answers.goal?.value ?? null, draft.answers.goal?.value ? "user_defined" : "deferred"),
    weakness: optionalValue<string>(null, "deferred"),
    world: optionalValue(draft.answers.world?.value ?? null, draft.answers.world?.value ? "user_defined" : "deferred"),
    worldRule: optionalValue(draft.answers.worldRule?.value ?? null, draft.answers.worldRule?.value ? "user_defined" : "deferred"),
    conflict: optionalValue(conflict, conflict ? "user_defined" : "deferred"),
    opposition: optionalValue<string>(null, "deferred"),
    opening: optionalValue(draft.answers.opening?.value ?? null, draft.answers.opening?.value ? "user_defined" : "deferred"),
    directions: [],
  };
}

type InitialCastSeed = {
  name: string;
  role: string;
  relationship: string;
  goal: string;
};

const ZH_CAST_NAMES = [
  "顧青禾", "謝知微", "裴照雪", "溫行舟", "寧秋棠", "陸沉霄",
  "蘇見月", "沈懷川", "葉星辭", "江聽瀾", "林照夜", "許雲深",
] as const;

const EN_CAST_NAMES = [
  "Mira Vale", "Rowan Hale", "Tessa Wynn", "Elias North", "Nora Voss", "Adrian Grey",
  "Iris Bell", "Julian Reed", "Mae Carter", "Theo Quinn", "Clara Finch", "Simon Lake",
] as const;

const CAST_ROLES = [
  { role: "核心同行者", relationship: "可信但有自身底線的盟友", goal: "保住共同目標，也守住自己不能退讓的承諾" },
  { role: "競爭者／對立者", relationship: "立場衝突、能力相當的競爭者", goal: "在主角之前取得關鍵資格，證明自己的道路才可行" },
  { role: "勢力代表", relationship: "掌握制度與資源的條件式合作方", goal: "維持所屬群體的利益，並找出值得長期結盟的人" },
  { role: "事件推動者／見證者", relationship: "知道部分真相、尚未完全站隊的人", goal: "追查被隱藏的因果，避免同一場傷害再次發生" },
] as const;

function stableNumber(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function compactCastValue(value: string | undefined, fallback: string, limit = 180) {
  return value?.replace(/\s+/gu, " ").trim().slice(0, limit) || fallback;
}

/**
 * Cast text is intentionally human-editable: one supporting character per
 * line as `name｜role｜relationship to protagonist｜personal goal`.
 */
export function initialCastSeeds(draft: ProjectCreationDraft, protagonistName: string | null) {
  const raw = draft.answers.cast?.value?.trim() ?? "";
  const rows = raw.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(0, 12);
  const seen = new Set([protagonistName?.trim()].filter(Boolean) as string[]);
  const parsed: InitialCastSeed[] = [];
  for (const row of rows) {
    const fields = row.split(/[｜|]/u).map((field) => field.trim());
    const template = CAST_ROLES[parsed.length % CAST_ROLES.length];
    const name = compactCastValue(fields[0], "", 80);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    parsed.push({
      name,
      role: compactCastValue(fields[1], template.role),
      relationship: compactCastValue(fields[2], template.relationship),
      goal: compactCastValue(fields[3], template.goal, 260),
    });
  }

  const language = draft.answers.language?.value ?? "zh-TW";
  const names = language === "en" ? EN_CAST_NAMES : ZH_CAST_NAMES;
  const offset = stableNumber(`${draft.projectId}|${draft.title}|${draft.genreId ?? "topic"}`) % names.length;
  let cursor = 0;
  while (parsed.length < CAST_ROLES.length && cursor < names.length * 2) {
    const name = names[(offset + cursor) % names.length];
    cursor += 1;
    if (seen.has(name)) continue;
    const template = CAST_ROLES[parsed.length];
    seen.add(name);
    parsed.push({ name, ...template });
  }
  return parsed;
}

function relationshipTrust(kind: string) {
  if (/對立|競爭|敵|rival|opponent/iu.test(kind)) return -15;
  if (/盟友|同行|信任|ally|companion/iu.test(kind)) return 25;
  return 5;
}

function topicContractForDraft(
  draft: ProjectCreationDraft,
  playMode: ReturnType<typeof selectedStoryPlayMode>,
): TopicWorldContract {
  if (!draft.genreId) {
    throw Object.assign(new Error("建立作品前必須從 218 類經典題材中選擇一類。"), {
      code: "PROJECT_TOPIC_REQUIRED",
    });
  }
  const contractMode: TopicWorldPlayMode = playMode === "rpg"
    || playMode === "romance"
    || playMode === "management"
    ? playMode
    : "general";
  return topicWorldContractAt({
    seed: `novel-project:${draft.projectId}:procedural-v1`,
    topicId: draft.genreId,
    playMode: contractMode,
  });
}

function inferredSystemValue(value: string) {
  return {
    ...optionalValue(value, "inferred"),
    source: "system" as const,
  };
}

function acceptedAiValue(value: string) {
  return {
    ...optionalValue(value, "ai_accepted"),
    source: "ai_candidate" as const,
  };
}

function approvedRecord(projectId: string, id: string) {
  return {
    ...makeRecord(projectId, "ai_candidate"),
    id,
  };
}

function stableDigest(value: string) {
  return Array.from({ length: 8 }, (_, index) => (
    stableNumber(`${index}|${value}`).toString(16).padStart(8, "0")
  )).join("");
}

type ResolvedFamilyStage = {
  matrix: TopicWorldFamilyStageMatrix;
  family: TopicWorldStageFamily;
  approved: ApprovedTopicWorldFamilyCanon;
  selectionSource: "explicit";
  selectedProtagonistId: string | null;
};

const PROCEDURAL_WORLD_TOPIC_ORDINAL_BY_ID = new Map(
  listProceduralWorldTopics().map(({ topicId, topicOrdinal }) => [topicId, topicOrdinal] as const),
);

function proceduralWorldTopicOrdinal(topicId: string) {
  const topicOrdinal = PROCEDURAL_WORLD_TOPIC_ORDINAL_BY_ID.get(topicId);
  if (topicOrdinal === undefined) {
    throw Object.assign(new Error(`題材 ${topicId} 尚未建立可重播的世界位址。`), {
      code: "PROJECT_TOPIC_PROCEDURAL_ADDRESS_NOT_FOUND",
    });
  }
  return topicOrdinal;
}

function stageFamilySelectionMismatch(detail: string) {
  return Object.assign(
    new Error(`上場家族選擇與目前題材世界不一致：${detail}`),
    { code: "PROJECT_STAGE_FAMILY_SELECTION_MISMATCH" },
  );
}

function stageFamilySelectionRequired() {
  return Object.assign(
    new Error("建立作品前必須明確選擇並核准一組上場家族、宗門或派系。"),
    { code: "PROJECT_STAGE_FAMILY_REQUIRED" },
  );
}

/**
 * A compact stage-family address is replayed before any Domain record is
 * built. This makes an explicit selection all-or-nothing. New drafts carry a
 * deferred `stageFamily` answer while waiting for the author, so an empty
 * answer is rejected rather than silently approving the first candidate.
 * Drafts created before this field existed must return to the selector. A
 * missing field is not consent to approve the first generated family.
 */
function resolveFamilyStage(
  draft: ProjectCreationDraft,
  baseContract: TopicWorldContract,
): ResolvedFamilyStage {
  const serializedSelection = draft.answers.stageFamily?.value?.trim() ?? "";
  if (serializedSelection) {
    const restored = restoreTopicWorldFamilyDraftSelection(serializedSelection);
    if (restored.matrix.topicId !== baseContract.topicId) {
      throw stageFamilySelectionMismatch("題材不同");
    }
    if (restored.matrix.playClassification.mode !== baseContract.playMechanics.mode) {
      throw stageFamilySelectionMismatch("玩法不同");
    }
    if (
      restored.matrix.contractId !== baseContract.contractId
      || restored.matrix.worldId !== baseContract.worldId
      || restored.matrix.seed !== baseContract.seed
      || restored.matrix.worldOrdinal !== baseContract.worldOrdinal
    ) {
      throw stageFamilySelectionMismatch("世界種子或世界 ID 不同");
    }
    return {
      matrix: restored.matrix,
      family: restored.family,
      approved: approveTopicWorldFamilyCanonCandidate({
        candidate: restored.canonCandidate,
        projectId: draft.projectId,
        approvedBy: "user",
      }),
      selectionSource: "explicit",
      selectedProtagonistId: restored.selection.selectedProtagonistId ?? null,
    };
  }

  throw stageFamilySelectionRequired();
}

function stageMemberCharacter(input: {
  projectId: string;
  member: TopicWorldStageMember;
  family: TopicWorldStageFamily;
  matrix: TopicWorldFamilyStageMatrix;
  approved: ApprovedTopicWorldFamilyCanon;
}): Character {
  const { projectId, member, family, matrix, approved } = input;
  const relatedRelationshipIds = approved.canonRecords.relationships
    .filter((relationship) => (
      relationship.sourceCharacterId === member.characterId
      || relationship.targetCharacterId === member.characterId
    ))
    .map((relationship) => relationship.relationshipId);
  const heldAssetIds = approved.canonRecords.lore
    .filter((asset) => asset.holderCharacterId === member.characterId)
    .map((asset) => asset.catalogTreasureId);
  const abilities = member.abilities;
  const personality = member.personality;
  return {
    ...approvedRecord(projectId, member.characterId),
    name: member.name,
    aliases: [],
    identity: acceptedAiValue(member.identity),
    personality: acceptedAiValue(
      `${personality.traits.join("、")}；對外${personality.publicFace}，內心需要${personality.privateNeed}。`,
    ),
    goal: acceptedAiValue(member.goal),
    lifeStatus: "alive",
    locationId: null,
    age: member.age,
    ageVerified: true,
    fears: [`失去${personality.privateNeed}`, `因${member.secret}使家族承受代價`],
    privateSecrets: [member.secret],
    factionIds: [family.organizationId, family.familyId],
    values: [personality.publicFace, personality.privateNeed, family.inheritedTrait],
    capabilities: [
      `力量層級：${abilities.powerTier}`,
      `修行 ${abilities.cultivation}`,
      `武技 ${abilities.martial}`,
      `謀略 ${abilities.strategy}`,
      `洞察 ${abilities.perception}`,
      `醫術 ${abilities.medicine}`,
      `工藝 ${abilities.crafting}`,
      `領導 ${abilities.leadership}`,
      `影響力 ${abilities.influence}`,
      ...abilities.specialties,
    ],
    limitations: [
      `警戒 ${personality.caution}/100；情緒波動 ${personality.volatility}/100`,
      `不能違背${family.name}目前的家族位置：${family.standing}`,
    ],
    portrait: {
      id: `${member.characterId}:portrait`,
      source: "procedural",
      assetUri: member.portrait.dataUrl,
      assetDigest: stableDigest(member.portrait.storyLibraryVisualSeed),
      themeId: `${matrix.worldFamily}:${matrix.topicId}`,
      themeLabel: `${matrix.topicName}・${family.organizationKind}`,
      role: member.stageRole,
      visualDescription: member.portrait.description,
      traits: [...personality.traits, ...member.portrait.palette],
      generatedBy: "procedural-story-engine",
      approvedAt: approved.approvedAt,
      approvedBy: "user",
      dataLeftDevice: false,
    },
    dynamicsProfile: {
      schemaVersion: "character-dynamics-profile-v1",
      engineVersion: "browser-character-dynamics-v1",
      playthroughSeed: matrix.seed,
      archetypeId: member.stageRole,
      archetypeLabel: member.stageRole,
      personalityAxes: {
        curiosity: abilities.perception,
        empathy: personality.empathy,
        ambition: personality.ambition,
        caution: personality.caution,
        loyalty: personality.loyalty,
        volatility: personality.volatility,
      },
      personalityTraits: [...personality.traits],
      socialRole: `${member.familyRole}／${member.organizationRole}`,
      relationshipNeeds: [personality.privateNeed, family.inheritedTrait],
      behavioralTendencies: [personality.publicFace, member.goal],
      approvedAt: approved.approvedAt,
      approvedBy: "user",
    },
    socialMatrixProfile: {
      schemaVersion: "novel-social-matrix-v1",
      sourceCharacterId: member.characterId,
      populationIndex: member.populationIndex,
      institutionId: family.organizationId,
      familyId: family.familyId,
      relationshipIds: relatedRelationshipIds,
      treasureIds: heldAssetIds,
      candidateFingerprint: approved.payloadFingerprint,
      approvedAt: approved.approvedAt,
      approvedBy: "user",
    },
  };
}

function canonicalFamilyRelationships(input: {
  projectId: string;
  approved: ApprovedTopicWorldFamilyCanon;
}): CharacterRelationship[] {
  return input.approved.canonRecords.relationships.map((relationship) => ({
    ...approvedRecord(input.projectId, relationship.relationshipId),
    fromCharacterId: relationship.sourceCharacterId,
    toCharacterId: relationship.targetCharacterId,
    kind: relationship.kind,
    summary: `${relationship.historyHook}信任 ${relationship.trust}/100、張力 ${relationship.tension}/100、責任 ${relationship.obligation}/100。`,
    trust: relationship.trust,
  }));
}

function stageRelationshipState(
  members: Character[],
  relationships: CharacterRelationship[],
) {
  const values: Record<string, number> = {};
  for (const member of members) {
    const relevant = relationships.filter((relationship) => (
      relationship.fromCharacterId === member.id
      || relationship.toCharacterId === member.id
    ));
    values[member.id] = relevant.length
      ? Math.round(relevant.reduce((total, relationship) => (
          total + (relationship.trust ?? 0)
        ), 0) / relevant.length)
      : 0;
  }
  return values;
}

function authoredSupportingSeeds(draft: ProjectCreationDraft, protagonistName: string | null) {
  return draft.answers.cast?.value?.trim()
    ? initialCastSeeds(draft, protagonistName)
    : [];
}

function selectedStageProtagonistId(input: {
  familyStage: ResolvedFamilyStage;
  requestedProtagonistName: string | null;
  stageCharacters: Character[];
  authoredSupporting: InitialCastSeed[];
}) {
  const { familyStage, requestedProtagonistName, stageCharacters, authoredSupporting } = input;
  if (familyStage.selectedProtagonistId) return familyStage.selectedProtagonistId;
  const exact = requestedProtagonistName
    ? stageCharacters.find((character) => character.name === requestedProtagonistName)
    : null;
  if (exact) return exact.id;
  if (!requestedProtagonistName) {
    return familyStage.approved.canonRecords.characters.find(
      (member) => member.stageRole === "男主角候選",
    )?.characterId ?? stageCharacters[0]?.id ?? null;
  }
  if (authoredSupporting.length) {
    const supportingNames = new Set(authoredSupporting.map((entry) => entry.name));
    const omitted = stageCharacters.filter((character) => !supportingNames.has(character.name));
    if (omitted.length === 1) return omitted[0].id;
  }
  // A supplied name that is not one of the approved family members is an
  // outside lead. Keep the complete selected family as the ensemble instead
  // of silently renaming and consuming its first protagonist candidate.
  return null;
}

function applyAuthoredStageCast(input: {
  stageCharacters: Character[];
  protagonistId: string | null;
  protagonistName: string | null;
  protagonistGoal: ProjectSeed["goal"];
  supporting: InitialCastSeed[];
}) {
  const supportingCharacters = input.stageCharacters.filter(
    (character) => character.id !== input.protagonistId,
  );
  const supportingById = new Map(
    supportingCharacters.map((character, index) => [character.id, input.supporting[index]] as const),
  );
  return input.stageCharacters.map((character) => {
    if (character.id === input.protagonistId) {
      const nextName = input.protagonistName?.trim() || character.name;
      return {
        ...character,
        name: nextName,
        aliases: nextName === character.name
          ? character.aliases
          : Array.from(new Set([character.name, ...character.aliases])),
        goal: input.protagonistGoal.value ? input.protagonistGoal : character.goal,
      };
    }
    const authored = supportingById.get(character.id);
    if (!authored) return character;
    return {
      ...character,
      name: authored.name,
      aliases: authored.name === character.name
        ? character.aliases
        : Array.from(new Set([character.name, ...character.aliases])),
      identity: optionalValue(authored.role, "user_defined"),
      goal: optionalValue(authored.goal, "user_defined"),
    };
  });
}

/**
 * Browser saves created before the 218-topic gate must remain readable, but an
 * unknown legacy story must never be silently assigned a topic, family or
 * treasure matrix. This bundle preserves only author-supplied Canon and marks
 * the missing topic/family setup for an explicit future choice.
 */
function buildUnclassifiedLegacyProjectBundle(
  draft: ProjectCreationDraft,
  seed: ProjectSeed,
): ProjectBundle {
  const projectId = draft.projectId;
  const title = draft.title.trim() || "未命名作品";
  const protagonist: Character | null = seed.protagonist.value
    ? {
        ...makeRecord(projectId),
        name: seed.protagonist.value,
        aliases: [],
        identity: optionalValue<string>(),
        personality: optionalValue<string>(),
        goal: seed.goal,
        lifeStatus: "unknown",
        locationId: null,
      }
    : null;
  const world = seed.world.value
    ? {
        ...makeRecord(projectId),
        name: optionalValue<string>(null, "deferred"),
        era: optionalValue<string>(null, "deferred"),
        summary: seed.world,
      }
    : null;
  const worldRules = seed.worldRule.value
    ? [{
        ...makeRecord(projectId, "user"),
        title: "作者世界規則",
        description: seed.worldRule.value,
        immutable: true,
      }]
    : [];
  const storyBible = {
    ...makeRecord(projectId),
    theme: optionalValue<string>(null, "deferred"),
    style: draft.style,
    protagonistIds: protagonist ? [protagonist.id] : [],
    characterIds: protagonist ? [protagonist.id] : [],
    relationshipIds: [],
    worldId: world?.id ?? null,
    worldRuleIds: worldRules.map((rule) => rule.id),
    loreIds: [],
    timelineEventIds: [],
    foreshadowing: [],
    unresolvedThreads: seed.conflict.value ? [seed.conflict.value] : [],
    forbiddenContradictions: [],
    authorPreferences: [],
  };
  const requestedPlayMode = selectedStoryPlayMode(draft.answers);
  const playMode = requestedPlayMode && isStoryPlayModeId(requestedPlayMode)
    ? requestedPlayMode
    : "general";
  const cloneFromProjectId = draft.answers.cloneFrom?.value?.trim() || null;
  const storyState = {
    ...makeRecord(projectId),
    protagonistStats: {},
    resources: {},
    money: null,
    inventory: [],
    relationships: {},
    reputation: null,
    factionStanding: {},
    worldFlags: {
      "story.playMode": playMode,
      "story.playModeLocked": true,
      "story.setupComplete": true,
      "story.creationMode": draft.mode,
      "story.language": draft.answers.language?.value || "zh-TW",
      "story.legacyUnclassified": true,
      "story.topicSelectionPending": true,
      "story.familySelectionPending": true,
      ...(cloneFromProjectId && cloneFromProjectId !== projectId
        ? { "story.cloneFromProjectId": cloneFromProjectId }
        : {}),
    },
    questStates: {},
    achievementStates: {},
    timeState: null,
    locationState: null,
    riskState: null,
  };
  const project = {
    ...makeRecord(projectId),
    id: projectId,
    title,
    proceduralRootSeed: `novel-project:${projectId}:procedural-v1`,
    creationMode: draft.mode,
    genrePackId: draft.genrePackId,
    genreId: null,
    subgenreId: draft.subgenreId,
    coreIdea: draft.coreIdea,
    narrativeStyle: draft.style,
    adultMode: false,
    adultExperienceProfile: null,
    activeChapterId: null,
    storyBibleId: storyBible.id,
    storyStateId: storyState.id,
  };
  const initialTask = {
    ...makeRecord(projectId),
    title: "寫下第一章",
    kind: "writing" as const,
    status: "not_started" as const,
    progress: 0,
    target: 1,
  };
  const readerState = {
    ...makeRecord(projectId),
    chapterId: null,
    positionType: "ratio" as const,
    positionValue: 0,
    contentAnchor: null,
    scrollTop: 0,
    percentage: 0,
    theme: "night" as const,
    fontFamily: "system-ui",
    fontSize: 20,
    lineHeight: 1.9,
    contentWidth: 760,
    paragraphSpacing: 18,
    lastReadAt: null,
  };
  const initialBackup = {
    ...makeRecord(projectId),
    formatVersion: "novel-backup-v2" as const,
    kind: "initial" as const,
    byteSize: 0,
    snapshot: {
      project,
      seed,
      storyBible,
      protagonist,
      world,
      worldRules,
      storyState,
    },
  };
  initialBackup.byteSize = new TextEncoder().encode(JSON.stringify(initialBackup.snapshot)).byteLength;
  return {
    project,
    seed,
    storyBible,
    protagonist,
    world,
    worldRules,
    storyState,
    initialTask,
    readerState,
    initialBackup,
  };
}

export function buildProjectBundle(draft: ProjectCreationDraft): ProjectBundle {
  const seed = draft.seedCandidate ?? buildSeedCandidate(draft);
  if (draft.mode === "legacy" && !draft.genreId) {
    return buildUnclassifiedLegacyProjectBundle(draft, seed);
  }
  const projectId = draft.projectId;
  const bibleRecord = makeRecord(projectId);
  const stateRecord = makeRecord(projectId);
  const title = draft.title.trim() || "未命名作品";
  const requestedPlayMode = selectedStoryPlayMode(draft.answers);
  const playMode = requestedPlayMode && isStoryPlayModeId(requestedPlayMode)
    ? requestedPlayMode
    : "general";
  const baseTopicContract = topicContractForDraft(draft, requestedPlayMode);
  const familyStage = resolveFamilyStage(draft, baseTopicContract);
  const topicContract = familyStage.matrix.worldContract;
  const approvedCanon = familyStage.approved;
  const selectedFamily = familyStage.family;
  const generatedStageCharacters = approvedCanon.canonRecords.characters.map((member) => (
    stageMemberCharacter({
      projectId,
      member,
      family: selectedFamily,
      matrix: familyStage.matrix,
      approved: approvedCanon,
    })
  ));
  const requestedProtagonistName = seed.protagonist.value?.trim() || null;
  const authoredSupporting = authoredSupportingSeeds(draft, requestedProtagonistName);
  const stageProtagonistId = selectedStageProtagonistId({
    familyStage,
    requestedProtagonistName,
    stageCharacters: generatedStageCharacters,
    authoredSupporting,
  });
  const stageCharacters = applyAuthoredStageCast({
    stageCharacters: generatedStageCharacters,
    protagonistId: stageProtagonistId,
    protagonistName: requestedProtagonistName,
    protagonistGoal: seed.goal,
    supporting: authoredSupporting,
  });
  const selectedStageProtagonist = stageProtagonistId
    ? stageCharacters.find((character) => character.id === stageProtagonistId) ?? null
    : null;
  const protagonist: Character | null = selectedStageProtagonist ?? (
    requestedProtagonistName
      ? {
          ...makeRecord(projectId, "user"),
          name: requestedProtagonistName,
          aliases: [],
          identity: optionalValue<string>(),
          personality: optionalValue<string>(),
          goal: seed.goal,
          lifeStatus: "unknown",
          locationId: null,
          factionIds: [selectedFamily.familyId],
        }
      : null
  );
  const cast: Character[] = selectedStageProtagonist
    ? stageCharacters.filter((character) => character.id !== selectedStageProtagonist.id)
    : stageCharacters;
  const authoredRelationshipByCharacterId = new Map(
    stageCharacters
      .filter((character) => character.id !== stageProtagonistId)
      .map((character, index) => [character.id, authoredSupporting[index]?.relationship] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  const familyRelationships = canonicalFamilyRelationships({ projectId, approved: approvedCanon })
    .map((relationship) => {
      if (!stageProtagonistId) return relationship;
      const counterpartId = relationship.fromCharacterId === stageProtagonistId
        ? relationship.toCharacterId
        : relationship.toCharacterId === stageProtagonistId
          ? relationship.fromCharacterId
          : null;
      const authoredRelationship = counterpartId
        ? authoredRelationshipByCharacterId.get(counterpartId)
        : null;
      return authoredRelationship
        ? {
            ...relationship,
            kind: authoredRelationship,
            summary: `${authoredRelationship}；${relationship.summary}`,
            trust: relationshipTrust(authoredRelationship),
          }
        : relationship;
    });
  const externalEntryRelationship: CharacterRelationship[] = protagonist
    && !selectedStageProtagonist
    && stageCharacters[0]
    ? [{
        ...makeRecord(projectId, "system"),
        fromCharacterId: protagonist.id,
        toCharacterId: stageCharacters[0].id,
        kind: "上場家族引介",
        summary: `${protagonist.name}由${stageCharacters[0].name}引介進入${selectedFamily.name}；家族仍保有拒絕與考驗的權利。`,
        trust: 10,
      }]
    : [];
  const relationships = [...familyRelationships, ...externalEntryRelationship];
  const worldSummary = [seed.world.value, approvedCanon.canonRecords.world.displaySummary]
    .map((value) => value?.trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .join("\n\n");
  const world = {
    ...approvedRecord(projectId, approvedCanon.canonRecords.world.worldId),
    name: inferredSystemValue(`${topicContract.topicName}・世界 ${topicContract.worldOrdinal + 1}`),
    era: topicContract.worldFamily === "cultivation"
      ? inferredSystemValue("修行紀元")
      : optionalValue<string>(null, "deferred"),
    summary: seed.world.value
      ? { ...seed.world, value: worldSummary }
      : acceptedAiValue(worldSummary),
    proceduralWorldProfile: {
      schemaVersion: "procedural-world-profile-v1" as const,
      sourceWorldId: approvedCanon.canonRecords.world.worldId,
      topicId: topicContract.topicId,
      topicOrdinal: proceduralWorldTopicOrdinal(topicContract.topicId),
      worldOrdinal: topicContract.worldOrdinal,
      relationshipScenarioId: familyStage.matrix.matrixId,
      characterIds: stageCharacters.map((character) => character.id),
      treasureIds: approvedCanon.canonRecords.lore.map((asset) => asset.catalogTreasureId),
      causalDimensionIds: PROCEDURAL_CAUSAL_DIMENSIONS.map((dimension) => dimension.id),
      approvedAt: approvedCanon.approvedAt,
      approvedBy: "user" as const,
    },
  };
  const worldRules = [
    ...(seed.worldRule.value
      ? [{
          ...makeRecord(projectId, "user"),
          title: "作者世界規則",
          description: seed.worldRule.value,
          immutable: true,
        }]
      : []),
    ...approvedCanon.canonRecords.worldRules.map((rule, index) => ({
      ...approvedRecord(projectId, rule.ruleId),
      title: index === 0 ? `${topicContract.topicName}題材承諾` : `世界規則 ${index + 1}`,
      description: rule.statement,
      immutable: true,
    })),
    ...approvedCanon.canonRecords.playMechanics.rules.map((description, index) => ({
      ...approvedRecord(
        projectId,
        `${familyStage.matrix.contractId}:play-rule:${index + 1}`,
      ),
      title: `${approvedCanon.canonRecords.playMechanics.label}規則 ${index + 1}`,
      description,
      immutable: true,
    })),
  ];
  const organizationById = new Map(
    approvedCanon.canonRecords.organizations.map((organization) => [
      organization.organizationId,
      organization,
    ] as const),
  );
  const assetById = new Map(
    approvedCanon.canonRecords.lore.map((asset) => [asset.assetControlId, asset] as const),
  );
  const stageCharacterById = new Map(
    stageCharacters.map((character) => [character.id, character] as const),
  );
  const organizationLore = approvedCanon.canonRecords.organizations.map((organization) => {
    const allies = organization.allyOrganizationIds
      .map((id) => organizationById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    const rivals = organization.rivalOrganizationIds
      .map((id) => organizationById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    const controlledAssets = organization.controlledAssetIds
      .map((id) => assetById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    const contestedAssets = organization.contestedAssetIds
      .map((id) => assetById.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    return {
      ...approvedRecord(projectId, organization.organizationId),
      kind: "faction" as const,
      title: `${organization.kindLabel}｜${organization.name}`,
      content: [
        organization.situationBrief,
        `領域：${organization.territory}；內部準則：${organization.doctrine}。`,
        `公開目標：${organization.publicGoal}；隱藏衝突：${organization.hiddenConflict}。`,
        `影響力 ${organization.influence}/100；可按需解碼成員 ${organization.memberCapacity} 人。`,
        `盟友：${allies.join("、") || "尚未公開"}；對手：${rivals.join("、") || "尚未公開"}。`,
        `控制：${controlledAssets.join("、") || "尚無"}；爭奪：${contestedAssets.join("、") || "尚無"}。`,
      ].join("\n"),
    };
  });
  const familyLore = {
    ...approvedRecord(projectId, selectedFamily.familyId),
    kind: "faction" as const,
    title: `上場家族｜${selectedFamily.name}`,
    content: [
      selectedFamily.introduction,
      `家族位置：${selectedFamily.standing}`,
      `上場前提：${selectedFamily.stagePremise}`,
      `掌握資產：${selectedFamily.assetControlIds.map((id) => assetById.get(id)?.name ?? id).join("、") || "尚無"}。`,
      "上場人物：",
      ...approvedCanon.canonRecords.characters.map((member) => {
        const character = stageCharacterById.get(member.characterId);
        return `${member.stageRole} ${character?.name ?? member.name}｜${character?.identity.value ?? member.identity}｜目標：${character?.goal.value ?? member.goal}｜持有：${member.possessionNames.join("、") || "尚無"}`;
      }),
    ].join("\n"),
  };
  const assetLore = approvedCanon.canonRecords.lore.map((asset) => ({
    ...approvedRecord(projectId, asset.loreId),
    kind: "item" as const,
    title: `${asset.category}｜${asset.name}`,
    content: [
      asset.storyHook,
      `控制勢力：${asset.controllerOrganizationName}（${asset.controlRelation}）。`,
      `持有人：${asset.holderName}。`,
      `聲索勢力：${asset.claimantOrganizationName ?? "無其他聲索者"}。`,
      `作用：${asset.function}`,
      `限制：${asset.limitation}`,
      `代價：${asset.cost}`,
      `外觀：${asset.visualDescription}`,
    ].join("\n"),
    proceduralTreasureProfile: {
      schemaVersion: "procedural-treasure-lore-v1" as const,
      ordinal: asset.treasureOrdinal,
      holderCharacterId: asset.holderCharacterId,
      stakeholderCharacterIds: stageCharacters
        .filter((character) => character.id !== asset.holderCharacterId)
        .map((character) => character.id),
      relationshipScenarioId: familyStage.matrix.matrixId,
      causalDimensionIds: PROCEDURAL_CAUSAL_DIMENSIONS.map((dimension) => dimension.id),
      approvedAt: approvedCanon.approvedAt,
      approvedBy: "user" as const,
    },
  }));
  const lore = [...organizationLore, familyLore, ...assetLore];
  const allCharacters = [
    ...(protagonist ? [protagonist] : []),
    ...cast,
  ];
  const storyBible = {
    ...bibleRecord,
    theme: inferredSystemValue(topicContract.topicName),
    style: draft.style,
    protagonistIds: protagonist ? [protagonist.id] : [],
    characterIds: allCharacters.map((character) => character.id),
    relationshipIds: relationships.map((relationship) => relationship.id),
    worldId: world.id,
    worldRuleIds: worldRules.map((rule) => rule.id),
    loreIds: lore.map((entry) => entry.id),
    timelineEventIds: [],
    foreshadowing: [],
    unresolvedThreads: seed.conflict.value ? [seed.conflict.value] : [],
    forbiddenContradictions: [],
    authorPreferences: [],
  };
  const cloneFromProjectId = draft.answers.cloneFrom?.value?.trim() || null;
  const relationshipValues = stageRelationshipState(allCharacters, relationships);
  const protagonistStageMember = protagonist
    ? approvedCanon.canonRecords.characters.find((member) => member.characterId === protagonist.id)
    : null;
  const protagonistStats: Record<string, number> = protagonistStageMember
    ? {
        "story.cultivation": protagonistStageMember.abilities.cultivation,
        "story.martial": protagonistStageMember.abilities.martial,
        "story.strategy": protagonistStageMember.abilities.strategy,
        "story.perception": protagonistStageMember.abilities.perception,
        "story.medicine": protagonistStageMember.abilities.medicine,
        "story.crafting": protagonistStageMember.abilities.crafting,
        "story.leadership": protagonistStageMember.abilities.leadership,
        "story.influence": protagonistStageMember.abilities.influence,
      }
    : {};
  const heldInventory = protagonist
    ? approvedCanon.canonRecords.lore
        .filter((asset) => asset.holderCharacterId === protagonist.id)
        .map((asset) => asset.name)
    : [];
  const storyState = {
    ...stateRecord,
    protagonistStats,
    resources: Object.fromEntries([
      ...approvedCanon.canonRecords.lore.map((asset) => [asset.assetControlId, 1] as const),
      ...approvedCanon.canonRecords.organizations.map((organization) => [
        `influence:${organization.organizationId}`,
        organization.influence,
      ] as const),
    ]),
    money: null,
    inventory: heldInventory,
    relationships: relationshipValues,
    reputation: null,
    factionStanding: Object.fromEntries(
      approvedCanon.canonRecords.organizations.map((organization) => [
        organization.organizationId,
        0,
      ]),
    ),
    worldFlags: {
      "story.playMode": playMode,
      "story.playModeLocked": true,
      "story.setupComplete": true,
      "story.creationMode": draft.mode,
      "story.language": draft.answers.language?.value || "zh-TW",
      "story.castReady": stageCharacters.length === 6,
      "story.castSize": allCharacters.length,
      "story.topicWorldContract": topicContract.schemaVersion,
      "story.topicId": topicContract.topicId,
      "story.worldOrdinal": topicContract.worldOrdinal,
      "story.worldFamily": topicContract.worldFamily,
      "story.playDimensions": topicContract.playMechanics.dimensions.join("、"),
      "story.familyStageMatrix": familyStage.matrix.schemaVersion,
      "story.familyStageMatrixId": familyStage.matrix.matrixId,
      "story.familyStageSelection": familyStage.selectionSource,
      "story.familyStageCandidateId": approvedCanon.candidateId,
      "story.familyStageApprovalId": approvedCanon.approvalId,
      "story.familyStageApprovedBy": approvedCanon.approvedBy,
      "story.familyStageApproved": approvedCanon.canonicalMutation === 1,
      "story.selectedFamilyId": selectedFamily.familyId,
      "story.selectedFamilyName": selectedFamily.name,
      "story.selectedFamilyOrganizationId": selectedFamily.organizationId,
      "story.familyStageMemberIds": stageCharacters.map((character) => character.id).join("、"),
      "story.organizationCount": approvedCanon.canonRecords.organizations.length,
      "story.assetControlCount": approvedCanon.canonRecords.lore.length,
      "story.virtualCharacterCapacity": familyStage.matrix.capacity.characters,
      "story.virtualTreasureCapacity": familyStage.matrix.capacity.treasures,
      "story.relationshipScenarioCapacity": familyStage.matrix.capacity.relationshipScenarios,
      ...(cloneFromProjectId && cloneFromProjectId !== projectId
        ? { "story.cloneFromProjectId": cloneFromProjectId }
        : {}),
    },
    questStates: {},
    achievementStates: {},
    timeState: null,
    locationState: selectedFamily.home,
    riskState: selectedFamily.standing,
  };
  const project = { ...makeRecord(projectId), id: projectId, title, proceduralRootSeed: `novel-project:${projectId}:procedural-v1`, creationMode: draft.mode, genrePackId: draft.genrePackId, genreId: draft.genreId, subgenreId: draft.subgenreId, coreIdea: draft.coreIdea, narrativeStyle: draft.style, adultMode: false, adultExperienceProfile: null, activeChapterId: null, storyBibleId: storyBible.id, storyStateId: storyState.id };
  const initialTask = { ...makeRecord(projectId), title: "寫下第一章", kind: "writing" as const, status: "not_started" as const, progress: 0, target: 1 };
  const readerState = { ...makeRecord(projectId), chapterId: null, positionType: "ratio" as const, positionValue: 0, contentAnchor: null, scrollTop: 0, percentage: 0, theme: "night" as const, fontFamily: "system-ui", fontSize: 20, lineHeight: 1.9, contentWidth: 760, paragraphSpacing: 18, lastReadAt: null };
  const initialBackup = { ...makeRecord(projectId), formatVersion: "novel-backup-v2" as const, kind: "initial" as const, byteSize: 0, snapshot: { project, seed, storyBible, protagonist, cast, relationships, world, worldRules, lore, storyState } };
  initialBackup.byteSize = new TextEncoder().encode(JSON.stringify(initialBackup.snapshot)).byteLength;
  return { project, seed, storyBible, protagonist, cast, relationships, world, worldRules, lore, storyState, initialTask, readerState, initialBackup };
}
