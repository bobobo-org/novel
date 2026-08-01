import type { PlatformTaskType } from "../../router/platform-types";
import {
  runPackagedBrowserExtractiveModel,
  splitBrowserModelSentences,
} from "./browser-extractive-model";

export const BROWSER_TASK_MODEL = Object.freeze({
  schemaVersion: "novel-browser-task-runtime-v3",
  modelId: "novel-browser-task-runtime-v3",
  modelDigest: "5ea2191560d86727a4d897f1b552a5f624b74dfb8ef0c57683b02d52d6db4b4f",
  rankerModelId: "novel-browser-extractive-v1",
  externalRequest: false,
  dataLeftDevice: false,
} as const);

const NATIVE_SUMMARY_TASKS = new Set<PlatformTaskType>([
  "story.summary",
  "chapter.compress",
  "drama.shortSummary",
]);

const NAME_STOP_WORDS = new Set([
  "但是",
  "然而",
  "因此",
  "所以",
  "如果",
  "這時",
  "那時",
  "有人",
  "眾人",
  "自己",
  "對方",
  "守門人",
]);

const EMOTIONS = {
  緊張: ["緊張", "恐懼", "害怕", "發抖", "逃", "危險", "威脅"],
  憤怒: ["憤怒", "生氣", "怒", "吼", "恨", "衝突"],
  悲傷: ["悲傷", "難過", "哭", "眼淚", "失去", "離別"],
  喜悅: ["喜悅", "開心", "微笑", "笑", "希望", "安心"],
} as const;

function matchingTerms(text: string, terms: readonly string[]) {
  return terms.filter((term) => text.includes(term));
}

function evidence(text: string) {
  const result = runPackagedBrowserExtractiveModel(text);
  return result.content.replace(/\n+/gu, " ").slice(0, 180);
}

function extractNames(text: string) {
  const candidates = new Set<string>();
  const patterns = [
    /(?:^|[，。！？；\s「『])([\p{Script=Han}]{2,4})(?=(?:說|問|答|道|喊|想|看|走|笑|哭|點頭|搖頭|：|「|『))/gu,
    /(?:名叫|叫做|名字是)([\p{Script=Han}]{2,4})/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]?.trim();
      if (name && !NAME_STOP_WORDS.has(name)) candidates.add(name);
    }
  }
  return [...candidates].slice(0, 12);
}

function classifyEmotion(text: string) {
  const matches = Object.entries(EMOTIONS)
    .map(([label, terms]) => ({ label, terms: matchingTerms(text, terms) }))
    .sort((left, right) => right.terms.length - left.terms.length);
  const strongest = matches[0];
  return strongest?.terms.length
    ? { label: strongest.label, terms: strongest.terms }
    : { label: "中性／證據不足", terms: [] };
}

function emotionCurve(text: string) {
  const sentences = splitBrowserModelSentences(text);
  if (!sentences.length) return "情緒曲線：無法判定；輸入中沒有可分析的句子。";
  const segmentSize = Math.ceil(sentences.length / 3);
  const labels = [0, 1, 2].map((segment) => {
    const part = sentences
      .slice(segment * segmentSize, (segment + 1) * segmentSize)
      .join("");
    return classifyEmotion(part).label;
  });
  return `情緒曲線：${labels.join(" → ")}。這是依三段文字中的顯性情緒詞判定，仍需作者核對語境。`;
}

function classifyScene(text: string) {
  const dialogue = (text.match(/[「『][^」』]+[」』]/gu) ?? []).length;
  const actionTerms = matchingTerms(text, [
    "跑",
    "追",
    "打",
    "推",
    "衝",
    "抓",
    "逃",
    "進入",
    "離開",
  ]);
  const revealTerms = matchingTerms(text, [
    "發現",
    "原來",
    "坦白",
    "揭露",
    "真相",
    "秘密",
  ]);
  const label = revealTerms.length
    ? "揭露／轉折場景"
    : actionTerms.length > dialogue
      ? "行動推進場景"
      : dialogue
        ? "對話互動場景"
        : "敘事銜接場景";
  return `場景分類：${label}。可見線索：對話 ${dialogue} 段、行動詞 ${actionTerms.length} 個、揭露詞 ${revealTerms.length} 個。`;
}

