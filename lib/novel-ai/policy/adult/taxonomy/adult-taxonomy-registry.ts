import type { AdultRating } from "../adult-policy-types";
import type { AdultScenarioPack, AdultTaxonomyCategory, AdultTaxonomyTag } from "./adult-taxonomy-types";

export const ADULT_TAXONOMY_VERSION = "adult-taxonomy-v1";

export const ADULT_TAXONOMY_CATEGORIES: AdultTaxonomyCategory[] = [
  ["character_archetype", "Character Archetype"],
  ["appearance_style", "Appearance Style"],
  ["clothing_costume", "Clothing / Costume"],
  ["occupation_identity", "Occupation / Identity"],
  ["relationship_type", "Relationship Type"],
  ["location", "Location"],
  ["situation", "Situation"],
  ["emotional_tone", "Emotional Tone"],
  ["power_dynamic", "Power Dynamic"],
  ["narrative_device", "Narrative Device"],
  ["pacing", "Pacing"],
  ["explicitness", "Explicitness"],
  ["stage_pattern", "Stage Pattern"],
  ["plot_purpose", "Plot Purpose"],
  ["aftermath_type", "Aftermath Type"],
  ["version_type", "Version Type"],
].map(([categoryId, displayName], index) => ({
  categoryId: categoryId as AdultTaxonomyCategory["categoryId"],
  displayName,
  ordinal: index + 1,
  enabled: true,
}));

function tag(
  tagId: string,
  categoryId: AdultTaxonomyTag["categoryId"],
  displayName: string,
  aliases: string[],
  description: string,
  extra: Partial<AdultTaxonomyTag> = {},
): AdultTaxonomyTag {
  return {
    tagId,
    categoryId,
    displayName,
    aliases,
    description,
    enabled: true,
    adultOnly: false,
    minimumRating: "E1",
    requiresTags: [],
    excludesTags: [],
    compatibleTags: [],
    requiredRelationshipStages: [],
    requiredStoryFacts: [],
    requiredPolicyFlags: [],
    defaultWeight: 1,
    preferenceWeight: 1,
    noveltyWeight: 1,
    repetitionWeight: 1,
    ...extra,
  };
}

export const ADULT_TAXONOMY_TAGS: AdultTaxonomyTag[] = [
  tag("archetype_reserved_strategist", "character_archetype", "Reserved strategist", ["strategist", "planner"], "A character who acts indirectly and values careful setup."),
  tag("archetype_direct_challenger", "character_archetype", "Direct challenger", ["challenger", "direct"], "A character who confronts pressure directly."),
  tag("archetype_wounded_guardian", "character_archetype", "Wounded guardian", ["guardian", "protector"], "A protective character with unresolved emotional costs."),
  tag("appearance_formal_elegant", "appearance_style", "Formal elegance", ["elegant", "formal"], "A composed and formal presentation."),
  tag("costume_ceremonial", "clothing_costume", "Ceremonial costume", ["ceremonial", "ritual"], "A symbolic outfit tied to status or ritual."),
  tag("identity_editor", "occupation_identity", "Editor / investigator", ["editor", "investigator"], "A role centered on observation, text, and truth finding."),
  tag("identity_political_heir", "occupation_identity", "Political heir", ["heir", "political"], "A public identity shaped by status and pressure."),
  tag("relationship_established_partner", "relationship_type", "Established partner", ["partner", "established"], "A relationship with shared history.", { requiredRelationshipStages: ["established", "conflicted", "reconciled"] }),
  tag("relationship_false_to_real", "relationship_type", "False relationship becomes real", ["fake relationship", "false to real"], "A public arrangement that gradually becomes emotionally real.", { requiredRelationshipStages: ["acquainted", "attraction", "emotional_bond"] }),
  tag("location_shared_travel", "location", "Shared travel space", ["travel", "shared space"], "A constrained travel setting where characters cannot easily avoid each other."),
  tag("location_political_estate", "location", "Political estate", ["estate", "manor"], "A status-heavy place with surveillance and social pressure."),
  tag("situation_long_reunion", "situation", "Long separation reunion", ["reunion", "separation"], "Characters meet again after unresolved history."),
  tag("situation_trapped_storm", "situation", "Storm trapped", ["storm", "trapped"], "External pressure forces proximity and decision."),
  tag("tone_tender_tension", "emotional_tone", "Tender tension", ["tender", "soft tension"], "Soft emotion under unresolved pressure."),
  tag("tone_bitter_humor", "emotional_tone", "Bitter humor", ["bitter humor", "dry wit"], "Emotional strain filtered through restrained wit."),
  tag("power_mutual_choice", "power_dynamic", "Mutual choice", ["mutual", "agency"], "Both sides retain agency."),
  tag("device_hidden_identity", "narrative_device", "Hidden identity", ["identity", "hidden identity"], "One or more identities are not fully known."),
  tag("pacing_slow_burn", "pacing", "Slow burn", ["slow burn", "gradual"], "Gradual development with delayed payoff."),
  tag("explicitness_fade_to_black", "explicitness", "Fade to black", ["fade", "implied"], "Private moments are implied rather than described."),
  tag("explicitness_mature_private", "explicitness", "Mature private", ["mature", "private"], "Mature-only handling requiring policy checks.", { adultOnly: true, minimumRating: "E3", requiredPolicyFlags: ["adultStoryPolicyStatus:ready"] }),
  tag("stage_pattern_reconnect", "stage_pattern", "Reconnect pattern", ["reconnect", "repair"], "A sequence from guarded contact to renewed trust."),
  tag("plot_purpose_relationship_turn", "plot_purpose", "Relationship turn", ["turn", "relationship change"], "A scene whose main job is changing relationship state."),
  tag("aftermath_boundary_change", "aftermath_type", "Boundary change", ["boundary", "aftermath"], "Aftermath changes what characters allow or avoid."),
  tag("version_private", "version_type", "Private version", ["private", "author-only"], "A private drafting track not meant for public export.", { adultOnly: true, minimumRating: "E3" }),
  tag("version_public_romance", "version_type", "Public romance", ["public", "public-safe"], "A public-safe version preserving outcome without private detail."),
];

