export const NOVEL_TO_VIDEO_DIRECTOR_DOCTRINE_VERSION = "novel-to-video-director-doctrine-v1" as const;

export const NOVEL_TO_VIDEO_CRAFT_PROVENANCE = {
  doctrineVersion: NOVEL_TO_VIDEO_DIRECTOR_DOCTRINE_VERSION,
  sourceClass: "distilled_public_craft_methods",
  sourceChannel: "https://www.youtube.com/@hedge.sphere/shorts",
  reusePolicy: "只採用抽象製作方法；不複製來源台詞、角色、鏡頭排列、提示詞或辨識性風格。",
} as const;

export type NovelToVideoDirectorPackage = {
  doctrineVersion: typeof NOVEL_TO_VIDEO_DIRECTOR_DOCTRINE_VERSION;
  narrativePurpose: string;
  assetLocks: string[];
  spatialBlocking: string[];
  performanceDirection: string[];
  shotGrammar: {
    framing: string;
    movement: string;
    depth: string;
    lightingAndColor: string;
  };
  stateHandoff: {
    entryState: string;
    terminalState: string;
    editBridge: string;
  };
  audioPlan: {
    voice: string;
    ambience: string;
    effects: string;
    music: string;
    transition: string;
  };
  negativeConstraints: string[];
  qualityChecks: string[];
};

type DirectorPackageInput = {
  shotIndex: number;
  totalShots: number;
  sceneGoal: string;
  conflict: string;
  visualAction: string;
  storyFunction?: string | null;
  characterRefIds?: string[];
  locationId?: string | null;
  continuityNotes?: string[];
  dialogueOrAudioCue?: string | null;
};

const FRAMINGS = [
  "先用全景交代人物、出口與關鍵物的空間關係，再把注意力收進作出選擇的人。",
  "以中景保留雙方距離與權力差，只有在資訊翻轉時切入反應特寫。",
  "以三分之四側面呈現動作方向，讓前後景同時保有可讀線索。",
  "以受限視角跟隨角色，直到關鍵細節進入畫面才改變景別。",
] as const;

const MOVEMENTS = [
  "鏡頭先穩定觀察；角色作出不可逆動作後才短距離推近，不做無目的漂移。",
  "沿角色實際移動方向橫移，速度服從步伐與障礙物，不任意環繞。",
  "以固定機位讓人物進出畫改變構圖，將壓力交給表演與空間。",
  "用一次有動機的視線轉移帶出新資訊，揭露後立即停穩。",
] as const;

const PERFORMANCE = [
  "主動者先完成一個清楚動作，另一人以視線、呼吸或重心轉移回應；避免所有人同時忙動。",
  "情緒由壓住的呼吸、短暫停頓與未完成的小動作外顯，不用誇張表情替代動機。",
  "每個動作都要有可見原因、受力與結束姿勢；衣物、頭髮及隨身物只作伴生反應。",
  "角色說話時仍維持當前任務；手、眼神與身體方向不得彼此矛盾。",
] as const;

