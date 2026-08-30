import { createHash } from "node:crypto";
import { stableStringify } from "../../closed-ai-cache";
import {
  assertExternalRpgPublicPayload,
  buildExternalRpgPromptFromPayload,
  EXTERNAL_RPG_PUBLIC_FIELD_MANIFEST,
  type ExternalRpgPublicPayload,
} from "../../web/rpg-external-public-context";

export const CANONICAL_EXTERNAL_RPG_FIELD_MANIFEST_DIGEST = createHash("sha256")
  .update(stableStringify(EXTERNAL_RPG_PUBLIC_FIELD_MANIFEST))
  .digest("hex");

export class ExternalRpgRequestError extends Error {
  readonly code: string;
  readonly status = 400;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ExternalRpgRequestError";
    this.code = code;
  }
}

function reject(code: string, message: string): never {
  throw new ExternalRpgRequestError(code, message);
}

/**
 * Server-owned reconstruction boundary for RPG egress. The provider prompt is
 * rebuilt from the exact public schema; client assertions never define the
 * allowed manifest and no free-form system instruction can accompany it.
 */
export function validateExternalRpgRequestBody(input: {
  body: Record<string, unknown>;
  acceptsEventStream: boolean;
}) {
  const { body } = input;
  if (body.systemInstruction !== undefined) {
    reject("EXTERNAL_RPG_SYSTEM_INSTRUCTION_FORBIDDEN", "RPG 外送不得附加未綁定的系統指令。");
  }
  if (body.stream === true || input.acceptsEventStream) {
    reject("EXTERNAL_RPG_STREAM_FORBIDDEN", "RPG 外送必須先完整緩衝並通過正文驗證，不提供未驗證串流。");
  }
  if (body.rpgFieldManifestDigest !== CANONICAL_EXTERNAL_RPG_FIELD_MANIFEST_DIGEST) {
    reject("EXTERNAL_RPG_FIELD_MANIFEST_MISMATCH", "RPG 外送欄位清單與伺服器規格不一致。");
  }
  try {
    assertExternalRpgPublicPayload(body.rpgPublicPayload);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    reject("EXTERNAL_RPG_PUBLIC_PAYLOAD_INVALID", "RPG 外送資料超出公開欄位界線。");
  }
  const canonicalPrompt = buildExternalRpgPromptFromPayload(
    body.rpgPublicPayload as ExternalRpgPublicPayload,
  );
  if (body.prompt !== canonicalPrompt) {
    reject("EXTERNAL_RPG_PROMPT_TAMPERED", "RPG 外送提示與公開結構資料不一致。");
  }
  return {
    canonicalPrompt,
    promptDigest: createHash("sha256").update(canonicalPrompt).digest("hex"),
    fieldManifestDigest: CANONICAL_EXTERNAL_RPG_FIELD_MANIFEST_DIGEST,
  };
}
