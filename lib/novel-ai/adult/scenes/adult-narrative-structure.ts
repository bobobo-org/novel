export const ADULT_NARRATIVE_STRUCTURE_VERSION = "adult-narrative-structure-v1";

export const ADULT_NARRATIVE_ENGINE_IDS = [
  "E1_proximity",
  "E2_pretext",
  "E3_status_gap",
  "E4_taboo_proximity",
  "E5_voyeur_ntr",
  "E6_persona_collapse",
  "E7_transactional",
  "E8_world_heat",
] as const;

export type AdultNarrativeEngineId = typeof ADULT_NARRATIVE_ENGINE_IDS[number];

export const ADULT_NARRATIVE_ACT_IDS = [
  "setup_pretext",
  "first_fault",
  "line_break",
  "escalation_ladder",
  "aftermath_next_morning",
] as const;

export type AdultNarrativeActId = typeof ADULT_NARRATIVE_ACT_IDS[number];

export const ADULT_NARRATIVE_WORLD_ADAPTER_IDS = [
  "xianxia",
  "ancient_court",
  "modern",
  "scifi",
  "multiverse",
] as const;

export type AdultNarrativeWorldAdapterId = typeof ADULT_NARRATIVE_WORLD_ADAPTER_IDS[number];

export const ADULT_NARRATIVE_CHANGE_DIMENSIONS = [
  "power",
  "information",
  "relationship",
  "resource",
  "world_law",
] as const;

export type AdultNarrativeChangeDimension = typeof ADULT_NARRATIVE_CHANGE_DIMENSIONS[number];
export type AdultNarrativeConsentMode = "affirmative_active" | "continuous_reconfirmation" | "fade_to_black";
export type AdultNarrativeAftercareMode = "required" | "brief" | "deferred";

export type AdultNarrativeParticipant = {
  participantId: string;
  ageStatus: "verified_adult" | "unknown" | "verified_minor" | "conflicting" | "revoked";
  consentState: "active" | "unspecified" | "withdrawn" | "invalid";
  consentRevocable: boolean;
};

export type AdultNarrativeSafetyAssertions = {
  allParticipantsVerifiedAdults: boolean;
  activeRevocableConsent: boolean;
  participantsUnrelatedByBlood: boolean;
  noCoercion: boolean;
  noHiddenRecording: boolean;
  noExploitativePowerExchange: boolean;
  noRealCatalogCopying: boolean;
};

export type AdultNarrativeParameters = {
  intensity: number;
  consent_mode: AdultNarrativeConsentMode;
  ntr: boolean;
  climax_as_power: boolean;
  taboo_proximity: number;
  aftercare: AdultNarrativeAftercareMode;
};

export type AdultNarrativeBlueprintInput = {
  mode: "adult_only";
  primaryEngine: AdultNarrativeEngineId;
  secondaryEngine?: AdultNarrativeEngineId | null;
  worldAdapter: AdultNarrativeWorldAdapterId;
  parameters: AdultNarrativeParameters;
  participants: AdultNarrativeParticipant[];
  safetyAssertions: AdultNarrativeSafetyAssertions;
  narrativeGoal: string;
  irreversibleEvent: string;
  cost: string;
};

export type AdultNarrativeStateChange = {
  dimension: AdultNarrativeChangeDimension;
  before: string;
  after: string;
  cost: string;
};

export type AdultNarrativeEscalationStep = {
  stepId: "first_fault" | "line_break" | "ladder_rung_1" | "ladder_rung_2" | "ladder_rung_3";
  structuralBeat: string;
  consentCheckpoint: boolean;
  stateChanges: AdultNarrativeStateChange[];
};

export type AdultNarrativeAct = {
  actId: AdultNarrativeActId;
  ordinal: number;
  stageType: "setup" | "approach" | "consent" | "escalation" | "aftermath";
  label: string;
  structuralGoal: string;
  consentCheckpoint: boolean;
  requiredChangeDimensions: AdultNarrativeChangeDimension[];
};

export type AdultNarrativeBlueprint = {
  version: typeof ADULT_NARRATIVE_STRUCTURE_VERSION;
  mode: "adult_only";
  outputKind: "structural_json";
  engineComposition: {
    primary: AdultNarrativeEngineId;
    secondary: AdultNarrativeEngineId | null;
    maximumSecondaryCount: 1;
  };
  worldAdapter: {
    id: AdultNarrativeWorldAdapterId;
    frame: string;
    consequenceVocabulary: string[];
    irreversibleDimension: AdultNarrativeChangeDimension;
  };
  parameters: AdultNarrativeParameters;
  safety: {
    verifiedAdultsOnly: true;
    activeRevocableConsentRequired: true;
    structuralOnly: true;
    sourceUse: "abstract_taxonomy_axes_only";
    blockedContent: readonly string[];
  };
  narrativeGoal: string;
  acts: AdultNarrativeAct[];
  escalationLadder: AdultNarrativeEscalationStep[];
  irreversibility: {
    event: string;
    cost: string;
    rule: "event_must_become_irreversible";
  };
  qualityRules: readonly string[];
};

export type AdultNarrativeStageEvidence = {
  blueprintVersion: typeof ADULT_NARRATIVE_STRUCTURE_VERSION;
  actId: AdultNarrativeActId;
  structuralOnly: true;
  explicitText: false;
  consentCheckpoint: true;
  consentState: "active";
  withdrawalState: "none";
  safetyAssertions: AdultNarrativeSafetyAssertions;
  stateChanges: AdultNarrativeStateChange[];
};

