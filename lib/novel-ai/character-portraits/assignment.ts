import {
  makeRecord,
  optionalValue,
  type Character,
  type CharacterPortraitAsset,
  type NovelProject,
  type World,
} from "../domain";
import { professionWorldContext, type ProfessionWorldContext } from "../game/character-profession";
import type { SocialMatrixCharacter, StoryOrganizationMember } from "../social-matrix";
import {
  hasExplicitCrossEraSemanticSignal,
  type CrossEraCanonAuthorization,
} from "../domain/story-started-canon-guard";
import {
  CHARACTER_PORTRAIT_BASE_CATALOG,
  CHARACTER_PORTRAIT_CATALOG,
} from "./catalog";

const CHARACTER_PORTRAIT_BY_ID = new Map(
  CHARACTER_PORTRAIT_CATALOG.map((portrait) => [portrait.id, portrait] as const),
);
const BASE_CHARACTER_PORTRAITS_BY_THEME = new Map<string, CharacterPortraitAsset[]>();
const CHARACTER_PORTRAIT_VARIANTS_BY_BASE_ID = new Map<string, CharacterPortraitAsset[]>();
for (const portrait of CHARACTER_PORTRAIT_BASE_CATALOG) {
  const portraits = BASE_CHARACTER_PORTRAITS_BY_THEME.get(portrait.themeId) ?? [];
  portraits.push(portrait);
  BASE_CHARACTER_PORTRAITS_BY_THEME.set(portrait.themeId, portraits);
}
for (const portrait of CHARACTER_PORTRAIT_CATALOG) {
  const baseId = portrait.id.replace(/-v\d{3}$/u, "");
  const variants = CHARACTER_PORTRAIT_VARIANTS_BY_BASE_ID.get(baseId) ?? [];
  variants.push(portrait);
  CHARACTER_PORTRAIT_VARIANTS_BY_BASE_ID.set(baseId, variants);
}

const COMPATIBLE_PORTRAIT_THEME_GROUPS = [
  ["warm-contemporary", "modern-mystery"],
  ["xianxia", "historical-east-asia"],
  ["scifi", "post-apocalypse"],
  ["western-fantasy", "gothic-mystery", "steampunk"],
] as const;

function compatiblePortraitThemes(themeId: string) {
  return COMPATIBLE_PORTRAIT_THEME_GROUPS.find((group) => group.includes(themeId as never))
    ?? [themeId];
}

function greatestCommonDivisor(left: number, right: number) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b > 0) [a, b] = [b, a % b];
  return a;
}

