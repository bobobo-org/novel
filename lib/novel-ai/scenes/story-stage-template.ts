import type { StorySceneProfileId, StoryStageTemplate } from "./story-scene-types";

const templateStages: Record<StorySceneProfileId, string[]> = {
  general_plot: ["setup", "goal", "obstacle", "confrontation", "reversal", "decision", "consequence", "hook"],
  action_battle: ["threat", "positioning", "first_exchange", "escalation", "tactical_reversal", "decisive_action", "outcome", "consequence"],
  mystery_reveal: ["discovery", "observation", "hypothesis", "contradiction", "investigation", "reveal", "reinterpretation", "next_question"],
  palace_intrigue: ["social_setup", "hidden_agenda", "probing", "trap", "evidence", "reversal", "public_resolution", "faction_consequence"],
  business_negotiation: ["market_context", "stakeholder_position", "negotiation", "hidden_information", "counter_move", "leverage_shift", "agreement_or_breakdown", "business_consequence"],
  romance: ["emotional_setup", "interaction", "vulnerability", "misunderstanding_or_tension", "emotional_reveal", "choice", "relationship_change", "aftermath"],
  adult_intimacy: ["setup", "approach", "consent", "escalation", "explicit", "peak", "deescalation", "aftermath"],
  custom: ["custom_setup", "custom_development", "custom_turn", "custom_resolution"],
};

function title(stage: string) {
  return stage.replace(/_/g, " ");
}

export function buildStageTemplate(profileId: StorySceneProfileId): StoryStageTemplate {
  const stages = templateStages[profileId] ?? templateStages.general_plot;
  return {
    templateId: `${profileId}_stage_template_v1`,
    profileId,
    templateName: `${profileId.replace(/_/g, " ")} template`,
    stageTypes: stages,
    stageGoals: Object.fromEntries(stages.map((stage) => [stage, `Plan ${title(stage)} as a structured story beat.`])),
    dependencyRules: stages.map((stage, index) => ({
      stageType: stage,
      dependsOn: stages[index - 1],
      requiredStatus: index === 0 ? undefined : "approved",
      required: !(profileId === "adult_intimacy" && ["explicit", "peak"].includes(stage)),
      skippable: profileId === "adult_intimacy" ? ["explicit", "peak"].includes(stage) : false,
    })),
    continuitySchemaVersion: `${profileId}-continuity-v1`,
  };
}

export const STORY_STAGE_TEMPLATES = Object.keys(templateStages).map((profileId) => buildStageTemplate(profileId as StorySceneProfileId));