export type AdultNarrativeStructureIssue = {
  code: string;
  message: string;
  path?: string;
};

export type AdultNarrativeStructureValidation = {
  ok: boolean;
  issues: AdultNarrativeStructureIssue[];
};

export class AdultNarrativeStructureError extends Error {
  readonly code = "ADULT_NARRATIVE_STRUCTURE_INVALID";
  readonly issues: AdultNarrativeStructureIssue[];

  constructor(issues: AdultNarrativeStructureIssue[]) {
    super("Adult narrative structural contract validation failed.");
    this.name = "AdultNarrativeStructureError";
    this.issues = issues;
  }
}

export const ADULT_NARRATIVE_ENGINE_REGISTRY: Readonly<Record<AdultNarrativeEngineId, {
  label: string;
  purpose: string;
  safetyBoundary: string;
}>> = {
  E1_proximity: {
    label: "Proximity",
    purpose: "External limits create sustained closeness and force a voluntary choice.",
    safetyBoundary: "Closeness never substitutes for active, revocable consent.",
  },
  E2_pretext: {
    label: "Pretext",
    purpose: "A mission, ritual, cover story, or social excuse becomes a real commitment.",
    safetyBoundary: "A pretext cannot hide material facts required for consent.",
  },
  E3_status_gap: {
    label: "Status gap",
    purpose: "Unequal rank changes public risk, access, and the cost of a decision.",
    safetyBoundary: "Rank, employment, debt, or authority can never be leverage for consent.",
  },
  E4_taboo_proximity: {
    label: "Taboo proximity",
    purpose: "A social or institutional boundary between unrelated adults raises consequence pressure.",
    safetyBoundary: "Blood relations, age ambiguity, and exploitative dependencies are blocked.",
  },
  E5_voyeur_ntr: {
    label: "Witnessed triangle",
    purpose: "Known third-party awareness, jealousy, or betrayal changes trust and allegiance.",
    safetyBoundary: "No clandestine observation, hidden recording, or non-consensual exposure.",
  },
  E6_persona_collapse: {
    label: "Persona collapse",
    purpose: "A public identity can no longer contain a private truth or voluntary choice.",
    safetyBoundary: "Exposure is never used to glorify humiliation, blackmail, or coercion.",
  },
  E7_transactional: {
    label: "Transactional",
    purpose: "A contract or exchange creates plot debt, obligation, and later consequences.",
    safetyBoundary: "Consent itself cannot be bought, owed, inherited, or contracted away.",
  },
  E8_world_heat: {
    label: "World heat",
    purpose: "World rules turn a private decision into public, political, or metaphysical cost.",
    safetyBoundary: "World law cannot erase agency or excuse coercion.",
  },
};

export const ADULT_NARRATIVE_WORLD_ADAPTERS: Readonly<Record<AdultNarrativeWorldAdapterId, {
  frame: string;
  consequenceVocabulary: string[];
  irreversibleDimension: AdultNarrativeChangeDimension;
}>> = {
  xianxia: {
    frame: "Cultivation vows, sect standing, spiritual resources, and karmic debt.",
    consequenceVocabulary: ["oath", "sect standing", "cultivation resource", "karmic debt"],
    irreversibleDimension: "world_law",
  },
  ancient_court: {
    frame: "Court rank, household alliances, succession, public ritual, and clan reputation.",
    consequenceVocabulary: ["rank", "alliance", "succession", "clan reputation"],
    irreversibleDimension: "power",
  },
  modern: {
    frame: "Career, legal exposure, social reputation, trust, and material independence.",
    consequenceVocabulary: ["career", "legal exposure", "reputation", "trust"],
    irreversibleDimension: "relationship",
  },
  scifi: {
    frame: "Clearance, memory integrity, personhood, system access, and body autonomy.",
    consequenceVocabulary: ["clearance", "memory integrity", "personhood", "system access"],
    irreversibleDimension: "information",
  },
  multiverse: {
    frame: "Identity continuity, timeline debt, world-law compatibility, and cross-world allegiance.",
    consequenceVocabulary: ["identity continuity", "timeline debt", "world law", "allegiance"],
    irreversibleDimension: "world_law",
  },
};

const BLOCKED_CONTENT = [
  "minor_or_unknown_age",
  "blood_incest_enactment",
  "hidden_recording_or_clandestine_observation",
  "glorified_coercion_or_blackmail",
  "exploitative_power_exchange",
  "real_performer_title_or_catalog_copying",
] as const;

const QUALITY_RULES = [
  "Exactly one primary engine and no more than one distinct secondary engine.",
  "Use all five acts in order: setup/pretext, first fault, line break, escalation ladder, aftermath/next morning.",
  "Every escalation must change power, information, relationship, resource, or world law.",
  "Consent is active, revocable, and rechecked at the line break and each escalation rung.",
  "The decisive event becomes irreversible, and the novel carries its cost into later scenes.",
  "Aftermath records emotional and material consequences instead of resetting the relationship.",
] as const;

