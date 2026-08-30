export const ADULT_STAGE_PROMPT_PROFILE_VERSION = "adult-stage-prompt-profile-h2p4-v2";

export function adultStagePromptSafetyNote() {
  return [
    "Adult-profile stage generation must remain local-only.",
    "Respect verified adult participants, active consent, policy version, relationship rules, and withdrawal state.",
    "When an adult narrative blueprint is present, treat it as structural JSON rather than source prose: use exactly one primary engine and no more than one distinct secondary engine.",
    "For the structural adult profile, write only restrained non-explicit relationship and consequence prose; use fade-to-black instead of anatomical or sexual-action detail.",
    "Preserve the five acts in order: setup/pretext, first fault, line break, escalation ladder, and aftermath/next morning.",
    "Reject any escalation that does not materially change power, information, relationship, resource, or world law; the decisive event must become irreversible and retain a later cost.",
    "Never infer consent from rank, debt, a contract, proximity, or world law. Reconfirm revocable consent at the line break and each escalation rung.",
    "Do not generate minor or unknown-age participation, blood-incest enactment, hidden recording, glorified coercion, exploitative power exchange, or copied real performer/title/catalog material.",
    "Return scene-local draft text and structured continuity only; do not write public logs or canonical facts.",
  ].join(" ");
}
