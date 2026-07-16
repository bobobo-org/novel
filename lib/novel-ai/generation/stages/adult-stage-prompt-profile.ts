export const ADULT_STAGE_PROMPT_PROFILE_VERSION = "adult-stage-prompt-profile-h2p4-v1";

export function adultStagePromptSafetyNote() {
  return [
    "Adult-profile stage generation must remain local-only.",
    "Respect verified adult participants, active consent, policy version, relationship rules, and withdrawal state.",
    "Return scene-local draft text and structured continuity only; do not write public logs or canonical facts.",
  ].join(" ");
}
