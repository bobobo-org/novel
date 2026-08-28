import type { CharacterPortraitAsset } from "../domain";

export const CHARACTER_PORTRAIT_CATALOG_VERSION = "character-portraits-v3-webp-10000" as const;
export const CHARACTER_PORTRAIT_CAPACITY = 10_000;

type PortraitTheme = {
  id: string;
  label: string;
  assetUri: string;
  assetDigest: string;
  width: number;
  height: number;
  roles: string[];
  moods: string[];
};

const THEMES: PortraitTheme[] = [
  {
    id: "xianxia",
    label: "仙俠武俠",
    assetUri: "/character-portraits/atlas-xianxia.webp",
    assetDigest: "bc55af201be0d0b4a4e6bfabf24c7166de93b7f1d3276a6f1f82e3d1bd4aa328",
    width: 1254,
    height: 1254,
    roles: ["玄門劍修", "靈花仙子", "白衣宗主", "赤甲女將", "北境俠客", "藥谷傳人", "暗衛統領", "冰湖聖女", "流浪刀客", "王朝貴女", "魔域少主", "山河策士"],
    moods: ["冷峻", "清雅", "克制", "果決", "滄桑", "溫柔", "沉著", "疏離", "堅毅", "高貴", "神秘", "睿智"],
  },
  {
    id: "modern-mystery",
    label: "現代懸疑",
    assetUri: "/character-portraits/atlas-modern-mystery.webp",
    assetDigest: "4236786a6e28a9bb03a7e8442b1242c96bfb8a93c3b7a80089407d5e321f4dcf",
    width: 1254,
    height: 1254,
    roles: ["刑警", "調查記者", "外科醫師", "律師", "畫家", "企業顧問", "資安專家", "運動員", "主廚", "大學教授", "音樂家", "私家偵探"],
    moods: ["銳利", "冷靜", "可靠", "自信", "敏感", "幹練", "專注", "堅定", "沉穩", "理性", "內斂", "警覺"],
  },
  {
    id: "western-fantasy",
    label: "歐美奇幻",
    assetUri: "/character-portraits/atlas-western-fantasy.webp",
    assetDigest: "91fb694935bd6eb789491c4d9d5637f3d791f9f2cc314d54a0e8d76fef193207",
    width: 1254,
    height: 1254,
    roles: ["王城騎士", "暗夜法師", "森林遊俠", "聖光治療師", "荒野盜賊", "北境貴族", "王室鍊金師", "吟遊詩人", "傭兵團長", "星象預言家", "古林德魯伊", "皇室近衛"],
    moods: ["英勇", "神秘", "敏銳", "慈悲", "危險", "驕傲", "專注", "灑脫", "強悍", "深邃", "莊嚴", "忠誠"],
  },
  {
    id: "scifi",
    label: "科幻未來",
    assetUri: "/character-portraits/atlas-scifi.webp",
    assetDigest: "554fa7d677f262a32fa3d6cdf4f21ae0269f5505ce5e81674e7cb52f2a49a055",
    width: 1448,
    height: 1086,
    roles: ["星艦艦長", "核心工程師", "仿生人", "前線醫官", "星際外交官", "賞金獵人", "殖民地科學家", "試飛員", "反抗軍領袖", "企業特務", "深空探險家", "人工智慧專家"],
    moods: ["鎮定", "務實", "純粹", "敏捷", "優雅", "不羈", "嚴謹", "果敢", "剛烈", "精算", "孤獨", "聰敏"],
  },
  {
    id: "historical-east-asia",
    label: "東亞歷史",
    assetUri: "/character-portraits/atlas-historical-east-asia.webp",
    assetDigest: "ce5fe631c06f0908338214ec4aee47b8c8960ebdc57ca06f906b5a1d95373c8b",
    width: 1024,
    height: 1536,
    roles: ["皇后", "翰林學士", "鎮國將軍", "女醫", "商會主人", "府尹", "工匠", "黑衣策士", "江湖旅人", "邊軍校尉", "世家公子", "客棧掌櫃"],
    moods: ["威儀", "儒雅", "剛毅", "溫婉", "世故", "公正", "樸實", "深沉", "灑脫", "忠勇", "矜貴", "親切"],
  },
  {
    id: "gothic-mystery",
    label: "哥德懸疑",
    assetUri: "/character-portraits/atlas-gothic-mystery.webp",
    assetDigest: "8286a93c85ccc2e437bee6aea1f5861059cfdfb7a5edd4d4eac9a0b22274427f",
    width: 1448,
    height: 1086,
    roles: ["祕術學者", "夜族貴族", "霧都偵探", "靈媒", "禁書檔案員", "受詛咒繼承人", "藥劑師", "驅魔神父", "古典教授", "神祕圖書館員", "面具義警", "荒原旅者"],
    moods: ["陰鬱", "危險", "警覺", "幽微", "寡言", "痛苦", "冷靜", "堅守", "執著", "疏離", "決絕", "不安"],
  },
  {
    id: "steampunk",
    label: "蒸汽龐克",
    assetUri: "/character-portraits/atlas-steampunk.webp",
    assetDigest: "818d8b5b13d6bc113ecc048beb1a94252d871535621bf9cdd363dc6d8ef4c9d8",
    width: 1448,
    height: 1086,
    roles: ["飛空艇艦長", "動力發明家", "機械師", "遺跡探險家", "新貴族", "情報間諜", "齒輪工程師", "鐘錶匠", "航路領航員", "戰地醫師", "工業反抗者", "自動機設計師"],
    moods: ["果敢", "執著", "精明", "好奇", "從容", "狡黠", "理性", "細膩", "沉著", "仁厚", "不屈", "狂熱"],
  },
  {
    id: "post-apocalypse",
    label: "末日生存",
    assetUri: "/character-portraits/atlas-post-apocalypse.webp",
    assetDigest: "d8116e2c99a1015614e9f7e6d66140edc54316a4da589c798dd1e9c0bcd54998",
    width: 1448,
    height: 1086,
    roles: ["聚落領袖", "救援醫護", "荒地斥候", "能源工程師", "復育農人", "物資談判者", "邊境巡守", "車隊技師", "病毒學家", "商隊護衛", "無線電員", "社區建築師"],
    moods: ["堅韌", "專注", "警戒", "務實", "溫暖", "圓融", "剛毅", "可靠", "嚴謹", "沉著", "敏銳", "希望"],
  },
  {
    id: "warm-contemporary",
    label: "都會情感",
    assetUri: "/character-portraits/atlas-warm-contemporary.webp",
    assetDigest: "740fe554f2bcb0761b5a7b0076da38b9d942e51b7f17eae7092eac06f0db060a",
    width: 1254,
    height: 1254,
    roles: ["書店主人", "建築師", "教師", "紀錄片導演", "花藝師", "創業者", "甜點師", "攝影師", "服裝設計師", "心理師", "旅行作家", "社區組織者"],
    moods: ["溫和", "清爽", "親切", "自信", "明亮", "穩重", "甜美", "自在", "熱情", "睿智", "開朗", "堅定"],
  },
];

