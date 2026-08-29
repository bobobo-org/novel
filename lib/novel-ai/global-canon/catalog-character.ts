import type { CharacterPortrait } from "../domain";
import type { CharacterMasteryProfile } from "../game/character-mastery-library";
import type { GlobalIndexedWorld } from "../game/global-world-index";
import type { SocialMatrixAbilities, SocialMatrixCharacter } from "../social-matrix";
import { createGlobalCharacter } from "./factories";
import { createGlobalCatalogCharacterAbilityProfile } from "./hero-abilities";
import type { GlobalCanonEraContext, GlobalCharacter } from "./types";

const ABILITY_LABELS: Record<keyof Omit<SocialMatrixAbilities, "powerTier" | "specialties">, string> = {
  cultivation: "修行",
  martial: "武力",
  strategy: "謀略",
  perception: "洞察",
  medicine: "醫藥",
  crafting: "技藝",
  leadership: "領導",
  influence: "影響力",
};

const ELEMENT_LABELS: Record<string, string> = {
  metal: "金",
  wood: "木",
  water: "水",
  fire: "火",
  earth: "土",
};

export const GLOBAL_CHARACTER_CATALOG_CAPACITY = 100_000;
export const GLOBAL_CHARACTER_CATALOG_PAGE_SIZE = 24;
export const GLOBAL_CHARACTER_CATALOG_VERSION = "global-character-catalog-v1" as const;

export function globalCatalogCharacterId(worldId: string, populationIndex: number) {
  if (!Number.isSafeInteger(populationIndex) || populationIndex < 0 || populationIndex >= GLOBAL_CHARACTER_CATALOG_CAPACITY) {
    throw new RangeError(`GLOBAL_CHARACTER_CATALOG_INDEX_INVALID:${populationIndex}`);
  }
  return `global-character:${worldId}:${String(populationIndex + 1).padStart(6, "0")}`;
}

export function globalCatalogCharacterNumber(populationIndex: number) {
  if (!Number.isSafeInteger(populationIndex) || populationIndex < 0 || populationIndex >= GLOBAL_CHARACTER_CATALOG_CAPACITY) {
    throw new RangeError(`GLOBAL_CHARACTER_CATALOG_INDEX_INVALID:${populationIndex}`);
  }
  return `第${String(populationIndex + 1).padStart(6, "0")}人物`;
}

export function globalCharacterEraContext(world: GlobalIndexedWorld): GlobalCanonEraContext {
  if (world.classification.id === "cultivation-sects") return "cultivation";
  if (world.era === "contemporary") return "modern";
  if (world.era === "historical") return "historical";
  if (world.era === "future") return "future";
  return "other";
}

function abilityEntries(abilities: SocialMatrixAbilities) {
  return (Object.keys(ABILITY_LABELS) as Array<keyof typeof ABILITY_LABELS>)
    .map((key) => ({ key, label: ABILITY_LABELS[key], value: abilities[key] }))
    .sort((left, right) => right.value - left.value);
}

export function globalCatalogCharacterAbilitySummary(character: SocialMatrixCharacter) {
  return abilityEntries(character.abilities)
    .slice(0, 3)
    .map((entry) => `${entry.label} ${entry.value}`)
    .join("、");
}

/** Converts one lazy catalog row into an editable global Canon record. */
export function createGlobalCharacterFromCatalog(input: {
  character: SocialMatrixCharacter;
  portrait: CharacterPortrait;
  world: GlobalIndexedWorld;
  mastery?: CharacterMasteryProfile;
}): GlobalCharacter {
  const { character, portrait, world, mastery } = input;
  const abilities = abilityEntries(character.abilities);
  const weakest = abilities.at(-1)!;
  const number = globalCatalogCharacterNumber(character.populationIndex);
  return createGlobalCharacter({
    name: character.name,
    aliases: [],
    identity: [character.identity, character.institutionRole, character.familyRole].filter(Boolean).join("；"),
    personality: [
      ...character.personality.traits,
      character.personality.publicFace,
      `內在需求：${character.personality.privateNeed}`,
    ].filter(Boolean).join("；"),
    goal: character.goal,
    lifeStatus: "alive",
    eraContext: globalCharacterEraContext(world),
    age: character.age,
    fears: [],
    privateSecrets: character.secret ? [character.secret] : [],
    factionIds: [character.institutionId, character.familyId],
    values: [
      ...character.personality.traits,
      character.personality.publicFace,
      character.familyRole,
      character.lifeStage,
    ].filter(Boolean),
    capabilities: [
      ...character.abilities.specialties,
      `力量層級：${character.abilities.powerTier}`,
      ...abilities.map((entry) => `${entry.label} ${entry.value}/100`),
      ...(mastery?.assignments.map((assignment) =>
        [
          `${assignment.relationLabel}${assignment.catalogLabel}「${assignment.name}」`,
          `時代 ${assignment.era}`,
          ...(assignment.element ? [`五行 ${ELEMENT_LABELS[assignment.element] ?? assignment.element}`] : []),
          `熟練 ${assignment.proficiency}/100`,
          `實效 ×${assignment.effectiveMultiplier.toFixed(2)}`,
        ].join("；")) ?? []),
    ],
    limitations: [
      `內在需求：${character.personality.privateNeed}`,
      `相對弱項：${weakest.label} ${weakest.value}/100`,
      ...(mastery?.assignments.map((assignment) =>
        `${assignment.name}限制：${assignment.limitation}；代價：${assignment.cost}`) ?? []),
    ],
    abilityProfile: createGlobalCatalogCharacterAbilityProfile({
      cultivation: character.abilities.cultivation,
      martial: character.abilities.martial,
      strategy: character.abilities.strategy,
      perception: character.abilities.perception,
      medicine: character.abilities.medicine,
      crafting: character.abilities.crafting,
      leadership: character.abilities.leadership,
      influence: character.abilities.influence,
    }),
    portrait,
  }, {
    id: globalCatalogCharacterId(world.id, character.populationIndex),
    provenance: {
      origin: "system_catalog",
      sourceLabel: `${world.displayId}・${number}`,
      sourceId: `${GLOBAL_CHARACTER_CATALOG_VERSION}:${world.schemaVersion}:${world.id}:${character.schemaVersion}:${character.characterId}`,
      rightsBasis: "系統原創程序人物；不對應真實人物或既有作品角色",
    },
  });
}
