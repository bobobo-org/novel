export const EXTERNAL_AI_PUBLIC_EXECUTION_ENV = "EXTERNAL_AI_PUBLIC_EXECUTION_ENABLED";

type ExternalAIExecutionEnvironment = Record<string, string | undefined>;

/**
 * Paid external AI execution is disabled unless an operator explicitly opts in.
 * Credentials alone must never make an anonymous public deployment executable.
 */
export function isExternalAIPublicExecutionEnabled(
  environment: ExternalAIExecutionEnvironment = process.env,
) {
  return environment[EXTERNAL_AI_PUBLIC_EXECUTION_ENV]?.trim() === "1";
}

export type ExternalAIPublicExecutionDecision =
  | { allowed: true }
  | {
      allowed: false;
      status: 403 | 503;
      code: "EXTERNAL_AI_CONSENT_REQUIRED" | "EXTERNAL_AI_EXECUTION_DISABLED";
      error: string;
    };

export function evaluateExternalAIPublicExecution(
  externalConsent: unknown,
  environment: ExternalAIExecutionEnvironment = process.env,
): ExternalAIPublicExecutionDecision {
  if (externalConsent !== true) {
    return {
      allowed: false,
      status: 403,
      code: "EXTERNAL_AI_CONSENT_REQUIRED",
      error: "送出內容前必須明確同意資料離開裝置。",
    };
  }
  if (!isExternalAIPublicExecutionEnabled(environment)) {
    return {
      allowed: false,
      status: 503,
      code: "EXTERNAL_AI_EXECUTION_DISABLED",
      error: "公開網站尚未開放外接 AI 執行；請先完成帳號權限、持久額度與成本上限。",
    };
  }
  return { allowed: true };
}