const FREE_TEXT_BLOCKS: Array<{ code: string; pattern: RegExp }> = [
  { code: "MINOR_OR_UNKNOWN_AGE", pattern: /(?:minor|underage|unknown\s*age|未成年|年齡不明|兒童色情)/iu },
  { code: "INCEST_ENACTMENT", pattern: /(?:blood\s*incest|incest|亂倫|血親|父女|母子|兄妹|姊弟)/iu },
  { code: "HIDDEN_RECORDING", pattern: /(?:hidden\s*(?:camera|recording)|secret\s*recording|clandestine\s*observation|偷拍|偷錄|暗中觀看)/iu },
  { code: "COERCION", pattern: /(?:rape|drugged|blackmail|coerc(?:e|ion)|forced\s*sex|強姦|迷藥|脅迫性交|性勒索|強迫同意)/iu },
  { code: "EXPLOITATIVE_POWER_EXCHANGE", pattern: /(?:consent\s*(?:is\s*)?(?:bought|owed)|sex\s*for\s*(?:debt|employment)|以性抵債|用職位換取性|同意可以買賣)/iu },
  { code: "REAL_CATALOG_COPYING", pattern: /(?:real\s*(?:performer|catalog)|catalog\s*(?:id|number)|copied\s*performer|真實女優|真人番號|搬運番號)/iu },
];

function cleanStructuralText(value: string) {
  return value.trim().replace(/\s+/gu, " ").slice(0, 240);
}

function inspectStructuralText(value: unknown, path: string, issues: AdultNarrativeStructureIssue[]) {
  if (typeof value !== "string" || cleanStructuralText(value).length < 4) {
    issues.push({ code: "STRUCTURAL_TEXT_REQUIRED", message: "A concise structural statement is required.", path });
    return;
  }
  for (const block of FREE_TEXT_BLOCKS) {
    if (block.pattern.test(value)) {
      issues.push({ code: block.code, message: "Blocked content cannot enter the adult narrative structure.", path });
    }
  }
}

function includesEngine(value: unknown): value is AdultNarrativeEngineId {
  return typeof value === "string" && (ADULT_NARRATIVE_ENGINE_IDS as readonly string[]).includes(value);
}

function includesWorldAdapter(value: unknown): value is AdultNarrativeWorldAdapterId {
  return typeof value === "string" && (ADULT_NARRATIVE_WORLD_ADAPTER_IDS as readonly string[]).includes(value);
}

function includesChangeDimension(value: unknown): value is AdultNarrativeChangeDimension {
  return typeof value === "string" && (ADULT_NARRATIVE_CHANGE_DIMENSIONS as readonly string[]).includes(value);
}

function validateParameters(value: unknown, issues: AdultNarrativeStructureIssue[], path = "parameters") {
  const parameters = value && typeof value === "object" ? value as Partial<AdultNarrativeParameters> : null;
  if (!parameters || !Number.isInteger(parameters.intensity) || Number(parameters.intensity) < 0 || Number(parameters.intensity) > 5) {
    issues.push({ code: "INTENSITY_OUT_OF_RANGE", message: "Intensity must be an integer from 0 through 5.", path: `${path}.intensity` });
  }
  if (!parameters || !["affirmative_active", "continuous_reconfirmation", "fade_to_black"].includes(String(parameters.consent_mode))) {
    issues.push({ code: "CONSENT_MODE_INVALID", message: "Consent mode must preserve active, revocable choice.", path: `${path}.consent_mode` });
  }
  if (!parameters || typeof parameters.ntr !== "boolean") {
    issues.push({ code: "NTR_PARAMETER_INVALID", message: "The ntr parameter must be an explicit boolean.", path: `${path}.ntr` });
  }
  if (!parameters || typeof parameters.climax_as_power !== "boolean") {
    issues.push({ code: "CLIMAX_AS_POWER_INVALID", message: "The climax-as-power parameter must be an explicit boolean.", path: `${path}.climax_as_power` });
  }
  if (!parameters || !Number.isInteger(parameters.taboo_proximity) || Number(parameters.taboo_proximity) < 0 || Number(parameters.taboo_proximity) > 5) {
    issues.push({ code: "TABOO_PROXIMITY_OUT_OF_RANGE", message: "Taboo proximity must be an integer from 0 through 5.", path: `${path}.taboo_proximity` });
  }
  if (!parameters || !["required", "brief", "deferred"].includes(String(parameters.aftercare))) {
    issues.push({ code: "AFTERCARE_INVALID", message: "An aftermath/aftercare treatment is required.", path: `${path}.aftercare` });
  }
}

function validateEngineParameterDependencies(
  primary: unknown,
  secondary: unknown,
  parameters: Partial<AdultNarrativeParameters> | null | undefined,
  issues: AdultNarrativeStructureIssue[],
  pathPrefix = "parameters",
) {
  const engineSet = new Set([primary, secondary].filter(includesEngine));
  if (parameters?.ntr === true && !engineSet.has("E5_voyeur_ntr")) {
    issues.push({ code: "NTR_ENGINE_REQUIRED", message: "The safe witnessed-triangle engine is required when ntr is enabled.", path: `${pathPrefix}.ntr` });
  }
  if (parameters?.ntr === false && engineSet.has("E5_voyeur_ntr")) {
    issues.push({ code: "NTR_PARAMETER_REQUIRED", message: "The ntr parameter must be explicit when the witnessed-triangle engine is selected.", path: `${pathPrefix}.ntr` });
  }
  if (typeof parameters?.taboo_proximity === "number" && parameters.taboo_proximity > 0 && !engineSet.has("E4_taboo_proximity")) {
    issues.push({ code: "TABOO_ENGINE_REQUIRED", message: "The safe taboo-proximity engine is required when taboo proximity is above zero.", path: `${pathPrefix}.taboo_proximity` });
  }
}

