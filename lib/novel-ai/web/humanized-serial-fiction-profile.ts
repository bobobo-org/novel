import type { PlatformTaskType } from "../router/platform-types";

export const HUMANIZED_SERIAL_FICTION_PROFILE_VERSION =
  "humanized-serial-fiction-v1";

const narrativeTasks = new Set<PlatformTaskType>([
  "chapter.continue",
  "chapter.rewrite",
  "chapter.expand",
  "chapter.endingCandidates",
  "chapter.abcChoices",
  "chapter.outline",
  "character.dialogue",
  "creation.storySeed",
  "creation.guidedChoices",
  "creation.protagonistCandidates",
  "creation.worldCandidates",
  "creation.conflictCandidates",
]);

const taskRules: Partial<Record<PlatformTaskType, string>> = {
  "chapter.continue":
    "承接上一段最後一個動作、位置與情緒，不重講前情；讓新事件由既有因果自然發生。",
  "chapter.rewrite":
    "保留原段落的事實、目的、視角與角色關係，只改善語氣、節奏、動作和可讀性。",
  "chapter.expand":
    "補足會改變讀者理解的感官、動作、猶豫與反應，不用同義句灌水。",
  "chapter.endingCandidates":
    "章末要完成一個局部回報，同時留下由本章因果產生的新問題、代價或決定。",
  "chapter.abcChoices":
    "三個選項必須有不同意圖、代價與後續狀態，不能只是同一句話換寫法。",
  "character.dialogue":
    "每個角色使用不同詞彙、句長、禮貌程度與迴避方式；對話要有潛台詞並伴隨可見反應。",
  "chapter.outline":
    "每個場景都標明人物目標、阻力、轉折、代價與承接下一場的因果。",
};

export function humanizedSerialFictionInstruction(
  taskType: PlatformTaskType,
  targetLength?: number,
) {
  if (!narrativeTasks.has(taskType)) return "";
  const lengthRule = targetLength
    ? `篇幅以約 ${targetLength} 個中文字為上限，優先完成場景，不為湊字數重複資訊。`
    : "篇幅服從場景需要，不重複已知資訊。";
  const taskRule = taskRules[taskType]
    ?? "讓人物的選擇推動情節，並留下可追蹤的因果與情緒變化。";

  return `

[人性化連載寫作設定｜${HUMANIZED_SERIAL_FICTION_PROFILE_VERSION}]
1. 作者的明確指令、正式 Canon、人物關係與目前章節事實優先；不擅自改名、復活、換地點或重置情緒。
2. 固定本段視角，只寫視角人物能感知或合理推斷的內容；不要突然跳入其他人物內心。
3. 每個場景至少形成「人物想做什麼 → 遇到阻力 → 作出反應或選擇 → 局勢產生變化」的可讀因果。
4. 角色要像不同的人：詞彙、句長、態度、欲言又止與行動方式不可全部相同；避免用對話朗讀設定資料。
5. 情緒用動作、停頓、感官、選擇與後果呈現，少用連續的情緒形容詞或旁白直接下結論。
6. 長短句、對話、動作與安靜片刻交替；刪除重複總結、空泛讚嘆、模板轉折與機械式段尾。
7. 場景開頭快速交代人物、位置與正在發生的事；場景結尾留下自然的問題、代價、發現或下一個行動。
8. 保留作者原有語氣與題材尺度，不模仿特定作者、不複製既有小說句子，只運用通用敘事方法產生原創內容。
本任務特別要求：${taskRule}
篇幅要求：${lengthRule}`;
}
