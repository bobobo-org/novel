import { createHash, timingSafeEqual } from "node:crypto";

export const WEB_DISTILL_SHARED_PUBLISH_ENABLED_ENV = "WEB_DISTILL_SHARED_PUBLISH_ENABLED";
export const WEB_DISTILL_SHARED_PUBLISH_TOKEN_ENV = "WEB_DISTILL_SHARED_PUBLISH_ADMIN_TOKEN";
export const WEB_DISTILL_SHARED_PUBLISH_TOKEN_HEADER = "x-novel-web-distill-publish-token";

type PublicationEnvironment = Record<string, string | undefined>;

export type ControlledWebSharedPublicationDecision =
  | { allowed: true; code: "WEB_DISTILL_SHARED_PUBLICATION_AUTHORIZED" }
  | {
      allowed: false;
      code:
        | "WEB_DISTILL_SHARED_PUBLICATION_DISABLED"
        | "WEB_DISTILL_SHARED_PUBLICATION_NOT_CONFIGURED"
        | "WEB_DISTILL_SHARED_PUBLICATION_NOT_AUTHORIZED";
    };

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Public research may always return a local candidate. Publishing that
 * candidate to the cross-user shared library is a separate, operator-only
 * action and is fail-closed unless both controls are present.
 */
export function evaluateControlledWebSharedPublication(input: {
  suppliedToken: string | null | undefined;
  environment?: PublicationEnvironment;
}): ControlledWebSharedPublicationDecision {
  const environment = input.environment ?? process.env;
  if (environment[WEB_DISTILL_SHARED_PUBLISH_ENABLED_ENV]?.trim() !== "1") {
    return { allowed: false, code: "WEB_DISTILL_SHARED_PUBLICATION_DISABLED" };
  }
  const expectedToken = environment[WEB_DISTILL_SHARED_PUBLISH_TOKEN_ENV]?.trim() ?? "";
  if (Buffer.byteLength(expectedToken, "utf8") < 32) {
    return { allowed: false, code: "WEB_DISTILL_SHARED_PUBLICATION_NOT_CONFIGURED" };
  }
  const suppliedToken = input.suppliedToken?.trim() ?? "";
  if (!suppliedToken || !timingSafeEqual(digest(suppliedToken), digest(expectedToken))) {
    return { allowed: false, code: "WEB_DISTILL_SHARED_PUBLICATION_NOT_AUTHORIZED" };
  }
  return { allowed: true, code: "WEB_DISTILL_SHARED_PUBLICATION_AUTHORIZED" };
}
