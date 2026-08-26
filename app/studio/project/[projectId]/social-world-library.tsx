"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  makeRecord,
  optionalValue,
  type Character,
  type CharacterDynamicsProfile,
  type CharacterRelationship,
  type LoreEntry,
  type NovelProject,
  type StoryState,
  type StoryBible,
  type World,
  type WorldRule,
} from "@/lib/novel-ai/domain";
import { assertStoryStartedCanonMutationAllowed } from "@/lib/novel-ai/domain/story-started-canon-guard";
import {
  characterRpgStatsForArchetype,
  createCharacterRpgProfile,
  suggestCharacterRpgArchetype,
} from "@/lib/novel-ai/game/character-rpg-profile";
import {
  ProceduralTreasureLibrary,
  type ProceduralTreasureRecord,
} from "@/lib/novel-ai/game/procedural-treasure-library";
import {
  listProceduralWorldTopics,
  PROCEDURAL_WORLD_CAPACITY,
  PROCEDURAL_WORLD_TOPIC_CAPACITY,
  PROCEDURAL_WORLD_VARIANTS_PER_TOPIC,
  proceduralWorldPage,
  type ProceduralWorld,
} from "@/lib/novel-ai/game/procedural-world-library";
import {
  createNovelRepository,
  type NovelRepository,
} from "@/lib/novel-ai/repository";
import {
  beginSocialWorldApproval,
  checkpointSocialWorldApproval,
  ensureProjectProceduralRootSeed,
  resolveProjectProceduralRootSeed,
  storyBibleApprovalChanged,
  storyBibleWithCharacterApproval,
  storyBibleWithTreasureApproval,
  storyBibleWithWorldApproval,
  type SocialWorldApprovalJournal,
} from "@/lib/novel-ai/social-world-approval";
import {
  approveSocialCharacterCandidate,
  buildStoryOrganizationBlueprints,
  buildStoryOrganizationDirectory,
  cultivationProfileForOrganizationMember,
  createSocialCharacterCandidate,
  DeterministicSocialMatrix,
  organizationMatrixContext,
  organizationMemberPage,
  resolveActiveWorldOrganizationSetting,
  type ApprovedSocialCharacter,
  type SocialMatrixCharacter,
  type StoryOrganizationMember,
  type StoryOrganizationHierarchyNode,
} from "@/lib/novel-ai/social-matrix";
import styles from "./social-world-library.module.css";

const PAGE_SIZE = 6;
const CHARACTER_CAPACITY = 100_000;
const TREASURE_CAPACITY = 100_000;
const SCENARIO_CAPACITY = 1_000_000;

type LibraryView = "characters" | "treasures" | "worlds";

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-TW").format(value);
}

function randomPage(capacity: number) {
  const pageCount = Math.ceil(capacity / PAGE_SIZE);
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] % pageCount;
}

function topAbilities(character: SocialMatrixCharacter | ApprovedSocialCharacter) {
  const entries = Object.entries(character.abilities)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);
  const labels: Record<string, string> = {
    cultivation: "修行",
    martial: "武力",
    strategy: "謀略",
    perception: "洞察",
    medicine: "醫藥",
    crafting: "製作",
    leadership: "領導",
    influence: "影響",
  };
  return entries.map(([key, value]) => ({ label: labels[key] ?? key, value }));
}

function personalityProfile(character: SocialMatrixCharacter | ApprovedSocialCharacter): CharacterDynamicsProfile {
  const approvedAt = new Date().toISOString();
  return {
    schemaVersion: "character-dynamics-profile-v1",
    engineVersion: "browser-character-dynamics-v1",
    playthroughSeed: character.storyProfileId,
    archetypeId: character.abilities.powerTier,
    archetypeLabel: `${character.abilities.powerTier}／${character.institutionRole}`,
    personalityAxes: {
      curiosity: character.abilities.perception,
      empathy: character.personality.empathy,
      ambition: character.personality.ambition,
      caution: character.personality.caution,
      loyalty: character.personality.loyalty,
      volatility: character.personality.volatility,
    },
    personalityTraits: [...character.personality.traits],
    socialRole: character.institutionRole,
    relationshipNeeds: [character.personality.privateNeed],
    behavioralTendencies: [character.personality.publicFace],
    approvedAt,
    approvedBy: "user",
  };
}