function normalizedText(value: string | null | undefined, fallback: string) {
  const text = value?.replace(/\s+/gu, " ").trim();
  return text || fallback;
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function phaseLabel(index: number, total: number, storyFunction: string | null | undefined) {
  const explicit = storyFunction?.trim();
  if (explicit) return explicit;
  if (index === 0) return "開場異常與立即代價";
  if (index === total - 1) return "可見回報、後果與下一個問題";
  if (index / Math.max(1, total - 1) < 0.55) return "阻力升級與資訊落差";
  return "選擇、翻轉與代價落地";
}

export function createNovelToVideoDirectorPackage(input: DirectorPackageInput): NovelToVideoDirectorPackage {
  const index = Math.max(0, Math.floor(input.shotIndex));
  const total = Math.max(1, Math.floor(input.totalShots));
  const variant = index % FRAMINGS.length;
  const characters = [...new Set((input.characterRefIds ?? []).filter(Boolean))];
  const location = input.locationId?.trim() || "目前場景";
  const goal = normalizedText(input.sceneGoal, "讓角色以可見行動推進事件");
  const conflict = normalizedText(input.conflict, "阻力迫使角色付出代價");
  const action = normalizedText(input.visualAction, "以一個可辨識主動作改變局面");
  const continuity = unique(input.continuityNotes ?? []);
  const hasDialogue = Boolean(input.dialogueOrAudioCue?.trim());
  const identityLock = characters.length
    ? `鎖定 ${characters.length} 名上場角色的臉、體型、聲線、髮型、服裝與配件；本鏡不得換人或融合。`
    : "若角色尚未綁定素材，先建立身份參考再生成，不以臨時路人臉代替。";

  return {
    doctrineVersion: NOVEL_TO_VIDEO_DIRECTOR_DOCTRINE_VERSION,
    narrativePurpose: `${phaseLabel(index, total, input.storyFunction)}：${goal}；主要阻力是「${conflict}」。`,
    assetLocks: unique([
      identityLock,
      `鎖定「${location}」的時代、格局、出口、光源與關鍵道具幾何。`,
      ...continuity.map((note) => `連戲帳本：${note}`),
    ]),
    spatialBlocking: [
      characters.length > 1
        ? "先建立多人全景與錨點：逐人標明區域、朝向、視線、相鄰人物及可用出口。"
        : "以固定地標標明角色起點、面向、目標物與出口，不用含糊的畫面左／右描述。",
      "本鏡只改變一項主要位置關係；其他人物和物件維持上一鏡可追蹤的位置。",
      `主動作：${action}`,
    ],
    performanceDirection: [
      PERFORMANCE[variant],
      PERFORMANCE[(variant + 1) % PERFORMANCE.length],
    ],
    shotGrammar: {
      framing: FRAMINGS[variant],
      movement: MOVEMENTS[variant],
      depth: variant % 2 === 0
        ? "以前景遮擋、中景人物、後景出口建立深度；遮擋不可蓋住關鍵動作。"
        : "保留可辨識前景或門框作空間參照，景深變化只服務資訊揭露。",
      lightingAndColor: "明確指定光源、方向、軟硬、色溫與主副光比；先跨鏡匹配膚色與場景色，再用局部色溫變化表達轉折。",
    },
    stateHandoff: {
      entryState: `承接上一鏡的站位、視線、傷勢、服裝、持有物與情緒強度；首鏡則以「${goal}」的異常狀態直接開始。`,
      terminalState: "記錄最後姿勢、面向、視線、移動方向與速度，以及道具所在手、傷勢、污漬、天候和光線狀態。",
      editBridge: index === total - 1
        ? "在可見回報或代價落地後留下下一個具體問題；不以任意黑畫面冒充懸念。"
        : "預留動作前後剪接餘量，優先用動作交疊、視線接點、環境音或 J／L cut 接續，不依賴末幀硬續寫。",
    },
    audioPlan: {
      voice: hasDialogue ? "角色對白與旁白分軌；保存聲線、語速、情緒強度、語境並檢查對嘴。" : "本鏡不硬塞旁白；若無對白，以行動與環境聲傳達資訊。",
      ambience: `建立「${location}」連續環境底聲，跨鏡不得無故消失或換空間。`,
      effects: "將門、腳步、衣料、道具碰撞等 Foley 分軌，聲音必須對齊可見動作。",
      music: "音樂只標記情緒方向與節拍，不模仿特定歌手或受保護作品；對白出現時自動 ducking。",
      transition: "以環境聲橋、動作聲或音樂節拍連接下一鏡，保留後製可調整的獨立音軌。",
    },
    negativeConstraints: [
      "禁止無目的飄鏡、全員同時忙動、過度表情、無受力漂浮與突然瞬移。",
      "禁止臉、手指、服裝、傷勢、道具形狀、文字、光向與背景格局跨幀突變。",
      "禁止用『電影感、史詩、高級』等空泛形容取代可見動作、物理光源與空間關係。",
      "禁止把整段小說直接塞成單一超長提示詞；本鏡失敗時只局部重生或修補。",
    ],
    qualityChecks: [
      "敘事：本鏡只有一個主動作，且開頭與結尾狀態產生可辨識變化。",
      "身份：角色數量、臉、聲線、妝髮、服裝、傷勢與持有物符合鎖定素材。",
      "空間：站位、朝向、視線、出入口、背景、光向及運動慣性可連回前後鏡。",
      "影像：無手臉崩壞、穿模、重影、閃爍、物件形變；文字須正確且位於安全區。",
      "聲音：對嘴、爆音、音量、環境底噪與四類音軌通過檢查；權利與同意來源可追溯。",
    ],
  };
}

export function closedAIDirectorDoctrineInstruction() {
  return [
    `小說轉影片必須遵守 ${NOVEL_TO_VIDEO_DIRECTOR_DOCTRINE_VERSION}。`,
    "不可把小說全文直接改寫成一個超長影片提示詞；先拆成故事節拍，再建立逐鏡導演包。",
    "每鏡依序明確輸出：敘事目的、不可變角色／場景／道具資產、多人錨點與站位、唯一主動作、伴生微動作、景別／機位／有動機運鏡、物理光源與色彩、四類聲音軌、進場狀態、末端姿勢／速度交接、負向限制與 QC。",
    "開場先出現正在發生的異常、衝突或代價；情緒用環境、蒙太奇、視線、呼吸與選擇外顯，不用旁白或全員過度表演。",
    "每集必須先兌現承諾或讓代價落地，再建立下一個具體問題；懸念不能取代 Payoff。",
    "多人戲先用全景建立地理，之後每鏡只改變少量位置關係；不用含糊的左／右取代固定地標。",
    "跨鏡維護資產、空間、故事三層連戲帳本，使用動作交疊、視線接點、環境聲橋或 J／L cut，不把末幀續寫當唯一方法。",
    "提示詞只是導演決策的交付格式，JSON 不是審美；失敗時指出可局部重生、替換或合成修補的鏡頭，不整段抽卡重做。",
    NOVEL_TO_VIDEO_CRAFT_PROVENANCE.reusePolicy,
  ].join("\n");
}
