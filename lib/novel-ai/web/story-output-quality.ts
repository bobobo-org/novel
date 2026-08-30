export type StoryProseGateFailure =
  | "empty"
  | "too_short"
  | "short_refusal"
  | "json_only"
  | "sentence_fragment"
  | "engineering_label"
  | "prompt_echo"
  | "repetition";

export type StoryProseGateInput = {
  content: string;
  language?: "zh-TW" | "zh-CN" | "en";
  minimumHanCharacters?: number;
  minimumCharacters?: number;
  prompt?: string | null;
};

function normalizedProse(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function proseParagraphs(value: string) {
  return value.replace(/\r\n?/gu, "\n")
    .split(/\n+/u)
    .map((paragraph) => normalizedProse(paragraph))
    .filter(Boolean);
}

function isJsonOnly(value: string) {
  const unwrapped = value
    .replace(/^\s*```(?:json)?\s*/iu, "")
    .replace(/\s*```\s*$/u, "")
    .trim();
  if (!/^(?:\{|\[)/u.test(unwrapped) || !/(?:\}|\])$/u.test(unwrapped)) return false;
  try {
    const parsed = JSON.parse(unwrapped);
    return parsed !== null && typeof parsed === "object";
  } catch {
    return false;
  }
}

function hasSharedLongProseFragment(
  left: string,
  right: string,
  minimumLength = 96,
) {
  const normalizedLeft = normalizedProse(left);
  const normalizedRight = normalizedProse(right);
  if (
    normalizedLeft.length < minimumLength
    || normalizedRight.length < minimumLength
  ) return false;
  const [shorter, longer] = normalizedLeft.length <= normalizedRight.length
    ? [normalizedLeft, normalizedRight]
    : [normalizedRight, normalizedLeft];
  for (let index = 0; index + minimumLength <= shorter.length; index += 1) {
    if (longer.includes(shorter.slice(index, index + minimumLength))) return true;
  }
  return false;
}

function hasRepeatedLongProseFragment(value: string, minimumLength = 80) {
  const compact = normalizedProse(value);
  for (let index = 0; index + minimumLength * 2 <= compact.length; index += 1) {
    const fragment = compact.slice(index, index + minimumLength);
    if (compact.indexOf(fragment, index + minimumLength) >= 0) return true;
  }
  return false;
}

export function hasInternalStoryProseRepetition(value: string) {
  const paragraphs = proseParagraphs(value).filter((paragraph) => paragraph.length >= 32);
  if (new Set(paragraphs).size !== paragraphs.length) return true;
  return hasRepeatedLongProseFragment(value);
}

export function hasCopiedStoryProse(
  candidate: string,
  previous: string,
) {
  const previousParagraphs = new Set(
    proseParagraphs(previous).filter((paragraph) => paragraph.length >= 32),
  );
  if (proseParagraphs(candidate).some((paragraph) => previousParagraphs.has(paragraph))) {
    return true;
  }
  return hasSharedLongProseFragment(candidate, previous);
}

const SHORT_REFUSAL = /^(?:(?:抱歉|對不起|很抱歉)[，,。.!！\s]*)?(?:我|本模型|此模型|人工智慧|ai)?(?:無法|不能|不可以|沒辦法|无法|无法协助|不能協助|不能协助|cannot|can't|unable to|sorry)[\s\S]{0,120}$/iu;
const ENGINEERING_LABEL = /(?:^|\n)\s*(?:\[(?:system|assistant|user|prompt|context|output|validator)[^\]]*\]|(?:system|assistant|user|prompt|context(?:digest)?|output\s*schema|validator\s*correction|instruction|analysis|json|工程(?:說明|標籤|報告)|系統(?:指令|提示)|輸出(?:格式|欄位)|驗收(?:規則|結果))\s*[：:=])/imu;
const TRAILING_FRAGMENT = /(?:[，,、；;：:]|(?:但是|然而|而且|因此|因為|因为|如果|只要|雖然|虽然|並且|并且|以及|and|but|because|while|when|if))\s*$/iu;

function hasCompleteProseEnding(value: string, language: "zh-TW" | "zh-CN" | "en") {
  const closingCharacters = new Set(Array.from("\"'’”)}]」』）】"));
  const characters = Array.from(value.trim());
  while (characters.length && closingCharacters.has(characters.at(-1)!)) characters.pop();
  const finalCharacter = characters.at(-1) ?? "";
  return (language === "en" ? ".!?…" : "。！？!?…").includes(finalCharacter);
}

/**
 * One format/prose boundary shared by external, closed and fused story output.
 * Long-form RPG validation remains stricter; this gate only rejects output
 * that cannot truthfully be presented as finished story prose at all.
 */
export function evaluateStoryProseGate(input: StoryProseGateInput) {
  const language = input.language ?? "zh-TW";
  const content = input.content.replace(/\r\n?/gu, "\n").trim();
  const compact = normalizedProse(content);
  const hanCharacters = content.match(/[\p{Script=Han}]/gu)?.length ?? 0;
  const minimumHanCharacters = input.minimumHanCharacters ?? 20;
  const minimumCharacters = input.minimumCharacters ?? (language === "en" ? 40 : 0);
  const failures: StoryProseGateFailure[] = [];
  if (!content) failures.push("empty");
  if (
    content
    && (
      (language !== "en" && hanCharacters < minimumHanCharacters)
      || (language === "en" && compact.length < minimumCharacters)
    )
  ) failures.push("too_short");
  if (content.length <= 180 && SHORT_REFUSAL.test(content)) failures.push("short_refusal");
  if (isJsonOnly(content)) failures.push("json_only");
  if (content && (
    TRAILING_FRAGMENT.test(content)
    || !hasCompleteProseEnding(content, language)
  )) failures.push("sentence_fragment");
  if (ENGINEERING_LABEL.test(content)) failures.push("engineering_label");
  if (
    input.prompt?.trim()
    && (
      (
        compact.length >= 40
        && normalizedProse(input.prompt).includes(compact)
      )
      || hasSharedLongProseFragment(content, input.prompt, 80)
    )
  ) failures.push("prompt_echo");
  if (hasInternalStoryProseRepetition(content)) failures.push("repetition");
  return {
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    metrics: {
      characters: compact.length,
      hanCharacters,
      paragraphs: proseParagraphs(content).length,
    },
  };
}

export function validProse(
  content: string,
  options: Omit<StoryProseGateInput, "content"> = {},
) {
  return evaluateStoryProseGate({ ...options, content }).passed;
}

export function assertValidStoryProseOutput(input: StoryProseGateInput) {
  const result = evaluateStoryProseGate(input);
  if (result.passed) return result;
  throw Object.assign(new Error("STORY_PROSE_OUTPUT_INVALID"), {
    code: "STORY_PROSE_OUTPUT_INVALID",
    proseFailures: result.failures,
    ...result.metrics,
  });
}

export function isUsableChineseStoryOutput(
  content: string,
  minimumHanCharacters = 20,
) {
  return validProse(content, {
    language: "zh-TW",
    minimumHanCharacters,
  });
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
  "窗縫", "後門", "后门", "側門", "侧门", "桌腳", "桌脚", "抽屜", "抽屉",
  "後院", "后院", "屋簷", "屋檐", "廊下", "院內", "院内",
  "门外", "门内", "门口", "窗边", "房间", "办公室", "车内", "车站", "电梯",
  "床边", "柜台", "街灯", "楼梯", "墙边", "椅背", "林间", "城门", "屋顶",
  "广场", "桥上", "厨房", "灯下", "月光", "脚步", "身后", "眼前", "耳边",
  "风声", "烟雾", "黑暗", "阴影",
] as const;

const NARRATIVE_ACTION_CUES = [
  "走近", "走出", "踏進", "踏出", "推開", "拉開", "握住", "抬起", "轉身", "回頭",
  "望向", "看向", "伸手", "退開", "靠近", "站起", "坐下", "蹲下", "跑向", "追上",
  "停下", "取出", "放下", "抽出", "拔出", "刺向", "劈下", "落下", "撞上", "踢開",
  "敲了", "按住", "抓住", "鬆開", "閉上", "睜開", "吸了", "吐出", "皺起", "搖頭",
  "點頭", "藏進", "掀開", "打開", "關上", "塞進", "滑出", "穿過", "躍下", "轉動",
  "響起", "傳來", "貼上", "折進", "調低", "熄掉", "顫了一下", "停了一息",
  "動手", "动手", "拆開", "拆开", "封住", "護住", "护住", "辨認", "辨认",
  "核對", "核对", "交給", "交给", "逼近",
  "踏进", "踏出", "推开", "拉开", "转身", "回头", "退开", "跑向", "停下",
  "踢开", "松开", "闭上", "睁开", "皱起", "摇头", "点头", "藏进", "掀开",
  "打开", "关上", "跃下", "转动", "响起", "传来", "贴上", "熄掉", "颤了一下",
  "停了一息",
] as const;

const NARRATIVE_SENSORY_CUES = [
  "看見", "望見", "瞥見", "聽見", "聽到", "聞到", "嗅到", "感到", "察覺", "觸到",
  "碰到", "冰冷", "灼熱", "溫熱", "寒意", "刺痛", "疼痛", "粗糙", "柔軟", "潮濕",
  "乾澀", "刺鼻", "腥味", "香氣", "呼吸", "腳步聲", "回聲", "低鳴", "顫抖", "發白",
  "泛白", "微亮", "反光", "耳鳴", "心跳", "汗水", "血腥", "嗓音", "燈影",
  "氣味", "气味", "聲響", "声响", "聲音", "声音", "目光", "墨色", "水痕",
  "藥香", "药香", "苦味", "雨聲", "雨声", "光線", "光线",
  "看见", "望见", "瞥见", "听见", "听到", "闻到", "察觉", "触到", "灼热",
  "温热", "柔软", "潮湿", "干涩", "脚步声", "回声", "低鸣", "颤抖", "发白",
  "耳鸣", "灯影",
] as const;

const ENGLISH_NARRATIVE_SCENE_CUES = [
  "door", "window", "corridor", "hallway", "room", "office", "classroom", "ward",
  "station", "elevator", "street", "alley", "stairs", "wall", "floor", "table",
  "courtyard", "forest", "riverbank", "harbor", "bridge", "kitchen", "rooftop",
  "night", "dawn", "lamplight", "firelight", "moonlight", "behind", "ahead",
] as const;

const ENGLISH_NARRATIVE_ACTION_CUES = [
  "walked", "stepped", "entered", "left", "opened", "closed", "pushed", "pulled",
  "held", "raised", "turned", "looked", "reached", "retreated", "stood", "sat",
  "ran", "followed", "stopped", "took", "placed", "drew", "struck", "kicked",
  "pressed", "grabbed", "released", "nodded", "shook", "hid", "crossed", "jumped",
] as const;

const ENGLISH_NARRATIVE_SENSORY_CUES = [
  "saw", "heard", "smelled", "felt", "noticed", "touched", "cold", "warm", "hot",
  "pain", "rough", "soft", "damp", "dry", "scent", "breath", "echo", "heartbeat",
  "sweat", "blood", "voice", "shadow", "bright", "dark", "trembled", "silence",
] as const;

const REPORT_STYLE_SIGNAL = /(?:分析報告|分析报告|工程報告|工程报告|檢核|检核|驗收|验收|評分程序|评分程序|評分規則|评分规则|判定為|判定为|欄位|栏位|格式要求|規格說明|规格说明|狀態面板|状态面板|工程說明|工程说明|清單|清单|檢查項目|检查项目|驗收項目|验收项目|字數門檻|字数门槛|段落門檻|段落门槛|關鍵字|关键字|範例對話|范例对话|行動建議|行动建议|場景資訊|场景信息|角色資料|角色资料|角色動機欄位|角色动机栏位|情節因果欄位|情节因果栏位|連載鉤子檢核|连载钩子检核|伏筆檢核|伏笔检核|規則會計算|规则会计算|用來填滿|用来填满|本段沒有|本段没有|以上內容|以上内容|以下內容|以下内容|輸出內容|输出内容|候選內容|候选内容|模板填字|不是小說|不是小说|沒有小說|没有小说|小說敘事感|小说叙事感|敘事感|叙事感)/gu;
const EXPLICIT_NON_NARRATIVE = /(?:這是|这是|本文是|本段是|以上(?:內容|内容)?是|以下(?:內容|内容)?是).{0,24}(?:報告|报告|清單|清单|狀態面板|状态面板|工程說明|工程说明|規格說明|规格说明|模板)|(?:不是|沒有|没有).{0,12}(?:小說|小说|敘事|叙事)|(?:只|純粹|纯粹).{0,12}(?:填滿|填满|格式|欄位|栏位|驗收|验收)/u;
const DIALOGUE_ATTRIBUTION = /(?:壓低聲音|压低声音|低聲(?:說|問|道)?|低声(?:说|问|道)?|開口(?:說|問)?|开口(?:说|问)?|回道|應道|应道|喃喃|呢喃|耳語|耳语|喊道|叫道|吼道|笑道|嘆道|叹道|問道|问道|答道|說道|说道|(?:他|她|對方|对方)(?:低聲|低声)?(?:說|说|問|问|答|喊|叫|吼)(?:道)?(?=[，。！？：:\s]|$))/u;
const ENGLISH_REPORT_STYLE_SIGNAL = /\b(?:analysis report|engineering report|acceptance test|scoring rubric|field requirement|format requirement|status panel|checklist|word count threshold|paragraph threshold|example dialogue|action recommendation|character data|causality field|foreshadowing check|serial hook check|output content|candidate content|template filler|not a novel|non-narrative)\b/giu;
const ENGLISH_EXPLICIT_NON_NARRATIVE = /\b(?:this|the following|the above)\s+(?:text|content|section)\s+is\s+(?:a\s+)?(?:report|checklist|status panel|template)|\b(?:not|isn't)\s+(?:a\s+)?(?:novel|narrative)\b/iu;
const ENGLISH_DIALOGUE_ATTRIBUTION = /\b(?:said|asked|answered|replied|whispered|murmured|shouted|yelled|cried|sighed|called|said softly|asked quietly)\b/iu;
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

function attributedDialogueCount(
  value: string,
  activeCharacterNames: string[],
  language: "zh-TW" | "zh-CN" | "en",
) {
  const namedAttribution = activeCharacterNames.length
    ? new RegExp(
        language === "en"
          ? `(?:${activeCharacterNames.map(escapeRegularExpression).join("|")})\\s+(?:said|asked|answered|replied|whispered|murmured|shouted|yelled|cried|sighed|called)(?=[,.!?:;\\s]|$)`
          : `(?:${activeCharacterNames.map(escapeRegularExpression).join("|")})(?:低聲|低声)?(?:說|说|問|问|答|喊|叫|吼)(?:道)?(?=[，。！？：:\\s]|$)`,
        language === "en" ? "iu" : "u",
      )
    : null;
  const matches = language === "en"
    ? [...value.matchAll(/["“][^"”\n]{2,}["”]/gu)]
    : [...value.matchAll(/[「『][^」』]{2,}[」』]/gu)];
  return matches.reduce((count, match) => {
    const index = match.index ?? 0;
    const nearby = value.slice(Math.max(0, index - 72), Math.min(value.length, index + match[0].length + 72));
    const attributed = language === "en"
      ? ENGLISH_DIALOGUE_ATTRIBUTION.test(nearby) || namedAttribution?.test(nearby)
      : DIALOGUE_ATTRIBUTION.test(nearby) || namedAttribution?.test(nearby);
    return count + (attributed ? 1 : 0);
  }, 0);
}

function continuityAnchorCount(tail: string, opening: string) {
  const tailBigrams = new Set(shingles(tail, 2).filter((value) => !WEAK_CONTINUITY_BIGRAMS.has(value)));
  const openingBigrams = new Set(shingles(opening, 2).filter((value) => !WEAK_CONTINUITY_BIGRAMS.has(value)));
  return [...openingBigrams].filter((value) => tailBigrams.has(value)).length;
}

const WEAK_ENGLISH_CONTINUITY_WORDS = new Set([
  "about", "after", "again", "also", "because", "before", "could", "every", "from",
  "have", "into", "just", "more", "only", "other", "should", "still", "their", "there",
  "these", "they", "this", "those", "through", "until", "very", "what", "when", "where",
  "which", "while", "with", "would", "your",
]);

function englishContinuityAnchorCount(tail: string, opening: string) {
  const words = (value: string) => value.normalize("NFKC").toLocaleLowerCase()
    .match(/[a-z][a-z'-]{3,}/gu)
    ?.filter((word) => !WEAK_ENGLISH_CONTINUITY_WORDS.has(word)) ?? [];
  const tailWords = new Set(words(tail));
  return [...new Set(words(opening))].filter((word) => tailWords.has(word)).length;
}

export function evaluateNovelContinuityGate(input: {
  prose: string;
  minimumHanCharacters: number;
  minimumCharacters?: number;
  minimumParagraphs: number;
  minimumDialogueCount?: number;
  continuityExcerpt?: string;
  activeCharacterNames?: string[];
  offstageCharacterNames?: string[];
  language?: "zh-TW" | "zh-CN" | "en";
  requireForeshadowing?: boolean;
  requireSerialHook?: boolean;
}) {
  const prose = input.prose.replace(/\r\n?/gu, "\n").trim();
  const language = input.language ?? "zh-TW";
  const failures: NovelContinuityGateFailure[] = [];
  const hanCharacters = prose.match(/[\p{Script=Han}]/gu)?.length ?? 0;
  const languageCharacters = prose.replace(/\s+/gu, "").length;
  const paragraphs = prose.split(/\n+/gu).map((item) => item.trim()).filter(Boolean);
  const dialogueCount = language === "en"
    ? prose.match(/["“][^"”\n]{2,}["”]/gu)?.length ?? 0
    : prose.match(/[「『][^」』]{2,}[」』]/gu)?.length ?? 0;
  const activeNames = [...new Set((input.activeCharacterNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length >= 2))];
  const cueProse = language === "en" ? prose.toLocaleLowerCase() : prose;
  const dialogueAttributionCount = attributedDialogueCount(prose, activeNames, language);
  const narrativeSceneCueCount = distinctCueCount(
    cueProse,
    language === "en" ? ENGLISH_NARRATIVE_SCENE_CUES : NARRATIVE_SCENE_CUES,
  );
  const narrativeActionCueCount = distinctCueCount(
    cueProse,
    language === "en" ? ENGLISH_NARRATIVE_ACTION_CUES : NARRATIVE_ACTION_CUES,
  );
  const narrativeSensoryCueCount = distinctCueCount(
    cueProse,
    language === "en" ? ENGLISH_NARRATIVE_SENSORY_CUES : NARRATIVE_SENSORY_CUES,
  );
  const listLineCount = prose.split("\n").filter((line) => (
    /^\s*(?:[-*•▪◦]|\d+[.)、]|[一二三四五六七八九十]+[、.)])\s*/u.test(line)
  )).length;
  const labelLineCount = prose.split("\n").filter((line) => (
    /^\s*[^。！？!?\n]{1,16}[：:]\s*\S/u.test(line)
  )).length;
  const reportSignalCount = language === "en"
    ? prose.match(ENGLISH_REPORT_STYLE_SIGNAL)?.length ?? 0
    : prose.match(REPORT_STYLE_SIGNAL)?.length ?? 0;
  if (
    (language !== "en" && hanCharacters < input.minimumHanCharacters)
    || languageCharacters < (input.minimumCharacters ?? 0)
  ) failures.push("length");
  if (paragraphs.length < input.minimumParagraphs) failures.push("paragraphs");
  const minimumDialogueCount = input.minimumDialogueCount ?? 2;
  if (dialogueCount < minimumDialogueCount) failures.push("dialogue");
  if (minimumDialogueCount > 0 && dialogueCount >= minimumDialogueCount && dialogueAttributionCount < 1) {
    failures.push("dialogue_attribution");
  }
  if (narrativeSceneCueCount < 2) failures.push("narrative_scene");
  if (narrativeActionCueCount < 3) failures.push("action_progression");
  if (narrativeSensoryCueCount < 2) failures.push("sensory_detail");
  if (
    (language === "en" ? ENGLISH_EXPLICIT_NON_NARRATIVE : EXPLICIT_NON_NARRATIVE).test(prose)
    || reportSignalCount >= 4
    || reportSignalCount / Math.max(languageCharacters, 1) >= 0.012
    || listLineCount >= 2
    || labelLineCount >= 3
  ) {
    failures.push("report_style");
  }

  const includesCharacterName = (name: string) => language === "en"
    ? prose.toLocaleLowerCase().includes(name.toLocaleLowerCase())
    : prose.includes(name);
  if (activeNames.length && !activeNames.some(includesCharacterName)) {
    failures.push("active_character");
  }
  const offstageNames = [...new Set((input.offstageCharacterNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length >= 2 && !activeNames.includes(name)))];
  if (offstageNames.some(includesCharacterName)) failures.push("offstage_character");

  const continuityExcerpt = input.continuityExcerpt?.trim() ?? "";
  let sharedContinuityAnchors = 0;
  if (continuityExcerpt) {
    const tail = continuityExcerpt.slice(-500);
    const opening = prose.slice(0, 500);
    sharedContinuityAnchors = language === "en"
      ? englishContinuityAnchorCount(tail, opening)
      : continuityAnchorCount(tail, opening);
    if (sharedContinuityAnchors < 2) {
      failures.push("continuity_anchor");
    }
  }
  const hasCausality = language === "en"
    ? /\b(?:because|therefore|so that|as a result|consequently|however|although|but|if|in order to|led to|caused|cost|consequence)\b/iu.test(prose)
    : /(?:因此|所以|於是|于是|才會|才发现|才發現|卻|却|但|然而|既然|如果|為了|为了|導致|导致|代價|代价|後果|后果)/u.test(prose);
  if (!hasCausality) {
    failures.push("causality");
  }
  const hasForeshadowing = language === "en"
    ? /\b(?:clue|trace|secret|unresolved|unanswered|strange|wrong|mystery|mark|sign|promise|unfinished|missing)\b/iu.test(prose)
    : /(?:伏筆|线索|線索|痕跡|痕迹|秘密|尚未|仍未|異樣|异样|不對勁|不对劲|未解|謎|谜|記號|记号|約定|约定)/u.test(prose);
  if ((input.requireForeshadowing ?? true) && !hasForeshadowing) {
    failures.push("foreshadowing");
  }
  const ending = prose.slice(-220);
  const hasSerialHook = language === "en"
    ? /(?:[?]|\b(?:but then|suddenly|only one|deadline|countdown|outside|behind|voice|appeared|vanished|decide|choose|cost|truth|too late|next moment)\b)/iu.test(ending)
    : /(?:[？?]|卻在|却在|突然|只剩|期限|倒數|倒数|門外|门外|身後|身后|聲音|声音|出現|出现|消失|決定|决定|選擇|选择|代價|代价|真相|來不及|来不及|下一刻|離岸|离岸|起航|追去|趕上|赶上)/u.test(ending);
  if ((input.requireSerialHook ?? true) && !hasSerialHook) {
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
      languageCharacters,
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