function classifyChapter(text: string) {
  const hasConflict = /衝突|阻止|拒絕|威脅|危險|敵人|追逐/u.test(text);
  const hasDecision = /決定|選擇|必須|代價|答應|拒絕/u.test(text);
  const hasReveal = /發現|真相|原來|揭露|秘密/u.test(text);
  const labels = [
    hasConflict ? "衝突升高" : null,
    hasDecision ? "選擇與代價" : null,
    hasReveal ? "資訊揭露" : null,
  ].filter(Boolean);
  return `章節分類：${labels.length ? labels.join("、") : "鋪陳／過渡"}。摘要證據：${evidence(text)}`;
}

function dialogueConsistency(text: string) {
  const names = extractNames(text);
  const dialogueCount = (text.match(/[「『][^」』]+[」』]/gu) ?? []).length;
  if (!dialogueCount) {
    return "對話一致性：證據不足；輸入中未偵測到完整引號對話，無法可靠比較角色聲音。";
  }
  return `對話一致性：需作者核對。偵測到 ${dialogueCount} 段對話，明確說話者 ${names.length ? names.join("、") : "未辨識"}；未取得角色聲音基準時不宣稱一致。`;
}

function gameStateEvaluation(text: string) {
  const numericState = [...text.matchAll(
    /(?:^|[\s，。！？；、])(rpg\.[a-z]+|resource\.\d+|relationship\.\d+|money|reputation|經驗值|XP|任務進度|成就進度)\s*[:：=]\s*(-?\d+(?:\.\d+)?)/giu,
  )].map((match) => ({
    key: match[1],
    value: Number(match[2]),
  }));
  const outOfRange = numericState.filter(({ key, value }) => {
    if (/經驗值|XP|rpg\.xp|money|resource\./iu.test(key)) return value < 0;
    if (/relationship\./iu.test(key)) return value < -100 || value > 100;
    return value < 0 || value > 100;
  });
  const duplicateKeys = numericState
    .map(({ key }) => key.toLowerCase())
    .filter((key, index, all) => all.indexOf(key) !== index);
  const evidenceCount = numericState.length;

  if (!evidenceCount) {
    return [
      "RPG 狀態評估：證據不足；輸入中未偵測到可驗證的能力值、XP、任務或成就進度。",
      "建議先載入 StoryState，再檢查能力值 0–100、XP 不得為負、分支與任務引用是否存在。",
      "此結果只產生修正候選，不會直接修改狀態或 Canon。",
    ].join("\n");
  }

  return [
    `RPG 狀態評估：已讀取 ${evidenceCount} 個數值欄位。`,
    outOfRange.length
      ? `異常值：${outOfRange.map(({ key, value }) => `${key}=${value}`).join("、")}；建議限制至合法範圍。`
      : "數值範圍：目前可見能力、進度與 XP 沒有越界。",
    duplicateKeys.length
      ? `重複欄位：${[...new Set(duplicateKeys)].join("、")}；應核對最新版本再合併。`
      : "欄位唯一性：未偵測到重複數值欄位。",
    "分支、資源與引用完整性仍需依正式 StoryState ID 核對；此結果不會直接修改狀態或 Canon。",
  ].join("\n");
}

