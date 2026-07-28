import { detectPromptInjection } from "../../security/prompt-injection-detector";
import { CharacterAgentError } from "../errors";
import { sha256 } from "../record-factory";
import type { AdultEligibility, CharacterCanonContext } from "../types";

const ADDITIONAL_ATTACKS = [
  /https?:\/\/\S+/giu,
  /(?:read|open|load|讀取|開啟|載入).{0,20}(?:file|path|url|檔案|路徑|網址)/giu,
  /(?:start|launch|call|啟動|呼叫).{0,20}(?:external\s*ai|chatgpt|gemini|grok|外部\s*ai)/giu,
  /(?:tell|ask|instruct|要求|指示).{0,24}(?:another|other|另一|其他).{0,16}(?:agent|角色).{0,24}(?:bypass|ignore|繞過|忽略)/giu,
  /(?:recursive|recursion|self-dialogue|遞迴|自我對話).{0,20}(?:forever|infinite|無限)/giu,
  /(?:show|display|reveal|print|顯示|揭露|輸出|告訴).{0,24}(?:author[_\s-]?only|private[_\s-]?secret|作者限定|私人秘密|秘密)/giu,
  /(?:read|load|access|讀取|載入|存取).{0,24}(?:another|other|另一|其他).{0,20}(?:workspace|project|作品|工作區)/giu,
  /(?:upload|send|transfer|post|上傳|傳送|送出).{0,24}(?:external|api|外部)/giu,
];

export async function secureCharacterContent(input: {
  sourceId: string;
  sourceRevision: number;
  content: string;
}) {
  const findings = detectPromptInjection(input.content);
  for (const pattern of ADDITIONAL_ATTACKS) {
    pattern.lastIndex = 0;
    for (const match of input.content.matchAll(pattern)) {
      findings.push({
        code: match[0].includes("http") ? "EXTERNAL_TRANSFER" : "TOOL_INVOCATION",
        start: match.index,
        end: match.index + match[0].length,
        severity: "blocking",
        matchedText: match[0].slice(0, 160),
      });
    }
  }
  const blocking = findings.filter((finding) => finding.severity === "blocking");
  let sanitizedText = input.content;
  for (const finding of [...blocking].sort((a, b) => b.start - a.start)) {
    sanitizedText = `${sanitizedText.slice(0, finding.start)}[不受信任的指令已隔離]${sanitizedText.slice(finding.end)}`;
  }
  const taint = {
    schemaVersion: "p23-taint-tracking-v1" as const,
    sourceId: input.sourceId,
    sourceType: "character_content",
    sourceRevision: String(input.sourceRevision),
    contentHash: await sha256(input.content),
    trustLevel: "untrusted" as const,
    taintLabels: [
      "USER_AUTHORED_CONTENT",
      ...(blocking.length ? ["PROMPT_INJECTION_SUSPECTED" as const] : []),
      "EXTERNAL_TRANSFER_RESTRICTED",
      "TRAINING_EXCLUDED",
    ],
    sanitizationStatus: blocking.length ? "quarantined" as const : "unchanged" as const,
    detectedSignals: findings.map((finding) => finding.code),
    allowedUsages: ["citation", "retrieval", "generation_context", "evaluation"] as const,
    blockedUsages: ["tool_request", "provider_selection", "external_transfer", "approval", "canonical_mutation", "training"] as const,
  };
  return {
    sanitizedText,
    findings,
    taint,
    mayInvokeTools: false as const,
    mayOpenUrls: false as const,
    maySelectProvider: false as const,
    mayRequestExternalAI: false as const,
    mayMutateCanonical: false as const,
  };
}

export function assertCharacterProjectAndCanonScope(input: {
  expectedProjectId: string;
  actualProjectId: string;
  expectedCanonContext: CharacterCanonContext;
  actualCanonContextId: string;
}) {
  if (input.expectedProjectId !== input.actualProjectId) {
    throw new CharacterAgentError("CROSS_PROJECT_CHARACTER_DATA_BLOCKED", "不得讀取其他作品的角色資料。");
  }
  if (input.expectedCanonContext.canonContextId !== input.actualCanonContextId) {
    throw new CharacterAgentError("CROSS_CANON_CHARACTER_DATA_BLOCKED", "不得跨 Canon Context 使用角色資料。");
  }
  return true;
}

export function assertAdultCharacterEligible(eligibility: AdultEligibility) {
  if (
    !eligibility.isFictional
    || !eligibility.ageAtLeast18
    || !eligibility.ageVerified
    || !eligibility.adultModeEnabled
    || !eligibility.optedIn
    || !eligibility.namespace.startsWith("adult:")
    || !eligibility.eligible
  ) {
    throw new CharacterAgentError("ADULT_CHARACTER_NOT_ELIGIBLE", "成人角色內容需要虛構、場景時間點滿 18 歲、年齡驗證與使用者主動啟用。");
  }
  return true;
}

export function assertNoRawReasoningStorage(value: unknown) {
  const text = JSON.stringify(value).toLocaleLowerCase();
  const forbidden = ["chain-of-thought", "chain_of_thought", "hidden reasoning tokens", "internal system prompt", "developer prompt", "完整推理草稿"];
  if (forbidden.some((needle) => text.includes(needle))) {
    throw new CharacterAgentError("RAW_REASONING_STORAGE_BLOCKED", "不得保存或顯示內部推理、系統提示或完整推理草稿。");
  }
  return true;
}