function stablePermutationStep(scope: string, size: number) {
  if (size <= 1) return 1;
  const start = stableHash(`${scope}|portrait-step`) % size;
  for (let offset = 0; offset < size; offset += 1) {
    const candidate = (start + offset) % size || 1;
    if (greatestCommonDivisor(candidate, size) === 1) return candidate;
  }
  return 1;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function characterSignal(character: Character) {
  return [
    character.name,
    ...(character.aliases ?? []),
    character.identity?.value,
    character.age === null || character.age === undefined ? null : `年齡${character.age}`,
    character.personality?.value,
    character.goal?.value,
    ...(character.values ?? []),
    ...(character.capabilities ?? []),
    ...(character.fears ?? []),
    ...(character.limitations ?? []),
    character.cultivationProfile?.sectRankId,
    character.cultivationProfile?.sectBranchId,
    ...(character.portrait?.source === "procedural"
      ? [
          character.portrait.themeLabel,
          character.portrait.role,
          character.portrait.visualDescription,
          ...character.portrait.traits,
        ]
      : []),
  ].filter(Boolean).join("｜");
}

function portraitThemeFromSignal(signal: string) {
  if (/蒸汽|齒輪|飞艇|飛空艇|維多利亞/u.test(signal)) return "steampunk";
  if (/末日|廢土|灾变|災變|感染|生存/u.test(signal)) return "post-apocalypse";
  if (/哥德|吸血鬼|詛咒|诅咒|靈媒|灵媒|驅魔|驱魔/u.test(signal)) return "gothic-mystery";
  if (/西幻|歐美奇幻|骑士|騎士|法師|法师|精靈|精灵|德魯伊|德鲁伊/u.test(signal)) return "western-fantasy";
  if (/修仙|仙俠|仙侠|玄幻|宗門|宗门|靈根|灵根|劍修|剑修/u.test(signal)) return "xianxia";
  if (/未來|未来|星際|星际|太空|賽博|赛博|機甲|机甲|仿生|量子/u.test(signal)) return "scifi";
  if (/古代|歷史|历史|王朝|朝廷|宮廷|宫廷|江湖|武俠|武侠|民國|民国/u.test(signal)) return "historical-east-asia";
  if (/刑警|偵探|侦探|懸疑|悬疑|案件|律師|律师|記者|记者|鑑識|鉴识/u.test(signal)) return "modern-mystery";
  return "warm-contemporary";
}

function portraitTheme(input: {
  character: Character;
  project: NovelProject;
  worlds: World[];
}) {
  const signal = [
    characterSignal(input.character),
    input.project.genrePackId,
    input.project.genreId,
    input.project.subgenreId,
    input.project.coreIdea.value,
    ...input.worlds.flatMap((world) => [world.name.value, world.era.value, world.summary.value]),
  ].filter(Boolean).join("｜");
  return portraitThemeFromSignal(signal);
}

const NON_DISTINCTIVE_PORTRAIT_TERMS = new Set([
  "人物",
  "角色",
  "成人",
  "成年",
  "半身",
  "肖像",
  "造型",
  "變體",
  "風格",
]);

function semanticPortraitTokens(value: string) {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("zh-TW");
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,8}|[a-z][a-z0-9-]{2,}/gu)) {
    const chunk = match[0]!;
    if (/^[a-z]/u.test(chunk)) {
      if (!NON_DISTINCTIVE_PORTRAIT_TERMS.has(chunk)) tokens.add(chunk);
      continue;
    }
    for (const size of [4, 3, 2]) {
      if (chunk.length < size) continue;
      for (let index = 0; index <= chunk.length - size; index += 1) {
        const token = chunk.slice(index, index + size);
        if (!NON_DISTINCTIVE_PORTRAIT_TERMS.has(token)) tokens.add(token);
      }
    }
  }
  return [...tokens];
}

function roleScore(portrait: CharacterPortraitAsset, signal: string) {
  const normalizedSignal = signal.normalize("NFKC").toLocaleLowerCase("zh-TW");
  const role = portrait.role.replace(/・.*$/u, "").normalize("NFKC").toLocaleLowerCase("zh-TW");
  let score = normalizedSignal.includes(role) ? 120 : 0;
  for (const token of semanticPortraitTokens(role)) {
    if (normalizedSignal.includes(token)) score += token.length * 6;
  }
  const descriptiveTraits = portrait.traits.filter((trait) => (
    trait !== portrait.themeLabel
    && trait !== role
    && !/^造型變體\s*\d+$/u.test(trait)
    && !NON_DISTINCTIVE_PORTRAIT_TERMS.has(trait)
  ));
  for (const trait of descriptiveTraits) {
    const normalizedTrait = trait.normalize("NFKC").toLocaleLowerCase("zh-TW");
    if (normalizedSignal.includes(normalizedTrait)) {
      score += 28;
      continue;
    }
    for (const token of semanticPortraitTokens(normalizedTrait)) {
      if (normalizedSignal.includes(token)) score += token.length * 2;
    }
  }
  return score;
}

/**
 * Chooses a real atlas portrait for catalog-only characters that do not yet
 * belong to a project.  The stable id keeps the same face and colour variant
 * across reloads; the signal keeps role, era and world style aligned.
 */
