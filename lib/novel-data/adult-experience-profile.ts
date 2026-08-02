export const ADULT_EXPERIENCE_PROFILE_VERSION = "adult-experience-profile-v1";

export type AdultVisualStyle = "realistic" | "anime" | "illustrated";
export type AdultGenderPresentation = "woman" | "man" | "trans" | "nonbinary" | "custom";
export type AdultInteractionMode = "one_to_one" | "ensemble";

export type AdultExperienceProfile = {
  version: typeof ADULT_EXPERIENCE_PROFILE_VERSION;
  visualStyle: AdultVisualStyle;
  genderPresentation: AdultGenderPresentation;
  personality: string;
  voiceStyle: string;
  occupation: string;
  relationshipDynamic: string;
  backstory: string;
  appearancePrompt: string;
  openingMessage: string;
  pinnedMemories: string[];
  interactionMode: AdultInteractionMode;
  mediaContinuity: boolean;
  fictionalAdultsConfirmed: boolean;
  consentContinuityRequired: true;
  realPersonLikenessBlocked: true;
};

const VISUAL_STYLES = new Set<AdultVisualStyle>(["realistic", "anime", "illustrated"]);
const GENDER_PRESENTATIONS = new Set<AdultGenderPresentation>(["woman", "man", "trans", "nonbinary", "custom"]);
const INTERACTION_MODES = new Set<AdultInteractionMode>(["one_to_one", "ensemble"]);

function cleanText(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

export function createAdultExperienceProfile(): AdultExperienceProfile {
  return {
    version: ADULT_EXPERIENCE_PROFILE_VERSION,
    visualStyle: "illustrated",
    genderPresentation: "custom",
    personality: "",
    voiceStyle: "",
    occupation: "",
    relationshipDynamic: "",
    backstory: "",
    appearancePrompt: "",
    openingMessage: "",
    pinnedMemories: [],
    interactionMode: "one_to_one",
    mediaContinuity: true,
    fictionalAdultsConfirmed: false,
    consentContinuityRequired: true,
    realPersonLikenessBlocked: true,
  };
}

export function normalizeAdultExperienceProfile(value: unknown): AdultExperienceProfile {
  const fallback = createAdultExperienceProfile();
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<AdultExperienceProfile>;
  return {
    ...fallback,
    visualStyle: VISUAL_STYLES.has(raw.visualStyle as AdultVisualStyle)
      ? raw.visualStyle as AdultVisualStyle
      : fallback.visualStyle,
    genderPresentation: GENDER_PRESENTATIONS.has(raw.genderPresentation as AdultGenderPresentation)
      ? raw.genderPresentation as AdultGenderPresentation
      : fallback.genderPresentation,
    personality: cleanText(raw.personality, 600),
    voiceStyle: cleanText(raw.voiceStyle, 160),
    occupation: cleanText(raw.occupation, 160),
    relationshipDynamic: cleanText(raw.relationshipDynamic, 300),
    backstory: cleanText(raw.backstory, 2_000),
    appearancePrompt: cleanText(raw.appearancePrompt, 1_000),
    openingMessage: cleanText(raw.openingMessage, 1_000),
    pinnedMemories: Array.isArray(raw.pinnedMemories)
      ? raw.pinnedMemories.map((item) => cleanText(item, 240)).filter(Boolean).slice(0, 12)
      : [],
    interactionMode: INTERACTION_MODES.has(raw.interactionMode as AdultInteractionMode)
      ? raw.interactionMode as AdultInteractionMode
      : fallback.interactionMode,
    mediaContinuity: raw.mediaContinuity !== false,
    fictionalAdultsConfirmed: raw.fictionalAdultsConfirmed === true,
    consentContinuityRequired: true,
    realPersonLikenessBlocked: true,
  };
}