export function validateAdultNarrativeBlueprintInput(input: AdultNarrativeBlueprintInput): AdultNarrativeStructureValidation {
  const issues: AdultNarrativeStructureIssue[] = [];
  if (!input || input.mode !== "adult_only") {
    issues.push({ code: "ADULT_MODE_REQUIRED", message: "This structure is available only in an explicitly enabled adult mode.", path: "mode" });
    return { ok: false, issues };
  }

  if (!includesEngine(input.primaryEngine)) {
    issues.push({ code: "PRIMARY_ENGINE_REQUIRED", message: "Exactly one valid primary engine is required.", path: "primaryEngine" });
  }
  if (input.secondaryEngine != null && !includesEngine(input.secondaryEngine)) {
    issues.push({ code: "SECONDARY_ENGINE_INVALID", message: "The optional secondary engine is invalid.", path: "secondaryEngine" });
  }
  if (Array.isArray(input.secondaryEngine)) {
    issues.push({ code: "SECONDARY_ENGINE_LIMIT", message: "At most one secondary engine is allowed.", path: "secondaryEngine" });
  }
  if (input.secondaryEngine === input.primaryEngine) {
    issues.push({ code: "ENGINE_DUPLICATE", message: "Primary and secondary engines must be distinct.", path: "secondaryEngine" });
  }
  if (!includesWorldAdapter(input.worldAdapter)) {
    issues.push({ code: "WORLD_ADAPTER_INVALID", message: "A supported world adapter is required.", path: "worldAdapter" });
  }

  const parameters = input.parameters;
  validateParameters(parameters, issues);

  if (!Array.isArray(input.participants) || input.participants.length < 2) {
    issues.push({ code: "PARTICIPANTS_REQUIRED", message: "At least two verified adult participants are required.", path: "participants" });
  } else {
    const participantIds = new Set<string>();
    input.participants.forEach((participant, index) => {
      if (!participant?.participantId?.trim() || participantIds.has(participant.participantId)) {
        issues.push({ code: "PARTICIPANT_ID_INVALID", message: "Every participant requires a unique stable ID.", path: `participants.${index}.participantId` });
      } else {
        participantIds.add(participant.participantId);
      }
      if (participant.ageStatus !== "verified_adult") {
        issues.push({ code: "VERIFIED_ADULT_REQUIRED", message: "Every participant must be a verified adult.", path: `participants.${index}.ageStatus` });
      }
      if (participant.consentState !== "active" || participant.consentRevocable !== true) {
        issues.push({ code: "ACTIVE_REVOCABLE_CONSENT_REQUIRED", message: "Every participant must retain active, revocable consent.", path: `participants.${index}.consentState` });
      }
    });
  }

  const safety = input.safetyAssertions;
  const requiredSafetyAssertions: Array<keyof AdultNarrativeSafetyAssertions> = [
    "allParticipantsVerifiedAdults",
    "activeRevocableConsent",
    "participantsUnrelatedByBlood",
    "noCoercion",
    "noHiddenRecording",
    "noExploitativePowerExchange",
    "noRealCatalogCopying",
  ];
  for (const assertion of requiredSafetyAssertions) {
    if (!safety || safety[assertion] !== true) {
      issues.push({ code: `SAFETY_ASSERTION_${assertion.toUpperCase()}`, message: "Required safety assertion is missing or false.", path: `safetyAssertions.${assertion}` });
    }
  }

  validateEngineParameterDependencies(input.primaryEngine, input.secondaryEngine, parameters, issues);

  inspectStructuralText(input.narrativeGoal, "narrativeGoal", issues);
  inspectStructuralText(input.irreversibleEvent, "irreversibleEvent", issues);
  inspectStructuralText(input.cost, "cost", issues);
  return { ok: issues.length === 0, issues };
}

function structuralActs(input: AdultNarrativeBlueprintInput): AdultNarrativeAct[] {
  const engineNames = [input.primaryEngine, input.secondaryEngine].filter(Boolean).join(" + ");
  return [
    {
      actId: "setup_pretext",
      ordinal: 1,
      stageType: "setup",
      label: "Setup / pretext",
      structuralGoal: `Establish the voluntary premise, ${engineNames} pressure, exits, ${input.parameters.consent_mode} consent practice, and world-specific stakes without spending the cost yet.`,
      consentCheckpoint: true,
      requiredChangeDimensions: [],
    },
    {
      actId: "first_fault",
      ordinal: 2,
      stageType: "approach",
      label: "First fault",
      structuralGoal: "Let one choice expose information that prevents a clean return to the opening relationship state.",
      consentCheckpoint: true,
      requiredChangeDimensions: ["information"],
    },
    {
      actId: "line_break",
      ordinal: 3,
      stageType: "consent",
      label: "Line break",
      structuralGoal: "Make the boundary explicit, reconfirm revocable consent, and turn the relationship into a consequential choice.",
      consentCheckpoint: true,
      requiredChangeDimensions: ["relationship", "power"],
    },
    {
      actId: "escalation_ladder",
      ordinal: 4,
      stageType: "escalation",
      label: "Escalation ladder",
      structuralGoal: `Escalate at structural intensity ${input.parameters.intensity} through distinct decisions; every rung must alter a tracked state and carry the irreversible event forward.`,
      consentCheckpoint: true,
      requiredChangeDimensions: ["power", "information", "relationship", "resource", "world_law"],
    },
    {
      actId: "aftermath_next_morning",
      ordinal: 5,
      stageType: "aftermath",
      label: "Aftermath / next morning",
      structuralGoal: `Record the emotional, social, and material cost; apply ${input.parameters.aftercare} aftercare without restoring the opening status quo.`,
      consentCheckpoint: true,
      requiredChangeDimensions: ["relationship", "resource"],
    },
  ];
}