export function suggestedCatalogCharacterPortrait(input: {
  stableId: string;
  signal: string;
  preferredThemeId?: string;
  /**
   * Stable position in a canonical population. When supplied, selection walks
   * every era-compatible base face before reusing one. It must never be a page
   * or filtered-list index, otherwise the same person would change faces.
   */
  diversityOrdinal?: number;
  /** Stable world/project scope shared by characters in the same population. */
  diversityScope?: string;
}): CharacterPortraitAsset {
  const themeId = input.preferredThemeId?.trim() || portraitThemeFromSignal(input.signal);
  const basePortraits = BASE_CHARACTER_PORTRAITS_BY_THEME.get(themeId)
    ?? BASE_CHARACTER_PORTRAITS_BY_THEME.get("warm-contemporary")
    ?? [];
  if (Number.isSafeInteger(input.diversityOrdinal) && (input.diversityOrdinal ?? -1) >= 0) {
    const themeIds = compatiblePortraitThemes(themeId);
    const compatibleBases = themeIds.flatMap(
      (compatibleThemeId) => BASE_CHARACTER_PORTRAITS_BY_THEME.get(compatibleThemeId) ?? [],
    );
    const pool = compatibleBases.length > 0 ? compatibleBases : basePortraits;
    const ordinal = input.diversityOrdinal!;
    const scope = input.diversityScope?.trim() || input.stableId;
    const poolKey = themeIds.join("+");
    const rotation = stableHash(`${scope}|${poolKey}|portrait-rotation`) % pool.length;
    const step = stablePermutationStep(`${scope}|${poolKey}`, pool.length);
    const base = pool[(rotation + ordinal * step) % pool.length] ?? CHARACTER_PORTRAIT_BASE_CATALOG[0]!;
    const variants = CHARACTER_PORTRAIT_VARIANTS_BY_BASE_ID.get(base.id) ?? [base];
    const cycle = Math.floor(ordinal / pool.length);
    const variantOffset = stableHash(`${scope}|${base.id}|portrait-variant`) % variants.length;
    return variants[(variantOffset + cycle) % variants.length] ?? base;
  }
  const scored = basePortraits
    .map((portrait) => ({ portrait, score: roleScore(portrait, input.signal) }))
    .sort((left, right) => right.score - left.score);
  const bestScore = scored[0]?.score ?? 0;
  const eligible = bestScore > 0
    ? scored.filter((entry) => entry.score === bestScore).map((entry) => entry.portrait)
    : basePortraits;
  const seed = `${input.stableId}|${input.signal}|${themeId}`;
  const base = eligible[stableHash(`${seed}|base`) % eligible.length] ?? CHARACTER_PORTRAIT_CATALOG[0]!;
  const baseId = base.id.replace(/-v\d{3}$/u, "");
  const variants = CHARACTER_PORTRAIT_VARIANTS_BY_BASE_ID.get(baseId) ?? [base];
  return variants[stableHash(`${seed}|variant`) % variants.length]
    ?? CHARACTER_PORTRAIT_BY_ID.get(base.id)
    ?? base;
}

export function suggestedCharacterPortrait(input: {
  character: Character;
  project: NovelProject;
  worlds: World[];
}): CharacterPortraitAsset {
  if (input.character.portrait && input.character.portrait.source !== "procedural") {
    return input.character.portrait;
  }
  const themeId = portraitTheme(input);
  const signal = characterSignal(input.character);
  return suggestedCatalogCharacterPortrait({
    stableId: `${input.project.id}|${input.character.id}`,
    signal,
    preferredThemeId: themeId,
  });
}

type PortraitReadySocialMatrixCharacter = SocialMatrixCharacter & Partial<Pick<
  StoryOrganizationMember,
  "organizationUnit" | "organizationRank" | "organizationFaction"
>>;

function socialMatrixPortraitCharacter(
  projectId: string,
  character: PortraitReadySocialMatrixCharacter,
): Character {
  const base = makeRecord(projectId, "system");
  const organizationSignals = [
    character.storyAffinity,
    character.institutionRole,
    character.organizationUnit,
    character.organizationRank,
    character.organizationFaction,
    character.familyRole,
  ].filter((value): value is string => Boolean(value));
  return {
    ...base,
    id: character.characterId,
    name: character.name,
    aliases: [],
    identity: optionalValue(
      [character.identity, ...organizationSignals].join("；"),
      "inferred",
    ),
    personality: optionalValue(
      [
        ...character.personality.traits,
        character.personality.publicFace,
        character.personality.privateNeed,
      ].filter(Boolean).join("；"),
      "inferred",
    ),
    goal: optionalValue(character.goal, "inferred"),
    lifeStatus: "alive",
    locationId: character.location || null,
    age: character.age,
    ageVerified: false,
    factionIds: [character.institutionId, character.familyId],
    values: [
      ...character.personality.traits,
      character.pronouns,
      character.lifeStage,
      character.familyRole,
    ],
    capabilities: [
      ...character.abilities.specialties,
      ...organizationSignals,
    ],
    limitations: [character.personality.privateNeed],
  };
}

