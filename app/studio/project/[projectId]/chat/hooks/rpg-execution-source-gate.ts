export type RpgExecutionSourceSnapshot = {
  externalSelected: boolean;
  publicExecutionEnabled: boolean;
  providerConfigured: boolean;
  providerStatusError: string | null;
  singleRunConsentGranted: boolean;
  externalExecutionModeSelected: boolean;
};

export type RpgExecutionSourceBlock = {
  code: "CONVERSATION_EXTERNAL_SINGLE_RUN_CONSENT_REQUIRED";
  message: string;
  progress: string;
};

export function resolveRpgExecutionSourceBlock(
  snapshot: RpgExecutionSourceSnapshot,
): RpgExecutionSourceBlock | null {
  if (!snapshot.externalSelected) return null;
  if (!snapshot.singleRunConsentGranted || !snapshot.externalExecutionModeSelected) {
    return {
      code: "CONVERSATION_EXTERNAL_SINGLE_RUN_CONSENT_REQUIRED",
      message: "請先確認本次外送範圍與供應商，再勾選單次同意。未同意前不會建立 RPG 回合，也不會改走閉端 AI 或規則後備。",
      progress: "等待本次外送同意；沒有建立故事訊息，內容尚未離開裝置。",
    };
  }
  return null;
}

export function assertRpgExecutionSourceCanGenerate(
  snapshot: RpgExecutionSourceSnapshot,
) {
  const block = resolveRpgExecutionSourceBlock(snapshot);
  if (!block) return;
  throw Object.assign(new Error(block.message), {
    code: block.code,
    safeProgress: block.progress,
  });
}
