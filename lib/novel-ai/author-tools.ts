import type {
  Chapter,
  Character,
  CharacterRelationship,
  NovelProject,
  StoryBible,
  StoryState,
  TimelineEvent,
  WorldRule,
} from "./domain";

export const AUTHOR_TOOL_IDS = ["breakdown", "relay", "batch", "serial"] as const;
export type AuthorToolId = (typeof AUTHOR_TOOL_IDS)[number];

export type AuthorToolSnapshot = {
  project: NovelProject;
  chapters: Chapter[];
  characters: Character[];
  relationships: CharacterRelationship[];
  worldRules: WorldRule[];
  storyBible: StoryBible | null;
  storyState: StoryState | null;
  timeline: TimelineEvent[];
};

function text(value: string | null | undefined, fallback = "尚未設定") {
  const normalized = value?.trim();
  return normalized || fallback;
}

function list(values: Array<string | null | undefined>, fallback = "尚無資料") {
  const normalized = values.map((value) => value?.trim()).filter(Boolean) as string[];
  return normalized.length ? normalized.map((value) => `- ${value}`).join("\n") : `- ${fallback}`;
}

function orderedChapters(snapshot: AuthorToolSnapshot) {
  return [...snapshot.chapters].sort((left, right) => left.order - right.order);
}

function chapterCharacters(chapter: Chapter) {
  return chapter.content.replace(/\s/gu, "").length;
}

function relationLines(snapshot: AuthorToolSnapshot) {
  const byId = new Map(snapshot.characters.map((character) => [character.id, character.name]));
  return snapshot.relationships.map((relationship) => {
    const from = byId.get(relationship.fromCharacterId) ?? "未命名角色";
    const to = byId.get(relationship.toCharacterId) ?? "未命名角色";
    const trust = relationship.trust === null ? "未量化" : `${relationship.trust}`;
    return `${from} → ${to}｜${text(relationship.kind, "未分類")}｜信任 ${trust}｜${text(relationship.summary)}`;
  });
}

function latestChapter(snapshot: AuthorToolSnapshot) {
  return snapshot.chapters.find((chapter) => chapter.id === snapshot.project.activeChapterId)
    ?? orderedChapters(snapshot).at(-1)
    ?? null;
}

function storyStateLines(snapshot: AuthorToolSnapshot) {
  const state = snapshot.storyState;
  if (!state) return ["尚未建立故事狀態"];
  const metrics = (label: string, values: Record<string, number | string | boolean>) => {
    const entries = Object.entries(values).slice(0, 12);
    return entries.length ? `${label}：${entries.map(([key, value]) => `${key}=${value}`).join("、")}` : "";
  };
  return [
    state.locationState ? `位置：${state.locationState}` : "",
    state.timeState ? `時間：${state.timeState}` : "",
    state.riskState ? `風險：${state.riskState}` : "",
    state.money !== null ? `金錢：${state.money}` : "",
    state.reputation !== null ? `聲望：${state.reputation}` : "",
    state.inventory.length ? `持有物：${state.inventory.slice(0, 20).join("、")}` : "",
    metrics("能力", state.protagonistStats),
    metrics("資源", state.resources),
    metrics("關係", state.relationships),
    metrics("任務", state.questStates),
    metrics("世界旗標", state.worldFlags),
  ].filter(Boolean);
}

function closingExcerpt(chapter: Chapter | null, maximum = 500) {
  if (!chapter?.content.trim()) return "尚無章節正文";
  const normalized = chapter.content.trim();
  return normalized.length > maximum ? `…${normalized.slice(-maximum)}` : normalized;
}

function pacingLabel(lengths: number[]) {
  if (lengths.length < 2) return "樣本不足，至少需要兩章才能比較節奏";
  const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const variance = lengths.reduce((sum, value) => sum + Math.abs(value - average), 0) / lengths.length;
  const ratio = average ? variance / average : 0;
  if (ratio < 0.15) return "章幅相當穩定，可再刻意安排一章長、一章短形成呼吸";
  if (ratio < 0.35) return "章幅有自然變化，目前節奏差異適中";
  return "章幅落差偏大，建議檢查短章是否有完整事件、長章是否可拆出鉤子";
}

