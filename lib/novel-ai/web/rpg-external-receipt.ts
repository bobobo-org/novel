import { sha256Hex, stableStringify } from "../closed-ai-cache";
import type { ExternalAIProviderId } from "../providers/external/external-provider-contract";
import type { RpgChatTurnCandidate } from "./rpg-chat-turn";

export const EXTERNAL_RPG_EXECUTION_RECEIPT_SCHEMA = "external-rpg-execution-receipt-v1" as const;
export const EXTERNAL_RPG_FAILURE_LINEAGE_SCHEMA = "external-rpg-failure-lineage-v1" as const;

export type ExternalRpgExecutionReceiptBody = {
  schemaVersion: typeof EXTERNAL_RPG_EXECUTION_RECEIPT_SCHEMA;
  requestId: string;
  providerId: ExternalAIProviderId;
  modelId: string;
  candidateId: string;
  candidateDigest: string;
  modelDigest: string;
  projectId: string;
  logicalRequestId: string;
  sourceChapterId: string;
  sourceRevision: number;
  rpgContextDigest: string | null;
  rpgContextRevisionDigest: string;
  publicContextDigest: string;
  promptDigest: string;
  fieldManifestDigest: string;
  choiceKey: string;
  lockedOutcome: string;
  lockedEffectDigest: string;
  elapsedMs: number;
  generatedTokenEvents: number;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  candidateOnly: true;
  externalRequest: true;
  dataLeftDevice: true;
  serverStoredByApplication: false;
};

export type ExternalRpgExecutionReceipt = ExternalRpgExecutionReceiptBody & {
  receiptDigest: string;
};

export async function sealExternalRpgExecutionReceipt(
  body: ExternalRpgExecutionReceiptBody,
): Promise<ExternalRpgExecutionReceipt> {
  return { ...body, receiptDigest: await sha256Hex(stableStringify(body)) };
}

function invalidReceipt() {
  return Object.assign(new Error("外來 RPG 候選收據與正文或鎖定結果不一致。"), {
    code: "EXTERNAL_RPG_RECEIPT_INVALID",
  });
}

export async function verifyExternalRpgExecutionReceipt(candidate: RpgChatTurnCandidate) {
  const value = candidate.executionReceipt;
  if (!value || typeof value !== "object") throw invalidReceipt();
  const receipt = value as ExternalRpgExecutionReceipt;
  const { receiptDigest, ...body } = receipt;
  if (
    receipt.schemaVersion !== EXTERNAL_RPG_EXECUTION_RECEIPT_SCHEMA
    || receipt.candidateId !== candidate.candidateId
    || receipt.candidateDigest !== candidate.candidateDigest
    || receipt.modelId !== candidate.model
    || receipt.modelDigest !== candidate.modelDigest
    || receipt.sourceChapterId !== candidate.sourceChapterId
    || receipt.sourceRevision !== candidate.sourceRevision
    || receipt.rpgContextDigest !== candidate.contextDigest
    || receipt.rpgContextRevisionDigest !== candidate.contextRevisionDigest
    || receipt.choiceKey !== candidate.choice.key
    || receipt.lockedOutcome !== candidate.resolution.outcome
    || receipt.lockedEffectDigest !== await sha256Hex(stableStringify(candidate.resolution.effect))
    || receipt.externalRequest !== true
    || receipt.dataLeftDevice !== true
    || receipt.candidateOnly !== true
    || receipt.serverStoredByApplication !== false
    || !/^[a-f0-9]{64}$/u.test(receiptDigest ?? "")
    || await sha256Hex(stableStringify(body)) !== receiptDigest
  ) throw invalidReceipt();
  return receipt;
}

type ExternalRpgFailureLineageCommon = {
  schemaVersion: typeof EXTERNAL_RPG_FAILURE_LINEAGE_SCHEMA;
  providerId: ExternalAIProviderId;
  logicalRequestId: string;
  publicContextDigest: string | null;
  promptDigest: string | null;
  fieldManifestDigest: string | null;
  failureCode: string;
};

export type ExternalRpgFailureLineageBody = ExternalRpgFailureLineageCommon & (
  | {
      attempted: false;
      dispatchState: "policy-blocked";
      dataLeftDevice: false;
      publicContextDigest: null;
      promptDigest: null;
      fieldManifestDigest: null;
      failureCode: "EXTERNAL_RPG_ADULT_CONTENT_LOCAL_ONLY";
    }
  | {
      attempted: true;
      dispatchState: "preflight-unavailable" | "provider-request-failed" | "provider-result-invalid";
      dataLeftDevice: boolean;
    }
);

export async function sealExternalRpgFailureLineage(body: ExternalRpgFailureLineageBody) {
  return { ...body, receiptDigest: await sha256Hex(stableStringify(body)) };
}

export async function verifyExternalRpgFailureLineage(candidate: RpgChatTurnCandidate) {
  const envelope = candidate.executionReceipt;
  const raw = envelope && typeof envelope === "object"
    ? (envelope as Record<string, unknown>).externalAttemptFailure
    : null;
  if (!raw) return null;
  if (!raw || typeof raw !== "object" || candidate.externalRequest || candidate.dataLeftDevice) {
    throw invalidReceipt();
  }
  const receipt = raw as ExternalRpgFailureLineageBody & { receiptDigest?: string };
  const { receiptDigest, ...body } = receipt;
  const policyBlocked = receipt.attempted === false && receipt.dispatchState === "policy-blocked";
  const attempted = receipt.attempted === true
    && ["preflight-unavailable", "provider-request-failed", "provider-result-invalid"].includes(receipt.dispatchState);
  if (
    receipt.schemaVersion !== EXTERNAL_RPG_FAILURE_LINEAGE_SCHEMA
    || (!policyBlocked && !attempted)
    || typeof receipt.dataLeftDevice !== "boolean"
    || (receipt.dispatchState === "preflight-unavailable" && receipt.dataLeftDevice)
    || (policyBlocked && (
      receipt.dataLeftDevice
      || receipt.publicContextDigest !== null
      || receipt.promptDigest !== null
      || receipt.fieldManifestDigest !== null
      || receipt.failureCode !== "EXTERNAL_RPG_ADULT_CONTENT_LOCAL_ONLY"
    ))
    || typeof receipt.logicalRequestId !== "string"
    || !receipt.logicalRequestId
    || typeof receipt.failureCode !== "string"
    || !receipt.failureCode
    || !/^[a-f0-9]{64}$/u.test(receiptDigest ?? "")
    || await sha256Hex(stableStringify(body)) !== receiptDigest
  ) throw invalidReceipt();
  return receipt;
}