export function suggestedSocialMatrixCharacterPortrait(input: {
  character: PortraitReadySocialMatrixCharacter;
  approvedCharacter?: Character | null;
  project: NovelProject;
  worlds: World[];
}): CharacterPortraitAsset {
  const approvedCharacter = input.approvedCharacter?.id === input.character.characterId
    || input.approvedCharacter?.socialMatrixProfile?.sourceCharacterId === input.character.characterId
    ? input.approvedCharacter
    : null;
  return suggestedCharacterPortrait({
    character: approvedCharacter ?? socialMatrixPortraitCharacter(input.project.id, input.character),
    project: input.project,
    worlds: input.worlds,
  });
}

export function characterEraContext(character: Character): ProfessionWorldContext | null {
  const explicitEra = character.eraContext;
  if (
    explicitEra === "modern"
    || explicitEra === "historical"
    || explicitEra === "cultivation"
    || explicitEra === "future"
    || explicitEra === "cross-era"
  ) {
    return explicitEra;
  }
  const signal = [
    characterSignal(character),
    character.portrait?.themeId,
  ].filter(Boolean).join("｜");
  if (/修仙|仙俠|仙侠|玄幻|宗門|宗门|靈根|灵根|劍修|剑修|xianxia/u.test(signal)) return "cultivation";
  if (/未來|未来|星際|星际|星艦|星舰|太空|賽博|赛博|機甲|机甲|scifi|post-apocalypse/u.test(signal)) return "future";
  if (/古代|歷史|历史|王朝|朝廷|宮廷|宫廷|江湖|武俠|武侠|historical-east-asia|steampunk/u.test(signal)) return "historical";
  if (/現代|现代|公司|企業|企业|律師|律师|醫師|医师|教師|教师|記者|记者|modern-mystery|warm-contemporary/u.test(signal)) return "modern";
  return null;
}

export function worldEraContext(world: World): ProfessionWorldContext {
  const explicitEra = (world as World & { eraContext?: string }).eraContext;
  if (
    explicitEra === "modern"
    || explicitEra === "historical"
    || explicitEra === "cultivation"
    || explicitEra === "future"
    || explicitEra === "cross-era"
  ) {
    return explicitEra;
  }
  const signal = [world.name.value, world.era.value, world.summary.value]
    .filter(Boolean)
    .join("｜");
  if (hasExplicitCrossEraSemanticSignal(signal)) return "cross-era";
  if (/修仙|仙俠|仙侠|玄幻|宗門|宗门|靈根|灵根|劍修|剑修/u.test(signal)) return "cultivation";
  if (/未來|未来|星際|星际|星艦|星舰|太空|賽博|赛博|機甲|机甲|末日|廢土/u.test(signal)) return "future";
  if (/古代|歷史|历史|王朝|朝廷|宮廷|宫廷|江湖|武俠|武侠|民國|民国|蒸汽/u.test(signal)) return "historical";
  return "modern";
}

export function isCharacterEraCompatible(input: {
  character: Character;
  project: NovelProject;
  worlds: World[];
  /**
   * Story-stage callers pass the result of
   * explicitCrossEraCanonAuthorization.  Omitting it preserves legacy
   * read-only consumers, while an explicitly supplied false authorization
   * fail-closes cross-era staging.
   */
  crossEraAuthorization?: CrossEraCanonAuthorization;
}) {
  const storyEra = input.worlds.length === 1
    ? worldEraContext(input.worlds[0]!)
    : professionWorldContext(input.project, input.worlds);
  const characterEra = characterEraContext(input.character);
  if (characterEra === null) return true;
  const validCrossEraAuthorization = input.crossEraAuthorization?.authorized === true
    && input.crossEraAuthorization.sources.length > 0;
  if (storyEra === "cross-era") {
    return input.crossEraAuthorization === undefined
      ? true
      : validCrossEraAuthorization;
  }
  if (characterEra === storyEra) return true;
  return validCrossEraAuthorization;
}
