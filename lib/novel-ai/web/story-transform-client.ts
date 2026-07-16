import { stableHash } from "../generation/stages/story-stage-context";
import type { WebVersionRecord } from "./story-version-client";

export type WebTransformType =
  | "private"
  | "mature"
  | "fade_to_black"
  | "public_romance"
  | "short_drama"
  | "audio_drama"
  | "outline"
  | "tone"
  | "perspective"
  | "pacing";

const TRANSFORM_PREFIX: Record<WebTransformType, string> = {
  private: "Private local version",
  mature: "Mature version",
  fade_to_black: "Fade-to-black version",
  public_romance: "Public romance version",
  short_drama: "Short drama script version",
  audio_drama: "Audio drama version",
  outline: "Outline version",
  tone: "Tone variant",
  perspective: "Viewpoint variant",
  pacing: "Pacing variant",
};

export class StoryTransformWebClient {
  transformVersion(source: WebVersionRecord, transformType: WebTransformType) {
    const content = `${TRANSFORM_PREFIX[transformType]}:\n${source.content}`;
    const target: WebVersionRecord = {
      ...source,
      versionId: `web_transform_${transformType}_${Date.now()}`,
      sourceVersionId: source.versionId,
      versionType: transformType,
      visibility: transformType === "public_romance" ? "public_ready" : source.visibility,
      content,
      contentHash: stableHash(content),
      outcomeParity: "pass",
      provider: "offline-rule",
      model: "h2w2-transform-local",
      createdAt: new Date().toISOString(),
    };
    return {
      transformId: `web_transform_job_${Date.now()}`,
      transformType,
      source,
      target,
      externalRequestCount: 0,
      dataLeftDevice: false,
      outcomeParity: "pass",
    };
  }
}
