import "server-only";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION,
  PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION,
} from "./interactions-availability";
import {
  PUBLIC_LOUNGE_INTERACTIONS_API_SCHEMA_VERSION,
  PublicLoungeInteractionError,
  encodePublicLoungeCommentCursor,
  type PublicLoungeInteractionComment,
  type PublicLoungeInteractionSnapshot,
  type PublicLoungeReportReasonCode,
  type PublicLoungeCommentCursor,
} from "./interactions";
import type { PublicLoungePost } from "./types";

type InteractionConfiguration = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;

function configuration(): InteractionConfiguration {
  if (process.env.PUBLIC_LOUNGE_INTERACTIONS_ENABLED !== "1"
    || process.env.PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION !== PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION
    || process.env.PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION !== PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
  }
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "")
    .trim()
    .replace(/\/$/u, "");
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/") {
      throw new Error("invalid");
    }
  } catch {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
  }
  if (!anonKey || !serviceRoleKey || anonKey === serviceRoleKey) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
  }
  return { url, anonKey, serviceRoleKey };
}

function client(key: string, authorization?: string) {
  const config = configuration();
  const options = {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  };
  return authorization
    ? createClient(config.url, key, {
      ...options,
      global: { headers: { Authorization: `Bearer ${authorization}` } },
    })
    : createClient(config.url, key, options);
}

function anonymousClient() {
  const config = configuration();
  return client(config.anonKey);
}

function serviceRoleClient() {
  const config = configuration();
  return client(config.serviceRoleKey);
}

function errorText(error: SupabaseErrorLike) {
  return [error.code, error.message, error.details, error.hint].filter(Boolean).join(" ");
}

function throwRpc(error: SupabaseErrorLike): never {
  const text = errorText(error);
  const mappings: Array<[RegExp, string, number]> = [
    [/PUBLIC_LOUNGE_AUTH_REQUIRED/iu, "PUBLIC_LOUNGE_AUTH_REQUIRED", 401],
    [/PUBLIC_LOUNGE_NOT_FOUND/iu, "PUBLIC_LOUNGE_NOT_FOUND", 404],
    [/PUBLIC_LOUNGE_CHAPTER_INVALID/iu, "PUBLIC_LOUNGE_CHAPTER_INVALID", 400],
    [/PUBLIC_LOUNGE_COMMENT_NOT_FOUND/iu, "PUBLIC_LOUNGE_COMMENT_NOT_FOUND", 404],
    [/PUBLIC_LOUNGE_COMMENT_DELETE_FORBIDDEN/iu, "PUBLIC_LOUNGE_COMMENT_DELETE_FORBIDDEN", 403],
    [/PUBLIC_LOUNGE_REPORT_ALREADY_SUBMITTED/iu, "PUBLIC_LOUNGE_REPORT_ALREADY_SUBMITTED", 409],
    [/PUBLIC_LOUNGE_REPORT_(?:TARGET_)?INVALID/iu, "PUBLIC_LOUNGE_REPORT_INVALID", 400],
    [/PUBLIC_LOUNGE_INTERACTION_RATE_LIMITED/iu, "PUBLIC_LOUNGE_INTERACTION_RATE_LIMITED", 429],
    [/PUBLIC_LOUNGE_OWNER_BINDING_CONFLICT/iu, "PUBLIC_LOUNGE_OWNER_BINDING_CONFLICT", 403],
  ];
  const mapped = mappings.find(([pattern]) => pattern.test(text));
  if (mapped) throw new PublicLoungeInteractionError(mapped[1], mapped[2]);
  throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
}

function bearerToken(request: Request, required: boolean) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!authorization) {
    if (required) throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_AUTH_REQUIRED", 401);
    return null;
  }
  const match = /^Bearer ([A-Za-z0-9._~-]{32,4096})$/u.exec(authorization);
  if (!match) throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_AUTH_REQUIRED", 401);
  return match[1];
}

export async function verifyPublicLoungeInteractionActor(request: Request) {
  const token = bearerToken(request, true) as string;
  const config = configuration();
  const verifier = client(config.anonKey);
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user || !UUID_PATTERN.test(data.user.id)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_AUTH_REQUIRED", 401);
  }
  return {
    user: data.user,
    token,
    client: client(config.anonKey, token),
  };
}

async function optionalActor(request: Request) {
  const token = bearerToken(request, false);
  if (!token) return { user: null, client: anonymousClient() };
  const config = configuration();
  const verifier = client(config.anonKey);
  const { data, error } = await verifier.auth.getUser(token);
  if (error || !data.user || !UUID_PATTERN.test(data.user.id)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_AUTH_REQUIRED", 401);
  }
  return { user: data.user, client: client(config.anonKey, token) };
}

function oneRow(value: unknown): Record<string, unknown> {
  const row = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
  }
  return row as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
  }
  return number;
}

