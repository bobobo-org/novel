import "server-only";
import { PublicLoungeError } from "./contract";
import {
  assertPublicLoungeSameOrigin,
  createPublicLoungeTrustedIpIdentity,
  readPublicLoungeBoundedJson,
} from "./http";
import {
  PublicLoungeInteractionError,
  assertPublicLoungeInteractionPublicId,
  assertPublicLoungeInteractionUuid,
  decodePublicLoungeCommentCursor,
  parsePublicLoungeCommentInput,
  parsePublicLoungeDeleteCommentInput,
  parsePublicLoungeReportInput,
  parsePublicLoungeVoteInput,
} from "./interactions";
import type { PublicLoungeInteractionGateway } from "./interactions.server";
import type { PublicLoungeServiceApi } from "./types";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

function interactionErrorResponse(error: unknown) {
  const safe = error instanceof PublicLoungeInteractionError
    ? error
    : error instanceof PublicLoungeError
      ? new PublicLoungeInteractionError(error.code, error.status, error.retryable)
      : new PublicLoungeInteractionError("PUBLIC_LOUNGE_INTERACTIONS_NOT_CONNECTED", 503, true);
  const headers: Record<string, string> = { ...NO_STORE_HEADERS };
  if (safe.status === 429) headers["Retry-After"] = "60";
  return Response.json({ error: { code: safe.code, retryable: safe.retryable } }, {
    status: safe.status,
    headers,
  });
}

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: NO_STORE_HEADERS });
}

function query(request: Request) {
  const url = new URL(request.url);
  const rawChapter = url.searchParams.get("chapter");
  const chapterNumber = rawChapter === null || rawChapter === ""
    ? null
    : Number(rawChapter);
  if (chapterNumber !== null && (!/^[1-9]\d*$/u.test(rawChapter ?? "") || !Number.isSafeInteger(chapterNumber))) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_CHAPTER_INVALID", 400);
  }
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (rawLimit !== null && !/^[1-9]\d*$/u.test(rawLimit))) {
    throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_COMMENT_LIMIT_INVALID", 400);
  }
  return {
    chapterNumber,
    limit,
    before: decodePublicLoungeCommentCursor(url.searchParams.get("cursor")),
  };
}

export function createPublicLoungeInteractionHttpHandlers(
  gatewayProvider: () => PublicLoungeInteractionGateway,
  loungeServiceProvider: () => PublicLoungeServiceApi,
  identifyRequest: (request: Request) => string = (request) => (
    createPublicLoungeTrustedIpIdentity({
      secret: process.env.PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY?.trim() ?? "",
    })(request)
  ),
) {
  const assertAuthoritativePost = async (request: Request, publicId: string) => {
    const service = loungeServiceProvider();
    await service.reserveRequest(identifyRequest(request), "read");
    const post = await service.get(assertPublicLoungeInteractionPublicId(publicId));
    return post;
  };

  return {
    async read(request: Request, publicId: string) {
      try {
        const post = await assertAuthoritativePost(request, publicId);
        const options = query(request);
        return json({
          snapshot: await gatewayProvider().read(request, {
            publicId: post.publicId,
            currentVersionId: post.versionId,
            chapterCount: post.chapterCount,
            ...options,
          }),
        });
      } catch (error) {
        return interactionErrorResponse(error);
      }
    },

    async vote(request: Request, publicId: string) {
      try {
        assertPublicLoungeSameOrigin(request);
        const post = await assertAuthoritativePost(request, publicId);
        const input = parsePublicLoungeVoteInput(await readPublicLoungeBoundedJson(request));
        return json(await gatewayProvider().setVote(
          request,
          post.publicId,
          post.versionId,
          input.selected,
        ));
      } catch (error) {
        return interactionErrorResponse(error);
      }
    },

    async comment(request: Request, publicId: string) {
      try {
        assertPublicLoungeSameOrigin(request);
        const post = await assertAuthoritativePost(request, publicId);
        const input = parsePublicLoungeCommentInput(await readPublicLoungeBoundedJson(request));
        if (input.chapterNumber !== null && input.chapterNumber > post.chapterCount) {
          throw new PublicLoungeInteractionError("PUBLIC_LOUNGE_CHAPTER_INVALID", 400);
        }
        return json(await gatewayProvider().addComment(request, {
          publicId: post.publicId,
          currentVersionId: post.versionId,
          ...input,
        }), 201);
      } catch (error) {
        return interactionErrorResponse(error);
      }
    },

    async deleteComment(request: Request, publicId: string, commentId: string) {
      try {
        assertPublicLoungeSameOrigin(request);
        const post = await assertAuthoritativePost(request, publicId);
        const canonicalCommentId = assertPublicLoungeInteractionUuid(commentId);
        const input = parsePublicLoungeDeleteCommentInput(await readPublicLoungeBoundedJson(request));
        await gatewayProvider().deleteComment(
          request,
          post.publicId,
          post.versionId,
          canonicalCommentId,
          input.reason,
        );
        return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
      } catch (error) {
        return interactionErrorResponse(error);
      }
    },

    async report(request: Request, publicId: string) {
      try {
        assertPublicLoungeSameOrigin(request);
        const post = await assertAuthoritativePost(request, publicId);
        const input = parsePublicLoungeReportInput(await readPublicLoungeBoundedJson(request));
        return json(await gatewayProvider().report(request, {
          publicId: post.publicId,
          currentVersionId: post.versionId,
          ...input,
        }), 201);
      } catch (error) {
        return interactionErrorResponse(error);
      }
    },
  };
}
