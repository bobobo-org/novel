import {
  createTextFingerprint,
  fingerprintOverlap,
  longestDirectSourceMatch,
  normalizeForLearning,
  sha256Hex,
  stableStringify,
} from "./hashing";
import type {
  LearningRuleDimension,
  LearningRuleDraft,
  LearningRuleFamily,
  LearningWebSourceProfile,
} from "./types";

export const VERIFIED_STORY_TEACHER_VERSION = "closed-story-causal-teacher-v1" as const;
export const VERIFIED_STORY_RESEARCH_SCHEMA_VERSION = "verified-story-research-v1" as const;

export const VERIFIED_STORY_TEACHER_CONTRACT = {
  teacherId: "closed-story-causal-teacher",
  version: VERIFIED_STORY_TEACHER_VERSION,
  executionBoundary: "closed_local_deterministic",
  rawStoryRetention: false,
  namedEntityRetention: false,
  externalRequestCount: 0,
  classificationDimensions: [
    "story_format",
    "genre_pressure",
    "protagonist_drive",
    "trigger_event",
    "causal_chain",
    "conflict_escalation",
    "stakes_and_cost",
    "relationship_movement",
    "functional_prop",
    "information_gap",
    "foreshadowing",
    "identity_or_status_reversal",
    "emotional_debt",
    "payoff",
    "quote_or_screenshot_moment",
    "social_debate_trigger",
    "cliffhanger",
    "episode_retention",
  ],
} as const;

export type StoryEvidenceGrade = "content_rich" | "content_partial" | "metadata_only" | "insufficient";

export type StoryMechanismSignal = {
  id: string;
  label: string;
  markerCount: number;
  signalStrength: number;
  confidence: number;
  causalFunction: string;
  reusablePrinciple: string;
  failureMode: string;
  measurement: string;
};

export type VerifiedStoryResearchProfile = {
  schemaVersion: typeof VERIFIED_STORY_RESEARCH_SCHEMA_VERSION;
  teacher: {
    teacherId: typeof VERIFIED_STORY_TEACHER_CONTRACT.teacherId;
    version: typeof VERIFIED_STORY_TEACHER_VERSION;
    contractDigest: string;
    verification: "verified";
    executionBoundary: "closed_local_deterministic";
    externalRequestCount: 0;
    dataLeavesDevice: false;
  };
  evidence: {
    grade: StoryEvidenceGrade;
    characterCount: number;
    sentenceCount: number;
    narrativeMarkerCount: number;
    narrativeMarkerDensity: number;
    sourceChannel: LearningWebSourceProfile["channel"];
    sourceQualityBasis: "content_evidence_only";
  };
  classification: {
    format: "short_drama" | "serialized_story" | "long_form_story" | "story_analysis" | "unknown";
    genreSignals: string[];
    protagonistDrive: "survival" | "justice" | "relationship" | "identity" | "achievement" | "discovery" | "mixed";
    conflictLayers: string[];
  };
  causalMap: {
    setupStrength: number;
    triggerStrength: number;
    escalationStrength: number;
    reversalStrength: number;
    payoffStrength: number;
    consequenceStrength: number;
    completeness: number;
    missingStages: string[];
  };
  mechanisms: StoryMechanismSignal[];
  warnings: string[];
  rawStoryRetained: false;
  sourceSentencesRetained: false;
  namedEntitiesRetained: false;
};

type SignalDefinition = Omit<StoryMechanismSignal, "markerCount" | "signalStrength" | "confidence"> & {
  pattern: RegExp;
  targetCount: number;
};

