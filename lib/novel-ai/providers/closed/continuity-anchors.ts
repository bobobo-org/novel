import type { PlatformTaskType } from "../../router/platform-types";

const CURRENT_CHAPTER_CONTEXT_MARKER =
  /(?:^|\n)\s*(?:\[current-chapter\]|\[active[_-]chapter\]|【目前章節[：:])/iu;

const DIRECT_NARRATIVE_TASKS = new Set<PlatformTaskType>([
  "chapter.continue",
  "chapter.rewrite",
  "chapter.expand",
  "character.dialogue",
  "drama.dialogue",
]);

type ActorContextIdentity = {
  id: string;
  kind: string;
  text: string;
};

function structuredActiveChapterContent(item: ActorContextIdentity) {
  const tagged = item.text
    .replace(/\r\n?/gu, "\n")
    .trim()
    .match(/^\[active[_-]chapter\]\s*([\s\S]+)$/iu);
  if (!tagged?.[1]) return null;
  try {
    const record = JSON.parse(tagged[1]) as {
      content?: unknown;
      summary?: unknown;
      title?: unknown;
    };
    if (
      !record
      || typeof record !== "object"
      || !("content" in record || "summary" in record || "title" in record)
    ) return null;
    return typeof record.content === "string" ? record.content.trim() : "";
  } catch {
    return null;
  }
}

function isSummaryOnlyActiveChapter(item: ActorContextIdentity) {
  return structuredActiveChapterContent(item) === "";
}

function isProjectSeedContext(item: ActorContextIdentity) {
  return item.id.startsWith("seed:")
    || /^\s*\[project[_-]seed\]/iu.test(item.text);
}

function isStrongActiveChapter(item: ActorContextIdentity) {
  return !isSummaryOnlyActiveChapter(item)
    && (
      item.id.startsWith("chapter-active:")
      || /^\s*\[active[_-]chapter\]/iu.test(item.text)
    );
}

function isCurrentChapterCandidate(item: ActorContextIdentity) {
  return !isSummaryOnlyActiveChapter(item)
    && (
      isStrongActiveChapter(item)
      || CURRENT_CHAPTER_CONTEXT_MARKER.test(item.text)
    );
}

function readableNonCurrentContext(item: ActorContextIdentity) {
  const normalized = item.text.replace(/\r\n?/gu, "\n").trim();
  if (!isSummaryOnlyActiveChapter(item)) return normalized;
  const tagged = normalized.match(/^\[active[_-]chapter\]\s*([\s\S]+)$/iu);
  if (tagged?.[1]) {
    try {
      const record = JSON.parse(tagged[1]) as { summary?: unknown };
      const summary = typeof record.summary === "string" ? record.summary.trim() : "";
      if (summary) return `[approved-chapter-seed]\n${summary}`;
    } catch {
      // Fall through to the non-current legacy representation.
    }
  }
  return normalized.replace(/^\[active[_-]chapter\]/iu, "[approved-chapter-seed]");
}

function readableActiveChapter(value: string) {
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  const tagged = normalized.match(/^\[active[_-]chapter\]\s*([\s\S]+)$/iu);
  if (!tagged?.[1]) {
    return normalized.replace(/^\[current-chapter\]\s*/iu, "").trim();
  }
  try {
    const record = JSON.parse(tagged[1]) as {
      title?: unknown;
      content?: unknown;
      summary?: unknown;
    };
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const content = typeof record.content === "string" ? record.content.trim() : "";
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    if (content || summary) {
      return [
        title ? `【目前章節：${title}】` : "【目前章節】",
        content,
        summary && !content.includes(summary) ? `【章節摘要】${summary}` : "",
      ].filter(Boolean).join("\n");
    }
  } catch {
    // The tagged context remains usable as text if an older record is not JSON.
  }
  return normalized.replace(/^\[active[_-]chapter\]\s*/iu, "").trim();
}

export function serializeClosedActorContext(
  context: ActorContextIdentity[],
  taskType: PlatformTaskType,
) {
  const narrativeTask = DIRECT_NARRATIVE_TASKS.has(taskType);
  const strongIndex = narrativeTask
    ? context.findIndex(isStrongActiveChapter)
    : -1;
  const activeIndex = strongIndex >= 0
    ? strongIndex
    : narrativeTask
      ? context.findIndex(isCurrentChapterCandidate)
      : -1;
  const summarySeedIndex = narrativeTask
    ? context.findIndex(isSummaryOnlyActiveChapter)
    : -1;
  return context
    .map((item, index) => ({
      item,
      index,
      active: index === activeIndex,
      promptPriority: index === activeIndex
        ? 3
        : isSummaryOnlyActiveChapter(item)
          ? 2
          : summarySeedIndex >= 0 && isProjectSeedContext(item)
            ? 1
          : 0,
    }))
    .sort((left, right) => right.promptPriority - left.promptPriority || left.index - right.index)
    .map(({ item, active }) => active
      ? `[current-chapter]\n${readableActiveChapter(item.text)}`
      : `[${item.kind}]\n${readableNonCurrentContext(item)}`);
}

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
    const markerOffset = match[0].search(
      /(?:\[current-chapter\]|\[active[_-]chapter\]|【目前章節[：:])/iu,
    );
    const chapterStart = markerOffset < 0
      ? match.index
      : match.index + markerOffset;
    return item
      .slice(chapterStart)
      .replace(/^\s*\[(?:current-chapter|active[_-]chapter)\]\s*/iu, "")
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
