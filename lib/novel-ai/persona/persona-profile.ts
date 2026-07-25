export const PERSONA_PROFILE_SCHEMA_VERSION = "p22a-persona-profile-v1" as const;

export const PERSONA_PROFILE_IDS = [
  "rigorous_advisor",
  "open_discussion",
  "fiction_writer",
  "adult_fiction",
  "adversarial_critic",
  "deep_reasoning",
] as const;

export type PersonaProfileId = typeof PERSONA_PROFILE_IDS[number];

export type PersonaProfile = {
  schemaVersion: typeof PERSONA_PROFILE_SCHEMA_VERSION;
  id: PersonaProfileId;
  label: string;
  directness: number;
  formality: number;
  creativity: number;
  humor: number;
  sarcasm: number;
  emotionalWarmth: number;
  criticality: number;
  evidenceStrictness: number;
  languagePrecision: number;
  narrativeFreedom: number;
  adultFictionLevel: number;
  responseDepth: number;
  uncertaintyDisclosure: number;
};

const defaults = {
  directness: 70,
  formality: 50,
  creativity: 70,
  humor: 20,
  sarcasm: 10,
  emotionalWarmth: 60,
  criticality: 75,
  evidenceStrictness: 85,
  languagePrecision: 90,
  narrativeFreedom: 80,
  adultFictionLevel: 0,
  responseDepth: 75,
  uncertaintyDisclosure: 90,
};

function profile(id: PersonaProfileId, label: string, values: Partial<typeof defaults>): PersonaProfile {
  return { schemaVersion: PERSONA_PROFILE_SCHEMA_VERSION, id, label, ...defaults, ...values };
}

export const PERSONA_PROFILES: Record<PersonaProfileId, PersonaProfile> = {
  rigorous_advisor: profile("rigorous_advisor", "嚴謹顧問", {
    directness: 75, formality: 90, languagePrecision: 100, criticality: 90,
    evidenceStrictness: 100, uncertaintyDisclosure: 100, creativity: 45,
  }),
  open_discussion: profile("open_discussion", "開放討論", {
    directness: 95, formality: 45, creativity: 80, humor: 65, criticality: 85,
    narrativeFreedom: 90,
  }),
  fiction_writer: profile("fiction_writer", "小說創作", {
    directness: 65, formality: 30, creativity: 100, emotionalWarmth: 80,
    languagePrecision: 90, narrativeFreedom: 100,
  }),
  adult_fiction: profile("adult_fiction", "成人小說", {
    directness: 90, formality: 20, creativity: 100, adultFictionLevel: 100,
    narrativeFreedom: 100, languagePrecision: 90,
  }),
  adversarial_critic: profile("adversarial_critic", "對抗式批評", {
    directness: 100, criticality: 100, evidenceStrictness: 95, emotionalWarmth: 30,
    creativity: 55,
  }),
  deep_reasoning: profile("deep_reasoning", "深度研究推理", {
    formality: 90, criticality: 100, evidenceStrictness: 100,
    languagePrecision: 100, responseDepth: 100, creativity: 65,
  }),
};

export function validatePersonaProfile(value: PersonaProfile) {
  if (value.schemaVersion !== PERSONA_PROFILE_SCHEMA_VERSION) {
    return { valid: false as const, errorCode: "PERSONA_SCHEMA_VERSION_UNSUPPORTED" };
  }
  if (!PERSONA_PROFILE_IDS.includes(value.id)) {
    return { valid: false as const, errorCode: "PERSONA_PROFILE_UNKNOWN" };
  }
  for (const [key, score] of Object.entries(value)) {
    if (typeof score === "number" && (!Number.isFinite(score) || score < 0 || score > 100)) {
      return { valid: false as const, errorCode: "PERSONA_SCORE_OUT_OF_RANGE", field: key };
    }
  }
  return { valid: true as const, errorCode: null };
}

export function resolvePersonaProfile(value?: PersonaProfile | PersonaProfileId) {
  if (!value) return PERSONA_PROFILES.fiction_writer;
  if (typeof value === "string") return PERSONA_PROFILES[value];
  const validation = validatePersonaProfile(value);
  if (!validation.valid) throw Object.assign(new Error(validation.errorCode), validation);
  return value;
}