const SIGNALS: SignalDefinition[] = [
  {
    id: "trigger_event",
    label: "觸發事件",
    pattern: /突然|某天|直到|當.+(?:發現|得知)|發現|得知|收到|被迫|事故|失蹤|死亡|穿越|重生|醒來|通知|闖入|trigger|discover(?:s|ed)?|learn(?:s|ed)?|forced|accident|vanish(?:es|ed)?|awakens?/giu,
    targetCount: 3,
    causalFunction: "打破原本平衡，迫使主要人物採取第一個有代價的行動。",
    reusablePrinciple: "先建立可辨識的失衡，再用單一事件鎖定本回合的行動方向。",
    failureMode: "只有突發刺激，卻沒有造成選擇、代價或後續因果。",
    measurement: "觸發後三個敘事節拍內，目標、阻力或風險至少一項必須改變。",
  },
  {
    id: "goal_pressure",
    label: "人物目標與壓力",
    pattern: /想要|必須|決定|發誓|為了|尋找|保護|逃離|復仇|證明|完成|目標|期限|倒數|must|need(?:s|ed)? to|wants? to|seeks? to|protect|escape|revenge|deadline/giu,
    targetCount: 5,
    causalFunction: "把事件轉成可判斷成敗的主動目標，並建立不行動的代價。",
    reusablePrinciple: "每一段推進都同時回答人物要什麼、現在擋住什麼、失敗會失去什麼。",
    failureMode: "人物只被情節拖行，沒有可觀察的企圖與決策。",
    measurement: "任一場景都能用一句話寫出目標、阻力、代價與狀態變化。",
  },
  {
    id: "causal_escalation",
    label: "因果升壓",
    pattern: /因此|所以|導致|結果|代價|後果|更糟|失去|來不及|只剩|不得不|because|therefore|so that|caus(?:e|ed)|consequence|cost|worse|too late|no choice/giu,
    targetCount: 6,
    causalFunction: "讓前一個決定生成下一個限制，使壓力不是隨機堆疊。",
    reusablePrinciple: "每次升壓至少增加代價、縮短時間、暴露資訊或移除退路其中一項。",
    failureMode: "連續加入陌生危機，前後事件互不造成彼此。",
    measurement: "將事件連成因為／所以句；任何無法連接的刺激都要刪除或補因果。",
  },
  {
    id: "functional_prop",
    label: "關鍵道具",
    pattern: /戒指|項鍊|鑰匙|手機|照片|信件|契約|合約|錄音|影片|證件|印章|病歷|票據|遺囑|盒子|門卡|ring|necklace|key|phone|photo|letter|contract|recording|identity card|will|box/giu,
    targetCount: 3,
    causalFunction: "把抽象秘密、權力或承諾變成能被看見、爭奪與驗證的物件。",
    reusablePrinciple: "道具至少承擔證明、通行、交換、威脅、記憶或計時中的一種功能。",
    failureMode: "物件只作裝飾，出現與消失都不改變人物的選擇。",
    measurement: "移除道具後若因果鏈不變，應合併、刪除或重新賦予功能。",
  },
  {
    id: "information_gap",
    label: "資訊差與懸念",
    pattern: /秘密|隱瞞|不知道|誤會|真相|線索|謊言|假裝|其實|只有.+知道|secret|hide|unknown|misunderstand|truth|clue|lie|pretend|actually/giu,
    targetCount: 5,
    causalFunction: "讓人物、觀眾與對手持有不同答案，形成預期與誤判。",
    reusablePrinciple: "先明確本輪追問，再分配誰知道、誰誤判、誰從誤判獲利。",
    failureMode: "只把必要資訊藏起來，沒有讓資訊差產生行動或風險。",
    measurement: "每次延後答案，都必須先交付一項可驗證線索或新的決策壓力。",
  },
  {
    id: "identity_status_reversal",
    label: "身份／地位反轉",
    pattern: /身份|身分|原來是|真正的|冒充|繼承|老闆|總裁|董事|首富|王|排名|看不起|羞辱|認出|identity|actually the|impostor|heir|boss|ceo|rank|humiliat|recognize/giu,
    targetCount: 4,
    causalFunction: "重排人物之間的權力與解讀，使先前行為產生新的後果。",
    reusablePrinciple: "反轉前先埋可回看的線索，反轉後立刻改變資源、關係或下一步行動。",
    failureMode: "只宣布更大的頭銜，沒有線索、代價或局勢變化。",
    measurement: "反轉後至少三項狀態改變：誰能決定、誰失去什麼、誰必須重新選擇。",
  },
  {
    id: "relationship_movement",
    label: "關係推進",
    pattern: /信任|背叛|誤會|原諒|合作|分手|結婚|家人|朋友|敵人|愛|恨|保護|利用|trust|betray|forgive|ally|break up|marry|family|friend|enemy|love|hate|use(?:s|d)?/giu,
    targetCount: 5,
    causalFunction: "把事件後果轉成關係距離、義務與權力的可追蹤變化。",
    reusablePrinciple: "每場關係戲必須改變信任、依賴、秘密、義務或支配權至少一項。",
    failureMode: "人物說了很多情緒，但場景結束後關係狀態完全相同。",
    measurement: "比較場景前後雙方願意提供的資訊、資源與承諾是否改變。",
  },
  {
    id: "emotional_debt",
    label: "情緒債與爽點蓄力",
    pattern: /委屈|冤枉|羞辱|陷害|搶走|壓迫|犧牲|忍耐|欠|報復|反擊|公道|justice|wronged|humiliat|frame(?:d)?|oppress|sacrifice|endure|owe|revenge|fight back/giu,
    targetCount: 5,
    causalFunction: "累積可記帳的不公平，使後續回收具有情緒重量。",
    reusablePrinciple: "爽點前要具體記錄誰奪走什麼、觀眾等待什麼、主角承受了多少成本。",
    failureMode: "只堆受苦畫面，沒有可辨識的欠債人、欠債內容與回收方式。",
    measurement: "回收時同時完成能力證明、責任歸位與人物主動選擇中的至少兩項。",
  },
  {
    id: "payoff",
    label: "回收與爽點",
    pattern: /終於|成功|證明|揭穿|反擊|逆轉|道歉|付出代價|報應|贏|救回|完成|finally|succeed|prove|expose|fight back|reverse|apolog|pay the price|win|rescue|complete/giu,
    targetCount: 4,
    causalFunction: "兌現前面建立的承諾、情緒債或能力期待。",
    reusablePrinciple: "回收必須對準先前明確建立的問題，並讓結果留下新的現實狀態。",
    failureMode: "突然靠外力解決，或只給口頭勝利而沒有代價與狀態更新。",
    measurement: "逐項對照前置承諾；沒有前置的勝利不算回收，有前置未處理則列入後續債務。",
  },
  {
    id: "reveal_reversal",
    label: "揭露與反轉節拍",
    pattern: /原來|竟然|其實|沒想到|卻是|真相|揭露|才知道|不料|反轉|turns out|surprisingly|actually|truth|reveal|twist/giu,
    targetCount: 4,
    causalFunction: "重新解釋既有資訊，同時改變人物的判斷與行動。",
    reusablePrinciple: "把答案拆為線索、局部答案、代價與更大問題，避免一次說完。",
    failureMode: "反轉只否定前文，沒有可回看的線索，也不影響後續選擇。",
    measurement: "反轉前至少一項公平線索；反轉後至少一項行動路線立即改變。",
  },
  {
    id: "contrast_release",
    label: "情緒反差",
    pattern: /但是|然而|可是|卻|反而|偏偏|笑.+哭|愛.+恨|希望.+絕望|but|however|yet|instead|laugh.+cry|love.+hate|hope.+despair/giu,
    targetCount: 5,
    causalFunction: "用相反情緒或地位快速拉開感受差，提升記憶點。",
    reusablePrinciple: "反差兩端必須由同一因果鏈連接，且後一端改變人物理解。",
    failureMode: "為反差而反差，前後語氣與人物動機互相取消。",
    measurement: "能說明從前一情緒到後一情緒的具體事件與認知變化。",
  },
  {
    id: "quote_screenshot_moment",
    label: "可轉述／截圖時刻",
    pattern: /[「『“"][^」』”"\n]{4,48}[」』”"]|我不會|你以為|從今天起|記住|只有我|輪不到|I will not|you think|from now on|remember this/giu,
    targetCount: 4,
    causalFunction: "把複雜的權力變化壓縮成一個可獨立理解的畫面或句子。",
    reusablePrinciple: "先讓場景完成權力變化，再用一句短而具體的表態封住結果。",
    failureMode: "先寫金句再硬湊情節，導致台詞與人物代價脫節。",
    measurement: "截取該時刻後仍能看懂立場變化，放回全文又能找到完整因果。",
  },
  {
    id: "social_debate_trigger",
    label: "社群爭議觸發",
    pattern: /應不應該|到底誰|對不對|值得嗎|選誰|站隊|公平|道德|背叛|原諒|should|who is right|fair|moral|betray|forgive|choose/giu,
    targetCount: 3,
    causalFunction: "提供至少兩個有代價的可辯立場，促使觀眾表態與分享。",
    reusablePrinciple: "爭議必須源自人物價值與已發生後果，而不是靠資訊缺失製造吵架。",
    failureMode: "故意隱藏常識或讓人物失智，只為逼觀眾留言。",
    measurement: "能各用一句話寫出雙方最強理由，且兩邊都必須承擔真實代價。",
  },
  {
    id: "cliffhanger",
    label: "章尾／集尾鉤子",
    pattern: /突然|就在這時|門外|腳步聲|來不及|倒數|未完|下一秒|電話響|打開門|to be continued|suddenly|at that moment|too late|countdown|the phone rang|opened the door/giu,
    targetCount: 4,
    causalFunction: "在答案、行動或後果即將落下時切斷，保留明確的下一步需求。",
    reusablePrinciple: "鉤子必須由本段因果推到門檻，下一段開頭優先交付而非換題。",
    failureMode: "憑空加入陌生威脅，或下一段跳過承諾不作回答。",
    measurement: "觀眾能具體說出下一段要看到的答案、行動或後果。",
  },
  {
    id: "episode_retention",
    label: "追更循環",
    pattern: /第\s*\d+\s*[集章]|下一集|下回|系列|連載|待續|episode|chapter\s*\d+|next episode|series|serial|continued/giu,
    targetCount: 3,
    causalFunction: "把一個大承諾拆成可交付的小回收與仍在增長的長線問題。",
    reusablePrinciple: "每回至少交付一項舊承諾，同時只開啟一至兩項更高價值的新問題。",
    failureMode: "只開新坑不回收，或每回重置人物與世界狀態。",
    measurement: "建立承諾帳本，檢查本回已回收、延後與新開的項目比例。",
  },
  {
    id: "consequence_memory",
    label: "後果記憶",
    pattern: /從此|再也|失去|留下|改變|承擔|受傷|分開|被發現|代價|never again|lost|remain|changed|bear the|injured|separated|exposed|cost/giu,
    targetCount: 4,
    causalFunction: "把高潮結果寫回人物、關係、資源與世界狀態，避免下一回歸零。",
    reusablePrinciple: "重大事件後至少更新一項資源、一項關係或一項認知狀態。",
    failureMode: "高潮只提供刺激，下一場所有人像沒發生過一樣。",
    measurement: "比較事件前後狀態表；若沒有持續差異，高潮尚未真正發生。",
  },
];

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countMatches(value: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return [...value.matchAll(pattern)].length;
}

function evidenceGrade(characterCount: number, sentenceCount: number, narrativeMarkerDensity: number): StoryEvidenceGrade {
  if (characterCount >= 2_400 && sentenceCount >= 24 && narrativeMarkerDensity >= 1.8) return "content_rich";
  if (characterCount >= 900 && sentenceCount >= 8 && narrativeMarkerDensity >= 0.8) return "content_partial";
  if (characterCount >= 240) return "metadata_only";
  return "insufficient";
}

function strongestDrive(text: string): VerifiedStoryResearchProfile["classification"]["protagonistDrive"] {
  const entries: Array<[Exclude<VerifiedStoryResearchProfile["classification"]["protagonistDrive"], "mixed">, RegExp]> = [
    ["survival", /活下去|逃離|保命|救命|生存|survive|escape|stay alive/giu],
    ["justice", /公道|復仇|真相|證明清白|揭穿|正義|justice|revenge|clear.+name|expose/giu],
    ["relationship", /挽回|守護|家人|愛人|婚姻|朋友|reconcile|protect.+family|lover|marriage|friend/giu],
    ["identity", /身份|身分|認出|我是誰|冒充|血統|identity|who am i|impostor|bloodline/giu],
    ["achievement", /成功|贏得|第一名|完成|事業|夢想|succeed|win|first place|career|dream/giu],
    ["discovery", /尋找|調查|發現|解開|探索|find|investigate|discover|solve|explore/giu],
  ];
  const ranked = entries
    .map(([drive, pattern]) => ({ drive, count: countMatches(text, pattern) }))
    .sort((left, right) => right.count - left.count);
  return ranked[0]?.count && ranked[0].count > (ranked[1]?.count ?? 0) ? ranked[0].drive : "mixed";
}

function classifyFormat(profile: LearningWebSourceProfile, text: string) {
  if (profile.channel === "youtube" && /短劇|微短劇|短篇|short\s*drama|mini\s*drama/iu.test(text)) return "short_drama" as const;
  if (/第\s*\d+\s*[集章]|下一集|下回|連載|episode|chapter\s*\d+|next episode|serial/iu.test(text)) return "serialized_story" as const;
  if (text.length >= 12_000) return "long_form_story" as const;
  if (/分析|研究|評論|結構|analysis|review|structure/iu.test(text)) return "story_analysis" as const;
  return "unknown" as const;
}

function genreSignals(text: string) {
  const definitions: Array<[string, RegExp]> = [
    ["愛情／關係", /愛情|戀愛|婚姻|分手|情侶|love|romance|marriage|break up/giu],
    ["家庭／倫理", /家庭|父母|孩子|兄弟|姊妹|婆媳|family|parent|child|sibling/giu],
    ["懸疑／秘密", /秘密|真相|失蹤|兇手|調查|線索|mystery|secret|truth|missing|killer|clue/giu],
    ["身份／逆襲", /身份|身分|逆襲|首富|繼承|看不起|identity|comeback|heir|humiliat/giu],
    ["職場／權力", /公司|職場|老闆|總裁|董事|合約|office|company|boss|ceo|contract/giu],
    ["奇幻／超常", /魔法|修仙|異能|穿越|重生|妖|神|magic|fantasy|superpower|time travel|rebirth/giu],
    ["犯罪／復仇", /犯罪|復仇|綁架|陷害|警察|crime|revenge|kidnap|frame|police/giu],
  ];
  return definitions
    .map(([label, pattern]) => ({ label, count: countMatches(text, pattern) }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 4)
    .map((item) => item.label);
}

function conflictLayers(text: string) {
  const layers = [
    [/猶豫|恐懼|內疚|自責|不敢|doubt|fear|guilt|hesitat/iu, "內在選擇"],
    [/爭吵|對抗|敵人|背叛|欺騙|fight|enemy|betray|deceive/iu, "人物對抗"],
    [/家族|公司|制度|法律|階級|family|company|system|law|class/iu, "群體／制度"],
    [/時間|倒數|期限|來不及|deadline|countdown|too late/iu, "時間壓力"],
    [/秘密|誤會|資訊|真相|secret|misunderstand|information|truth/iu, "資訊不對稱"],
  ].flatMap(([pattern, label]) => (pattern as RegExp).test(text) ? [label as string] : []);
  return layers.length ? layers : ["未能由目前公開文字可靠辨識"];
}

export async function analyzeStoryWithVerifiedTeacher(input: {
  sourceText: string;
  sourceProfile?: LearningWebSourceProfile;
}): Promise<VerifiedStoryResearchProfile> {
  const text = normalizeForLearning(input.sourceText).slice(0, 60_000);
  const profile = input.sourceProfile ?? { channel: "article" };
  const sentences = text.split(/(?<=[。！？!?…])|\n+/u).map((item) => item.trim()).filter(Boolean);
  const signalCounts = SIGNALS.map((definition) => countMatches(text, definition.pattern));
  const narrativeMarkerCount = signalCounts.reduce((total, value) => total + value, 0);
  const narrativeMarkerDensity = round(narrativeMarkerCount / Math.max(1, text.length / 1_000));
  const grade = evidenceGrade(text.length, sentences.length, narrativeMarkerDensity);
  const gradeWeight = { content_rich: 1, content_partial: 0.82, metadata_only: 0.52, insufficient: 0.2 }[grade];
  const mechanisms = SIGNALS.map((definition, index): StoryMechanismSignal => {
    const markerCount = signalCounts[index];
    const signalStrength = round(clamp(markerCount / definition.targetCount));
    return {
      id: definition.id,
      label: definition.label,
      markerCount,
      signalStrength,
      confidence: round(clamp((0.35 + signalStrength * 0.55) * gradeWeight, 0.12, 0.96)),
      causalFunction: definition.causalFunction,
      reusablePrinciple: definition.reusablePrinciple,
      failureMode: definition.failureMode,
      measurement: definition.measurement,
    };
  });
  const strength = (id: string) => mechanisms.find((item) => item.id === id)?.signalStrength ?? 0;
  const setupStrength = round(clamp((strength("goal_pressure") + strength("relationship_movement")) / 2));
  const triggerStrength = strength("trigger_event");
  const escalationStrength = round(clamp((strength("causal_escalation") + strength("emotional_debt")) / 2));
  const reversalStrength = round(clamp((strength("reveal_reversal") + strength("identity_status_reversal")) / 2));
  const payoffStrength = strength("payoff");
  const consequenceStrength = strength("consequence_memory");
  const stages = [setupStrength, triggerStrength, escalationStrength, reversalStrength, payoffStrength, consequenceStrength];
  const stageNames = ["前提／目標", "觸發事件", "因果升壓", "揭露／反轉", "爽點／回收", "持續後果"];
  const missingStages = stageNames.filter((_, index) => stages[index] < 0.25);
  const warnings = [
    ...(grade === "metadata_only" ? ["STORY_EVIDENCE_METADATA_ONLY"] : []),
    ...(grade === "insufficient" ? ["STORY_EVIDENCE_INSUFFICIENT"] : []),
    ...(missingStages.length ? ["CAUSAL_CHAIN_INCOMPLETE"] : []),
  ];
  return {
    schemaVersion: VERIFIED_STORY_RESEARCH_SCHEMA_VERSION,
    teacher: {
      teacherId: VERIFIED_STORY_TEACHER_CONTRACT.teacherId,
      version: VERIFIED_STORY_TEACHER_VERSION,
      contractDigest: await sha256Hex(stableStringify(VERIFIED_STORY_TEACHER_CONTRACT)),
      verification: "verified",
      executionBoundary: "closed_local_deterministic",
      externalRequestCount: 0,
      dataLeavesDevice: false,
    },
    evidence: {
      grade,
      characterCount: text.length,
      sentenceCount: sentences.length,
      narrativeMarkerCount,
      narrativeMarkerDensity,
      sourceChannel: profile.channel,
      sourceQualityBasis: "content_evidence_only",
    },
    classification: {
      format: classifyFormat(profile, text),
      genreSignals: genreSignals(text),
      protagonistDrive: strongestDrive(text),
      conflictLayers: conflictLayers(text),
    },
    causalMap: {
      setupStrength,
      triggerStrength,
      escalationStrength,
      reversalStrength,
      payoffStrength,
      consequenceStrength,
      completeness: round(stages.reduce((total, value) => total + value, 0) / stages.length),
      missingStages,
    },
    mechanisms,
    warnings,
    rawStoryRetained: false,
    sourceSentencesRetained: false,
    namedEntitiesRetained: false,
  };
}

type RuleBlueprint = {
  mechanismId: string;
  family: LearningRuleFamily;
  dimension: LearningRuleDimension;
  statement: string;
  when: string;
  operation: string;
  constraint: string;
  evaluate: string;
  tags: string[];
};

const RULE_BLUEPRINTS: RuleBlueprint[] = [
  { mechanismId: "trigger_event", family: "structure", dimension: "opening_hook", statement: "先建立可辨識的失衡狀態，再用單一觸發事件迫使主要人物做出不能無成本撤回的第一個選擇。", when: "故事、章節或短劇開場需要把觀眾帶進主線時", operation: "用現況、異常、選擇三個節拍完成開場，並讓選擇立刻產生後果", constraint: "不能只靠突發事故製造刺激，事件必須改變目標、阻力或風險", evaluate: "檢查觸發後三個節拍內，人物的下一步是否已由事件推導出來", tags: ["觸發事件", "開場鉤子", "因果"] },
  { mechanismId: "goal_pressure", family: "character", dimension: "character_pressure", statement: "把人物慾望寫成可觀察的目標，並同時標出阻力、期限與不行動會付出的代價。", when: "人物進入新場景或目標改變時", operation: "以目標、阻力、代價、退路四格建立人物壓力", constraint: "不得讓人物只被巧合推著走，也不能用旁白代替選擇", evaluate: "每場戲是否能清楚回答人物要什麼、怕失去什麼與現在要做什麼", tags: ["人物目標", "代價", "主動性"] },
  { mechanismId: "causal_escalation", family: "pacing", dimension: "conflict_escalation", statement: "讓前一個決定生成下一個限制；每次升壓至少增加代價、縮短時間、暴露資訊或移除退路其中一項。", when: "主要衝突已成立但張力需要持續上升時", operation: "把每個事件改寫成因為前一步所以發生下一步的因果梯", constraint: "禁止用互不相關的新危機取代真正的因果升壓", evaluate: "逐步列出相較前一步新增的實質限制，無新增者應合併或刪除", tags: ["因果鏈", "升壓", "節奏"] },
  { mechanismId: "functional_prop", family: "worldbuilding", dimension: "world_rule_delivery", statement: "關鍵道具必須承擔證明、通行、交換、威脅、記憶或計時功能，並實際改變人物可做的選擇。", when: "秘密、承諾或權力需要被具體化時", operation: "為物件指定持有人、可驗證功能、爭奪理由與失去後果", constraint: "物件不能只作裝飾，也不能在需要時無因出現", evaluate: "移除物件後若因果鏈完全不變，代表道具尚未具有劇情功能", tags: ["關鍵道具", "物件功能", "因果"] },
  { mechanismId: "information_gap", family: "structure", dimension: "information_control", statement: "先確定本輪的核心追問，再分配觀眾、主要人物與對手各自知道、誤判及隱瞞的資訊。", when: "需要建立懸念、誤會或調查動力時", operation: "建立三方知情表，讓資訊差造成可見行動與風險", constraint: "不能只藏起人物理應知道的常識，也不能無限延後答案", evaluate: "每次延後答案前，是否交付一項可驗證線索或新的決策壓力", tags: ["資訊差", "懸念", "觀眾優勢"] },
  { mechanismId: "identity_status_reversal", family: "structure", dimension: "reveal_cadence", statement: "身份或地位反轉前先埋下可回看的公平線索，反轉後立即重排決策權、資源與人物關係。", when: "故事要用身份、能力或地位揭露改寫局勢時", operation: "依線索、誤判、揭露、狀態更新四步完成反轉", constraint: "不能只宣告更大的頭銜，也不能靠未出現過的設定救場", evaluate: "反轉後誰能決定、誰失去什麼與誰必須重新選擇是否都已改變", tags: ["身份反轉", "地位逆轉", "公平線索"] },
  { mechanismId: "relationship_movement", family: "relationship", dimension: "relationship_movement", statement: "每場關係戲至少改變信任、依賴、秘密、義務或支配權其中一項，並把變化帶入後續行動。", when: "兩個以上人物互動但劇情推進感不足時", operation: "比較互動前後雙方願意給出的資訊、資源、承諾與退讓", constraint: "不能只增加情緒台詞卻讓關係狀態維持不變", evaluate: "場景結束後，雙方能做與願意做的事情是否與開始時不同", tags: ["關係變化", "信任", "權力"] },
  { mechanismId: "emotional_debt", family: "character", dimension: "character_pressure", statement: "爽點前先累積可記帳的情緒債：明確誰奪走什麼、人物承受什麼成本，以及觀眾等待哪一種公道。", when: "需要蓄積逆襲、揭穿或正義回收的情緒重量時", operation: "建立欠債者、受損狀態、見證者與預期回收四項紀錄", constraint: "不得只反覆堆受苦畫面，也不得把人物主動性全部拿走", evaluate: "觀眾是否能具體說出誰欠誰、欠了什麼與為何值得等待", tags: ["情緒債", "爽點蓄力", "公道"] },
  { mechanismId: "payoff", family: "foreshadowing", dimension: "foreshadow_payoff", statement: "回收必須對準先前建立的承諾或情緒債，同時完成能力證明、責任歸位與主動選擇中的至少兩項。", when: "高潮、揭穿、逆襲或關係承諾需要兌現時", operation: "逐項對照前置承諾，讓結果寫回人物、關係與資源狀態", constraint: "禁止突然由外力代為解決，也不能只有口頭勝利沒有後果", evaluate: "沒有前置的勝利應刪除，有前置未處理則列入下一回合的承諾帳本", tags: ["爽點回收", "情緒回報", "承諾"] },
  { mechanismId: "reveal_reversal", family: "foreshadowing", dimension: "reveal_cadence", statement: "把答案拆成公平線索、局部解釋、行動代價與更大問題四層，讓每次揭露都改變判斷或下一步。", when: "秘密、真相或誤會需要分段揭露時", operation: "先交付可驗證線索，再給局部答案，最後讓答案製造新選擇", constraint: "反轉不能只否定前文，也不能一次說完所有答案", evaluate: "移除本次揭露後若人物行動完全不變，代表揭露沒有劇情功能", tags: ["揭露節拍", "反轉", "伏筆"] },
  { mechanismId: "contrast_release", family: "style", dimension: "tone", statement: "用同一條因果鏈連接相反的情緒或地位，讓後一端重新解釋前一端，而不是任意切換語氣。", when: "場景需要快速形成記憶點或情緒釋放時", operation: "先固定前一狀態，再用具體事件與認知改變推到相反狀態", constraint: "不能為反差犧牲人物動機與事件連續性", evaluate: "是否能清楚指出造成情緒翻轉的事件與人物理解變化", tags: ["情緒反差", "記憶點", "語氣"] },
  { mechanismId: "quote_screenshot_moment", family: "dialogue", dimension: "dialogue_density", statement: "先讓場景完成一次真實的權力變化，再用短而具體的表態封住結果，形成可轉述但不脫離因果的時刻。", when: "重要立場、關係或地位變化需要被觀眾記住時", operation: "把結果濃縮為一個可視動作加一句角色表態", constraint: "不能先寫金句再硬湊情節，也不能讓句子替代應有的代價", evaluate: "單獨截取仍看得懂立場，放回全文又找得到完整因果", tags: ["金句", "截圖時刻", "分享性"] },
  { mechanismId: "social_debate_trigger", family: "relationship", dimension: "other", statement: "社群爭議必須提供至少兩個都有真實代價的可辯立場，並讓分歧源自人物價值與既有後果。", when: "希望觀眾討論、站隊或分享但不操弄理解時", operation: "分別寫出雙方最強理由、盲點、代價與不可兼得之處", constraint: "禁止靠人物失智、常識缺失或刻意隱瞞必要資訊製造爭吵", evaluate: "兩邊是否都能被理性支持，且選擇任何一邊都會失去某些東西", tags: ["社群討論", "價值衝突", "站隊"] },
  { mechanismId: "cliffhanger", family: "structure", dimension: "ending_hook", statement: "章尾或集尾應停在答案、行動或後果即將落下的門檻，並在下一段開頭優先交付承諾。", when: "分段結尾需要提高續看動機時", operation: "從本段因果推到具體門檻，清楚標示下一段必須回答的問題", constraint: "不能憑空加入陌生危機，也不能在下一段換題逃避承諾", evaluate: "觀眾是否能精確說出下一段要看到的答案、行動或後果", tags: ["集尾鉤子", "續看", "承諾"] },
  { mechanismId: "episode_retention", family: "pacing", dimension: "scene_transition", statement: "每回交付至少一項舊承諾，同時只開啟一至兩項價值更高的新問題，形成可持續的追更循環。", when: "長篇、連載或短劇需要安排回合節奏時", operation: "維護承諾帳本，標記本回回收、延後與新開的問題", constraint: "不得只開新坑不回收，也不能在每回重置人物與世界狀態", evaluate: "檢查回收率、未解問題數與下一回合的單一主要承諾", tags: ["追更循環", "連載", "承諾帳本"] },
  { mechanismId: "consequence_memory", family: "revision", dimension: "other", statement: "重大事件後要把結果寫回人物、關係、資源與世界狀態，確保下一場不能無成本回到事件前。", when: "高潮、衝突或揭露結束後進行連續性修訂時", operation: "建立事件前後狀態差異，並把至少一項差異帶入下一場", constraint: "不能讓高潮只提供刺激，也不能讓後果只存在於旁白", evaluate: "比較前後狀態；若行動選項、關係或資源沒有持續差異，應補寫後果", tags: ["後果", "狀態更新", "連續性"] },
];

export function buildVerifiedStoryTeacherRules(
  sourceText: string,
  research: VerifiedStoryResearchProfile,
): LearningRuleDraft[] {
  const fingerprint = createTextFingerprint(sourceText);
  const mechanismMap = new Map(research.mechanisms.map((item) => [item.id, item]));
  return RULE_BLUEPRINTS.flatMap((blueprint): LearningRuleDraft[] => {
    const mechanism = mechanismMap.get(blueprint.mechanismId);
    const comparisonText = [blueprint.statement, blueprint.when, blueprint.operation, blueprint.constraint, blueprint.evaluate].join(" ");
    const overlap = fingerprintOverlap(comparisonText, fingerprint);
    const longestMatch = longestDirectSourceMatch(sourceText, comparisonText);
    if (longestMatch >= 18 || (overlap.matchedShingles >= 2 && overlap.score >= 0.14)) return [];
    const evidenceWeight = { content_rich: 1, content_partial: 0.86, metadata_only: 0.62, insufficient: 0.4 }[research.evidence.grade];
    const signalStrength = mechanism?.signalStrength ?? 0;
    const confidence = round(clamp((0.58 + signalStrength * 0.28) * evidenceWeight, 0.35, 0.94));
    return [{
      family: blueprint.family,
      dimension: blueprint.dimension,
      statement: blueprint.statement,
      tags: [...new Set([
        ...blueprint.tags,
        "閉端因果教師",
        `故事格式:${research.classification.format}`,
        `證據:${research.evidence.grade}`,
      ])].slice(0, 10),
      parameters: {
        mechanismId: blueprint.mechanismId,
        markerCount: mechanism?.markerCount ?? 0,
        signalStrength,
        evidenceGrade: research.evidence.grade,
        causalCompleteness: research.causalMap.completeness,
        teacherVersion: VERIFIED_STORY_TEACHER_VERSION,
      },
      recipe: {
        when: blueprint.when,
        operation: blueprint.operation,
        constraint: blueprint.constraint,
        evaluate: blueprint.evaluate,
      },
      confidence,
      extractorKind: "local_closed_ai",
      extractorProvider: VERIFIED_STORY_TEACHER_CONTRACT.teacherId,
      extractorModel: VERIFIED_STORY_TEACHER_VERSION,
      sourceOverlapScore: round(overlap.score, 4),
      longestSourceMatch: longestMatch,
      abstractionScore: round(1 - Math.max(overlap.score, longestMatch / 96), 4),
      conflictKey: null,
    }];
  }).slice(0, 16);
}

export async function getBaselineViralDramaCurriculum() {
  const sourceText = "抽象故事研究課程，不包含任何來源作品、人物、台詞或情節。".repeat(20);
  const research = await analyzeStoryWithVerifiedTeacher({
    sourceText,
    sourceProfile: {
      channel: "youtube",
    },
  });
  return buildVerifiedStoryTeacherRules(sourceText, {
    ...research,
    evidence: { ...research.evidence, grade: "content_partial" },
  });
}