function repeatedSentences(text: string) {
  const sentences = splitBrowserModelSentences(text)
    .map((sentence) => sentence.replace(/\s+/gu, "").trim())
    .filter((sentence) => sentence.length >= 10);
  const counts = new Map<string, number>();
  for (const sentence of sentences) counts.set(sentence, (counts.get(sentence) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);
}

function pacingCheck(text: string) {
  const paragraphs = text.split(/\n\s*\n/gu).map((item) => item.trim()).filter(Boolean);
  const sentences = splitBrowserModelSentences(text);
  const dialogueCount = (text.match(/[「『][^」』]+[」』]/gu) ?? []).length;
  const actionCount = matchingTerms(text, ["走", "跑", "推", "拉", "抓", "轉身", "進入", "離開", "打", "追"]).length;
  const longParagraphs = paragraphs.filter((paragraph) => paragraph.length > 420).length;
  const averageSentence = sentences.length
    ? Math.round(sentences.reduce((sum, sentence) => sum + sentence.length, 0) / sentences.length)
    : 0;
  return [
    `節奏掃描：${paragraphs.length} 段、${sentences.length} 句、平均句長 ${averageSentence} 字。`,
    `可見動態：對話 ${dialogueCount} 段、行動線索 ${actionCount} 類。`,
    longParagraphs
      ? `發現 ${longParagraphs} 個超過 420 字的長段落；可在動作、視角轉移或資訊揭露處分段。`
      : "段落密度未出現明顯過長警訊。",
    dialogueCount === 0 && text.length > 500
      ? "本段較偏敘述；若目標是即時場景，可加入角色行動或具目的的對話。"
      : "對話與敘述比例需依場景目的由作者判斷。",
  ].join("\n");
}

function timelineCheck(text: string) {
  const markers = [...text.matchAll(
    /(?:翌日|隔天|當晚|清晨|正午|黃昏|深夜|稍後|片刻後|\d+[年月日時分]|第[一二三四五六七八九十百零\d]+天)/gu,
  )].map((match) => match[0]);
  const reversal = matchingTerms(text, ["回到從前", "時間倒流", "回憶", "多年以前", "同一時間"]);
  return [
    `時間線掃描：找到 ${markers.length} 個明確時間標記。`,
    markers.length ? `依出現順序：${markers.slice(0, 16).join(" → ")}${markers.length > 16 ? "…" : ""}` : "沒有足夠時間標記，跨場景先後可能需要補強。",
    reversal.length ? `非線性線索：${reversal.join("、")}；請確認切換點有清楚標示。` : "未偵測到明確倒敘或時間逆轉詞。",
    "這是文字順序掃描；旅行時間與 Canon 日期仍需對照 Story Bible。",
  ].join("\n");
}

function consistencyCheck(text: string) {
  const ageFacts = new Map<string, Set<number>>();
  for (const match of text.matchAll(/([\p{Script=Han}]{2,4})(?:今年|年齡(?:是|為)?|已經)?\s*(\d{1,3})\s*歲/gu)) {
    const ages = ageFacts.get(match[1]) ?? new Set<number>();
    ages.add(Number(match[2]));
    ageFacts.set(match[1], ages);
  }
  const ageConflicts = [...ageFacts.entries()].filter(([, ages]) => ages.size > 1);
  const duplicated = repeatedSentences(text);
  const negationPairs = [
    ["已死", "還活著"],
    ["從未見過", "再次見到"],
    ["不會魔法", "施展魔法"],
    ["無法離開", "離開了"],
  ].filter(([left, right]) => text.includes(left) && text.includes(right));
  return [
    `一致性掃描：年齡衝突 ${ageConflicts.length}、可能狀態衝突 ${negationPairs.length}、重複句 ${duplicated.length}。`,
    ageConflicts.length
      ? `年齡：${ageConflicts.map(([name, ages]) => `${name}=${[...ages].join("/")}歲`).join("；")}`
      : "未發現同名角色的明顯年齡衝突。",
    negationPairs.length
      ? `狀態：${negationPairs.map((pair) => pair.join(" ↔ ")).join("；")}。需回到上下文判斷是否為合理轉折。`
      : "未發現內建規則可直接判定的狀態對撞。",
    duplicated.length
      ? `重複：${duplicated.map(([sentence, count]) => `「${sentence.slice(0, 36)}」×${count}`).join("；")}`
      : "未發現完全相同的長句重複。",
  ].join("\n");
}

function foreshadowingCheck(text: string) {
  const setup = matchingTerms(text, ["似乎", "不祥", "預言", "夢見", "藏著", "秘密", "約定", "總有一天", "留下", "異樣"]);
  const payoff = matchingTerms(text, ["原來", "果然", "終於明白", "真相", "兌現", "揭露", "應驗", "找回"]);
  return [
    `伏筆掃描：埋設線索 ${setup.length} 類、回收線索 ${payoff.length} 類。`,
    setup.length ? `可能埋設：${setup.join("、")}。` : "沒有偵測到明顯伏筆提示詞。",
    payoff.length ? `可能回收：${payoff.join("、")}。` : "沒有偵測到明顯回收提示詞。",
    setup.length > payoff.length + 3
      ? "埋設明顯多於回收；建議在 Story Bible 為每條線索設定預期回收窗口。"
      : "是否真正回收仍需逐條比對線索身分與 Canon。",
  ].join("\n");
}

function worldRuleCheck(text: string) {
  const rules = splitBrowserModelSentences(text).filter((sentence) =>
    /(?:必須|不得|不能|只能|每當|除非|一旦|規則|代價)/u.test(sentence));
  const exceptions = rules.filter((sentence) => /(?:但是|然而|除非|例外|卻)/u.test(sentence));
  return [
    `世界規則掃描：找到 ${rules.length} 條規則型句子，其中 ${exceptions.length} 條包含例外或轉折。`,
    ...rules.slice(0, 8).map((rule, index) => `${index + 1}. ${rule.slice(0, 120)}`),
    rules.length ? "請為每條規則補齊觸發條件、效果、限制、例外與代價，再與正文事件逐項比對。" : "目前沒有足夠明確的規則句；不會自行猜測世界規則。",
  ].join("\n");
}

function plotAnalysis(text: string) {
  const conflict = matchingTerms(text, ["阻止", "拒絕", "威脅", "追", "逃", "爭奪", "失去", "危險"]);
  const choices = matchingTerms(text, ["決定", "選擇", "答應", "拒絕", "冒險", "犧牲"]);
  const consequences = matchingTerms(text, ["因此", "結果", "代價", "導致", "只好", "從此", "卻"]);
  return [
    `劇情因果掃描：阻力 ${conflict.length} 類、選擇 ${choices.length} 類、後果 ${consequences.length} 類。`,
    conflict.length ? `可見阻力：${conflict.join("、")}。` : "未找到明確阻力，場景目標可能缺少對抗。",
    choices.length ? `可見選擇：${choices.join("、")}。` : "未找到明確角色選擇，事件可能主要由外力推動。",
    consequences.length ? `可見後果：${consequences.join("、")}。` : "未找到明確後果詞，建議讓選擇產生可見改變或代價。",
  ].join("\n");
}

function originalityCheck(text: string) {
  const duplicated = repeatedSentences(text);
  const generic = matchingTerms(text, ["命運的齒輪", "不由自主", "嘴角微微上揚", "一切才剛剛開始", "倒吸一口涼氣", "眼神一凜"]);
  return [
    "原創性自檢：這是作品內部重複與慣用表達掃描，不是網路抄襲比對。",
    duplicated.length ? `完全重複句：${duplicated.length} 組；優先檢查是否為誤貼。` : "未發現完全相同的長句重複。",
    generic.length ? `高頻慣用語：${generic.join("、")}；可改成角色專屬動作、具體代價或作品意象。` : "未命中內建高頻慣用語清單。",
    "提高辨識度時，優先改變衝突機制、角色選擇、代價與意象，不必只做同義詞替換。",
  ].join("\n");
}

function chapterReview(text: string) {
  return [
    "【章節摘要】",
    runPackagedBrowserExtractiveModel(text).content,
    "【場景與因果】",
    classifyScene(text),
    plotAnalysis(text),
    "【節奏】",
    pacingCheck(text),
    "【一致性】",
    consistencyCheck(text),
    "【優先修訂】",
    "先處理明確衝突與重複，再補角色選擇及後果；所有建議都是候選，不會直接修改 Canon。",
  ].join("\n");
}

export function isNativeBrowserSummaryTask(taskType: PlatformTaskType) {
  return NATIVE_SUMMARY_TASKS.has(taskType);
}

export function runPackagedBrowserTaskModel(
  taskType: PlatformTaskType,
  text: string,
) {
  const source = text.replace(/\r\n?/gu, "\n").trim();
  if (!source) {
    throw Object.assign(new Error("瀏覽器模型需要可分析的文字。"), {
      code: "BROWSER_AI_INPUT_REQUIRED",
      retryable: false,
    });
  }
  let content: string;
  switch (taskType) {
    case "story.summary":
    case "chapter.compress":
    case "drama.shortSummary":
      content = runPackagedBrowserExtractiveModel(source).content;
      break;
    case "story.chapterReview":
      content = chapterReview(source);
      break;
    case "story.consistencyCheck":
      content = consistencyCheck(source);
      break;
    case "story.timelineCheck":
      content = timelineCheck(source);
      break;
    case "story.characterCheck":
      content = `${dialogueConsistency(source)}\n${consistencyCheck(source)}`;
      break;
    case "story.worldRuleCheck":
      content = worldRuleCheck(source);
      break;
    case "story.foreshadowingCheck":
      content = foreshadowingCheck(source);
      break;
    case "story.plotAnalysis":
      content = plotAnalysis(source);
      break;
    case "story.pacingCheck":
      content = pacingCheck(source);
      break;
    case "story.originalityCheck":
      content = originalityCheck(source);
      break;
    case "character.nameExtract": {
      const names = extractNames(source);
      content = names.length
        ? `可驗證的人名候選：${names.join("、")}。僅列出與說話或動作語法相連的名稱，請由作者核准。`
        : "人名擷取：沒有找到足夠明確的姓名語法證據；不以一般名詞猜測角色姓名。";
      break;
    }
    case "character.emotionClassify": {
      const result = classifyEmotion(source);
      content = `角色情緒分類：${result.label}。${result.terms.length ? `文字證據：${result.terms.join("、")}。` : "沒有足夠顯性情緒詞，需人工判讀。"}這只依輸入中的可見詞彙分類，仍需作者核對語境、否定詞與角色偽裝。`;
      break;
    }
    case "drama.emotionCurve":
      content = emotionCurve(source);
      break;
    case "drama.chapterClassify":
      content = classifyChapter(source);
      break;
    case "drama.sceneClassify":
      content = classifyScene(source);
      break;
    case "drama.characterPresence": {
      const names = extractNames(source);
      content = names.length
        ? `角色出場候選：${names.join("、")}。這份結果只依明確說話／動作語法擷取，未推測未出場人物。`
        : "角色出場檢查：沒有足夠明確的姓名證據；可能只有代名詞或未命名角色，請人工確認。";
      break;
    }
    case "character.dialogueConsistency":
      content = dialogueConsistency(source);
      break;
    case "game.stateEvaluation":
      content = gameStateEvaluation(source);
      break;
    case "character.traitClassify": {
      const decisive = matchingTerms(source, ["決定", "堅持", "拒絕", "必須"]);
      const cautious = matchingTerms(source, ["觀察", "等待", "猶豫", "小心"]);
      const label = decisive.length > cautious.length
        ? "果斷傾向"
        : cautious.length
          ? "審慎傾向"
          : "證據不足";
      content = `角色特質分類：${label}。依據為行動詞而非作者標籤；相關詞：${[...decisive, ...cautious].join("、") || "未偵測到"}。`;
      break;
    }
    case "character.voiceClassify": {
      const questions = (source.match(/[？?]/gu) ?? []).length;
      const shortLines = splitBrowserModelSentences(source)
        .filter((sentence) => sentence.length <= 18).length;
      content = `角色語氣分類：${questions > 1 ? "追問／質疑傾向" : shortLines > 2 ? "簡短直接傾向" : "敘述型／證據有限"}。可量測證據：問句 ${questions}、短句 ${shortLines}。`;
      break;
    }
    case "character.relationshipEventClassify": {
      const conflict = matchingTerms(source, ["拒絕", "背叛", "爭吵", "威脅", "離開"]);
      const trust = matchingTerms(source, ["相信", "答應", "保護", "合作", "原諒"])
        .filter((term) =>
          !source.includes(`不${term}`)
          && !source.includes(`未${term}`)
          && !source.includes(`拒絕${term}`));
      content = `關係事件分類：${conflict.length > trust.length ? "關係受損" : trust.length ? "信任增強" : "未形成明確變化"}。文字線索：${[...conflict, ...trust].join("、") || "不足"}。這是待核准的候選分類，不會直接修改人物關係或 Canon。`;
      break;
    }
    case "drama.beatSuggestion":
      content = `節拍建議：先讓角色對「${evidence(source).slice(0, 70)}」做出可見反應，再加入一個選擇與明確代價；此為候選，不是 Canon。`;
      break;
    default:
      throw Object.assign(new Error("這個輕量工作尚未由瀏覽器模型實作。"), {
        code: "BROWSER_AI_TASK_NOT_SUPPORTED",
        retryable: false,
      });
  }
  return {
    content: content.trim(),
    modelId: BROWSER_TASK_MODEL.modelId,
    modelDigest: BROWSER_TASK_MODEL.modelDigest,
    externalRequest: false as const,
    dataLeftDevice: false as const,
  };
}
