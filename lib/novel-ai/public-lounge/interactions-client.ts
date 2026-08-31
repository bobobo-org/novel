"use client";

import {
  getPublicLoungeSession,
  requirePublicLoungeAccessToken,
} from "./auth-browser";
import type {
  PublicLoungeInteractionSnapshot,
  PublicLoungeReportReasonCode,
} from "./interactions";

export class PublicLoungeInteractionClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "PublicLoungeInteractionClientError";
    this.code = code;
    this.status = status;
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as {
    error?: { code?: string };
  } | null;
  if (!response.ok) {
    throw new PublicLoungeInteractionClientError(
      value?.error?.code ?? "PUBLIC_LOUNGE_INTERACTION_REQUEST_FAILED",
      response.status,
    );
  }
  return value as T;
}

async function authorization(required: boolean): Promise<Record<string, string>> {
  const token = required
    ? await requirePublicLoungeAccessToken()
    : (await getPublicLoungeSession())?.access_token ?? null;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function endpoint(publicId: string, suffix = "") {
  return `/api/lounge/interactions/${encodeURIComponent(publicId)}${suffix}`;
}

export async function readPublicLoungeInteractions(input: {
  publicId: string;
  chapterNumber?: number | null;
  cursor?: string | null;
  limit?: number;
}) {
  const search = new URLSearchParams();
  if (input.chapterNumber !== undefined && input.chapterNumber !== null) {
    search.set("chapter", String(input.chapterNumber));
  }
  if (input.cursor) search.set("cursor", input.cursor);
  if (input.limit !== undefined) search.set("limit", String(input.limit));
  const response = await fetch(`${endpoint(input.publicId)}${search.size ? `?${search}` : ""}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: await authorization(false),
  });
  return (await responseJson<{ snapshot: PublicLoungeInteractionSnapshot }>(response)).snapshot;
}

export async function setPublicLoungeVote(publicId: string, selected: boolean) {
  const response = await fetch(endpoint(publicId, "/vote"), {
    method: "PUT",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(await authorization(true)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ selected }),
  });
  return responseJson<{ selected: boolean; voteCount: number }>(response);
}

export async function addPublicLoungeComment(input: {
  publicId: string;
  chapterNumber: number | null;
  displayName: string;
  body: string;
}) {
  const response = await fetch(endpoint(input.publicId, "/comments"), {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(await authorization(true)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chapterNumber: input.chapterNumber,
      displayName: input.displayName,
      body: input.body,
    }),
  });
  return responseJson<{ commentId: string }>(response);
}

export async function deletePublicLoungeComment(input: {
  publicId: string;
  commentId: string;
  reason: string;
}) {
  const response = await fetch(endpoint(
    input.publicId,
    `/comments/${encodeURIComponent(input.commentId)}`,
  ), {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(await authorization(true)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reason: input.reason }),
  });
  if (!response.ok) await responseJson(response);
}

export async function reportPublicLoungeContent(input: {
  publicId: string;
  targetCommentId: string | null;
  reasonCode: PublicLoungeReportReasonCode;
  details: string;
}) {
  const response = await fetch(endpoint(input.publicId, "/reports"), {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(await authorization(true)),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      targetCommentId: input.targetCommentId,
      reasonCode: input.reasonCode,
      details: input.details,
    }),
  });
  return responseJson<{ reportId: string }>(response);
}