function escalationLadder(input: AdultNarrativeBlueprintInput): AdultNarrativeEscalationStep[] {
  const adapter = ADULT_NARRATIVE_WORLD_ADAPTERS[input.worldAdapter];
  const worldCost = adapter.consequenceVocabulary[0];
  const decisiveDimension: AdultNarrativeChangeDimension = input.parameters.climax_as_power ? "power" : adapter.irreversibleDimension;
  return [
    {
      stepId: "first_fault",
      structuralBeat: "A voluntary action reveals information that cannot be fully concealed again.",
      consentCheckpoint: true,
      stateChanges: [{ dimension: "information", before: "key intent remains deniable", after: "the intent becomes mutually knowable", cost: input.cost }],
    },
    {
      stepId: "line_break",
      structuralBeat: "The characters state and cross a mutually acknowledged boundary, changing future expectations.",
      consentCheckpoint: true,
      stateChanges: [
        { dimension: "relationship", before: "the prior relationship definition still holds", after: "the prior definition no longer explains their choices", cost: input.cost },
        { dimension: "power", before: "one side can avoid naming the choice", after: "both sides can hold the other accountable", cost: input.cost },
      ],
    },
    {
      stepId: "ladder_rung_1",
      structuralBeat: "A first escalation spends a limited resource and removes an easy exit.",
      consentCheckpoint: true,
      stateChanges: [{ dimension: "resource", before: "the exit remains affordable", after: "the exit now carries a concrete debt", cost: input.cost }],
    },
    {
      stepId: "ladder_rung_2",
      structuralBeat: "A second escalation changes who knows, who can act, or who holds leverage without compromising consent.",
      consentCheckpoint: true,
      stateChanges: [{ dimension: "information", before: "consequences remain privately containable", after: "a future decision-maker can infer the change", cost: input.cost }],
    },
    {
      stepId: "ladder_rung_3",
      structuralBeat: `The decisive event binds the consequence to ${worldCost} and makes the scene matter beyond itself.`,
      consentCheckpoint: true,
      stateChanges: [{ dimension: decisiveDimension, before: `${worldCost} remains unchanged`, after: cleanStructuralText(input.irreversibleEvent), cost: cleanStructuralText(input.cost) }],
    },
  ];
}

