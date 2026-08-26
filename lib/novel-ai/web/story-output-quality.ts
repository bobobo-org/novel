export function isUsableChineseStoryOutput(
  content: string,
  minimumHanCharacters = 20,
) {
  const text = content.trim();
  if (!text) return false;
  const hanCharacterCount = text.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  return hanCharacterCount >= minimumHanCharacters;
}

export function hasVerifiedExecutedStoryOutput(input: {
  content: string;
  provider: string;
  actualExecutor: string;
  modelDigest?: string | null;
}) {
  return Boolean(
    input.content.trim()
    && input.modelDigest?.trim()
    && ["local-ollama", "browser-ai"].includes(input.provider)
    && input.actualExecutor === input.provider,
  );
}

export type NovelContinuityGateFailure =
  | "length"
  | "paragraphs"
  | "dialogue"
  | "dialogue_attribution"
  | "continuity_anchor"
  | "active_character"
  | "offstage_character"
  | "narrative_scene"
  | "action_progression"
  | "sensory_detail"
  | "report_style"
  | "causality"
  | "foreshadowing"
  | "serial_hook"
  | "repetition";

const NARRATIVE_SCENE_CUES = [
  "門外", "門內", "門口", "窗邊", "走廊", "廊柱", "房間", "屋內", "屋外",
  "室內", "辦公室", "教室", "病房", "車內", "車站", "電梯", "床邊", "櫃臺",
  "街上", "街燈", "巷口", "樓梯", "牆邊", "地面", "桌前", "椅背", "座位",
  "庭院", "林間", "山道", "河岸", "海面", "城門", "屋頂", "廣場", "港口",
  "橋上", "廚房", "夜色", "晨光", "燈下", "火光", "月光", "腳步", "身後",
  "眼前", "耳邊", "掌心", "指尖", "衣角", "雨水", "風聲", "煙霧", "黑暗", "陰影",
] as const;

const NARRATIVE_ACTION_CUES = [
  "走近", "走出", "踏進", "踏出", "推開", "拉開", "握住", "抬起", "轉身", "回頭",
  "望向", "看向", "伸手", "退開", "靠近", "站起", "坐下", "蹲下", "跑向", "追上",
  "停下", "取出", "放下", "抽出", "拔出", "刺向", "劈下", "落下", "撞上", "踢開",
  "敲了", "按住", "抓住", "鬆開", "閉上", "睜開", "吸了", "吐出", "皺起", "搖頭",
  "點頭", "藏進", "掀開", "打開", "關上", "塞進", "滑出", "穿過", "躍下", "轉動",
  "響起", "傳來", "貼上", "折進", "調低", "熄掉", "顫了一下", "停了一息",
] as const;

const NARRATIVE_SENSORY_CUES = [
  "看見", "望見", "瞥見", "聽見", "聽到", "聞到", "嗅到", "感到", "察覺", "觸到",
  "碰到", "冰冷", "灼熱", "溫熱", "寒意", "刺痛", "疼痛", "粗糙", "柔軟", "潮濕",
  "乾澀", "刺鼻", "腥味", "香氣", "呼吸", "腳步聲", "回聲", "低鳴", "顫抖", "發白",
  "泛白", "微亮", "反光", "耳鳴", "心跳", "汗水", "血腥", "嗓音", "燈影",
] as const;