export function buildWorkBreakdown(snapshot: AuthorToolSnapshot) {
  const chapters = orderedChapters(snapshot);
  const lengths = chapters.map(chapterCharacters);
  const totalCharacters = lengths.reduce((sum, value) => sum + value, 0);
  const average = chapters.length ? Math.round(totalCharacters / chapters.length) : 0;
  const bible = snapshot.storyBible;
  const activeThreads = bible?.unresolvedThreads ?? [];
  const hooks = chapters.slice(-3).map((chapter) => {
    const ending = closingExcerpt(chapter, 120).replace(/\s+/gu, " ");
    return `${chapter.title}：${ending}`;
  });

  return [
    `# 《${snapshot.project.title}》作品拆解`,
    "",
    "## 核心定位",
    `- 核心概念：${text(snapshot.project.coreIdea.value)}`,
    `- 主題：${text(bible?.theme.value)}`,
    `- 敘事風格：${text(snapshot.project.narrativeStyle.value ?? bible?.style.value)}`,
    `- 類型代碼：${text(snapshot.project.genreId ?? snapshot.project.genrePackId, "尚未選定")}`,
    "",
    "## 作品規模與節奏",
    `- 章節：${chapters.length} 章（完成 ${chapters.filter((chapter) => chapter.status === "completed").length}、草稿 ${chapters.filter((chapter) => chapter.status === "draft").length}）`,
    `- 正文字數（不含空白）：${totalCharacters.toLocaleString("zh-TW")} 字；平均每章 ${average.toLocaleString("zh-TW")} 字`,
    `- 節奏判讀：${pacingLabel(lengths)}`,
    "",
    "## 角色與欲望",
    list(snapshot.characters.map((character) => `${character.name}｜身分：${text(character.identity.value)}｜目標：${text(character.goal.value)}｜性格：${text(character.personality.value)}`), "尚未建立角色"),
    "",
    "## 關係張力",
    list(relationLines(snapshot), "尚未建立角色關係"),
    "",
    "## 世界規則與不可破壞條件",
    list(snapshot.worldRules.map((rule) => `${rule.immutable ? "不可變" : "可演化"}｜${rule.title}：${rule.description}`), "尚未建立世界規則"),
    "",
    "## 未解線索與伏筆",
    list([...activeThreads, ...(bible?.foreshadowing ?? [])], "尚未登記未解線索或伏筆"),
    "",
    "## 最近三章的章尾鉤子檢視",
    list(hooks, "尚無章節正文可檢視"),
    "",
    "## 下一步檢查",
    activeThreads.length
      ? `- 優先選一條未解線索推進：${activeThreads[0]}，同時讓角色付出可見代價。`
      : "- 先建立一條可在後續回收的未解線索，避免每章只完成眼前事件。",
    snapshot.relationships.length
      ? "- 下一章至少讓一段既有關係因行動而升溫、破裂或產生債務。"
      : "- 補上主角與阻力來源的關係，讓衝突不只停留在事件層。",
    "- 本報告只讀取本作品的本機 Canon，不會修改正文或設定。",
  ].join("\n");
}

export function buildRelayPrompt(snapshot: AuthorToolSnapshot, target: string) {
  const chapters = orderedChapters(snapshot);
  const current = latestChapter(snapshot);
  const bible = snapshot.storyBible;
  return [
    `# 《${snapshot.project.title}》續寫接力包`,
    `目標工具：${target}`,
    "",
    "你是續寫協作者。請只產生一份『下一章候選稿』，不要宣稱已寫入原作，也不要改寫既有 Canon。輸出使用繁體中文。",
    "",
    "## 必守 Canon",
    `- 核心概念：${text(snapshot.project.coreIdea.value)}`,
    `- 主題：${text(bible?.theme.value)}`,
    `- 風格：${text(snapshot.project.narrativeStyle.value ?? bible?.style.value)}`,
    list(snapshot.worldRules.filter((rule) => rule.immutable).map((rule) => `${rule.title}：${rule.description}`), "尚無不可變世界規則"),
    "",
    "## 角色現況",
    list(snapshot.characters.map((character) => `${character.name}｜目標：${text(character.goal.value)}｜性格：${text(character.personality.value)}｜狀態：${character.lifeStatus}`), "尚未建立角色"),
    "",
    `## 上一章結果（${current?.title ?? "尚無章節"}）`,
    text(current?.summary, closingExcerpt(current, 900)),
    "",
    "## 上一章末段（供銜接；請勿逐句重複）",
    closingExcerpt(current, 1_200),
    "",
    "## 尚未解決",
    list(bible?.unresolvedThreads ?? [], "尚未登記未解線索"),
    "",
    "## 目前存檔狀態",
    list(storyStateLines(snapshot)),
    "",
    "## 禁止矛盾",
    list(bible?.forbiddenContradictions ?? [], "尚未登記額外禁則；仍不得違反上方 Canon"),
    "",
    "## 輸出規格",
    "1. 先用三行說明本章目標、衝突與不可逆後果。",
    "2. 再寫完整候選正文；延續上一章，不重開故事。",
    "3. 章末留下可回應的行動鉤子。",
    "4. 最後列出本候選會改變的角色、資源、關係與未解線索，供作者回到系統核准。",
    "",
    `目前共有 ${chapters.length} 章。本接力包由作者主動複製；外部工具不會自動取得作品庫。`,
  ].join("\n");
}

