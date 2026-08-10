export type ClosedOutputSafetyCode =
  | "credential"
  | "raw-reasoning"
  | "control-token"
  | "role-envelope"
  | "internal-envelope";

export const CLOSED_OUTPUT_PINNED_SPECIAL_TOKENS_SOURCE_REVISION =
  "32ff081fe7e4dfe4ffb167b94c66fdf11e02b8ad" as const;

export const CLOSED_OUTPUT_PINNED_SPECIAL_TOKENS = Object.freeze([
  "<|im_start|>",
  "<|im_end|>",
  "<|endoftext|>",
  "<|object_ref_start|>",
  "<|object_ref_end|>",
  "<|box_start|>",
  "<|box_end|>",
  "<|quad_start|>",
  "<|quad_end|>",
  "<|vision_start|>",
  "<|vision_end|>",
  "<|vision_pad|>",
  "<|image_pad|>",
  "<|video_pad|>",
] as const);

const MODEL_CONTROL_TOKEN = /<\|[^|<>\r\n]+\|>/iu;
const MODEL_INSTRUCTION_TOKEN = /(?:\[\/?INST\]|<\/?s>)/iu;
const CREDENTIAL = /\b(?:vcp|sbp|gh[pousr])_[A-Za-z0-9_-]{16,}\b|\bgithub_pat_[A-Za-z0-9_]{16,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}\b|\bxox[baprs]-[A-Za-z0-9-]{12,}\b|\bAIza[A-Za-z0-9_-]{20,}\b|\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b|\b(?:authorization|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|cookie)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}|-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/iu;
const RAW_REASONING = /\b(?:chain[-_ ]?of[-_ ]?thought|raw[_-]?reasoning|hidden reasoning|system[_-]?prompt)\b|(?:<|&lt;)\/?(?:think|analysis)(?:>|&gt;)|(?:^|\n)\s*(?:analysis|reasoning)\s*[:：]/iu;
const MODEL_ROLE_ENVELOPE = /(?:(?:^|\n)\s*(?:system|assistant|user|developer|tool|助手|使用者|用戶|開發者|工具)\s*(?=[:：]|$)|(?:<|&lt;)\/?\s*(?:system|assistant|user|developer|tool|助手|使用者|用戶|開發者|工具)\s*(?:>|&gt;))/iu;
const INTERNAL_OUTPUT_ENVELOPE = /(?:<\/?(?:unapproved-continuation-seed|作者目標|最終輸出契約|品質階段|工作類型|explicit-regeneration)>|\[\/?EXISTING_STORY_REFERENCE\]|base-digest=|base-han=|anchor-(?:begin|end))/iu;

export function closedOutputSafetyCode(
  value: string,
): ClosedOutputSafetyCode | null {
  const normalized = value
    .replace(/\r\n?/gu, "\n")
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .trim();
  if (CREDENTIAL.test(normalized)) return "credential";
  if (RAW_REASONING.test(normalized)) return "raw-reasoning";
  if (MODEL_CONTROL_TOKEN.test(normalized) || MODEL_INSTRUCTION_TOKEN.test(normalized)) {
    return "control-token";
  }
  if (MODEL_ROLE_ENVELOPE.test(normalized)) return "role-envelope";
  if (INTERNAL_OUTPUT_ENVELOPE.test(normalized)) return "internal-envelope";
  return null;
}

export function closedOutputSafetyReasonCode(
  code: ClosedOutputSafetyCode,
) {
  switch (code) {
    case "credential": return "QUALITY_OUTPUT_CREDENTIAL_LEAK" as const;
    case "raw-reasoning": return "QUALITY_OUTPUT_RAW_REASONING_LEAK" as const;
    case "control-token": return "QUALITY_OUTPUT_CONTROL_TOKEN" as const;
    case "role-envelope": return "QUALITY_OUTPUT_ROLE_ENVELOPE" as const;
    case "internal-envelope": return "QUALITY_OUTPUT_INTERNAL_ENVELOPE" as const;
  }
}