function OrganizationHierarchyBranch({
  branch,
  selectedNodeId,
  onSelect,
}: {
  branch: StoryOrganizationHierarchyNode;
  selectedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const selectable = branch.kind !== "asset" && branch.currentMemberCount > 0;
  return (
    <li className={styles.hierarchyBranch} data-node-kind={branch.kind} data-selected={selectedNodeId === branch.nodeId}>
      <button
        type="button"
        className={styles.hierarchyNodeButton}
        aria-pressed={selectedNodeId === branch.nodeId}
        disabled={!selectable}
        data-testid={`filter-hierarchy-${branch.nodeId}`}
        onClick={() => onSelect(branch.nodeId)}
      >
        <span>{branch.kind === "asset" ? "資產" : branch.kind === "rank" ? "位階" : branch.kind === "command" ? "決策" : "單位"}</span>
        <b>{branch.label}</b>
        {branch.memberCapacity > 0 ? <small>在籍 {formatNumber(branch.currentMemberCount)}／上限 {formatNumber(branch.memberCapacity)}</small> : null}
      </button>
      {branch.roles.length ? <p><strong>職位</strong>{branch.roles.join("・")}</p> : null}
      {branch.assets.length ? <p><strong>資源</strong>{branch.assets.join("・")}</p> : null}
      {branch.children.length ? <ul>{branch.children.map((child) => (
        <OrganizationHierarchyBranch
          branch={child}
          key={child.nodeId}
          selectedNodeId={selectedNodeId}
          onSelect={onSelect}
        />
      ))}</ul> : null}
    </li>
  );
}

function treasureLoreContent(treasure: ProceduralTreasureRecord) {
  const causal = treasure.causalDimensions
    .map((dimension) => `${dimension.label}：${dimension.signal}`)
    .join("\n");
  return [
    treasure.storyHook,
    `類型：${treasure.kindLabel}／${treasure.subtype}；稀有度：${treasure.rarityLabel}`,
    `能力：${treasure.abilities.map((ability) => `${ability.name}（${ability.effect}）`).join("；")}`,
    `限制：${treasure.limitation}`,
    `代價：${treasure.cost}`,
    `持有人：${treasure.holder.characterName}（${treasure.holder.factionName}）`,
    `十因果索引：\n${causal}`,
  ].join("\n\n");
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function treasureLoreMatches(
  lore: LoreEntry,
  treasure: ProceduralTreasureRecord,
) {
  const profile = lore.proceduralTreasureProfile;
  return lore.kind === "item"
    && profile?.schemaVersion === "procedural-treasure-lore-v1"
    && profile.ordinal === treasure.ordinal
    && profile.holderCharacterId === treasure.holder.characterId
    && profile.relationshipScenarioId === treasure.crossMatrix.scenarioId
    && sameStrings(
      profile.stakeholderCharacterIds,
      treasure.stakeholders.map((stakeholder) => stakeholder.characterId),
    )
    && sameStrings(
      profile.causalDimensionIds,
      treasure.crossMatrix.causalDimensionIds,
    );
}

async function ensureTreasureLore(
  repository: NovelRepository,
  projectId: string,
  treasure: ProceduralTreasureRecord,
  requestId: string,
  approvedAt: string,
) {
  const existingLore = await repository.get<LoreEntry>("lore", treasure.id);
  if (existingLore) {
    if (!treasureLoreMatches(existingLore, treasure)) {
      throw new Error("TREASURE_CANON_ID_COLLISION");
    }
    return { lore: existingLore, written: false };
  }
  const loreBase = makeRecord(projectId, "user");
  const lore = await repository.put<LoreEntry>("lore", {
    ...loreBase,
    id: treasure.id,
    provenance: { ...loreBase.provenance, requestId },
    kind: "item",
    title: treasure.name,
    content: treasureLoreContent(treasure),
    proceduralTreasureProfile: {
      schemaVersion: "procedural-treasure-lore-v1",
      ordinal: treasure.ordinal,
      holderCharacterId: treasure.holder.characterId,
      stakeholderCharacterIds: treasure.stakeholders.map(
        (stakeholder) => stakeholder.characterId,
      ),
      relationshipScenarioId: treasure.crossMatrix.scenarioId,
      causalDimensionIds: treasure.crossMatrix.causalDimensionIds,
      approvedAt,
      approvedBy: "user",
    },
  });
  return { lore, written: true };
}

export default function SocialWorldLibrary({
  project,
  approvedCharacters,
  approvedLore,
  approvalJournals,
  storyBibles,
  approvedWorlds = [],
  initialView = "characters",
  storyStarted = false,
  onChanged,
}: {
  project: NovelProject;
  approvedCharacters: Character[];
  approvedLore: LoreEntry[];
  approvalJournals: SocialWorldApprovalJournal[];
  storyBibles: StoryBible[];
  approvedWorlds?: World[];
  initialView?: LibraryView;
  storyStarted?: boolean;
  onChanged: () => Promise<void>;
}) {
  const seed = useMemo(
    () => resolveProjectProceduralRootSeed(project),
    [project],
  );
  const organizationSeed = `${seed}|story-organization-directory-v1`;
  const baseContext = useMemo(() => ({
    genre: [project.genrePackId, project.genreId, project.subgenreId].filter(Boolean).join("／"),
    playMode: "三選一互動",
    storyTags: [project.narrativeStyle.value, project.coreIdea.value].filter((value): value is string => Boolean(value)),
    protagonist: approvedCharacters[0]?.name ?? project.title,
    conflict: project.coreIdea.value ?? undefined,
  }), [approvedCharacters, project]);
  const [activeStoryState, setActiveStoryState] = useState<StoryState | null>(null);
  const organizationSetting = useMemo(() => {
    const legacyWorldId = storyBibles.find((storyBible) => storyBible.worldId)?.worldId ?? null;
    const activeWorldId = activeStoryState?.activeWorldId === undefined
      ? legacyWorldId
      : activeStoryState.activeWorldId;
    return resolveActiveWorldOrganizationSetting({
      activeWorldId,
      worlds: approvedWorlds.map((world) => ({
        id: world.id,
        name: world.name.value,
        era: world.era.value,
        summary: world.summary.value,
      })),
      fallback: {
        genre: baseContext.genre,
        coreIdea: project.coreIdea.value,
        narrativeStyle: project.narrativeStyle.value,
      },
    });
  }, [activeStoryState, approvedWorlds, baseContext.genre, project.coreIdea.value, project.narrativeStyle.value, storyBibles]);
  const context = useMemo(() => organizationMatrixContext({
    base: baseContext,
    setting: organizationSetting,
  }), [baseContext, organizationSetting]);
  const organizationBlueprints = useMemo(() => buildStoryOrganizationBlueprints({
    seed: organizationSeed,
    setting: organizationSetting,
  }), [organizationSeed, organizationSetting]);
  const matrix = useMemo(() => new DeterministicSocialMatrix({
    seed: organizationSeed,
    context,
    institutionCount: organizationBlueprints.length,
    institutionProfiles: organizationBlueprints,
    cacheLimit: 96,
  }), [context, organizationBlueprints, organizationSeed]);
  const organizations = useMemo(() => buildStoryOrganizationDirectory({
    seed: organizationSeed,
    setting: organizationSetting,
    blueprints: organizationBlueprints,
    institutions: organizationBlueprints.map((_, index) => matrix.getInstitution(index)),
  }), [matrix, organizationBlueprints, organizationSeed, organizationSetting]);
  const organizationTreasureLibrary = useMemo(() => new ProceduralTreasureLibrary({
    storySeed: organizationSeed,
    context,
    maxCacheEntries: 96,
  }), [context, organizationSeed]);
  const treasureLibrary = useMemo(() => new ProceduralTreasureLibrary({
    storySeed: seed,
    context,
    maxCacheEntries: 96,
  }), [context, seed]);
  const worldTopics = useMemo(() => listProceduralWorldTopics(), []);
  const [view, setView] = useState<LibraryView>(initialView);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(
    organizations[0]?.organizationId ?? "",
  );
  const [selectedHierarchyNodeId, setSelectedHierarchyNodeId] = useState<string | null>(null);
  const [characterPage, setCharacterPage] = useState(0);
  const [treasurePage, setTreasurePage] = useState(0);
  const [worldPage, setWorldPage] = useState(0);
  const [worldTopicId, setWorldTopicId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const seedBackfillStarted = useRef(false);
  const approvedIds = useMemo(() => new Set(approvedCharacters.map((character) => character.id)), [approvedCharacters]);
  const approvedSocialIds = useMemo(() => new Set(
    approvedCharacters.map((character) => character.socialMatrixProfile?.sourceCharacterId).filter((id): id is string => Boolean(id)),
  ), [approvedCharacters]);
  const approvedWorldIds = useMemo(() => new Set([
    ...approvedWorlds.map((world) => world.id),
    ...approvedWorlds.map((world) => world.proceduralWorldProfile?.sourceWorldId).filter((id): id is string => Boolean(id)),
  ]), [approvedWorlds]);
  const approvedTreasureIds = useMemo(
    () => new Set(approvedLore.map((lore) => lore.id)),
    [approvedLore],
  );
  const pendingApprovals = useMemo(() => new Set(
    approvalJournals
      .filter((journal) => journal.status === "in_progress")
      .map((journal) => `${journal.approvalKind}:${journal.sourceId}`),
  ), [approvalJournals]);
  const selectedOrganization = organizations.find((organization) => (
    organization.organizationId === selectedOrganizationId
  )) ?? organizations[0];
  const treasurePageCount = Math.ceil(TREASURE_CAPACITY / PAGE_SIZE);
  const selectedHierarchyNode = useMemo(() => {
    if (!selectedOrganization || !selectedHierarchyNodeId) return null;
    const visit = (branch: StoryOrganizationHierarchyNode): StoryOrganizationHierarchyNode | null => {
      if (branch.nodeId === selectedHierarchyNodeId) return branch;
      for (const child of branch.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(selectedOrganization.hierarchy);
  }, [selectedHierarchyNodeId, selectedOrganization]);
  const effectiveHierarchyNodeId = selectedHierarchyNode?.nodeId ?? null;
  const characterResult = useMemo(() => selectedOrganization
    ? organizationMemberPage({
        matrix,
        organization: selectedOrganization,
        page: characterPage,
        pageSize: PAGE_SIZE,
        hierarchyNodeId: effectiveHierarchyNodeId,
      })
    : { items: [], nextCursor: null, total: 0 }, [characterPage, effectiveHierarchyNodeId, matrix, selectedOrganization]);
  const characterItems = characterResult.items;
  const selectedMemberTotal = characterResult.total;
  const characterPageCount = Math.max(1, Math.ceil(selectedMemberTotal / PAGE_SIZE));
  const treasureItems = useMemo(() => treasureLibrary.page(treasurePage, PAGE_SIZE).items, [treasureLibrary, treasurePage]);
  const worldResult = useMemo(() => proceduralWorldPage({
    seed,
    topicId: worldTopicId || undefined,
    offset: worldPage * PAGE_SIZE,
    limit: PAGE_SIZE,
    context,
  }), [context, seed, worldPage, worldTopicId]);
  const worldItems = worldResult.items;

  useEffect(() => {
    let cancelled = false;
    const repository = createNovelRepository();
    const loadStoryState = async () => {
      const direct = project.storyStateId
        ? await repository.get<StoryState>("storyStates", project.storyStateId)
        : null;
      const state = direct ?? (await repository.list<StoryState>("storyStates", project.id))
        .sort((left, right) => right.revision - left.revision)[0]
        ?? null;
      if (!cancelled) setActiveStoryState(state);
    };
    void loadStoryState().catch(() => {
      if (!cancelled) setActiveStoryState(null);
    });
    return () => {
      cancelled = true;
    };
  }, [project]);

  useEffect(() => {
    if (project.proceduralRootSeed?.trim() || seedBackfillStarted.current) return;
    seedBackfillStarted.current = true;
    let cancelled = false;
    void ensureProjectProceduralRootSeed(createNovelRepository(), project)
      .then(async () => {
        if (!cancelled) await onChanged();
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          seedBackfillStarted.current = false;
          setMessage(`作品索引初始化失敗：${cause instanceof Error ? cause.message : "請重試"}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onChanged, project]);

  async function syncApprovedRelationships(
    repository: NovelRepository,
    requestId: string,
  ) {
    const canonicalCharacters = await repository.list<Character>(
      "characters",
      project.id,
    );
    const canonicalCharacterIds = new Set(
      canonicalCharacters.map((character) => character.id),
    );
    const existingRelationships = await repository.list<CharacterRelationship>(
      "relationships",
      project.id,
    );
    const byId = new Map(
      existingRelationships.map((relationship) => [relationship.id, relationship]),
    );

    for (const source of canonicalCharacters) {
      const profile = source.socialMatrixProfile;
      if (!profile) continue;
      const generated = matrix.getCharacter(profile.populationIndex);
      // Older or externally imported roots remain canonical, but cannot be
      // regenerated under a different root without fabricating evidence.
      if (generated.characterId !== profile.sourceCharacterId) continue;
      for (const relationship of generated.relationships) {
        if (!canonicalCharacterIds.has(relationship.targetCharacterId)) continue;
        const target = matrix.getCharacterById(relationship.targetCharacterId);
        if (!target) continue;
        // Undirected edges deliberately share one deterministic relationship
        // id in both character records. Store them once in population order so
        // approving the other endpoint later resumes instead of colliding.
        const canonicalFromCharacterId = !relationship.directed
          && profile.populationIndex > target.populationIndex
          ? relationship.targetCharacterId
          : source.id;
        const canonicalToCharacterId = !relationship.directed
          && profile.populationIndex > target.populationIndex
          ? source.id
          : relationship.targetCharacterId;
        const existing = byId.get(relationship.relationshipId);
        if (existing) {
          if (
            existing.fromCharacterId !== canonicalFromCharacterId
            || existing.toCharacterId !== canonicalToCharacterId
          ) {
            throw new Error("SOCIAL_RELATIONSHIP_CANON_ID_COLLISION");
          }
          continue;
        }
        const relationBase = makeRecord(project.id, "user");
        const saved = await repository.put<CharacterRelationship>(
          "relationships",
          {
            ...relationBase,
            id: relationship.relationshipId,
            provenance: { ...relationBase.provenance, requestId },
            fromCharacterId: canonicalFromCharacterId,
            toCharacterId: canonicalToCharacterId,
            kind: relationship.kind,
            summary: `${relationship.historyHook}；張力 ${relationship.tension}/100，義務 ${relationship.obligation}/100。`,
            trust: relationship.trust,
          },
        );
        byId.set(saved.id, saved);
      }
    }

    return [...byId.values()]
      .filter((relationship) =>
        canonicalCharacterIds.has(relationship.fromCharacterId)
        && canonicalCharacterIds.has(relationship.toCharacterId))
      .map((relationship) => relationship.id);
  }

  async function approveCharacter(character: StoryOrganizationMember) {
    const approvalKey = `character:${character.characterId}`;
    const linkedInEveryBible = storyBibles.every((storyBible) =>
      storyBible.characterIds.includes(character.characterId));
    if (
      (approvedIds.has(character.characterId)
        || approvedSocialIds.has(character.characterId))
      && linkedInEveryBible
      && !pendingApprovals.has(approvalKey)
    ) {
      setMessage(`「${character.name}」已經是這部作品的正式角色。`);
      return;
    }
    try {
      assertStoryStartedCanonMutationAllowed({
        storyStarted,
        mutation: "approve-social-character",
      });
    } catch {
      setMessage("故事已有正文；此處只能瀏覽組織名冊，不能再核准新正式角色、能力或持有鏈。請回首頁從既有正式人物中選擇上場角色。");
      return;
    }
    setBusyId(character.characterId);
    setMessage(`正在核准「${character.name}」及其持有鏈……`);
    try {
      const characterOrganization = organizations.find((organization) => (
        organization.organizationId === character.institutionId
      ));
      if (!characterOrganization) throw new Error("STORY_ORGANIZATION_MEMBERSHIP_MISSING");
      const repository = createNovelRepository();
      const proceduralRootSeed = await ensureProjectProceduralRootSeed(
        repository,
        project,
      );
      const journal = await beginSocialWorldApproval(repository, {
        projectId: project.id,
        approvalKind: "character",
        sourceId: character.characterId,
        proceduralRootSeed,
      });
      const now = new Date().toISOString();
      const candidate = await createSocialCharacterCandidate({
        projectId: project.id,
        matrix,
        populationIndex: character.populationIndex,
        proposedAt: now,
        proposedBy: "rule-fallback",
      });
      const { canonicalRecord, approval } = await approveSocialCharacterCandidate({
        candidate,
        expectedPayloadFingerprint: candidate.payloadFingerprint,
        approvedBy: "local-author",
        approvedAt: now,
      });
      const archetype = suggestCharacterRpgArchetype([
        character.identity,
        character.organizationRank,
        character.organizationUnit,
        ...canonicalRecord.abilities.specialties,
      ]);
      const base = makeRecord(project.id, "user");
      const nextCharacter: Character = {
        ...base,
        id: canonicalRecord.characterId,
        provenance: {
          ...base.provenance,
          requestId: candidate.candidateId,
        },
        name: canonicalRecord.name,
        aliases: [],
        identity: optionalValue(character.identity, "ai_accepted"),
        personality: optionalValue(
          `${canonicalRecord.personality.traits.join("、")}；${canonicalRecord.personality.publicFace}。內在需要：${canonicalRecord.personality.privateNeed}`,
          "ai_accepted",
        ),
        goal: optionalValue(canonicalRecord.goal, "ai_accepted"),
        lifeStatus: "alive",
        locationId: canonicalRecord.location,
        age: canonicalRecord.age,
        ageVerified: false,
        fears: [`失去${canonicalRecord.personality.privateNeed}`],
        privateSecrets: [canonicalRecord.secret],
        factionIds: [
          canonicalRecord.institutionId,
          canonicalRecord.familyId,
          character.hierarchyNodeId,
          `${canonicalRecord.institutionId}:faction:${character.organizationFaction}`,
        ],
        values: canonicalRecord.personality.traits,
        capabilities: [
          ...canonicalRecord.abilities.specialties,
          `${character.organizationUnit}／${character.organizationRank}`,
          ...topAbilities(canonicalRecord).map((ability) => `${ability.label} ${ability.value}`),
        ],
        limitations: [`情緒波動 ${canonicalRecord.personality.volatility}/100`, canonicalRecord.personality.privateNeed],
        portrait: {
          id: `portrait:${canonicalRecord.characterId}`,
          source: "procedural",
          assetUri: canonicalRecord.portrait.dataUrl,
          assetDigest: approval.payloadFingerprint,
          themeId: canonicalRecord.storyAffinity,
          themeLabel: "本作原創程序化人像",
          role: character.organizationRank,
          visualDescription: canonicalRecord.portrait.description,
          traits: canonicalRecord.personality.traits,
          generatedBy: "procedural-story-engine",
          approvedAt: now,
          approvedBy: "user",
          dataLeftDevice: false,
        },
        rpgProfile: createCharacterRpgProfile({
          archetype,
          stats: characterRpgStatsForArchetype(archetype),
          approvedAt: now,
        }),
        dynamicsProfile: personalityProfile({
          ...canonicalRecord,
          identity: character.identity,
          institutionRole: character.organizationRank,
        }),
        socialMatrixProfile: {
          schemaVersion: "novel-social-matrix-v1",
          sourceCharacterId: canonicalRecord.characterId,
          populationIndex: canonicalRecord.populationIndex,
          institutionId: canonicalRecord.institutionId,
          familyId: canonicalRecord.familyId,
          relationshipIds: canonicalRecord.relationships.map((relationship) => relationship.relationshipId),
          treasureIds: canonicalRecord.possessions.map((possession) => possession.treasureRef),
          candidateFingerprint: approval.payloadFingerprint,
          approvedAt: now,
          approvedBy: "user",
        },
        cultivationProfile: cultivationProfileForOrganizationMember({
          organization: characterOrganization,
          member: character,
          approvedAt: now,
        }),
        voiceStyle: {
          formality: canonicalRecord.personality.caution,
          directness: Math.max(10, 100 - canonicalRecord.personality.caution),
          emotionalExpressiveness: Math.max(10, canonicalRecord.personality.empathy),
          sentenceLength: canonicalRecord.abilities.strategy >= 65 ? "long" : "mixed",
          preferredAddressTerms: [],
        },
      };
      const existingCharacter = await repository.get<Character>(
        "characters",
        canonicalRecord.characterId,
      );
      if (
        existingCharacter
        && existingCharacter.socialMatrixProfile?.sourceCharacterId
          !== canonicalRecord.characterId
      ) {
        throw new Error("SOCIAL_CHARACTER_CANON_ID_COLLISION");
      }
      const savedCharacter = existingCharacter
        ?? await repository.put<Character>("characters", nextCharacter);
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "canonical-character",
        [savedCharacter.id],
      );

      const loreIds: string[] = [];
      for (const possession of canonicalRecord.possessions) {
        const treasure = organizationTreasureLibrary.at(possession.treasureOrdinal);
        const { lore } = await ensureTreasureLore(
          repository,
          project.id,
          treasure,
          journal.operationId,
          now,
        );
        loreIds.push(lore.id);
      }
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "owned-treasures",
        loreIds,
      );

      const relationshipIds = await syncApprovedRelationships(
        repository,
        journal.operationId,
      );
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "relationships",
        relationshipIds,
      );

      const updatedBibleIds: string[] = [];
      for (const storyBible of await repository.list<StoryBible>(
        "storyBibles",
        project.id,
      )) {
        const next = storyBibleWithCharacterApproval(storyBible, {
          characterId: savedCharacter.id,
          relationshipIds,
          loreIds,
        });
        if (storyBibleApprovalChanged(storyBible, next)) {
          await repository.put<StoryBible>(
            "storyBibles",
            next,
            storyBible.revision,
          );
        }
        updatedBibleIds.push(storyBible.id);
      }
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "story-bibles",
        updatedBibleIds,
      );
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "complete",
        [savedCharacter.id, ...loreIds, ...relationshipIds, ...updatedBibleIds],
        true,
      );
      setMessage(`已核准「${canonicalRecord.name}」：${characterOrganization.name}／${character.organizationUnit}／${character.organizationRank}身分、派系、人像、能力${characterOrganization.archetype === "sect" ? "與修煉檔案" : ""}及目前列出的 ${loreIds.length} 件持有物已保存；其他人物與寶物仍維持按需產生。`);
      await onChanged();
    } catch (cause) {
      setMessage(`核准失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusyId(null);
    }
  }

  async function approveTreasure(treasure: ProceduralTreasureRecord) {
    const approvalKey = `treasure:${treasure.id}`;
    const linkedInEveryBible = storyBibles.every((storyBible) =>
      storyBible.loreIds.includes(treasure.id));
    if (
      approvedTreasureIds.has(treasure.id)
      && linkedInEveryBible
      && !pendingApprovals.has(approvalKey)
    ) {
      setMessage(`「${treasure.name}」已經是這部作品的正式寶物。`);
      return;
    }
    setBusyId(treasure.id);
    setMessage(`正在核准「${treasure.name}」……`);
    try {
      const repository = createNovelRepository();
      const proceduralRootSeed = await ensureProjectProceduralRootSeed(
        repository,
        project,
      );
      const journal = await beginSocialWorldApproval(repository, {
        projectId: project.id,
        approvalKind: "treasure",
        sourceId: treasure.id,
        proceduralRootSeed,
      });
      const { lore } = await ensureTreasureLore(
        repository,
        project.id,
        treasure,
        journal.operationId,
        new Date().toISOString(),
      );
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "canonical-treasure",
        [lore.id],
      );
      const updatedBibleIds: string[] = [];
      for (const storyBible of await repository.list<StoryBible>(
        "storyBibles",
        project.id,
      )) {
        const next = storyBibleWithTreasureApproval(storyBible, lore.id);
        if (storyBibleApprovalChanged(storyBible, next)) {
          await repository.put<StoryBible>(
            "storyBibles",
            next,
            storyBible.revision,
          );
        }
        updatedBibleIds.push(storyBible.id);
      }
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "story-bibles",
        updatedBibleIds,
      );
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "complete",
        [lore.id, ...updatedBibleIds],
        true,
      );
      setMessage(`已核准「${treasure.name}」：寶物說明、固定持有人來源 ID 與十因果座標已保存；未顯示的寶物沒有寫入本作。`);
      await onChanged();
    } catch (cause) {
      setMessage(`寶物核准失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusyId(null);
    }
  }

  async function approveWorld(world: ProceduralWorld) {
    const approvalKey = `world:${world.id}`;
    const expectedRuleIds = world.rules.map((rule) => rule.id);
    const linkedInEveryBible = storyBibles.every((storyBible) =>
      storyBible.worldId === world.id
      && sameStrings(storyBible.worldRuleIds, expectedRuleIds));
    if (
      approvedWorldIds.has(world.id)
      && linkedInEveryBible
      && !pendingApprovals.has(approvalKey)
    ) {
      setMessage(`「${world.title}」已經是這部作品的正式世界。`);
      return;
    }
    try {
      assertStoryStartedCanonMutationAllowed({
        storyStarted,
        mutation: "approve-world",
      });
    } catch {
      setMessage("故事已有正文；世界資料庫只能瀏覽，不能再核准新正式世界或新時代。請回首頁選擇既有正式世界。");
      return;
    }
    setBusyId(world.id);
    setMessage(`正在核准「${world.title}」及五條世界規則……`);
    try {
      const repository = createNovelRepository();
      const proceduralRootSeed = await ensureProjectProceduralRootSeed(
        repository,
        project,
      );
      const journal = await beginSocialWorldApproval(repository, {
        projectId: project.id,
        approvalKind: "world",
        sourceId: world.id,
        proceduralRootSeed,
      });
      const now = new Date().toISOString();
      const worldBase = makeRecord(project.id, "user");
      const existingWorld = await repository.get<World>("worlds", world.id);
      const summary = [
        world.logline,
        `社會結構：${world.socialStructure.hierarchy}；${world.socialStructure.socialNorm}`,
        `主要勢力：${world.factions.map((faction) => `${faction.name}（${faction.publicGoal}）`).join("、")}`,
        `稀缺資源：${world.resources.map((resource) => resource.name).join("、")}`,
        `核心矛盾：${world.conflicts.map((conflict) => conflict.pressure).join("；")}`,
        `人物索引：${world.characters.map((character) => `${character.name}［${character.characterId}］`).join("、")}`,
        `寶物索引：${world.treasures.map((treasure) => `${treasure.name}→${treasure.holderCharacterName}`).join("、")}`,
        `情境索引：${world.relationshipScenario.scenarioId}`,
        `十因果維度：${world.causalDimensions.map((dimension) => `${dimension.label}=${dimension.signal}`).join("；")}`,
      ].join("\n\n");
      const nextWorld: World = {
        ...worldBase,
        id: world.id,
        provenance: {
          ...worldBase.provenance,
          requestId: journal.operationId,
        },
        name: optionalValue(world.title, "ai_accepted"),
        era: optionalValue(world.anchors.era, "ai_accepted"),
        summary: optionalValue(summary, "ai_accepted"),
        proceduralWorldProfile: {
          schemaVersion: "procedural-world-profile-v1",
          sourceWorldId: world.id,
          topicId: world.topic.topicId,
          topicOrdinal: world.topicOrdinal,
          worldOrdinal: world.worldOrdinal,
          relationshipScenarioId: world.relationshipScenario.scenarioId,
          characterIds: world.characters.map((character) => character.characterId),
          treasureIds: world.treasures.map((treasure) => treasure.treasureId),
          causalDimensionIds: world.causalDimensions.map((dimension) => dimension.id),
          approvedAt: now,
          approvedBy: "user",
        },
      };
      if (
        existingWorld
        && existingWorld.proceduralWorldProfile?.sourceWorldId !== world.id
      ) {
        throw new Error("PROCEDURAL_WORLD_CANON_ID_COLLISION");
      }
      const savedWorld = existingWorld
        ?? await repository.put<World>("worlds", nextWorld);
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "canonical-world",
        [savedWorld.id],
      );

      const ruleIds: string[] = [];
      for (const rule of world.rules) {
        const existingRule = await repository.get<WorldRule>("worldRules", rule.id);
        const ruleBase = makeRecord(project.id, "user");
        if (existingRule) {
          if (
            existingRule.provenance.requestId !== journal.operationId
            && existingRule.provenance.requestId
              !== world.relationshipScenario.scenarioId
            && existingRule.title !== rule.statement
          ) {
            throw new Error("PROCEDURAL_WORLD_RULE_CANON_ID_COLLISION");
          }
        } else {
          await repository.put<WorldRule>("worldRules", {
            ...ruleBase,
            id: rule.id,
            provenance: {
              ...ruleBase.provenance,
              requestId: journal.operationId,
            },
            title: rule.statement,
            description: `執行：${rule.enforcement}\n後果：${rule.consequence}\n例外：${rule.exception}`,
            immutable: true,
          });
        }
        ruleIds.push(rule.id);
      }
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "world-rules",
        ruleIds,
      );

      const updatedBibleIds: string[] = [];
      for (const storyBible of await repository.list<StoryBible>(
        "storyBibles",
        project.id,
      )) {
        const next = storyBibleWithWorldApproval(
          storyBible,
          savedWorld.id,
          ruleIds,
        );
        if (storyBibleApprovalChanged(storyBible, next)) {
          await repository.put<StoryBible>(
            "storyBibles",
            next,
            storyBible.revision,
          );
        }
        updatedBibleIds.push(storyBible.id);
      }
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "story-bibles",
        updatedBibleIds,
      );
      await checkpointSocialWorldApproval(
        repository,
        journal.operationId,
        "complete",
        [savedWorld.id, ...ruleIds, ...updatedBibleIds],
        true,
      );
      setMessage(`已核准「${world.title}」：正式世界與這個世界的 ${ruleIds.length} 條規則已保存並設為目前 Story Bible；人物、寶物與情境仍是按需索引，沒有整批寫入。`);
      await onChanged();
    } catch (cause) {
      setMessage(`世界核准失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusyId(null);
    }
  }

  function pageControls(kind: LibraryView) {
    const page = kind === "characters" ? characterPage : kind === "treasures" ? treasurePage : worldPage;
    const capacity = kind === "characters"
      ? selectedMemberTotal
      : kind === "treasures"
        ? TREASURE_CAPACITY
        : worldResult.totalItems;
    const pageCount = kind === "characters"
      ? characterPageCount
      : kind === "treasures"
        ? treasurePageCount
        : Math.ceil(worldResult.totalItems / PAGE_SIZE);
    const setPage = kind === "characters" ? setCharacterPage : kind === "treasures" ? setTreasurePage : setWorldPage;
    const label = kind === "characters" ? "組織人物" : kind === "treasures" ? "寶物" : "世界";
    return (
      <div className={styles.pageControls} aria-label={`${label}資料庫分頁`}>
        <button type="button" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>上一批</button>
        <span>第 {formatNumber(page * PAGE_SIZE + 1)}–{formatNumber(Math.min((page + 1) * PAGE_SIZE, capacity))} 筆</span>
        <button type="button" onClick={() => setPage(randomPage(capacity))}>換一批</button>
        <button type="button" onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}>下一批</button>
      </div>
    );
  }

  return (
    <section className={styles.library} data-testid="social-world-library">
      <div className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>STORY SOCIETY MATRIX · 同一作品種子</span>
          <h3>故事社會與寶物宇宙</h3>
          <p>人物不是空白名單。每個人都有派系、家族、目標、個性、能力、關係與持有物；只有你核准的項目才會成為正式作品資料。</p>
        </div>
        <div className={styles.seedBadge}><span>本作索引</span><strong>{matrix.seedTag.toUpperCase()}</strong></div>
      </div>

      <div className={styles.capacityGrid} aria-label="程序化故事容量">
        <div><strong>{formatNumber(PROCEDURAL_WORLD_TOPIC_CAPACITY)}</strong><span>經典題材</span></div>
        <div><strong>{formatNumber(PROCEDURAL_WORLD_VARIANTS_PER_TOPIC)}</strong><span>每類世界設定</span></div>
        <div><strong>{formatNumber(PROCEDURAL_WORLD_CAPACITY)}</strong><span>可定位世界</span></div>
        <div><strong>{formatNumber(CHARACTER_CAPACITY)}</strong><span>原創人物</span></div>
        <div><strong>{formatNumber(TREASURE_CAPACITY)}</strong><span>寶物與機緣</span></div>
        <div><strong>{formatNumber(SCENARIO_CAPACITY)}</strong><span>人寶情境</span></div>
        <div><strong>10</strong><span>因果維度</span></div>
      </div>
      <p className={styles.materializationNote}>採固定 ID 的按需索引：容量數字不是已儲存筆數；畫面只計算目前這一批，不會因資料庫擴大而把十萬筆全部載入記憶體。相同作品根種子會得到相同人物、關係與寶物持有人。</p>

      <div className={styles.viewTabs} role="tablist" aria-label="故事資料庫檢視">
        <button type="button" role="tab" aria-selected={view === "characters"} onClick={() => setView("characters")}>
          人物、派系與家族
          <small>原創人像 · 能力 · 關係 · 一鍵核准</small>
        </button>
        <button type="button" role="tab" aria-selected={view === "treasures"} onClick={() => setView("treasures")}>
          寶物、持有人與十因果
          <small>丹藥 · 武器 · 符 · 陣法 · 特殊機緣</small>
        </button>
        <button type="button" role="tab" aria-selected={view === "worlds"} onClick={() => setView("worlds")}>
          218 類題材世界庫
          <small>每類 1,000 個世界 · 派系 · 規則 · 人物寶物交叉</small>
        </button>
      </div>

      {message ? <div className={styles.message} role="status" data-testid="social-library-status">{message}</div> : null}
      {storyStarted ? (
        <div className={styles.message} role="status" data-testid="story-started-social-library-lock">
          故事已有正文：組織與世界資料庫仍可查閱，但不能在這裡新增正式角色、能力、持有鏈或世界。請回作品首頁，從既有正式人物與世界中選擇上場內容。
        </div>
      ) : null}

      {view === "characters" ? (
        <>
          <section className={styles.settingGate} data-testid="organization-setting-gate" data-era={organizationSetting.era}>
            <div>
              <span>STEP 1 · ERA &amp; BACKGROUND</span>
              <h4>先依故事時代與背景選組織</h4>
              <p>本區只建立符合目前作品脈絡的組織；人物要先隸屬一個組織，才會按需出現在下方名冊。</p>
            </div>
            <dl>
              <div><dt>時代</dt><dd>{organizationSetting.eraLabel}</dd></div>
              <div><dt>背景</dt><dd>{organizationSetting.backgroundLabel}</dd></div>
              <div><dt>依據世界</dt><dd>{organizationSetting.sourceWorldId ? `目前上場世界（${organizationSetting.sourceWorldId}）` : "尚未指定上場世界，使用作品背景"}</dd></div>
              <div><dt>跨時代</dt><dd>{organizationSetting.allowsCrossEra ? "作品已明示，可查看多時代組織" : "未啟用；不混入其他時代"}</dd></div>
            </dl>
          </section>

          <section className={styles.organizationBrowser} aria-labelledby="organization-browser-title">
            <div className={styles.organizationList} role="listbox" aria-label="符合時代與背景的組織">
              <div className={styles.organizationListHeading}>
                <span>STEP 2 · ORGANIZATION</span>
                <h4 id="organization-browser-title">選擇組織</h4>
                <p>每個組織最多一萬人，規模由作品種子固定；不會為了湊數灌滿。</p>
              </div>
              {organizations.map((organization) => {
                const selected = organization.organizationId === selectedOrganization?.organizationId;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? styles.organizationSelected : undefined}
                    data-testid={`select-organization-${organization.institutionIndex}`}
                    key={organization.organizationId}
                    onClick={() => {
                      setSelectedOrganizationId(organization.organizationId);
                      setSelectedHierarchyNodeId(null);
                      setCharacterPage(0);
                    }}
                  >
                    <span>{organization.kindLabel} · {organization.eraLabel} · {organization.sizeLabel}</span>
                    <b>{organization.name}</b>
                    <small>在籍 {formatNumber(organization.currentMemberCount)}／上限 {formatNumber(organization.memberCapacity)} 人</small>
                  </button>
                );
              })}
            </div>

            {selectedOrganization ? (
              <article className={styles.organizationDetail} data-testid="selected-organization" data-organization-id={selectedOrganization.organizationId}>
                <header>
                  <div><span>{selectedOrganization.kindLabel} · {selectedOrganization.eraLabel} · {selectedOrganization.sizeLabel}組織</span><h4>{selectedOrganization.name}</h4></div>
                  <strong>{formatNumber(selectedOrganization.currentMemberCount)}<small>人在籍／上限 {formatNumber(selectedOrganization.memberCapacity)}</small></strong>
                </header>
                <dl className={styles.organizationFacts}>
                  <div><dt>據點</dt><dd>{selectedOrganization.territory}</dd></div>
                  <div><dt>內部準則</dt><dd>{selectedOrganization.doctrine}</dd></div>
                  <div><dt>公開目標</dt><dd>{selectedOrganization.publicGoal}</dd></div>
                  <div><dt>內部矛盾</dt><dd>{selectedOrganization.hiddenConflict}</dd></div>
                </dl>
                <div className={styles.hierarchyHeading}><span>STEP 3 · HIERARCHY FILTER</span><h5>點選階層查看人物</h5><p>可直接查峰、堂、內外門、房系、事業群或部門；每個節點同時顯示實際在籍與編制上限。</p></div>
                <ul className={styles.hierarchyTree} data-testid="organization-hierarchy-tree">
                  <OrganizationHierarchyBranch
                    branch={selectedOrganization.hierarchy}
                    selectedNodeId={selectedHierarchyNodeId}
                    onSelect={(nodeId) => {
                      setSelectedHierarchyNodeId(nodeId);
                      setCharacterPage(0);
                    }}
                  />
                </ul>
              </article>
            ) : null}
          </section>

          <div className={styles.sectionHeading}>
            <div>
              <span>STEP 4 · MEMBERS ON DEMAND</span>
              <h4>{selectedOrganization?.name ?? "組織"}人物名冊{selectedHierarchyNode ? ` · ${selectedHierarchyNode.label}` : ""}</h4>
              {selectedHierarchyNode ? <button type="button" className={styles.clearHierarchyFilter} onClick={() => { setSelectedHierarchyNodeId(null); setCharacterPage(0); }}>查看全組織</button> : null}
            </div>
            {pageControls("characters")}
          </div>
          <div className={styles.characterGrid} data-testid="social-character-grid">
            {characterItems.map((character) => {
              const institutionIndex = Number.parseInt(character.institutionId.split(":").at(-1) ?? "0", 36);
              const familyIndex = Number.parseInt(character.familyId.split(":").at(-1) ?? "0", 36);
              const institution = matrix.getInstitution(institutionIndex);
              const family = matrix.getFamily(familyIndex);
              const hasCanonicalCharacter = approvedIds.has(character.characterId)
                || approvedSocialIds.has(character.characterId);
              const linkedInEveryBible = storyBibles.every((storyBible) =>
                storyBible.characterIds.includes(character.characterId));
              const isApproved = hasCanonicalCharacter
                && linkedInEveryBible
                && !pendingApprovals.has(`character:${character.characterId}`);
              return (
                <article className={styles.characterCard} key={character.characterId} data-character-id={character.characterId}>
                  <header>
                    {/* eslint-disable-next-line @next/next/no-img-element -- deterministic local SVG data URL */}
                    <img src={character.portrait.dataUrl} alt={`${character.name}的原創抽象人物相片`} />
                    <div><span>{character.abilities.powerTier} · {character.storyAffinity}</span><h5>{character.name}</h5><p>{character.identity}</p></div>
                  </header>
                  <div className={styles.affiliation}>
                    <span>{selectedOrganization?.kindLabel ?? institution.kind}</span><strong>{institution.name}</strong>
                    <span>峰堂／部門</span><strong>{character.organizationUnit}</strong>
                    <span>位階／職位</span><strong>{character.organizationRank}</strong>
                    <span>派系／房系</span><strong>{character.organizationFaction}</strong>
                    <span>家族／團隊</span><strong>{family.name}</strong>
                  </div>
                  <p className={styles.goal}><b>人物目標</b>{character.goal}</p>
                  <div className={styles.traits}>{character.personality.traits.map((trait) => <span key={trait}>{trait}</span>)}</div>
                  <div className={styles.abilities}>{topAbilities(character).map((ability) => <div key={ability.label}><span>{ability.label}</span><meter min="0" max="100" value={ability.value}>{ability.value}</meter><b>{ability.value}</b></div>)}</div>
                  <details><summary>關係與持有物</summary><p>{character.relationships.slice(0, 2).map((relationship) => `${relationship.kind}：${matrix.getCharacterById(relationship.targetCharacterId)?.name ?? "未知角色"}`).join("；")}</p><p>{character.possessions.length ? character.possessions.map((item) => `${item.ownership}「${item.name}」`).join("；") : "目前沒有已索引持有物"}</p></details>
                  <button
                    type="button"
                    className={styles.approveButton}
                    disabled={isApproved || storyStarted || busyId !== null}
                    onClick={() => void approveCharacter(character)}
                    data-testid={`approve-social-character-${character.populationIndex}`}
                  >
                    {isApproved ? "已核准為正式角色" : storyStarted ? "故事開始後請由首頁選擇既有人物" : busyId === character.characterId ? "正在核准持有鏈…" : "核准角色與持有鏈"}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      ) : view === "treasures" ? (
        <>
          <div className={styles.sectionHeading}>
            <div><span>TREASURE OWNERSHIP</span><h4>寶物與人物交叉矩陣</h4></div>
            {pageControls("treasures")}
          </div>
          <div className={styles.treasureGrid} data-testid="social-treasure-grid">
            {treasureItems.map((treasure) => {
              const linkedInEveryBible = storyBibles.every((storyBible) =>
                storyBible.loreIds.includes(treasure.id));
              const isApproved = approvedTreasureIds.has(treasure.id)
                && linkedInEveryBible
                && !pendingApprovals.has(`treasure:${treasure.id}`);
              return (
                <article className={styles.treasureCard} key={treasure.id} data-treasure-id={treasure.id}>
                  <header><span>{treasure.rarityLabel} · {treasure.kindLabel}</span><h5>{treasure.name}</h5><p>{treasure.subtype}</p></header>
                  <p>{treasure.storyHook}</p>
                  <dl><div><dt>固定索引持有人候選</dt><dd>{treasure.holder.characterName} · {treasure.holder.factionName}</dd></div><div><dt>主要能力</dt><dd>{treasure.abilities[0].name}：{treasure.abilities[0].effect}</dd></div><div><dt>不可忽略代價</dt><dd>{treasure.cost}</dd></div></dl>
                  <details><summary>查看十個因果維度</summary><ol>{treasure.causalDimensions.map((dimension) => <li key={dimension.id}><b>{dimension.label}</b><span>{dimension.signal}</span></li>)}</ol></details>
                  <button
                    type="button"
                    className={styles.approveButton}
                    disabled={isApproved || storyStarted || busyId !== null}
                    onClick={() => void approveTreasure(treasure)}
                    data-testid={`approve-treasure-${treasure.ordinal}`}
                  >
                    {isApproved ? "已核准為正式寶物" : busyId === treasure.id ? "正在核准寶物…" : "核准這件寶物"}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className={styles.sectionHeading}>
            <div><span>218 TOPICS · 218,000 WORLDS</span><h4>經典題材世界候選</h4></div>
            <label className={styles.topicFilter}>
              <span>題材篩選</span>
              <select
                value={worldTopicId}
                onChange={(event) => {
                  setWorldTopicId(event.target.value);
                  setWorldPage(0);
                }}
                data-testid="world-topic-filter"
              >
                <option value="">全部 218 類題材</option>
                {worldTopics.map((topic) => <option key={topic.topicId} value={topic.topicId}>{topic.name} · 1,000 個世界</option>)}
              </select>
            </label>
            {pageControls("worlds")}
          </div>
          <div className={styles.worldGrid} data-testid="procedural-world-grid">
            {worldItems.map((world) => {
              const expectedRuleIds = world.rules.map((rule) => rule.id);
              const linkedInEveryBible = storyBibles.every((storyBible) =>
                storyBible.worldId === world.id
                && sameStrings(storyBible.worldRuleIds, expectedRuleIds));
              const isApproved = approvedWorldIds.has(world.id)
                && linkedInEveryBible
                && !pendingApprovals.has(`world:${world.id}`);
              return (
                <article className={styles.worldCard} key={world.id} data-world-id={world.id}>
                  <header>
                    <span>{world.topic.name} · 世界 #{world.worldOrdinal + 1}</span>
                    <h5>{world.title}</h5>
                    <p>{world.anchors.era} · {world.anchors.geography}</p>
                  </header>
                  <p className={styles.worldLogline}>{world.logline}</p>
                  <div className={styles.worldMetrics}>
                    <span><b>{world.factions.length}</b>勢力</span>
                    <span><b>{world.rules.length}</b>規則</span>
                    <span><b>{world.characters.length}</b>主動人物</span>
                    <span><b>{world.treasures.length}</b>關鍵寶物</span>
                    <span><b>10</b>因果維度</span>
                  </div>
                  <dl className={styles.worldDetails}>
                    <div><dt>社會規則</dt><dd>{world.socialStructure.socialNorm}</dd></div>
                    <div><dt>主要矛盾</dt><dd>{world.conflicts[0].pressure}</dd></div>
                    <div><dt>人物 × 寶物</dt><dd>{world.treasures.map((treasure) => `${treasure.holderCharacterName}持有${treasure.name}`).join("；")}</dd></div>
                  </dl>
                  <details>
                    <summary>展開勢力、人物與十因果</summary>
                    <h6>四個自主勢力</h6>
                    <ul>{world.factions.map((faction) => <li key={faction.id}><b>{faction.name}</b>：{faction.publicGoal}；內部矛盾為{faction.internalContradiction}</li>)}</ul>
                    <h6>三名自主人物</h6>
                    <ul>{world.characters.map((character) => <li key={character.characterId}><b>{character.name}</b>：{character.agency}；拒絕條件為{character.refusalCondition}</li>)}</ul>
                    <h6>十因果座標</h6>
                    <ol>{world.causalDimensions.map((dimension) => <li key={dimension.id}><b>{dimension.label}</b><span>{dimension.signal}</span></li>)}</ol>
                  </details>
                  <button
                    type="button"
                    className={styles.approveButton}
                    disabled={isApproved || busyId !== null}
                    onClick={() => void approveWorld(world)}
                    data-testid={`approve-world-${world.globalOrdinal}`}
                  >
                    {isApproved ? "已核准為正式世界" : storyStarted ? "故事開始後請由首頁選擇既有世界" : busyId === world.id ? "正在核准世界與規則…" : "核准世界與五條規則"}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