const REPORT_STYLE_SIGNAL = /(?:分析報告|工程報告|檢核|驗收|評分程序|評分規則|判定為|欄位|格式要求|規格說明|狀態面板|工程說明|清單|檢查項目|驗收項目|字數門檻|段落門檻|關鍵字|範例對話|行動建議|場景資訊|角色資料|角色動機欄位|情節因果欄位|連載鉤子檢核|伏筆檢核|規則會計算|用來填滿|本段沒有|以上內容|以下內容|輸出內容|候選內容|模板填字|不是小說|沒有小說|小說敘事感|敘事感)/gu;
const EXPLICIT_NON_NARRATIVE = /(?:這是|本文是|本段是|以上(?:內容)?是|以下(?:內容)?是).{0,24}(?:報告|清單|狀態面板|工程說明|規格說明|模板)|(?:不是|沒有).{0,12}(?:小說|敘事)|(?:只|純粹).{0,12}(?:填滿|格式|欄位|驗收)/u;
const DIALOGUE_ATTRIBUTION = /(?:壓低聲音|低聲(?:說|問|道)?|開口(?:說|問)?|回道|應道|喃喃|呢喃|耳語|喊道|叫道|吼道|笑道|嘆道|問道|答道|說道|(?:他|她|對方)(?:低聲)?(?:說|問|答|喊|叫|吼)(?:道)?(?=[，。！？：:\s]|$))/u;
const WEAK_CONTINUITY_BIGRAMS = new Set([
  "一個", "沒有", "不是", "但是", "然而", "因為", "所以", "如果", "這個", "那個", "他的",
  "她的", "他們", "她們", "自己", "已經", "仍然", "仍舊", "可以", "不能", "不得", "以及",
  "故事", "角色", "目前", "現在", "下一", "下的", "的事", "之後", "之前", "時候", "什麼",
  "怎麼", "可能", "開始", "知道",
]);

function compactStoryText(value: string) {
  return value.replace(/[\s\p{P}\p{S}]+/gu, "");
}

function shingles(value: string, size: number, step = 1) {
  const compact = compactStoryText(value);
  const result: string[] = [];
  for (let index = 0; index + size <= compact.length; index += step) {
    result.push(compact.slice(index, index + size));
  }
  return result;
}