function interactionComment(value: unknown): PublicLoungeInteractionComment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
  }
  const row = value as Record<string, unknown>;
  const createdAt = typeof row.created_at === "string" ? row.created_at : "";
  let canonicalCreatedAt = false;
  try {
    canonicalCreatedAt = new Date(createdAt).toISOString() === createdAt;
  } catch {
    canonicalCreatedAt = false;
  }
  if (typeof row.id !== "string" || !UUID_PATTERN.test(row.id)
    || typeof row.version_id !== "string"
    || !/^version_[a-z0-9_-]{12,96}$/u.test(row.version_id)
    || typeof row.display_name !== "string"
    || typeof row.body !== "string"
    || !canonicalCreatedAt
    || typeof row.can_delete !== "boolean"
    || (row.chapter_number !== null
      && (typeof row.chapter_number !== "number"
        || !Number.isInteger(row.chapter_number)
        || row.chapter_number < 1))) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
  }
  return {
    id: row.id,
    versionId: row.version_id,
    chapterNumber: row.chapter_number === null ? null : Number(row.chapter_number),
    displayName: row.display_name,
    body: row.body,
    createdAt,
    canDelete: row.can_delete,
  };
}

async function rpc<T>(supabase: SupabaseClient, name: string, parameters: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name as never, parameters as never);
  if (error) throwRpc(error);
  return data as T;
}

export type PublicLoungeInteractionGateway = {
  health(): Promise<{ migrationVersion: string; ready: true }>;
  read(request: Request, input: {
    publicId: string;
    currentVersionId: string;
    chapterCount: number;
    chapterNumber: number | null;
    limit: number;
    before: PublicLoungeCommentCursor | null;
  }): Promise<PublicLoungeInteractionSnapshot>;
  setVote(request: Request, publicId: string, currentVersionId: string, selected: boolean): Promise<{ selected: boolean; voteCount: number }>;
  addComment(request: Request, input: { publicId: string; currentVersionId: string; chapterNumber: number | null; displayName: string; body: string }): Promise<{ commentId: string }>;
  deleteComment(request: Request, publicId: string, currentVersionId: string, commentId: string, reason: string): Promise<void>;
  report(request: Request, input: { publicId: string; currentVersionId: string; targetCommentId: string | null; reasonCode: PublicLoungeReportReasonCode; details: string }): Promise<{ reportId: string }>;
};

export class SupabasePublicLoungeInteractionGateway implements PublicLoungeInteractionGateway {
  async health() {
    const row = oneRow(await rpc(serviceRoleClient(), "novel_public_lounge_interactions_status", {}));
    if (row.migration_version !== PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION || row.ready !== true) {
      throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
    }
    return { migrationVersion: PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION, ready: true as const };
  }

  async read(request: Request, input: {
    publicId: string;
    currentVersionId: string;
    chapterCount: number;
    chapterNumber: number | null;
    limit: number;
    before: PublicLoungeCommentCursor | null;
  }) {
    await this.health();
    const actor = await optionalActor(request);
    const [summaryValue, commentsValue] = await Promise.all([
      rpc(actor.client, "novel_public_lounge_interaction_summary", { p_public_id: input.publicId }),
      rpc<unknown[]>(actor.client, "novel_public_lounge_list_comments", {
        p_public_id: input.publicId,
        p_chapter_number: input.chapterNumber,
        p_limit: input.limit + 1,
        p_before: input.before?.createdAt ?? null,
        p_before_id: input.before?.id ?? null,
      }),
    ]);
    const summary = oneRow(summaryValue);
    if (summary.current_version_id !== input.currentVersionId
      || nonNegativeInteger(summary.chapter_count) !== input.chapterCount) {
      throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
    }
    const rawComments = Array.isArray(commentsValue) ? commentsValue : [];
    const hasMore = rawComments.length > input.limit;
    const comments = rawComments.slice(0, input.limit).map(interactionComment);
    if (comments.some((comment) => comment.versionId !== input.currentVersionId)) {
      throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
    }
    const last = comments.at(-1);
    return {
      schemaVersion: PUBLIC_LOUNGE_INTERACTIONS_API_SCHEMA_VERSION,
      authenticated: Boolean(actor.user),
      selected: actor.user ? summary.selected === true : false,
      voteCount: nonNegativeInteger(summary.vote_count),
      commentCount: nonNegativeInteger(summary.comment_count),
      comments,
      nextCursor: hasMore && last
        ? encodePublicLoungeCommentCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    } satisfies PublicLoungeInteractionSnapshot;
  }

  async setVote(request: Request, publicId: string, currentVersionId: string, selected: boolean) {
    await this.health();
    const actor = await verifyPublicLoungeInteractionActor(request);
    const row = oneRow(await rpc(actor.client, "novel_public_lounge_set_vote", {
      p_public_id: publicId,
      p_version_id: currentVersionId,
      p_selected: selected,
    }));
    if (typeof row.selected !== "boolean") {
      throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
    }
    return { selected: row.selected, voteCount: nonNegativeInteger(row.vote_count) };
  }