function pack(
  scenarioPackId: string,
  title: string,
  premise: string,
  compatibleTags: string[],
  extra: Partial<AdultScenarioPack> = {},
): AdultScenarioPack {
  return {
    scenarioPackId,
    title,
    premise,
    participantRoles: ["lead", "counterpart"],
    requiredRelationshipStages: ["acquainted", "attraction", "emotional_bond", "established"],
    requiredSetup: ["Both participants have a clear reason to remain in the same scene."],
    locationOptions: ["private room", "travel stop", "estate corridor"],
    emotionalToneOptions: ["tender tension", "guarded honesty"],
    stageTemplate: ["setup", "approach", "boundary check", "turning point", "aftermath"],
    narrativePurpose: "relationship_turn",
    consequenceTemplate: "Trust, secrecy, or future boundaries change after the scene.",
    compatibleTags,
    incompatibleTags: [],
    ratingRange: ["E1", "E5"] as [AdultRating, AdultRating],
    version: 1,
    enabled: true,
    ...extra,
  };
}

export const ADULT_SCENARIO_PACKS: AdultScenarioPack[] = [
  pack("established_partner_reconnection", "Established partner reconnection", "A pair with shared history chooses whether to rebuild trust.", ["relationship_established_partner", "stage_pattern_reconnect", "tone_tender_tension"]),
  pack("long_separation_reunion", "Long separation reunion", "Old absence returns as a present-tense emotional problem.", ["situation_long_reunion", "tone_tender_tension"]),
  pack("secret_workplace_relationship", "Secret workplace relationship", "Public roles pressure private honesty.", ["identity_editor", "device_hidden_identity"]),
  pack("political_marriage", "Political marriage", "Public duty and personal choice collide.", ["identity_political_heir", "location_political_estate"]),
  pack("false_relationship_becomes_real", "False relationship becomes real", "A strategic arrangement begins to create real consequences.", ["relationship_false_to_real", "plot_purpose_relationship_turn"]),
  pack("opposing_factions", "Opposing factions", "Characters from rival sides negotiate trust.", ["power_mutual_choice", "location_political_estate"]),
  pack("storm_trapped", "Storm trapped", "External pressure forces conversation and boundary-setting.", ["situation_trapped_storm", "location_shared_travel"]),
  pack("travel_shared_space", "Travel shared space", "A journey removes escape routes and exposes habits.", ["location_shared_travel", "pacing_slow_burn"]),
  pack("hot_spring_trip", "Hot spring trip", "A retreat setting tests privacy, etiquette, and emotional honesty.", ["location_shared_travel", "explicitness_fade_to_black"], { ratingRange: ["E2", "E5"] }),
  pack("identity_exchange", "Identity exchange", "A swapped or hidden identity changes trust calculations.", ["device_hidden_identity", "tone_bitter_humor"]),
  pack("time_loop_relationship", "Time loop relationship", "Repeated chances reveal what each character avoids saying.", ["pacing_slow_burn", "stage_pattern_reconnect"]),
  pack("parallel_world_partner", "Parallel world partner", "A familiar person from another world complicates loyalty.", ["device_hidden_identity", "plot_purpose_relationship_turn"]),
  pack("artificial_intelligence_partner", "Artificial intelligence partner", "Agency and intimacy are filtered through personhood questions.", ["power_mutual_choice", "tone_tender_tension"]),
  pack("nonhuman_fantasy_partner", "Nonhuman fantasy partner", "World rules shape boundaries and trust.", ["power_mutual_choice", "explicitness_fade_to_black"]),
  pack("revenge_emotional_complication", "Revenge emotional complication", "A revenge plan is complicated by real emotional stakes.", ["archetype_reserved_strategist", "tone_bitter_humor"]),
  pack("hidden_identity_relationship", "Hidden identity relationship", "Affection grows while key truths remain concealed.", ["device_hidden_identity", "relationship_false_to_real"]),
];

export function normalizeAlias(value: string) {
  return value.trim().toLowerCase();
}