function distinctCueCount(value: string, cues: readonly string[]) {
  return cues.reduce((count, cue) => count + (value.includes(cue) ? 1 : 0), 0);
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function attributedDialogueCount(value: string, activeCharacterNames: string[]) {
  const namedAttribution = activeCharacterNames.length
    ? new RegExp(
        `(?:${activeCharacterNames.map(escapeRegularExpression).join("|")})(?:低聲)?(?:說|問|答|喊|叫|吼)(?:道)?(?=[，。！？：:\\s]|$)`,
        "u",
      )
    : null;
  const matches = [...value.matchAll(/[「『][^」』]{2,}[」』]/gu)];
  return matches.reduce((count, match) => {
    const index = match.index ?? 0;
    const nearby = value.slice(Math.max(0, index - 72), Math.min(value.length, index + match[0].length + 72));
    return count + (DIALOGUE_ATTRIBUTION.test(nearby) || namedAttribution?.test(nearby) ? 1 : 0);
  }, 0);
}

function continuityAnchorCount(tail: string, opening: string) {
  const tailBigrams = new Set(shingles(tail, 2).filter((value) => !WEAK_CONTINUITY_BIGRAMS.has(value)));
  const openingBigrams = new Set(shingles(opening, 2).filter((value) => !WEAK_CONTINUITY_BIGRAMS.has(value)));
  return [...openingBigrams].filter((value) => tailBigrams.has(value)).length;
}

export function evaluateNovelContinuityGate(input: {
  prose: string;
  minimumHanCharacters: number;
  minimumParagraphs: number;
  minimumDialogueCount?: number;
  continuityExcerpt?: string;
  activeCharacterNames?: string[];
  offstageCharacterNames?: string[];
}) {
  const prose = input.prose.replace(/\r\n?/gu, "\n").trim();
  const failures: NovelContinuityGateFailure[] = [];
  const hanCharacters = prose.match(/[\p{Script=Han}]/gu)?.length ?? 0;
  const paragraphs = prose.split(/\n\s*\n/gu).map((item) => item.trim()).filter(Boolean);
  const dialogueCount = prose.match(/[「『][^」』]{2,}[」』]/gu)?.length ?? 0;
  const activeNames = [...new Set((input.activeCharacterNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length >= 2))];
  const dialogueAttributionCount = attributedDialogueCount(prose, activeNames);
  const narrativeSceneCueCount = distinctCueCount(prose, NARRATIVE_SCENE_CUES);
  const narrativeActionCueCount = distinctCueCount(prose, NARRATIVE_ACTION_CUES);
  const narrativeSensoryCueCount = distinctCueCount(prose, NARRATIVE_SENSORY_CUES);
  const listLineCount = prose.split("\n").filter((line) => (
    /^\s*(?:[-*•▪◦]|\d+[.)、]|[一二三四五六七八九十]+[、.)])\s*/u.test(line)
  )).length;
  const labelLineCount = prose.split("\n").filter((line) => (
    /^\s*[^。！？!?\n]{1,16}[：:]\s*\S/u.test(line)
  )).length;
  const reportSignalCount = prose.match(REPORT_STYLE_SIGNAL)?.length ?? 0;
  if (hanCharacters < input.minimumHanCharacters) failures.push("length");
  if (paragraphs.length < input.minimumParagraphs) failures.push("paragraphs");
  if (dialogueCount < (input.minimumDialogueCount ?? 2)) failures.push("dialogue");
  if (dialogueCount >= (input.minimumDialogueCount ?? 2) && dialogueAttributionCount < 1) {
    failures.push("dialogue_attribution");
  }
  if (narrativeSceneCueCount < 2) failures.push("narrative_scene");
  if (narrativeActionCueCount < 3) failures.push("action_progression");
  if (narrativeSensoryCueCount < 2) failures.push("sensory_detail");
  if (
    EXPLICIT_NON_NARRATIVE.test(prose)
    || reportSignalCount >= 4
    || reportSignalCount / Math.max(hanCharacters, 1) >= 0.012
    || listLineCount >= 2
    || labelLineCount >= 3
  ) {
    failures.push("report_style");
  }

  if (activeNames.length && !activeNames.some((name) => prose.includes(name))) {
    failures.push("active_character");
  }
  const offstageNames = [...new Set((input.offstageCharacterNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length >= 2 && !activeNames.includes(name)))];
  if (offstageNames.some((name) => prose.includes(name))) failures.push("offstage_character");

  const continuityExcerpt = input.continuityExcerpt?.trim() ?? "";
  let sharedContinuityAnchors = 0;
  if (continuityExcerpt) {
    const tail = continuityExcerpt.slice(-500);
    const opening = prose.slice(0, 500);
    sharedContinuityAnchors = continuityAnchorCount(tail, opening);
    if (sharedContinuityAnchors < 2) {
      failures.push("continuity_anchor");
    }
  }
  if (!/(?:因此|所以|於是|于是|才會|才发现|才發現|卻|却|但|然而|既然|如果|為了|为了|導致|导致|代價|代价|後果|后果)/u.test(prose)) {
    failures.push("causality");
  }
  if (!/(?:伏筆|线索|線索|痕跡|痕迹|秘密|尚未|仍未|異樣|异样|不對勁|不对劲|未解|謎|谜|記號|记号|約定|约定)/u.test(prose)) {
    failures.push("foreshadowing");
  }
  const ending = prose.slice(-220);
  if (!/(?:[？?]|卻在|却在|突然|只剩|期限|倒數|倒数|門外|门外|身後|身后|聲音|声音|出現|出现|消失|決定|决定|選擇|选择|代價|代价|真相|來不及|来不及|下一刻)/u.test(ending)) {
    failures.push("serial_hook");
  }

  const normalizedParagraphs = paragraphs.map(compactStoryText).filter((item) => item.length >= 20);
  const uniqueParagraphRatio = normalizedParagraphs.length
    ? new Set(normalizedParagraphs).size / normalizedParagraphs.length
    : 1;
  const proseShingles = shingles(prose, 24, 6);
  const uniqueShingleRatio = proseShingles.length
    ? new Set(proseShingles).size / proseShingles.length
    : 1;
  if (uniqueParagraphRatio < 0.8 || uniqueShingleRatio < 0.72) failures.push("repetition");

  return {
    passed: failures.length === 0,
    failures,
    metrics: {
      hanCharacters,
      paragraphs: paragraphs.length,
      dialogueCount,
      dialogueAttributionCount,
      narrativeSceneCueCount,
      narrativeActionCueCount,
      narrativeSensoryCueCount,
      reportSignalCount,
      listLineCount,
      labelLineCount,
      sharedContinuityAnchors,
      uniqueParagraphRatio,
      uniqueShingleRatio,
    },
  };
}
