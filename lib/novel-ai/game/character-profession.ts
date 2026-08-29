import type { NovelProject, World } from "../domain";
import { hasExplicitCrossEraSemanticSignal } from "../domain/story-started-canon-guard";

export const CULTIVATION_PROFESSIONS = [
  "劍士", "劍修", "刀修", "體修", "煉丹師", "符師", "陣法師", "煉器師",
  "靈植師", "馭獸師", "醫修", "宗門執事", "護法", "長老", "散修", "坊市掌櫃",
] as const;

export const MODERN_PROFESSIONS = [
  "律師", "醫生", "會計師", "保險業務員", "教師", "記者", "工程師", "警察",
  "企業主管", "創業者", "行銷企劃", "社工", "心理師", "演員", "導演", "編劇",
  "經紀人", "製作人", "攝影師", "剪輯師", "親密協調員",
] as const;

export const HISTORICAL_PROFESSIONS = [
  "文官", "武將", "謀士", "捕快", "仵作", "郎中", "鏢師", "帳房", "掌櫃", "商賈",
  "工匠", "織造師", "船運管事", "農師", "樂師", "畫師", "史官", "女官", "侍衛", "驛使",
] as const;

export const FUTURE_PROFESSIONS = [
  "星艦領航員", "機甲駕駛員", "人工智慧倫理師", "仿生工程師", "太空醫師", "資料考古學家",
  "殖民地規劃師", "量子通訊員", "氣候工程師", "軌道物流師", "安全分析師", "異星生態學家",
] as const;

export const SHARED_PROFESSIONS = ["工匠"] as const;

export const MODERN_ORGANIZATION_CATALOG = [
  { id: "modern.company", name: "公司／企業集團", roles: ["董事長", "執行長", "部門主管", "專案經理", "專業職員", "外部顧問"], strategicAssets: "資金、股權、客戶、供應鏈、專利與商譽" },
  { id: "modern.family-business", name: "家族企業／財團", roles: ["家主", "接班人", "家族董事", "事業部負責人", "家族律師", "受託人"], strategicAssets: "家族持股、信託、婚姻聯盟、政商人脈與繼承順位" },
  { id: "modern.faction", name: "勢力／幫會／社群組織", roles: ["領袖", "副手", "堂主", "骨幹", "聯絡人", "外圍成員"], strategicAssets: "地盤、情報、人脈、聲望、忠誠與行動網絡" },
  { id: "modern.government", name: "政府／公共機構", roles: ["首長", "政務官", "主管", "承辦人", "專業幕僚", "外部委員"], strategicAssets: "法定權限、預算、政策、執照、調查與公共信任" },
  { id: "modern.country", name: "國家／跨國陣營", roles: ["國家領導人", "外交官", "軍政官員", "情報人員", "商務代表", "民間使者"], strategicAssets: "領土、外交、軍力、貿易、情報與國際承諾" },
] as const;

export const HISTORICAL_ORGANIZATION_CATALOG = [
  { id: "historical.clan", name: "宗族／世家", roles: ["家主", "宗子", "族老", "房主", "管事", "門客"], strategicAssets: "田產、商號、族譜、婚盟、門生與祖傳技藝" },
  { id: "historical.court", name: "朝廷／官署", roles: ["君主", "宰輔", "官員", "將領", "幕僚", "差役"], strategicAssets: "官位、兵權、稅賦、法令、糧道與地方聲望" },
  { id: "historical.guild", name: "商會／行會", roles: ["會首", "東家", "掌櫃", "帳房", "師傅", "學徒"], strategicAssets: "商路、貨源、船隊、票號、工藝與同業承諾" },
  { id: "historical.school", name: "書院／學派", roles: ["山長", "祭酒", "先生", "門生", "藏書官", "贊助人"], strategicAssets: "典籍、科名、師承、門生網絡與輿論名望" },
] as const;

export const FUTURE_ORGANIZATION_CATALOG = [
  { id: "future.megacorp", name: "跨星企業／財團", roles: ["董事長", "執行官", "殖民地主任", "研發主管", "安全官", "契約人員"], strategicAssets: "軌道資產、專利、算力、能源、航道與殖民許可" },
  { id: "future.alliance", name: "星際聯盟／政體", roles: ["議長", "艦隊司令", "外交使節", "區域總督", "情報官", "公民代表"], strategicAssets: "行星、艦隊、條約、通訊網、資源配額與公民信任" },
  { id: "future.collective", name: "研究共同體／自治群落", roles: ["首席研究員", "倫理委員", "工程主管", "醫療官", "資料保管員", "居民代表"], strategicAssets: "研究資料、核心模型、培養艙、生態系統與自治協議" },
] as const;

export type ProfessionWorldContext = "cultivation" | "modern" | "historical" | "future" | "cross-era";

function professionCatalogForContext(context: ProfessionWorldContext) {
  const catalog = context === "cultivation"
    ? CULTIVATION_PROFESSIONS
    : context === "historical"
      ? HISTORICAL_PROFESSIONS
      : context === "future"
        ? [...FUTURE_PROFESSIONS, ...MODERN_PROFESSIONS]
        : context === "modern"
          ? MODERN_PROFESSIONS
          : [...CULTIVATION_PROFESSIONS, ...HISTORICAL_PROFESSIONS, ...MODERN_PROFESSIONS, ...FUTURE_PROFESSIONS];
  return [...new Set([...catalog, ...SHARED_PROFESSIONS])];
}

