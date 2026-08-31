export const PUBLIC_LOUNGE_INTERACTIONS_API_SCHEMA_VERSION =
  "public-lounge-interactions-api-v1" as const;

export const PUBLIC_LOUNGE_REPORT_REASON_CODES = [
  "spam",
  "harassment",
  "hate",
  "sexual_content",
  "violence",
  "copyright",
  "privacy",
  "impersonation",
  "other",
] as const;

export type PublicLoungeReportReasonCode =
  typeof PUBLIC_LOUNGE_REPORT_REASON_CODES[number];

export type PublicLoungeInteractionComment = {
  id: string;
  versionId: string;
  chapterNumber: number | null;
  displayName: string;
  body: string;
  createdAt: string;
  canDelete: boolean;
};

export type PublicLoungeInteractionSnapshot = {
  schemaVersion: typeof PUBLIC_LOUNGE_INTERACTIONS_API_SCHEMA_VERSION;
  authenticated: boolean;
  selected: boolean;
  voteCount: number;
  commentCount: number;
  comments: PublicLoungeInteractionComment[];
  nextCursor: string | null;
};

export class PublicLoungeInteractionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, status = 400, retryable = false) {
    super(code);
    this.name = "PublicLoungeInteractionError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const PUBLIC_ID_PATTERN = /^novel_[a-z0-9_-]{12,80}$/u;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTION_PAYLOAD_INVALID", 400);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || !actual.every((key, index) => key === expected[index])) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTION_PAYLOAD_INVALID", 400);
  }
}

function cleanText(value: unknown, min: number, max: number, multiline = false) {
  if (typeof value !== "string") {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTION_PAYLOAD_INVALID", 400);
  }
  const cleaned = value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, "")
    .replace(multiline ? /[ \t]+/gu : /\s+/gu, " ")
    .trim();
  if (cleaned.length < min || cleaned.length > max) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTION_PAYLOAD_INVALID", 400);
  }
  return cleaned;
}

export function assertPublicLoungeInteractionPublicId(value: string) {
  if (!PUBLIC_ID_PATTERN.test(value)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_NOT_FOUND", 404);
  }
  return value;
}

export function assertPublicLoungeInteractionUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTION_PAYLOAD_INVALID", 400);
  }
  return value.toLowerCase();
}

export function parsePublicLoungeVoteInput(value: unknown) {
  const raw = record(value);
  exactKeys(raw, ["selected"]);
  if (typeof raw.selected !== "boolean") {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTION_PAYLOAD_INVALID", 400);
  }
  return { selected: raw.selected };
}

export function parsePublicLoungeCommentInput(value: unknown) {
  const raw = record(value);
  exactKeys(raw, ["chapterNumber", "displayName", "body"]);
  const chapterNumber = raw.chapterNumber === null
    ? null
    : Number(raw.chapterNumber);
  if (chapterNumber !== null && (!Number.isInteger(chapterNumber) || chapterNumber < 1 || chapterNumber > 100_000)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_CHAPTER_INVALID", 400);
  }
  return {
    chapterNumber,
    displayName: cleanText(raw.displayName, 1, 48),
    body: cleanText(raw.body, 1, 1_200, true),
  };
}

export function parsePublicLoungeDeleteCommentInput(value: unknown) {
  const raw = record(value);
  exactKeys(raw, ["reason"]);
  return { reason: cleanText(raw.reason, 2, 240) };
}

export function parsePublicLoungeReportInput(value: unknown) {
  const raw = record(value);
  exactKeys(raw, ["targetCommentId", "reasonCode", "details"]);
  const targetCommentId = raw.targetCommentId === null
    ? null
    : assertPublicLoungeInteractionUuid(raw.targetCommentId);
  if (!PUBLIC_LOUNGE_REPORT_REASON_CODES.includes(raw.reasonCode as PublicLoungeReportReasonCode)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_REPORT_INVALID", 400);
  }
  const details = typeof raw.details === "string" && raw.details.trim()
    ? cleanText(raw.details, 1, 800, true)
    : "";
  return {
    targetCommentId,
    reasonCode: raw.reasonCode as PublicLoungeReportReasonCode,
    details,
  };
}

export type PublicLoungeCommentCursor = { createdAt: string; id: string };

export function encodePublicLoungeCommentCursor(cursor: PublicLoungeCommentCursor) {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor }), "utf8").toString("base64url");
}

export function decodePublicLoungeCommentCursor(value: string | null): PublicLoungeCommentCursor | null {
  if (!value) return null;
  if (value.length > 256 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_COMMENT_CURSOR_INVALID", 400);
  }
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error("non-canonical");
    const raw = JSON.parse(decoded.toString("utf8")) as Record<string, unknown>;
    exactKeys(raw, ["v", "createdAt", "id"]);
    if (raw.v !== 1
      || typeof raw.createdAt !== "string"
      || new Date(raw.createdAt).toISOString() !== raw.createdAt) {
      throw new Error("invalid cursor");
    }
    return { createdAt: raw.createdAt, id: assertPublicLoungeInteractionUuid(raw.id) };
  } catch (error) {
    if (error instanceof PublicLoungeInteractionError) throw error;
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_COMMENT_CURSOR_INVALID", 400);
  }
}