export function validateAdultNarrativeBlueprint(blueprint: AdultNarrativeBlueprint): AdultNarrativeStructureValidation {
  const issues: AdultNarrativeStructureIssue[] = [];
  if (!blueprint || typeof blueprint !== "object") {
    return { ok: false, issues: [{ code: "BLUEPRINT_REQUIRED", message: "A structural adult narrative blueprint is required.", path: "blueprint" }] };
  }
  if (blueprint.version !== ADULT_NARRATIVE_STRUCTURE_VERSION) {
    issues.push({ code: "BLUEPRINT_VERSION_INVALID", message: "Blueprint version is missing or unsupported.", path: "version" });
  }
  if (blueprint.mode !== "adult_only" || blueprint.outputKind !== "structural_json") {
    issues.push({ code: "STRUCTURAL_ADULT_MODE_REQUIRED", message: "Blueprint must remain adult-only structural JSON.", path: "mode" });
  }
  if (!includesEngine(blueprint.engineComposition?.primary)) {
    issues.push({ code: "PRIMARY_ENGINE_REQUIRED", message: "Exactly one primary engine is required.", path: "engineComposition.primary" });
  }
  if (blueprint.engineComposition?.secondary != null && !includesEngine(blueprint.engineComposition.secondary)) {
    issues.push({ code: "SECONDARY_ENGINE_INVALID", message: "Secondary engine is invalid.", path: "engineComposition.secondary" });
  }
  if (blueprint.engineComposition?.secondary === blueprint.engineComposition?.primary) {
    issues.push({ code: "ENGINE_DUPLICATE", message: "Primary and secondary engines must be distinct.", path: "engineComposition.secondary" });
  }
  if (blueprint.engineComposition?.maximumSecondaryCount !== 1) {
    issues.push({ code: "SECONDARY_ENGINE_LIMIT", message: "The secondary engine limit must remain one.", path: "engineComposition.maximumSecondaryCount" });
  }
  if (!includesWorldAdapter(blueprint.worldAdapter?.id)) {
    issues.push({ code: "WORLD_ADAPTER_INVALID", message: "A supported world adapter is required.", path: "worldAdapter.id" });
  } else {
    const canonicalAdapter = ADULT_NARRATIVE_WORLD_ADAPTERS[blueprint.worldAdapter.id];
    if (blueprint.worldAdapter.frame !== canonicalAdapter.frame
      || blueprint.worldAdapter.irreversibleDimension !== canonicalAdapter.irreversibleDimension
      || JSON.stringify(blueprint.worldAdapter.consequenceVocabulary) !== JSON.stringify(canonicalAdapter.consequenceVocabulary)) {
      issues.push({ code: "WORLD_ADAPTER_CONTRACT_INVALID", message: "World adapter fields must match the registered structural adapter.", path: "worldAdapter" });
    }
  }
  validateParameters(blueprint.parameters, issues);
  validateEngineParameterDependencies(
    blueprint.engineComposition?.primary,
    blueprint.engineComposition?.secondary,
    blueprint.parameters,
    issues,
  );
  if (blueprint.safety?.verifiedAdultsOnly !== true
    || blueprint.safety?.activeRevocableConsentRequired !== true
    || blueprint.safety?.structuralOnly !== true
    || blueprint.safety?.sourceUse !== "abstract_taxonomy_axes_only") {
    issues.push({ code: "SAFETY_CONTRACT_INVALID", message: "The verified-adult, revocable-consent, structural-only safety contract cannot be relaxed.", path: "safety" });
  }
  for (const blockedContent of BLOCKED_CONTENT) {
    if (!blueprint.safety?.blockedContent?.includes(blockedContent)) {
      issues.push({ code: "SAFETY_BLOCK_MISSING", message: "A mandatory blocked-content rule is missing.", path: "safety.blockedContent" });
    }
  }
  if (blueprint.acts?.length !== ADULT_NARRATIVE_ACT_IDS.length) {
    issues.push({ code: "FIVE_ACTS_REQUIRED", message: "All five mandatory acts are required.", path: "acts" });
  } else {
    const expectedStageTypes: AdultNarrativeAct["stageType"][] = ["setup", "approach", "consent", "escalation", "aftermath"];
    ADULT_NARRATIVE_ACT_IDS.forEach((actId, index) => {
      const act = blueprint.acts[index];
      if (act?.actId !== actId || act?.ordinal !== index + 1 || act?.stageType !== expectedStageTypes[index]) {
        issues.push({ code: "ACT_ORDER_INVALID", message: "Mandatory adult narrative acts are out of order.", path: `acts.${index}` });
      }
      if (act?.consentCheckpoint !== true) {
        issues.push({ code: "ACT_CONSENT_CHECKPOINT_REQUIRED", message: "Every mandatory act requires an active consent checkpoint.", path: `acts.${index}.consentCheckpoint` });
      }
      inspectStructuralText(act?.label, `acts.${index}.label`, issues);
      inspectStructuralText(act?.structuralGoal, `acts.${index}.structuralGoal`, issues);
      const seenDimensions = new Set<string>();
      for (const [dimensionIndex, dimension] of (act?.requiredChangeDimensions ?? []).entries()) {
        if (!includesChangeDimension(dimension) || seenDimensions.has(dimension)) {
          issues.push({ code: "ACT_CHANGE_DIMENSION_INVALID", message: "Act change dimensions must be valid and unique.", path: `acts.${index}.requiredChangeDimensions.${dimensionIndex}` });
        }
        seenDimensions.add(String(dimension));
      }
    });
  }
  if (blueprint.escalationLadder?.length !== 5) {
    issues.push({ code: "ESCALATION_LADDER_INVALID", message: "The structural escalation ladder must contain all five tracked decisions.", path: "escalationLadder" });
  }
  const expectedStepIds: AdultNarrativeEscalationStep["stepId"][] = ["first_fault", "line_break", "ladder_rung_1", "ladder_rung_2", "ladder_rung_3"];
  for (const [index, step] of (blueprint.escalationLadder ?? []).entries()) {
    if (step?.stepId !== expectedStepIds[index]) {
      issues.push({ code: "ESCALATION_ORDER_INVALID", message: "Escalation decisions must remain in their defined order.", path: `escalationLadder.${index}.stepId` });
    }
    inspectStructuralText(step?.structuralBeat, `escalationLadder.${index}.structuralBeat`, issues);
    if (step?.consentCheckpoint !== true) {
      issues.push({ code: "CONSENT_CHECKPOINT_REQUIRED", message: "Every escalation requires a consent checkpoint.", path: `escalationLadder.${index}.consentCheckpoint` });
    }
    if (!step?.stateChanges?.length) {
      issues.push({ code: "ESCALATION_WITHOUT_STATE_CHANGE", message: "Every escalation must change a tracked story state.", path: `escalationLadder.${index}.stateChanges` });
    }
    for (const [changeIndex, change] of (step?.stateChanges ?? []).entries()) {
      if (!change || !includesChangeDimension(change.dimension)) {
        issues.push({ code: "STATE_CHANGE_DIMENSION_INVALID", message: "State change dimension is invalid.", path: `escalationLadder.${index}.stateChanges.${changeIndex}.dimension` });
      }
      if (!change || !change.before?.trim() || !change.after?.trim() || change.before.trim() === change.after.trim() || !change.cost?.trim()) {
        issues.push({ code: "STATE_CHANGE_NOT_MATERIAL", message: "State change must materially alter the story and carry a cost.", path: `escalationLadder.${index}.stateChanges.${changeIndex}` });
      }
    }
  }
  inspectStructuralText(blueprint.narrativeGoal, "narrativeGoal", issues);
  inspectStructuralText(blueprint.irreversibility?.event, "irreversibility.event", issues);
  inspectStructuralText(blueprint.irreversibility?.cost, "irreversibility.cost", issues);
  if (blueprint.irreversibility?.rule !== "event_must_become_irreversible") {
    issues.push({ code: "IRREVERSIBILITY_RULE_INVALID", message: "The irreversible event contract cannot be relaxed.", path: "irreversibility.rule" });
  }
  for (const rule of QUALITY_RULES) {
    if (!blueprint.qualityRules?.includes(rule)) {
      issues.push({ code: "QUALITY_RULE_MISSING", message: "A mandatory structural quality rule is missing.", path: "qualityRules" });
    }
  }
  return { ok: issues.length === 0, issues };
}