export function buildBatchPlan(snapshot: AuthorToolSnapshot, count: number, objective: string) {
  const safeCount = Math.max(2, Math.min(20, Math.round(count) || 3));
  const latest = latestChapter(snapshot);
  const startOrder = latest?.order ?? 0;
  const threads = snapshot.storyBible?.unresolvedThreads.filter(Boolean) ?? [];
  const characters = snapshot.characters.filter((character) => character.name.trim());
  const goal = text(objective, threads[0] ? `推進並回收「${threads[0]}」` : "建立新衝突並形成可回收的後果");
  const plans = Array.from({ length: safeCount }, (_, index) => {
    const order = startOrder + index + 1;
    const thread = threads[index % Math.max(threads.length, 1)] ?? goal;
    const character = characters[index % Math.max(characters.length, 1)];
    const phase = index === 0 ? "承接與逼迫" : index === safeCount - 1 ? "回收與反轉" : "升級與付代價";
    return [
      `### 第 ${order} 章｜${phase}`,
      `- 本章目標：${index === safeCount - 1 ? `讓「${thread}」得到部分答案，同時留下更深後果` : `推進「${thread}」並迫使${character?.name ?? "主角"}做出選擇`}`,
      `- 核心衝突：${character?.name ?? "主角"}想達成「${text(character?.goal.value, goal)}」，但必須犧牲一項既有資源、關係或安全感。`,
      "- 中段轉折：原先可控的辦法暴露隱藏成本，讓下一步不能回到原狀。",
      `- 回收檢查：${index ? "回應前一章留下的具體後果，避免平行重開事件。" : `明確承接「${latest?.title ?? "故事起點"}」的結果。`}`,
      "- 章尾鉤子：讓讀者看見下一個威脅或機會，但暫時只揭露一半原因。",
    ].join("\n");
  });

  return [
    `# 《${snapshot.project.title}》${safeCount} 章批量規劃`,
    "",
    `總目標：${goal}`,
    `承接位置：${latest ? `${latest.title}（第 ${latest.order} 章）` : "尚無章節，從第一章建立"}`,
    "",
    ...plans,
    "",
    "## 批量防呆 Gate",
    "- 每一章都必須承接上一章的可見結果，不可只換場景後重新開始。",
    "- 每一章至少改變一項人物關係、資源、線索或風險。",
    "- 本規劃是可編輯候選，不會批量寫入正式章節。",
  ].join("\n\n");
}

export function buildSerialResearch(snapshot: AuthorToolSnapshot, cadence: string) {
  const chapters = orderedChapters(snapshot);
  const lengths = chapters.map(chapterCharacters);
  const average = chapters.length ? Math.round(lengths.reduce((sum, value) => sum + value, 0) / chapters.length) : 0;
  const endings = chapters.map((chapter) => closingExcerpt(chapter, 160));
  const hookSignals = endings.filter((ending) => /[？?]|危險|死亡|追|失蹤|秘密|真相|背叛|期限|倒數|威脅|選擇/u.test(ending)).length;
  const hookCoverage = chapters.length ? Math.round((hookSignals / chapters.length) * 100) : 0;
  const unfinished = snapshot.storyBible?.unresolvedThreads.length ?? 0;
  const immutableRules = snapshot.worldRules.filter((rule) => rule.immutable).length;
  const readiness = Math.min(100, 20 + Math.min(chapters.length * 5, 25) + Math.min(snapshot.characters.length * 6, 24) + Math.min(unfinished * 4, 16) + Math.min(immutableRules * 5, 15));

  return [
    `# 《${snapshot.project.title}》連載、讀者與 IP 研究`,
    "",
    `發布節奏目標：${cadence}`,
    "",
    "## 連載結構",
    `- 現有 ${chapters.length} 章；平均每章 ${average.toLocaleString("zh-TW")} 字。`,
    `- 章幅判讀：${pacingLabel(lengths)}。`,
    `- 章尾顯性鉤子覆蓋估計：${hookCoverage}%（以問句、危險、秘密、期限與選擇等文字訊號判讀，不冒充真實讀者數據）。`,
    `- 未解線索：${unfinished} 條；${unfinished ? "適合輪替推進，但要避免長期只新增不回收。" : "建議先建立一條可追蹤的長線問題。"}`,
    "",
    "## 讀者留存檢查",
    "- 每章前 10% 應回應上一章結果，讓讀者立即知道選擇造成什麼變化。",
    "- 每章中段至少出現一次資訊、關係或資源的重新定價。",
    "- 章尾要留下具體下一步，而不只是抽象感想。",
    "",
    "## IP 改編準備度",
    `- 內容結構準備度：${readiness}/100（依章節、角色、未解線索與不可變規則的完整度估算，不是市場成功率）。`,
    `- 聲音劇：${snapshot.characters.length >= 3 ? "角色數足以測試多人聲線" : "先補足可辨識的主要角色聲線"}。`,
    `- 短劇／影片：${chapters.length ? "可從章末鉤子最強的一章建立分場與鏡頭交接包" : "需先有章節正文，才能建立可追溯分場"}。`,
    `- 互動作品：${unfinished ? "已有未解線索可轉成選擇壓力" : "先建立可因選擇改變的風險或關係"}。`,
    "",
    "## 建議行動",
    "1. 用最近三章做一次『開場承接／中段轉折／章尾鉤子』人工複核。",
    "2. 選一條未解線索設定明確回收章，不讓伏筆無限堆積。",
    "3. 進入影片製作前，先核准短劇分場；目前系統只提供可下載的 JSON 交接資料，不會冒充已產生 MP4。",
  ].join("\n");
}
