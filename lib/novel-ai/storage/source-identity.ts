import crypto from "crypto";
import type { JsonRecord } from "./types";

export const SOURCE_NATURAL_KEY_VERSION = "source-natural-key-v1";

function normalized(value: unknown, sentinel: string) {
  const text = String(value ?? "").trim();
  return text || sentinel;
}

export function normalizeSourceIdentity(source: JsonRecord) {
  return {
    projectId: normalized(source.projectId || source.project_id, "__no_project__"),
    sourceHash: normalized(source.sourceHash || source.source_hash || source.excerptHash || source.excerpt_hash, "__no_hash__"),
    chapterId: normalized(source.chapterId || source.chapter_id, "__no_chapter__"),
    normalizedSceneId: normalized(source.sceneId || source.scene_id, "__no_scene__"),
    normalizedParagraphStart: normalized(source.paragraphStart ?? source.paragraph_start ?? source.paragraphIndex ?? source.paragraph_index ?? source.textStart ?? source.text_start, "__no_paragraph_start__"),
    normalizedParagraphEnd: normalized(source.paragraphEnd ?? source.paragraph_end ?? source.textEnd ?? source.text_end, "__no_paragraph_end__"),
    sourceType: normalized(source.sourceType || source.source_type, "text_excerpt"),
  };
}

export function createSourceNaturalKey(source: JsonRecord) {
  const identity = normalizeSourceIdentity(source);
  return [
    SOURCE_NATURAL_KEY_VERSION,
    identity.projectId,
    identity.sourceHash,
    identity.chapterId,
    identity.normalizedSceneId,
    identity.normalizedParagraphStart,
    identity.normalizedParagraphEnd,
    identity.sourceType,
  ].join("|");
}

export function createSourceNaturalKeyHash(source: JsonRecord) {
  return crypto.createHash("sha256").update(createSourceNaturalKey(source)).digest("hex");
}