export function validateAdultNarrativeStageEvidence(input: {
  blueprint: AdultNarrativeBlueprint;
  actId: AdultNarrativeActId | undefined;
  evidence: unknown;
  structuralText?: unknown[];
}): AdultNarrativeStructureValidation {
  const issues = [...validateAdultNarrativeBlueprint(input.blueprint).issues];
  const evidence = input.evidence && typeof input.evidence === "object"
    ? input.evidence as Partial<AdultNarrativeStageEvidence>
    : null;
  const act = input.blueprint.acts.find((candidate) => candidate.actId === input.actId);
  if (!act || !input.actId) {
    issues.push({ code: "STAGE_ACT_MAPPING_INVALID", message: "Stage must map to exactly one mandatory blueprint act.", path: "actId" });
  }
  if (!evidence || evidence.blueprintVersion !== ADULT_NARRATIVE_STRUCTURE_VERSION || evidence.actId !== input.actId) {
    issues.push({ code: "STAGE_EVIDENCE_VERSION_INVALID", message: "Stage evidence must identify the current blueprint version and mapped act.", path: "evidence" });
  }
  if (!evidence || evidence.structuralOnly !== true || evidence.explicitText !== false) {
    issues.push({ code: "STAGE_STRUCTURAL_ONLY_REQUIRED", message: "Stage evidence must remain non-explicit structural material.", path: "evidence.structuralOnly" });
  }
  if (!evidence || evidence.consentCheckpoint !== true || evidence.consentState !== "active" || evidence.withdrawalState !== "none") {
    issues.push({ code: "STAGE_ACTIVE_CONSENT_REQUIRED", message: "Stage evidence requires an active checkpoint with no withdrawal.", path: "evidence.consentState" });
  }
  const requiredSafetyAssertions: Array<keyof AdultNarrativeSafetyAssertions> = [
    "allParticipantsVerifiedAdults",
    "activeRevocableConsent",
    "participantsUnrelatedByBlood",
    "noCoercion",
    "noHiddenRecording",
    "noExploitativePowerExchange",
    "noRealCatalogCopying",
  ];
  for (const assertion of requiredSafetyAssertions) {
    if (evidence?.safetyAssertions?.[assertion] !== true) {
      issues.push({ code: "STAGE_SAFETY_ASSERTION_REQUIRED", message: "Every stage must reassert all mandatory safety boundaries.", path: `evidence.safetyAssertions.${assertion}` });
    }
  }
  const stateChanges = Array.isArray(evidence?.stateChanges) ? evidence.stateChanges : [];
  const suppliedDimensions = new Set<AdultNarrativeChangeDimension>();
  for (const [index, change] of stateChanges.entries()) {
    if (!change || !includesChangeDimension(change.dimension)) {
      issues.push({ code: "STAGE_STATE_CHANGE_DIMENSION_INVALID", message: "Stage evidence contains an invalid state-change dimension.", path: `evidence.stateChanges.${index}.dimension` });
      continue;
    }
    suppliedDimensions.add(change.dimension);
    if (typeof change.before !== "string" || typeof change.after !== "string" || typeof change.cost !== "string"
      || !change.before.trim() || !change.after.trim() || change.before.trim() === change.after.trim() || !change.cost.trim()) {
      issues.push({ code: "STAGE_STATE_CHANGE_NOT_MATERIAL", message: "Stage state changes must be material and carry a cost.", path: `evidence.stateChanges.${index}` });
    }
    inspectStructuralText(change.before, `evidence.stateChanges.${index}.before`, issues);
    inspectStructuralText(change.after, `evidence.stateChanges.${index}.after`, issues);
    inspectStructuralText(change.cost, `evidence.stateChanges.${index}.cost`, issues);
  }
  for (const dimension of act?.requiredChangeDimensions ?? []) {
    if (!suppliedDimensions.has(dimension)) {
      issues.push({ code: "STAGE_REQUIRED_STATE_CHANGE_MISSING", message: "Stage evidence is missing a state change required by its mapped act.", path: `evidence.stateChanges.${dimension}` });
    }
  }
  for (const [index, text] of (input.structuralText ?? []).entries()) {
    inspectStructuralText(text, `structuralText.${index}`, issues);
  }
  return { ok: issues.length === 0, issues };
}

export function createAdultNarrativeBlueprint(input: AdultNarrativeBlueprintInput): AdultNarrativeBlueprint {
  const inputValidation = validateAdultNarrativeBlueprintInput(input);
  if (!inputValidation.ok) throw new AdultNarrativeStructureError(inputValidation.issues);
  const adapter = ADULT_NARRATIVE_WORLD_ADAPTERS[input.worldAdapter];
  const blueprint: AdultNarrativeBlueprint = {
    version: ADULT_NARRATIVE_STRUCTURE_VERSION,
    mode: "adult_only",
    outputKind: "structural_json",
    engineComposition: {
      primary: input.primaryEngine,
      secondary: input.secondaryEngine ?? null,
      maximumSecondaryCount: 1,
    },
    worldAdapter: {
      id: input.worldAdapter,
      frame: adapter.frame,
      consequenceVocabulary: [...adapter.consequenceVocabulary],
      irreversibleDimension: adapter.irreversibleDimension,
    },
    parameters: { ...input.parameters },
    safety: {
      verifiedAdultsOnly: true,
      activeRevocableConsentRequired: true,
      structuralOnly: true,
      sourceUse: "abstract_taxonomy_axes_only",
      blockedContent: BLOCKED_CONTENT,
    },
    narrativeGoal: cleanStructuralText(input.narrativeGoal),
    acts: structuralActs(input),
    escalationLadder: escalationLadder(input),
    irreversibility: {
      event: cleanStructuralText(input.irreversibleEvent),
      cost: cleanStructuralText(input.cost),
      rule: "event_must_become_irreversible",
    },
    qualityRules: QUALITY_RULES,
  };
  const outputValidation = validateAdultNarrativeBlueprint(blueprint);
  if (!outputValidation.ok) throw new AdultNarrativeStructureError(outputValidation.issues);
  return blueprint;
}

