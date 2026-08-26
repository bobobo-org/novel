import type { Character, CharacterPortraitAsset, NovelProject, World } from "../domain";
import { professionWorldContext, type ProfessionWorldContext } from "../game/character-profession";
import { CHARACTER_PORTRAIT_CATALOG } from "./catalog";

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
    ...character.aliases,
    character.identity.value,
    character.age === null || character.age === undefined ? null : `年齡${character.age}`,
    character.personality.value,
    character.goal.value,
    ...(character.values ?? []),
    ...(character.capabilities ?? []),
    ...(character.fears ?? []),
    ...(character.limitations ?? []),
    character.cultivationProfile?.sectRankId,
    character.cultivationProfile?.sectBranchId,
  ].filter(Boolean).join("｜");
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

function roleScore(portrait: CharacterPortraitAsset, signal: string) {
  const role = portrait.role.replace(/・.*$/u, "");
  if (signal.includes(role)) return 100;
  const chunks = role.match(/[\p{Script=Han}]{2,4}/gu) ?? [];
  return chunks.reduce((score, chunk) => score + (signal.includes(chunk) ? chunk.length * 5 : 0), 0);
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
  const basePortraits = CHARACTER_PORTRAIT_CATALOG.filter((portrait) => (
    portrait.themeId === themeId && portrait.visualVariant?.variant === 0
  ));
  const scored = basePortraits
    .map((portrait) => ({ portrait, score: roleScore(portrait, signal) }))
    .sort((left, right) => right.score - left.score);
  const bestScore = scored[0]?.score ?? 0;
  const eligible = bestScore > 0
    ? scored.filter((entry) => entry.score === bestScore).map((entry) => entry.portrait)
    : basePortraits;
  const seed = [input.project.id, input.character.id, signal, themeId].join("|");
  const base = eligible[stableHash(`${seed}|base`) % eligible.length] ?? CHARACTER_PORTRAIT_CATALOG[0]!;
  const variant = stableHash(`${seed}|variant`) % 100;
  return CHARACTER_PORTRAIT_CATALOG.find((portrait) => (
    portrait.id === `${base.id.replace(/-v\d{3}$/u, "")}-v${String(variant + 1).padStart(3, "0")}`
  )) ?? base;
}

export function characterEraContext(character: Character): ProfessionWorldContext | null {
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
  const signal = [world.name.value, world.era.value, world.summary.value]
    .filter(Boolean)
    .join("｜");
  if (/跨時代|跨时代|穿越|時間旅行|时间旅行|時空|时空/u.test(signal)) return "cross-era";
  if (/修仙|仙俠|仙侠|玄幻|宗門|宗门|靈根|灵根|劍修|剑修/u.test(signal)) return "cultivation";
  if (/未來|未来|星際|星际|星艦|星舰|太空|賽博|赛博|機甲|机甲|末日|廢土/u.test(signal)) return "future";
  if (/古代|歷史|历史|王朝|朝廷|宮廷|宫廷|江湖|武俠|武侠|民國|民国|蒸汽/u.test(signal)) return "historical";
  return "modern";
}

export function isCharacterEraCompatible(input: {
  character: Character;
  project: NovelProject;
  worlds: World[];
}) {
  const storyEra = input.worlds.length === 1
    ? worldEraContext(input.worlds[0]!)
    : professionWorldContext(input.project, input.worlds);
  if (storyEra === "cross-era") return true;
  const characterEra = characterEraContext(input.character);
  return characterEra === null || characterEra === storyEra;
}
