import {
  isExternalRpgConsentAssertion,
  isExternalRpgConsentBinding,
  type ExternalRpgConsentBinding,
} from "./external-rpg-consent-contract";

type ConsentState = { consumed: Map<string, number> };
type ConsentGlobal = typeof globalThis & {
  __novelExternalRpgConsentState?: ConsentState;
};

export class ExternalRpgConsentError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ExternalRpgConsentError";
    this.code = code;
    this.status = status;
  }
}

function state() {
  const target = globalThis as ConsentGlobal;
  target.__novelExternalRpgConsentState ??= { consumed: new Map() };
  return target.__novelExternalRpgConsentState;
}

function fail(code: string, message: string, status = 403): never {
  throw new ExternalRpgConsentError(code, message, status);
}

function pruneConsumed(now: number) {
  const current = state();
  for (const [grantId, expiresAt] of current.consumed) {
    if (expiresAt <= now) current.consumed.delete(grantId);
  }
}

/**
 * Validates the exact prompt/provider/request binding and consumes it before
 * provider execution. Replay protection is intentionally instance-local. A
 * serverless cold start loses this consumed set, so this MUST NOT be described
 * as cross-instance or durable single-use protection; a shared authenticated
 * grant store is required before making that stronger claim.
 */
export function consumeExternalRpgConsentAssertion(input: {
  assertion: unknown;
  expected: ExternalRpgConsentBinding;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  if (!isExternalRpgConsentBinding(input.expected) || !isExternalRpgConsentAssertion(input.assertion)) {
    fail(
      "EXTERNAL_RPG_CONSENT_ASSERTION_INVALID",
      "本次 RPG 外送同意無效；沒有呼叫外來 AI，也不會改走閉端 AI。",
    );
  }
  if (Date.parse(input.assertion.grantedAt) > now + 5_000 || Date.parse(input.assertion.expiresAt) <= now) {
    fail(
      "EXTERNAL_RPG_CONSENT_EXPIRED",
      "本次 RPG 外送同意已逾時；請重新勾選同意。沒有呼叫閉端 AI。",
    );
  }
  for (const key of [
    "projectId",
    "logicalRequestId",
    "providerId",
    "promptDigest",
    "fieldManifestDigest",
  ] as const) {
    if (input.assertion[key] !== input.expected[key]) {
      fail(
        "EXTERNAL_RPG_CONSENT_BINDING_MISMATCH",
        "本次 RPG 外送內容、供應商或請求已改變；請重新勾選同意。沒有呼叫閉端 AI。",
      );
    }
  }
  pruneConsumed(now);
  const current = state();
  if (current.consumed.has(input.assertion.grantId)) {
    fail(
      "EXTERNAL_RPG_CONSENT_REPLAYED",
      "本次 RPG 外送同意已使用；請重新勾選同意。沒有呼叫閉端 AI。",
      409,
    );
  }
  current.consumed.set(input.assertion.grantId, Date.parse(input.assertion.expiresAt));
  return input.assertion;
}

export function resetExternalRpgConsentStateForTests() {
  const target = globalThis as ConsentGlobal;
  delete target.__novelExternalRpgConsentState;
}