  async addComment(request: Request, input: { publicId: string; currentVersionId: string; chapterNumber: number | null; displayName: string; body: string }) {
    await this.health();
    const actor = await verifyPublicLoungeInteractionActor(request);
    const commentId = await rpc<string>(actor.client, "novel_public_lounge_add_comment", {
      p_public_id: input.publicId,
      p_version_id: input.currentVersionId,
      p_chapter_number: input.chapterNumber,
      p_display_name: input.displayName,
      p_body: input.body,
    });
    if (typeof commentId !== "string" || !UUID_PATTERN.test(commentId)) {
      throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
    }
    return { commentId };
  }

  async deleteComment(request: Request, publicId: string, currentVersionId: string, commentId: string, reason: string) {
    await this.health();
    const actor = await verifyPublicLoungeInteractionActor(request);
    await rpc(actor.client, "novel_public_lounge_delete_comment", {
      p_public_id: publicId,
      p_version_id: currentVersionId,
      p_comment_id: commentId,
      p_reason: reason,
    });
  }

  async report(request: Request, input: { publicId: string; currentVersionId: string; targetCommentId: string | null; reasonCode: PublicLoungeReportReasonCode; details: string }) {
    await this.health();
    const actor = await verifyPublicLoungeInteractionActor(request);
    const reportId = await rpc<string>(actor.client, "novel_public_lounge_report", {
      p_public_id: input.publicId,
      p_version_id: input.currentVersionId,
      p_target_comment_id: input.targetCommentId,
      p_reason_code: input.reasonCode,
      p_details: input.details,
    });
    if (typeof reportId !== "string" || !UUID_PATTERN.test(reportId)) {
      throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
    }
    return { reportId };
  }
}

export type PublicLoungeOwnerLifecycleGateway = {
  authenticate(request: Request): Promise<User>;
  bind(ownerId: string, post: Pick<PublicLoungePost, "publicId" | "versionId" | "versionNumber" | "chapterCount">): Promise<void>;
  assertOwner(ownerId: string, publicId: string): Promise<void>;
  sync(ownerId: string, expectedVersionId: string, post: Pick<PublicLoungePost, "publicId" | "versionId" | "versionNumber" | "chapterCount">): Promise<void>;
  deactivate(ownerId: string, publicId: string, expectedVersionId: string | null, expectedVersionNumber: number | null): Promise<void>;
};

export class SupabasePublicLoungeOwnerLifecycleGateway implements PublicLoungeOwnerLifecycleGateway {
  async authenticate(request: Request) {
    return (await verifyPublicLoungeInteractionActor(request)).user;
  }

  async bind(ownerId: string, post: Pick<PublicLoungePost, "publicId" | "versionId" | "versionNumber" | "chapterCount">) {
    await rpc(serviceRoleClient(), "novel_public_lounge_bind_owner", {
      p_public_id: post.publicId,
      p_owner_id: ownerId,
      p_version_id: post.versionId,
      p_version_number: post.versionNumber,
      p_chapter_count: post.chapterCount,
    });
  }

  async assertOwner(ownerId: string, publicId: string) {
    await rpc(serviceRoleClient(), "novel_public_lounge_assert_owner", {
      p_public_id: publicId,
      p_owner_id: ownerId,
    });
  }

  async sync(ownerId: string, expectedVersionId: string, post: Pick<PublicLoungePost, "publicId" | "versionId" | "versionNumber" | "chapterCount">) {
    await rpc(serviceRoleClient(), "novel_public_lounge_sync_owner", {
      p_public_id: post.publicId,
      p_owner_id: ownerId,
      p_expected_version_id: expectedVersionId,
      p_version_id: post.versionId,
      p_version_number: post.versionNumber,
      p_chapter_count: post.chapterCount,
    });
  }

  async deactivate(ownerId: string, publicId: string, expectedVersionId: string | null, expectedVersionNumber: number | null) {
    await rpc(serviceRoleClient(), "novel_public_lounge_deactivate_owner", {
      p_public_id: publicId,
      p_owner_id: ownerId,
      p_expected_version_id: expectedVersionId,
      p_expected_version_number: expectedVersionNumber,
    });
  }
}

let interactionGateway: PublicLoungeInteractionGateway | null = null;
let ownerGateway: PublicLoungeOwnerLifecycleGateway | null = null;

export function getPublicLoungeInteractionGateway() {
  interactionGateway ??= new SupabasePublicLoungeInteractionGateway();
  return interactionGateway;
}

export function getPublicLoungeOwnerLifecycleGateway() {
  ownerGateway ??= new SupabasePublicLoungeOwnerLifecycleGateway();
  return ownerGateway;
}
