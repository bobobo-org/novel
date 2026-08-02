const CURRENT_CHAPTER_CONTEXT_MARKER =
  /(?:^|\n)\s*(?:\[current-chapter\]|【目前章節[：:])/iu;

const ROLE_PREFIXES = [
  "鑄劍師",
  "主角",
  "少年",
  "少女",
  "青年",
  "女子",
  "男子",
  "女孩",
  "男孩",
  "妹妹",
  "哥哥",
  "姐姐",
  "弟弟",
  "母親",
  "父親",
  "師父",
  "師兄",
  "師姐",
  "師弟",
  "師妹",
  "劍師",
  "醫師",
  "將軍",
  "警官",
  "掌門",
  "宗主",
  "店主",
  "隊長",
  "老師",
  "教授",
  "公主",
  "王子",
] as const;

const ROLE_NAME_FOLLOWERS = [
  "的",
  "說",
  "道",
  "問",
  "答",
  "喊",
  "握",
  "聽",
  "看",
  "望",
  "走",
  "跑",
  "抬",
  "轉",
  "推",
  "拉",
  "站",
  "坐",
  "跪",
  "伸",
  "收",
  "拔",
  "踏",
  "將",
  "把",
  "被",
  "已",
  "正",
  "忽",
  "從",
  "向",
  "在",
  "嚥",
  "，",
  "。",
  "！",
  "？",
  "：",
  "；",
  "「",
  "『",
] as const;

const GENERIC_FALSE_NAMES = new Set([
  "故事",
  "主角",
  "人物",
  "世界",
  "聲音",
  "記憶",
  "少年",
  "少女",
  "有人",
  "自己",
]);

const roleNamePattern = new RegExp(
  `(?:${[...ROLE_PREFIXES]
    .sort((left, right) => right.length - left.length)
    .join("|")})([\\p{Script=Han}]{2,4}?)(?=${ROLE_NAME_FOLLOWERS.join("|")}|\\s)`,
  "gu",
);

export function currentChapterContext(context: string[] | undefined) {
  for (const item of context ?? []) {
    const match = CURRENT_CHAPTER_CONTEXT_MARKER.exec(item);
    if (!match || match.index < 0) continue;
    const markerOffset = match[0].search(/(?:\[current-chapter\]|【目前章節[：:])/iu);
    const chapterStart = markerOffset < 0
      ? match.index
      : match.index + markerOffset;
    return item
      .slice(chapterStart)
      .replace(/^\s*\[current-chapter\]\s*/iu, "")
      .trim();
  }
  return null;
}

export function extractNarrativeCharacterAnchors(chapterText: string) {
  const anchors: string[] = [];
  roleNamePattern.lastIndex = 0;
  for (const match of chapterText.matchAll(roleNamePattern)) {
    const name = match[1]?.trim();
    if (
      !name
      || GENERIC_FALSE_NAMES.has(name)
      || ROLE_PREFIXES.some((role) => name.includes(role))
      || anchors.includes(name)
    ) continue;
    anchors.push(name);
  }
  return anchors.slice(0, 8);
}
