import type { PlatformTaskType } from "../../router/platform-types";
import {
  runPackagedBrowserExtractiveModel,
  splitBrowserModelSentences,
} from "./browser-extractive-model";

export const BROWSER_TASK_MODEL = Object.freeze({
  schemaVersion: "novel-browser-task-runtime-v2",
  modelId: "novel-browser-task-runtime-v2",
  modelDigest: "ac7af317902b9bb7f4c8806b61a7a52962ce43f4ac747d3917fa0d721c25b59f",
  rankerModelId: "novel-browser-extractive-v1",
  externalRequest: false,
  dataLeftDevice: false,
} as const);

const NATIVE_SUMMARY_TASKS = new Set<PlatformTaskType>([
  "story.summary",
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
    case "drama.shortSummary":
      content = runPackagedBrowserExtractiveModel(source).content;
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