function projectWorldSignal(project: NovelProject, worlds: World[]) {
  return normalizeWorldEraSignal([
    project.genrePackId,
    project.genreId,
    project.subgenreId,
    project.coreIdea.value,
    ...worlds.flatMap((world) => [world.name.value, world.era.value, world.summary.value]),
  ].filter(Boolean).join(" "));
}

/**
 * Older identity-overlay worlds explicitly said that the host setting would
 * not be rewritten into a cultivation story.  That negated disclosure is not
 * evidence that the story itself is cultivation, so remove it before the era
 * keyword classifier runs.  Keep this compatibility normalizer even after the
 * source copy changes because existing IndexedDB projects retain the old text.
 */
export function normalizeWorldEraSignal(signal: string) {
  return signal
    .replace(/(?:不會|不会)被(?:自動|自动)(?:改寫|改写)成修仙故事/gu, "")
    .replace(/不(?:改寫|改写)修仙\s*Canon/giu, "");
}

export function professionWorldContext(project: NovelProject, worlds: World[]): ProfessionWorldContext {
  const signal = projectWorldSignal(project, worlds);
  if (hasExplicitCrossEraSemanticSignal(signal)) {
    return "cross-era";
  }
  if (/修仙|仙俠|仙侠|玄幻|宗門|宗门|靈根|灵根|煉氣|炼气|築基|筑基|金丹|元嬰|元婴|渡劫|飛升|飞升/u.test(signal)) {
    return "cultivation";
  }
  if (/未來|未来|星際|星际|太空|宇宙殖民|賽博|赛博|機甲|机甲|人工智慧|量子|星艦|星舰/u.test(signal)) {
    return "future";
  }
  if (/古代|歷史|历史|王朝|朝廷|宮廷|宫廷|江湖|武俠|武侠|民國|民国|書院|书院|科舉|科举|鏢局|镖局/u.test(signal)) {
    return "historical";
  }
  return "modern";
}

export function professionSuggestions(project: NovelProject, worlds: World[]) {
  const context = professionWorldContext(project, worlds);
  return professionCatalogForContext(context);
}

function professionTermSpans(value: string, profession: string) {
  const spans: Array<{ start: number; end: number }> = [];
  let offset = 0;
  while (offset < value.length) {
    const start = value.indexOf(profession, offset);
    if (start < 0) break;
    spans.push({ start, end: start + profession.length });
    offset = start + profession.length;
  }
  return spans;
}

export function professionContinuityError(
  value: string,
  project: NovelProject,
  worlds: World[],
) {
  const context = professionWorldContext(project, worlds);
  const normalizedValue = value.trim();
  if (context === "cross-era" || !normalizedValue) return null;
  const currentWorldTermSpans = professionCatalogForContext(context)
    .filter((profession) => !SHARED_PROFESSIONS.includes(profession as typeof SHARED_PROFESSIONS[number]))
    .flatMap((profession) => professionTermSpans(normalizedValue, profession));
  const otherWorldTerms = context === "cultivation"
    ? [...MODERN_PROFESSIONS, ...HISTORICAL_PROFESSIONS, ...FUTURE_PROFESSIONS]
    : context === "historical"
      ? [...MODERN_PROFESSIONS, ...CULTIVATION_PROFESSIONS, ...FUTURE_PROFESSIONS]
      : context === "future"
        ? [...CULTIVATION_PROFESSIONS, ...HISTORICAL_PROFESSIONS]
        : [...CULTIVATION_PROFESSIONS, ...HISTORICAL_PROFESSIONS, ...FUTURE_PROFESSIONS];
  const collision = otherWorldTerms
    .filter((profession) => !SHARED_PROFESSIONS.includes(profession as typeof SHARED_PROFESSIONS[number]))
    .flatMap((profession) => professionTermSpans(normalizedValue, profession).map((span) => ({ profession, ...span })))
    .filter((foreignSpan) => !currentWorldTermSpans.some((allowedSpan) => (
      allowedSpan.start <= foreignSpan.start && allowedSpan.end >= foreignSpan.end
    )))
    .sort((left, right) => right.profession.length - left.profession.length || left.start - right.start)[0]?.profession;
  if (!collision) return null;
  const contextLabel = context === "cultivation" ? "修仙" : context === "historical" ? "古代／歷史" : context === "future" ? "未來" : "現代";
  return `「${collision}」不屬於目前的${contextLabel}職業庫。若要保留，請先在世界前提明確設定穿越或跨時代。`;
}

export function professionValueChanged(value: string, previousValue?: string | null) {
  return value.trim() !== (previousValue?.trim() ?? "");
}

export function professionChangeValidationError({
  value,
  previousValue,
  isNew,
  project,
  worlds,
  currentCharacterId,
  professionHolders = [],
}: {
  value: string;
  previousValue?: string | null;
  isNew: boolean;
  project: NovelProject;
  worlds: World[];
  currentCharacterId?: string | null;
  professionHolders?: ReadonlyArray<{
    id: string;
    name: string;
    profession?: string | null;
  }>;
}) {
  const normalizedProfession = value.trim();
  if (!isNew && !professionValueChanged(value, previousValue)) return null;

  const continuityError = professionContinuityError(normalizedProfession, project, worlds);
  if (continuityError) return continuityError;

  const duplicateProfession = normalizedProfession
    ? professionHolders.find((holder) => (
        holder.id !== currentCharacterId
        && holder.profession?.trim() === normalizedProfession
      ))
    : null;
  if (!duplicateProfession) return null;
  return `「${normalizedProfession}」已由${duplicateProfession.name}擔任；請替每位人物安排不同職業或專長。`;
}