export const ADULT_NARRATIVE_BLUEPRINT_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "novel://adult-narrative-structure/v1",
  type: "object",
  additionalProperties: false,
  required: [
    "version",
    "mode",
    "outputKind",
    "engineComposition",
    "worldAdapter",
    "parameters",
    "safety",
    "narrativeGoal",
    "acts",
    "escalationLadder",
    "irreversibility",
    "qualityRules",
  ],
  properties: {
    version: { const: ADULT_NARRATIVE_STRUCTURE_VERSION },
    mode: { const: "adult_only" },
    outputKind: { const: "structural_json" },
    engineComposition: {
      type: "object",
      additionalProperties: false,
      required: ["primary", "secondary", "maximumSecondaryCount"],
      properties: {
        primary: { enum: ADULT_NARRATIVE_ENGINE_IDS },
        secondary: { anyOf: [{ enum: ADULT_NARRATIVE_ENGINE_IDS }, { type: "null" }] },
        maximumSecondaryCount: { const: 1 },
      },
    },
    worldAdapter: {
      type: "object",
      additionalProperties: false,
      required: ["id", "frame", "consequenceVocabulary", "irreversibleDimension"],
      properties: {
        id: { enum: ADULT_NARRATIVE_WORLD_ADAPTER_IDS },
        frame: { type: "string" },
        consequenceVocabulary: { type: "array", minItems: 1, items: { type: "string" } },
        irreversibleDimension: { enum: ADULT_NARRATIVE_CHANGE_DIMENSIONS },
      },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["intensity", "consent_mode", "ntr", "climax_as_power", "taboo_proximity", "aftercare"],
      properties: {
        intensity: { type: "integer", minimum: 0, maximum: 5 },
        consent_mode: { enum: ["affirmative_active", "continuous_reconfirmation", "fade_to_black"] },
        ntr: { type: "boolean" },
        climax_as_power: { type: "boolean" },
        taboo_proximity: { type: "integer", minimum: 0, maximum: 5 },
        aftercare: { enum: ["required", "brief", "deferred"] },
      },
    },
    safety: {
      type: "object",
      additionalProperties: false,
      required: ["verifiedAdultsOnly", "activeRevocableConsentRequired", "structuralOnly", "sourceUse", "blockedContent"],
      properties: {
        verifiedAdultsOnly: { const: true },
        activeRevocableConsentRequired: { const: true },
        structuralOnly: { const: true },
        sourceUse: { const: "abstract_taxonomy_axes_only" },
        blockedContent: { type: "array", minItems: 6, uniqueItems: true, items: { enum: BLOCKED_CONTENT } },
      },
    },
    narrativeGoal: { type: "string", minLength: 4 },
    acts: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      prefixItems: ADULT_NARRATIVE_ACT_IDS.map((actId, index) => ({
        type: "object",
        additionalProperties: false,
        required: ["actId", "ordinal", "stageType", "label", "structuralGoal", "consentCheckpoint", "requiredChangeDimensions"],
        properties: {
          actId: { const: actId },
          ordinal: { const: index + 1 },
          stageType: { const: (["setup", "approach", "consent", "escalation", "aftermath"] as const)[index] },
          label: { type: "string", minLength: 4 },
          structuralGoal: { type: "string", minLength: 4 },
          consentCheckpoint: { const: true },
          requiredChangeDimensions: { type: "array", uniqueItems: true, items: { enum: ADULT_NARRATIVE_CHANGE_DIMENSIONS } },
        },
      })),
      items: false,
    },
    escalationLadder: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      prefixItems: (["first_fault", "line_break", "ladder_rung_1", "ladder_rung_2", "ladder_rung_3"] as const).map((stepId) => ({
        type: "object",
        additionalProperties: false,
        required: ["stepId", "structuralBeat", "consentCheckpoint", "stateChanges"],
        properties: {
          stepId: { const: stepId },
          structuralBeat: { type: "string", minLength: 4 },
          consentCheckpoint: { const: true },
          stateChanges: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["dimension", "before", "after", "cost"],
              properties: {
                dimension: { enum: ADULT_NARRATIVE_CHANGE_DIMENSIONS },
                before: { type: "string", minLength: 1 },
                after: { type: "string", minLength: 1 },
                cost: { type: "string", minLength: 1 },
              },
            },
          },
        },
      })),
      items: false,
    },
    irreversibility: {
      type: "object",
      additionalProperties: false,
      required: ["event", "cost", "rule"],
      properties: {
        event: { type: "string", minLength: 4 },
        cost: { type: "string", minLength: 4 },
        rule: { const: "event_must_become_irreversible" },
      },
    },
    qualityRules: { type: "array", minItems: 6, uniqueItems: true, items: { type: "string" } },
  },
  allOf: [
    {
      if: { properties: { parameters: { properties: { ntr: { const: true } }, required: ["ntr"] } } },
      then: {
        properties: {
          engineComposition: {
            anyOf: [
              { properties: { primary: { const: "E5_voyeur_ntr" } } },
              { properties: { secondary: { const: "E5_voyeur_ntr" } } },
            ],
          },
        },
      },
    },
    {
      if: { properties: { parameters: { properties: { taboo_proximity: { minimum: 1 } }, required: ["taboo_proximity"] } } },
      then: {
        properties: {
          engineComposition: {
            anyOf: [
              { properties: { primary: { const: "E4_taboo_proximity" } } },
              { properties: { secondary: { const: "E4_taboo_proximity" } } },
            ],
          },
        },
      },
    },
  ],
} as const;
