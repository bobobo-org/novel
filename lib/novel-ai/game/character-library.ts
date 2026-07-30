export const RPG_CHARACTER_LIBRARY_SCHEMA = "novel-rpg-character-library-v1" as const;
export const RPG_CHARACTER_LIBRARY_STORAGE_KEY = "novel:rpg-character-library:v1";

export type RpgCharacterTemplate = {
  schemaVersion: typeof RPG_CHARACTER_LIBRARY_SCHEMA;
  templateId: string;
  name: string;
  archetype: string;
  identity: string;
  personality: string;
  goal: string;
  fears: string[];
  values: string[];
  capabilities: string[];
  limitations: string[];
  createdAt: string;
  builtin: boolean;
};

export const BUILTIN_RPG_CHARACTERS: RpgCharacterTemplate[] = [
  {
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    templateId: "builtin-starfire-swordswoman",
    name: "燼星",
    archetype: "背負代價的劍士",
    identity: "失去故鄉、仍守護陌生人的流浪劍士",
    personality: "冷靜寡言，遇到弱者受傷時會不計代價出手",
    goal: "查明故鄉毀滅的真相，並阻止同樣的悲劇重演",
    fears: ["再次失去同伴", "自己的力量失控"],
    values: ["承諾", "保護", "真相"],
    capabilities: ["近身戰鬥", "危機判斷", "承受壓力"],
    limitations: ["不擅長求助", "容易獨自承擔代價"],
    createdAt: "2026-01-01T00:00:00.000Z",
    builtin: true,
  },
  {
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    templateId: "builtin-forbidden-scholar",
    name: "墨衡",
    archetype: "禁書學者",
    identity: "能讀懂被抹除歷史、卻被各方追捕的研究者",
    personality: "說話精準克制，對未知充滿近乎危險的好奇",
    goal: "重建被改寫的世界歷史",
    fears: ["記憶遭到竄改", "知識害死無辜者"],
    values: ["證據", "自由意志", "知識責任"],
    capabilities: ["古文解析", "推理", "法則研究"],
    limitations: ["體力薄弱", "不容易信任直覺"],
    createdAt: "2026-01-01T00:00:00.000Z",
    builtin: true,
  },
  {
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    templateId: "builtin-many-faced-broker",
    name: "千面",
    archetype: "情報商與關係操盤者",
    identity: "在敵對勢力之間販售消息、從不交出全部真相的中間人",
    personality: "幽默圓滑，總能看見每個人不願承認的需求",
    goal: "建立一個任何權力都無法壟斷的情報網",
    fears: ["真正的身分被看穿", "欠下無法償還的人情"],
    values: ["選擇", "交換", "生存"],
    capabilities: ["談判", "偽裝", "人脈經營"],
    limitations: ["承諾可信度低", "習慣隱瞞造成誤會"],
    createdAt: "2026-01-01T00:00:00.000Z",
    builtin: true,
  },
];

export function createRpgCharacterTemplate(input: {
  name: string;
  archetype: string;
  identity: string;
  personality: string;
  goal: string;
}): RpgCharacterTemplate {
  const name = input.name.trim();
  if (!name) throw Object.assign(new Error("角色姓名不能空白。"), {
    code: "RPG_CHARACTER_NAME_REQUIRED",
  });
  return {
    schemaVersion: RPG_CHARACTER_LIBRARY_SCHEMA,
    templateId: crypto.randomUUID(),
    name,
    archetype: input.archetype.trim() || "自創角色",
    identity: input.identity.trim(),
    personality: input.personality.trim(),
    goal: input.goal.trim(),
    fears: [],
    values: [],
    capabilities: [],
    limitations: [],
    createdAt: new Date().toISOString(),
    builtin: false,
  };
}

export function parseRpgCharacterLibrary(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RpgCharacterTemplate => {
      if (!item || typeof item !== "object") return false;
      const record = item as Partial<RpgCharacterTemplate>;
      return record.schemaVersion === RPG_CHARACTER_LIBRARY_SCHEMA
        && typeof record.templateId === "string"
        && typeof record.name === "string"
        && typeof record.archetype === "string"
        && record.builtin === false;
    });
  } catch {
    return [];
  }
}

export function mergeCharacterLibrary(custom: RpgCharacterTemplate[]) {
  const map = new Map<string, RpgCharacterTemplate>();
  for (const template of [...BUILTIN_RPG_CHARACTERS, ...custom]) {
    map.set(template.templateId, template);
  }
  return [...map.values()];
}