export const CHARACTER_PORTRAIT_THEME_OPTIONS = THEMES.map(({ id, label }) => ({ id, label }));

function themePortraits(theme: PortraitTheme, themeIndex: number): CharacterPortraitAsset[] {
  const visibleCount = themeIndex < THEMES.length - 1 ? 11 : 12;
  return theme.roles.slice(0, visibleCount).map((role, index) => {
    const mood = theme.moods[index] ?? "鮮明";
    const number = String(index + 1).padStart(2, "0");
    return {
      id: `${theme.id}-${number}`,
      source: "catalog",
      assetUri: theme.assetUri,
      assetDigest: theme.assetDigest,
      atlas: {
        width: theme.width,
        height: theme.height,
        columns: 4,
        rows: 3,
        column: index % 4,
        row: Math.floor(index / 4),
      },
      themeId: theme.id,
      themeLabel: theme.label,
      role,
      visualDescription: `${theme.label}風格的${role}，呈現${mood}氣質的正面半身人物肖像。`,
      traits: [theme.label, role, mood, "成人角色", "半身肖像"],
      generatedBy: "openai-image-generation",
    };
  });
}
const BASE_CHARACTER_PORTRAIT_CATALOG = THEMES.flatMap(themePortraits);
const VARIANT_ACCENTS = ["晨光", "月影", "暖金", "青碧", "冷銀", "霞紅", "墨藍", "松綠", "紫霧", "素白"] as const;

function portraitVariant(portrait: CharacterPortraitAsset, baseIndex: number, variant: number) {
  const accent = VARIANT_ACCENTS[(baseIndex + variant) % VARIANT_ACCENTS.length];
  const hueRotate = ((variant * 17 + baseIndex * 7) % 31) - 15;
  const saturation = 0.9 + ((variant * 13 + baseIndex) % 21) / 100;
  const brightness = 0.94 + ((variant * 7 + baseIndex) % 13) / 100;
  const contrast = 0.94 + ((variant * 11 + baseIndex) % 15) / 100;
  return {
    ...portrait,
    id: `${portrait.id}-v${String(variant + 1).padStart(3, "0")}`,
    role: variant === 0 ? portrait.role : `${portrait.role}・${accent}型`,
    visualDescription: `${portrait.visualDescription} ${accent}配色與第 ${variant + 1} 組原創虛擬造型變體。`,
    traits: [...portrait.traits, accent, `造型變體 ${variant + 1}`],
    generatedBy: variant === 0 ? portrait.generatedBy : "procedural-story-engine",
    visualVariant: { variant, hueRotate, saturation, brightness, contrast, accentLabel: accent },
  };
}

// Browse base identities before their colour variants so an unfiltered page
// shows genuinely different people. The stable portrait IDs and deterministic
// assignment hashes are unchanged; only the discovery order is different.
export const CHARACTER_PORTRAIT_CATALOG: CharacterPortraitAsset[] = Array.from(
  { length: 100 },
  (_, variant) => BASE_CHARACTER_PORTRAIT_CATALOG.map(
    (portrait, baseIndex) => portraitVariant(portrait, baseIndex, variant),
  ),
).flat();

if (BASE_CHARACTER_PORTRAIT_CATALOG.length !== 100 || CHARACTER_PORTRAIT_CATALOG.length !== CHARACTER_PORTRAIT_CAPACITY) {
  throw new Error(`Character portrait catalog must contain 100 bases and ${CHARACTER_PORTRAIT_CAPACITY} virtual portraits; received ${BASE_CHARACTER_PORTRAIT_CATALOG.length}/${CHARACTER_PORTRAIT_CATALOG.length}.`);
}

export function filterCharacterPortraitCatalog(input: {
  themeId?: string;
  query?: string;
}) {
  const themeId = input.themeId?.trim() || "all";
  const terms = (input.query ?? "")
    .toLocaleLowerCase("zh-TW")
    .split(/[\s，。！？、；：,.!?;:]+/u)
    .filter(Boolean);
  return CHARACTER_PORTRAIT_CATALOG.filter((portrait) => {
    if (themeId !== "all" && portrait.themeId !== themeId) return false;
    if (!terms.length) return true;
    const haystack = [
      portrait.id,
      portrait.themeLabel,
      portrait.role,
      portrait.visualDescription,
      ...portrait.traits,
    ].join(" ").toLocaleLowerCase("zh-TW");
    return terms.every((term) => haystack.includes(term));
  });
}
