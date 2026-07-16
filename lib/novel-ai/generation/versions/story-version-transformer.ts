import { OllamaClient } from "../../providers/ollama/ollama-client";
import { checkOllamaHealth } from "../../providers/ollama/ollama-health";
import { summarizeText, type StoryRating, type StoryTransformType, type StoryVersionOptions } from "./story-version-types";

const INSTRUCTIONS: Record<StoryTransformType, { rating?: StoryRating; prompt: string }> = {
  private_to_mature: {
    rating: "mature",
    prompt: "Rewrite into a mature literary version. Preserve all plot outcomes, character consequences, and branch identity. Remove explicit private phrasing while keeping emotional consequence.",
  },
  private_to_fade_to_black: {
    rating: "fade_to_black",
    prompt: "Rewrite as fade-to-black. Preserve setup, consent/relationship consequence where present, aftermath, plot outcomes, and next-scene hooks. Omit explicit private detail.",
  },
  private_to_public_romance: {
    rating: "public_romance",
    prompt: "Rewrite into public-safe romance prose. Keep emotional stakes, relationship state changes, required events, and consequences. Avoid explicit private content.",
  },
  short_drama: {
    prompt: "Convert into short drama script with concise scene directions and dialogue. Preserve required events and consequences.",
  },
  audio_drama: {
    prompt: "Convert into audio drama script with sound cues, speaker labels, and narration. Preserve required events and consequences.",
  },
  outline: {
    prompt: "Convert into a concise outline. Preserve scene outcome, required events, character changes, relationship changes, and unresolved consequences.",
  },
  tone_variant: {
    prompt: "Create a tone variant while preserving all outcomes and facts. Do not change required events.",
  },
  viewpoint_variant: {
    prompt: "Create an alternate viewpoint version while preserving all outcomes and facts. Do not change required events.",
  },
  pacing_variant: {
    prompt: "Create an alternate pacing version while preserving all outcomes and facts. Do not remove required events.",
  },
};

function localTransform(sourceText: string, transformType: StoryTransformType) {
  if (transformType === "outline") {
    return sourceText.split(/[。！？.!?]\s*/).filter(Boolean).slice(0, 8).map((line, index) => `${index + 1}. ${line.trim()}`).join("\n");
  }
  if (transformType === "short_drama" || transformType === "audio_drama") {
    const cue = transformType === "audio_drama" ? "SFX: low room tone\n" : "";
    return `${cue}NARRATOR: ${summarizeText(sourceText)}\nLEAD: We keep the consequence, but change how the scene is performed.\nNARRATOR: The required outcome remains intact.`;
  }
  return sourceText
    .replace(/\bexplicit\b/gi, "private")
    .replace(/\s+/g, " ")
    .trim();
}

export async function transformTextWithLocalModel(sourceText: string, transformType: StoryTransformType, options: StoryVersionOptions = {}) {
  const health = await checkOllamaHealth();
  const model = options.model || health.selectedModel;
  if (!model) {
    return { text: localTransform(sourceText, transformType), provider: "local-rule", model: "none", externalRequestCount: 0, dataLeftDevice: false };
  }
  const instruction = INSTRUCTIONS[transformType].prompt;
  const prompt = [
    "You are a local-only fiction transformation engine.",
    "Return only the transformed text. No markdown fence. No commentary.",
    instruction,
    "SOURCE:",
    sourceText,
  ].join("\n\n");
  try {
    const client = new OllamaClient({ endpoint: options.ollamaEndpoint, timeoutMs: options.timeoutMs ?? 120_000 });
    const result = await client.generate({
      model,
      prompt,
      stream: false,
      signal: options.signal,
      options: { temperature: 0.2, num_predict: Math.max(160, Math.min(900, Math.ceil(sourceText.length / 2))) },
    });
    return {
      text: String(result.response || "").trim() || localTransform(sourceText, transformType),
      provider: "ollama-local",
      model,
      externalRequestCount: 0,
      dataLeftDevice: false,
    };
  } catch {
    return { text: localTransform(sourceText, transformType), provider: "local-rule", model: "fallback", externalRequestCount: 0, dataLeftDevice: false };
  }
}

export function ratingForTransform(sourceRating: StoryRating, transformType: StoryTransformType): StoryRating {
  return INSTRUCTIONS[transformType].rating || sourceRating;
}

export function versionTypeForTransform(transformType: StoryTransformType) {
  if (transformType === "outline") return "outline_only";
  if (transformType === "short_drama") return "short_drama";
  if (transformType === "audio_drama") return "audio_drama";
  if (transformType === "tone_variant") return "alternate_tone";
  if (transformType === "viewpoint_variant") return "alternate_viewpoint";
  if (transformType === "pacing_variant") return "alternate_pacing";
  if (transformType === "private_to_fade_to_black" || transformType === "private_to_public_romance") return "condensed";
  return "expanded";
}

