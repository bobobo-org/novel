export type DramaOsErrorCode =
  | "DRAMA_INPUT_INVALID"
  | "DRAMA_SOURCE_EMPTY"
  | "DRAMA_SOURCE_REVISION_STALE"
  | "DRAMA_STORY_BIBLE_STALE"
  | "DRAMA_RESOURCE_BUDGET_EXCEEDED"
  | "DRAMA_RESOURCE_LIMIT_EXCEEDED"
  | "DRAMA_CANCELLED"
  | "DRAMA_PROVIDER_TIMEOUT"
  | "DRAMA_EVIDENCE_INVALID"
  | "DRAMA_ADULT_CONSENT_REQUIRED"
  | "DRAMA_ADULT_AGE_UNCONFIRMED"
  | "DRAMA_SECURITY_BOUNDARY_BLOCKED"
  | "DRAMA_PROVIDER_CAPABILITY_INSUFFICIENT"
  | "DRAMA_PROJECTION_NOT_FOUND"
  | "DRAMA_PROJECTION_NOT_APPROVABLE"
  | "DRAMA_APPROVAL_BLOCKED"
  | "DRAMA_IDEMPOTENCY_PAYLOAD_MISMATCH"
  | "DRAMA_BACKUP_INVALID";

export class DramaOsError extends Error {
  readonly code: DramaOsErrorCode;
  readonly retryable: boolean;

  constructor(
    code: DramaOsErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "DramaOsError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new DramaOsError("DRAMA_CANCELLED", "Drama projection was cancelled.");
}

export const throwIfCancelled = assertNotCancelled;
