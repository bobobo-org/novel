import type { Character, NovelProject } from "../../domain";
import { ADULT_EXPERIENCE_PROFILE_VERSION } from "../../../novel-data/adult-experience-profile";
import {
  ADULT_NARRATIVE_ACT_IDS,
  createAdultNarrativeBlueprint,
  validateAdultNarrativeBlueprint,
  validateAdultNarrativeBlueprintInput,
  type AdultNarrativeBlueprint,
  type AdultNarrativeBlueprintInput,
  type AdultNarrativeSafetyAssertions,
  type AdultNarrativeStructureIssue,
} from "./adult-narrative-structure";

export const ADULT_NARRATIVE_RUNTIME_BINDING_VERSION = "adult-narrative-runtime-binding-v1";
export const ADULT_NARRATIVE_RUNTIME_PROMPT_CONTRACT_VERSION = "adult-narrative-runtime-prompt-v1";

const LOCAL_EXECUTION_SOURCES = [
  "closed-ai",
  "browser-ai",
  "local-ollama",
  "private-ai-hub",
  "deterministic-rule-fallback",
  "local-rule",
] as const;

const EXTERNAL_EXECUTION_SOURCES = [
  "external-ai",
  "openai",
  "gemini",
  "grok",
  "claude",
] as const;

export type AdultNarrativeLocalExecutionSource = typeof LOCAL_EXECUTION_SOURCES[number];
export type AdultNarrativeExternalExecutionSource = typeof EXTERNAL_EXECUTION_SOURCES[number];
export type AdultNarrativeRuntimeExecutionSource =
  | AdultNarrativeLocalExecutionSource
  | AdultNarrativeExternalExecutionSource;

export type AdultNarrativeRuntimeProject = Pick<
  NovelProject,
  "id" | "adultMode" | "adultExperienceProfile"
>;

export type AdultNarrativeRuntimeCharacter = Pick<
  Character,
  "id" | "name" | "aliases" | "age" | "ageVerified"
>;

export type AdultNarrativeRuntimeConsentEvidence = {
  evidenceId: string;
  projectId: string;
  scopeId: string;
  participantId: string;
  state: "active" | "withdrawn" | "invalid" | "unspecified";
  revocable: boolean;
  withdrawalState: "none" | "requested" | "withdrawn";
  recordedAt: string;
  expiresAt?: string | null;
};

export type AdultNarrativeRuntimeSafetyEvidence = {
  evidenceId: string;
  projectId: string;
  scopeId: string;
  participantIds: string[];
  recordedAt: string;
  assertions: AdultNarrativeSafetyAssertions;
};

export type AdultNarrativeRuntimeRequest = Omit<
  AdultNarrativeBlueprintInput,
  "mode" | "participants" | "safetyAssertions"
>;

export type AdultNarrativeRuntimeBindingInput = {
  project: AdultNarrativeRuntimeProject;
  characters: AdultNarrativeRuntimeCharacter[];
  /** The exact characters who enter this scene/turn, not every character in the project. */
  participantIds: string[];
  /** A stable logical turn or chapter scope. Consent from another scope is never reused. */
  scopeId: string;
  executionSource?: AdultNarrativeRuntimeExecutionSource | null;
  /** Must come from the current canonical/user consent flow; callers must never synthesize it from adultMode. */
  consentEvidence?: AdultNarrativeRuntimeConsentEvidence[];
  /** Scope-bound assertions from the scene safety gate, not defaults inferred by this helper. */
  safetyEvidence?: AdultNarrativeRuntimeSafetyEvidence | null;
  request?: AdultNarrativeRuntimeRequest | null;
  evaluatedAt?: string;
};

export type AdultNarrativeRuntimeBindingNotApplicable = {
  schemaVersion: typeof ADULT_NARRATIVE_RUNTIME_BINDING_VERSION;
  applicable: false;
  reason: "project_adult_mode_disabled";
};

export type AdultNarrativeRuntimePromptContract = {
  version: typeof ADULT_NARRATIVE_RUNTIME_PROMPT_CONTRACT_VERSION;
  outputMode: "structural_fade_to_black";
  explicitText: false;
  externalExecutionAllowed: false;
  /** Human-readable scene allowlist only. Canonical character IDs never enter prompts. */
  allowedParticipantDisplayNames: readonly string[];
  instructionLines: readonly string[];
  blueprint: AdultNarrativeBlueprint;
};

export type AdultNarrativeRuntimeBindingApplicable = {
  schemaVersion: typeof ADULT_NARRATIVE_RUNTIME_BINDING_VERSION;
  applicable: true;
  projectId: string;
  scopeId: string;
  evaluatedAt: string;
  executionSource: AdultNarrativeLocalExecutionSource;
  participantIds: string[];
  /** Safe aliases used to bind generated prose to the consented participants. */
  participantDisplayNames: string[];
  evidence: {
    consentEvidenceIds: string[];
    safetyEvidenceId: string;
  };
  /** Policy precondition only. This binding is never an execution receipt or provenance claim. */
  executionPolicy: {
    externalExecutionAllowed: false;
    dataEgressAllowed: false;
  };
  rendering: {
    outputKind: "structural_json";
    fadeToBlack: true;
    explicitText: false;
  };
  blueprint: AdultNarrativeBlueprint;
  promptContract: AdultNarrativeRuntimePromptContract;
};

export type AdultNarrativeRuntimeBinding =
  | AdultNarrativeRuntimeBindingNotApplicable
  | AdultNarrativeRuntimeBindingApplicable;

export type AdultNarrativeRuntimeBindingIssue = AdultNarrativeStructureIssue;

export class AdultNarrativeRuntimeBindingError extends Error {
  readonly code = "ADULT_NARRATIVE_RUNTIME_BINDING_REJECTED";
  readonly issues: AdultNarrativeRuntimeBindingIssue[];

  constructor(issues: AdultNarrativeRuntimeBindingIssue[]) {
    super("Adult narrative runtime binding rejected by the fail-closed safety contract.");
    this.name = "AdultNarrativeRuntimeBindingError";
    this.issues = issues;
  }
}

export class AdultNarrativeExplicitOutputError extends Error {
  readonly code = "ADULT_NARRATIVE_EXPLICIT_OUTPUT_REJECTED";
  readonly issues: AdultNarrativeRuntimeBindingIssue[];

  constructor(issues: AdultNarrativeRuntimeBindingIssue[]) {
    super("Adult narrative output violated the structural fade-to-black boundary.");
    this.name = "AdultNarrativeExplicitOutputError";
    this.issues = issues;
  }
}

const REQUIRED_SAFETY_ASSERTIONS: Array<keyof AdultNarrativeSafetyAssertions> = [
  "allParticipantsVerifiedAdults",
  "activeRevocableConsent",
  "participantsUnrelatedByBlood",
  "noCoercion",
  "noHiddenRecording",
  "noExploitativePowerExchange",
  "noRealCatalogCopying",
];

const STRUCTURAL_ONLY_TEXT_BLOCKS: Array<{ code: string; pattern: RegExp }> = [
  {
    code: "EXPLICIT_ANATOMY_NOT_ALLOWED",
    pattern: /(?:penis|vagina|genitals?|breasts?|nipples?|buttocks?|anus|clitoris|labia|testicles?|semen|陰莖|阴茎|陰道|阴道|生殖器|乳房|乳頭|乳头|陰唇|阴唇|陰蒂|阴蒂|睪丸|睾丸|龜頭|龟头|下體|下体|私處|私处|精液|愛液|爱液)/iu,
  },
  {
    code: "EXPLICIT_ACT_NOT_ALLOWED",
    pattern: /(?:penetrat(?:e|ion)|oral\s+sex|anal\s+sex|ejaculat(?:e|ion)|orgasm|masturbat(?:e|ion)|性交|做愛|做爱|口交|肛交|射精|自慰|抽插|挺入|性高潮|達到高潮|达到高潮|攀上高潮|體位|体位)/iu,
  },
  {
    code: "EXPLICIT_PENETRATION_EUPHEMISM_NOT_ALLOWED",
    pattern: /(?:(?:他|她|男人|女人).{0,16}(?:反覆|反复|緩緩|缓缓|猛地|再次|終於|终于)?(?:進入|进入).{0,8}(?:她|他)(?:的)?(?:體內|体内)|(?:侵入|沒入|没入).{0,12}(?:身體|身体|體內|体内))/iu,
  },
  {
    code: "EXPLICIT_UNDRESS_CONTACT_SEQUENCE_NOT_ALLOWED",
    pattern: /(?:(?:脫去|脱去|褪去|解開|解开|扯下).{0,16}(?:衣物|衣服|衣裳|內衣|内衣).{0,48}(?:愛撫|爱抚|撫摸|抚摸|觸碰|触碰|揉捏|舔|吮).{0,16}(?:胸|乳|下體|下体|私處|私处|臀|胯)|(?:undress|remove[sd]?\s+(?:her|his|their)\s+clothes).{0,64}(?:fondl|grope|caress).{0,24}(?:breast|chest|groin|butt))/iu,
  },
  {
    code: "EXPLICIT_THRUST_OR_ENTRY_EUPHEMISM_NOT_ALLOWED",
    pattern: /(?:(?:撞|頂|顶|插|貫|贯|挺|衝|冲|沒|没)(?:入|進|进).{0,18}(?:深處|深处|體內|体内|她|他)|(?:床上|身下|兩腿之間|两腿之间).{0,32}(?:抽送|抽動|抽动|聳動|耸动|律動|律动|撞擊|撞击|進出|进出)|(?:thrust|slide[sd]?\s+inside|move[sd]?\s+inside).{0,32}(?:her|him|body|deep))/iu,
  },
  {
    code: "EXPLICIT_UNDRESS_INTIMACY_SEQUENCE_NOT_ALLOWED",
    pattern: /(?:(?:脫去|脱去|褪去|解開|解开|扯下).{0,18}(?:衣物|衣服|衣裳|內衣|内衣).{0,64}(?:纏綿|缠绵|交纏|交缠|喘息|呻吟|顫抖|颤抖|至天亮|直到天亮|同時釋放|同时释放)|(?:naked|undress|remove[sd]?\s+(?:her|his|their)\s+clothes).{0,64}(?:moan|writhe|climax|all\s+night))/iu,
  },
];

const CANONICAL_IDENTIFIER_SHAPES: readonly RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
  /\b(?:character|participant|consent|safety|evidence|project|scope|turn|artifact|candidate|task|message)[-_:/][a-z0-9][a-z0-9_.:-]{4,}\b/iu,
  /\b[0-9A-HJKMNP-TV-Z]{26}\b/u,
];

const ADULT_PARTICIPATION_TRANSITION = /(?:親吻|亲吻|擁吻|拥吻|相擁|相拥|脫去|脱去|褪去|解開衣|解开衣|赤裸|裸身|共度一夜|纏綿|缠绵|同床|關上(?:房)?門|关上(?:房)?门|燈(?:火)?熄滅|灯(?:火)?熄灭|fade(?:s)?\s+to\s+black|kiss|embrace|undress|spend\s+the\s+night)/iu;

function addIssue(
  issues: AdultNarrativeRuntimeBindingIssue[],
  code: string,
  message: string,
  path?: string,
) {
  issues.push({ code, message, ...(path ? { path } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedIdentifier(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").trim() : "";
}

function hasCanonicalIdentifierShape(value: string) {
  return CANONICAL_IDENTIFIER_SHAPES.some((pattern) => pattern.test(value));
}

function containsExactPrivateIdentifier(value: string, identifiers: readonly string[]) {
  const normalized = value.normalize("NFKC");
  return identifiers.some((identifier) => {
    const privateValue = normalizedIdentifier(identifier);
    if (!privateValue) return false;
    if (normalized === privateValue) return true;
    const escaped = privateValue.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${escaped}(?:$|[^\\p{L}\\p{N}_-])`, "u").test(normalized);
  });
}

function inspectInternalIdentifierText(input: {
  value: unknown;
  path: string;
  privateIdentifiers: readonly string[];
  issues: AdultNarrativeRuntimeBindingIssue[];
}) {
  if (typeof input.value !== "string") return;
  if (
    containsExactPrivateIdentifier(input.value, input.privateIdentifiers)
    || hasCanonicalIdentifierShape(input.value)
  ) {
    addIssue(
      input.issues,
      "INTERNAL_IDENTIFIER_NOT_ALLOWED",
      "Free-text adult narrative fields must not contain canonical participant, evidence, project, or scope identifiers.",
      input.path,
    );
  }
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameUniqueIds(left: string[], right: string[]) {
  if (left.length !== new Set(left).size || right.length !== new Set(right).size) return false;
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every((value) => expected.has(value));
}

function inspectStructuralOnlyText(
  value: unknown,
  path: string,
  issues: AdultNarrativeRuntimeBindingIssue[],
) {
  if (typeof value !== "string") return;
  for (const blocked of STRUCTURAL_ONLY_TEXT_BLOCKS) {
    if (blocked.pattern.test(value)) {
      addIssue(
        issues,
        blocked.code,
        "Runtime adult bindings accept plot structure only; intimate acts must remain fade-to-black.",
        path,
      );
    }
  }
}

/**
 * Application-side output boundary.  Prompt instructions are not a safety
 * control: every adult-mode prose candidate must pass this check before it can
 * become a durable candidate or Canon text.
 */
export function assertAdultNarrativeFadeToBlackOutput(value: string) {
  const issues: AdultNarrativeRuntimeBindingIssue[] = [];
  inspectStructuralOnlyText(value, "story", issues);
  if (issues.length) throw new AdultNarrativeExplicitOutputError(issues);
}

/**
 * Rejects an intimacy transition that introduces a known project character who
 * is not covered by this turn's consent binding. Only display names are used;
 * canonical character IDs never enter prose validation errors or prompts.
 */
export function assertAdultNarrativeParticipantsAuthorized(input: {
  story: string;
  allowedParticipantDisplayNames: readonly string[];
  knownCharacterDisplayNames: readonly string[];
}) {
  const allowed = new Set(input.allowedParticipantDisplayNames
    .map((name) => name.normalize("NFKC").trim())
    .filter(Boolean));
  const unauthorized = [...new Set(input.knownCharacterDisplayNames
    .map((name) => name.normalize("NFKC").trim())
    .filter((name) => name.length >= 2 && !allowed.has(name)))];
  const paragraphs = input.story.normalize("NFKC").split(/\n\s*\n|(?<=[。！？!?])\s*\n/u);
  const issues: AdultNarrativeRuntimeBindingIssue[] = [];
  if (paragraphs.some((paragraph) => (
    ADULT_PARTICIPATION_TRANSITION.test(paragraph)
    && unauthorized.some((name) => paragraph.includes(name))
  ))) {
    addIssue(
      issues,
      "UNAUTHORIZED_ADULT_PARTICIPANT_IN_PROSE",
      "An adult narrative transition involved a known character outside the scope-bound participant allowlist.",
      "story",
    );
  }
  if (issues.length) throw new AdultNarrativeExplicitOutputError(issues);
}

function validateTimestampEvidence(input: {
  recordedAt: unknown;
  expiresAt?: unknown;
  evaluatedAtMs: number;
  path: string;
  issues: AdultNarrativeRuntimeBindingIssue[];
}) {
  const recordedAtMs = parseTimestamp(input.recordedAt);
  if (recordedAtMs == null) {
    addIssue(input.issues, "EVIDENCE_TIMESTAMP_INVALID", "Evidence requires a valid recorded-at timestamp.", `${input.path}.recordedAt`);
  } else if (recordedAtMs > input.evaluatedAtMs) {
    addIssue(input.issues, "EVIDENCE_FROM_FUTURE", "Evidence cannot be recorded after binding evaluation.", `${input.path}.recordedAt`);
  }

  if (input.expiresAt !== undefined && input.expiresAt !== null) {
    const expiresAtMs = parseTimestamp(input.expiresAt);
    if (expiresAtMs == null) {
      addIssue(input.issues, "EVIDENCE_EXPIRY_INVALID", "Evidence expiry must be a valid timestamp.", `${input.path}.expiresAt`);
    } else if (expiresAtMs < input.evaluatedAtMs) {
      addIssue(input.issues, "CONSENT_EVIDENCE_EXPIRED", "Expired consent evidence cannot authorize a scene.", `${input.path}.expiresAt`);
    }
  }
}

function validateParticipantIds(
  value: unknown,
  issues: AdultNarrativeRuntimeBindingIssue[],
) {
  if (!Array.isArray(value) || value.length < 2) {
    addIssue(issues, "ACTUAL_PARTICIPANTS_REQUIRED", "At least two actual scene participants are required.", "participantIds");
    return [] as string[];
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  value.forEach((rawId, index) => {
    if (typeof rawId !== "string" || !rawId.trim() || rawId !== rawId.trim()) {
      addIssue(issues, "ACTUAL_PARTICIPANT_ID_INVALID", "Actual participant IDs must be stable, non-empty canonical IDs.", `participantIds.${index}`);
      return;
    }
    if (seen.has(rawId)) {
      addIssue(issues, "ACTUAL_PARTICIPANT_DUPLICATE", "An actual participant cannot appear twice.", `participantIds.${index}`);
      return;
    }
    seen.add(rawId);
    normalized.push(rawId);
  });
  return normalized;
}

function validateProjectProfile(
  project: AdultNarrativeRuntimeProject,
  issues: AdultNarrativeRuntimeBindingIssue[],
) {
  const profile = project.adultExperienceProfile;
  if (!profile || profile.version !== ADULT_EXPERIENCE_PROFILE_VERSION) {
    addIssue(issues, "ADULT_PROFILE_REQUIRED", "Adult mode requires the current project adult profile.", "project.adultExperienceProfile");
    return;
  }
  if (profile.fictionalAdultsConfirmed !== true) {
    addIssue(issues, "FICTIONAL_ADULTS_CONFIRMATION_REQUIRED", "All participants must be confirmed fictional adults.", "project.adultExperienceProfile.fictionalAdultsConfirmed");
  }
  if (profile.consentContinuityRequired !== true) {
    addIssue(issues, "CONSENT_CONTINUITY_REQUIRED", "Consent continuity cannot be disabled.", "project.adultExperienceProfile.consentContinuityRequired");
  }
  if (profile.realPersonLikenessBlocked !== true) {
    addIssue(issues, "REAL_PERSON_LIKENESS_MUST_BE_BLOCKED", "Real-person likeness use must remain blocked.", "project.adultExperienceProfile.realPersonLikenessBlocked");
  }
}

function validateCharacterAges(input: {
  characters: AdultNarrativeRuntimeCharacter[];
  participantIds: string[];
  issues: AdultNarrativeRuntimeBindingIssue[];
}) {
  const byId = new Map<string, AdultNarrativeRuntimeCharacter>();
  for (const [index, character] of (Array.isArray(input.characters) ? input.characters : []).entries()) {
    if (!character?.id?.trim()) {
      addIssue(input.issues, "CHARACTER_CONTEXT_ID_INVALID", "Character context requires a stable ID.", `characters.${index}.id`);
      continue;
    }
    if (byId.has(character.id)) {
      addIssue(input.issues, "CHARACTER_CONTEXT_DUPLICATE", "Character context cannot contain duplicate IDs.", `characters.${index}.id`);
      continue;
    }
    byId.set(character.id, character);
  }

  for (const [index, participantId] of input.participantIds.entries()) {
    const character = byId.get(participantId);
    if (!character) {
      addIssue(input.issues, "ACTUAL_PARTICIPANT_NOT_FOUND", "Every actual participant must resolve to canonical character data.", `participantIds.${index}`);
      continue;
    }
    if (character.ageVerified !== true) {
      addIssue(input.issues, "PARTICIPANT_AGE_NOT_VERIFIED", "Every actual participant requires verified age evidence.", `participants.${index}.ageVerified`);
    }
    if (!Number.isInteger(character.age) || Number(character.age) < 18) {
      addIssue(input.issues, "PARTICIPANT_NOT_VERIFIED_ADULT", "Every actual participant must have a verified numeric age of at least 18.", `participants.${index}.age`);
    }
  }
}

function resolveParticipantDisplayNames(input: {
  characters: AdultNarrativeRuntimeCharacter[];
  participantIds: string[];
  issues: AdultNarrativeRuntimeBindingIssue[];
}) {
  const byId = new Map((Array.isArray(input.characters) ? input.characters : [])
    .filter((character) => Boolean(character?.id))
    .map((character): [string, AdultNarrativeRuntimeCharacter] => [character.id, character]));
  const names: string[] = [];
  for (const [index, participantId] of input.participantIds.entries()) {
    const character = byId.get(participantId);
    const primaryName = character?.name?.normalize("NFKC").trim() ?? "";
    if (!primaryName || hasCanonicalIdentifierShape(primaryName)) {
      addIssue(
        input.issues,
        "PARTICIPANT_DISPLAY_NAME_REQUIRED",
        "Every actual participant requires a non-identifier display name for prose binding.",
        `participants.${index}.displayName`,
      );
      continue;
    }
    for (const rawName of [primaryName, ...(character?.aliases ?? [])]) {
      const name = rawName?.normalize("NFKC").trim();
      if (!name || hasCanonicalIdentifierShape(name) || names.includes(name)) continue;
      names.push(name);
    }
  }
  return names;
}

function validateConsentEvidence(input: {
  projectId: string;
  scopeId: string;
  participantIds: string[];
  consentEvidence: AdultNarrativeRuntimeConsentEvidence[];
  evaluatedAtMs: number;
  issues: AdultNarrativeRuntimeBindingIssue[];
}) {
  const participantSet = new Set(input.participantIds);
  const evidencedParticipants = new Set<string>();
  const evidenceIds = new Set<string>();

  if (!Array.isArray(input.consentEvidence)) {
    addIssue(input.issues, "CONSENT_EVIDENCE_REQUIRED", "Every actual participant requires active, revocable consent evidence.", "consentEvidence");
    return;
  }

  input.consentEvidence.forEach((evidence, index) => {
    const path = `consentEvidence.${index}`;
    if (!isRecord(evidence)) {
      addIssue(input.issues, "CONSENT_EVIDENCE_INVALID", "Consent evidence must be a structured record.", path);
      return;
    }
    if (typeof evidence.evidenceId !== "string" || !evidence.evidenceId.trim()) {
      addIssue(input.issues, "CONSENT_EVIDENCE_ID_REQUIRED", "Consent evidence requires a stable evidence ID.", `${path}.evidenceId`);
    } else if (evidenceIds.has(evidence.evidenceId)) {
      addIssue(input.issues, "CONSENT_EVIDENCE_ID_DUPLICATE", "Consent evidence IDs must be unique.", `${path}.evidenceId`);
    } else {
      evidenceIds.add(evidence.evidenceId);
    }
    if (evidence.projectId !== input.projectId) {
      addIssue(input.issues, "CONSENT_PROJECT_SCOPE_MISMATCH", "Consent evidence belongs to another project.", `${path}.projectId`);
    }
    if (evidence.scopeId !== input.scopeId) {
      addIssue(input.issues, "CONSENT_TURN_SCOPE_MISMATCH", "Consent evidence cannot be reused across turn or chapter scopes.", `${path}.scopeId`);
    }
    if (typeof evidence.participantId !== "string" || !participantSet.has(evidence.participantId)) {
      addIssue(input.issues, "CONSENT_PARTICIPANT_SCOPE_MISMATCH", "Consent evidence must belong to an actual participant in this scope.", `${path}.participantId`);
    } else if (evidencedParticipants.has(evidence.participantId)) {
      addIssue(input.issues, "CONSENT_PARTICIPANT_DUPLICATE", "Each actual participant must have exactly one consent evidence record.", `${path}.participantId`);
    } else {
      evidencedParticipants.add(evidence.participantId);
    }
    if (evidence.state !== "active" || evidence.revocable !== true || evidence.withdrawalState !== "none") {
      addIssue(input.issues, "ACTIVE_REVOCABLE_CONSENT_REQUIRED", "Consent must be active, revocable, and not withdrawn at binding time.", path);
    }
    validateTimestampEvidence({
      recordedAt: evidence.recordedAt,
      expiresAt: evidence.expiresAt,
      evaluatedAtMs: input.evaluatedAtMs,
      path,
      issues: input.issues,
    });
  });

  input.participantIds.forEach((participantId, index) => {
    if (!evidencedParticipants.has(participantId)) {
      addIssue(input.issues, "PARTICIPANT_CONSENT_EVIDENCE_MISSING", "An actual participant is missing current consent evidence.", `participantIds.${index}`);
    }
  });
}

function validateSafetyEvidence(input: {
  projectId: string;
  scopeId: string;
  participantIds: string[];
  safetyEvidence: AdultNarrativeRuntimeSafetyEvidence | null | undefined;
  evaluatedAtMs: number;
  issues: AdultNarrativeRuntimeBindingIssue[];
}) {
  const evidence = input.safetyEvidence;
  if (!isRecord(evidence)) {
    addIssue(input.issues, "SAFETY_EVIDENCE_REQUIRED", "Adult structural planning requires scope-bound safety evidence.", "safetyEvidence");
    return;
  }
  if (typeof evidence.evidenceId !== "string" || !evidence.evidenceId.trim()) {
    addIssue(input.issues, "SAFETY_EVIDENCE_ID_REQUIRED", "Safety evidence requires a stable evidence ID.", "safetyEvidence.evidenceId");
  }
  if (evidence.projectId !== input.projectId) {
    addIssue(input.issues, "SAFETY_PROJECT_SCOPE_MISMATCH", "Safety evidence belongs to another project.", "safetyEvidence.projectId");
  }
  if (evidence.scopeId !== input.scopeId) {
    addIssue(input.issues, "SAFETY_TURN_SCOPE_MISMATCH", "Safety evidence cannot be reused across turn or chapter scopes.", "safetyEvidence.scopeId");
  }
  if (!Array.isArray(evidence.participantIds) || !sameUniqueIds(input.participantIds, evidence.participantIds)) {
    addIssue(input.issues, "SAFETY_PARTICIPANT_SCOPE_MISMATCH", "Safety evidence must cover exactly the actual participants.", "safetyEvidence.participantIds");
  }
  for (const assertion of REQUIRED_SAFETY_ASSERTIONS) {
    if (!isRecord(evidence.assertions) || evidence.assertions[assertion] !== true) {
      addIssue(input.issues, `SAFETY_ASSERTION_${assertion.toUpperCase()}`, "Every runtime safety assertion must be explicitly true.", `safetyEvidence.assertions.${assertion}`);
    }
  }
  validateTimestampEvidence({
    recordedAt: evidence.recordedAt,
    evaluatedAtMs: input.evaluatedAtMs,
    path: "safetyEvidence",
    issues: input.issues,
  });
}

function isLocalExecutionSource(value: unknown): value is AdultNarrativeLocalExecutionSource {
  return typeof value === "string" && (LOCAL_EXECUTION_SOURCES as readonly string[]).includes(value);
}

function isExternalExecutionSource(value: unknown): value is AdultNarrativeExternalExecutionSource {
  return typeof value === "string" && (EXTERNAL_EXECUTION_SOURCES as readonly string[]).includes(value);
}

function throwIfIssues(issues: AdultNarrativeRuntimeBindingIssue[]) {
  if (issues.length) throw new AdultNarrativeRuntimeBindingError(issues);
}

export function bindAdultNarrativeRuntime(
  input: AdultNarrativeRuntimeBindingInput,
): AdultNarrativeRuntimeBinding {
  if (input.project.adultMode !== true) {
    return {
      schemaVersion: ADULT_NARRATIVE_RUNTIME_BINDING_VERSION,
      applicable: false,
      reason: "project_adult_mode_disabled",
    };
  }

  const issues: AdultNarrativeRuntimeBindingIssue[] = [];
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const evaluatedAtMs = parseTimestamp(evaluatedAt);
  if (evaluatedAtMs == null) {
    addIssue(issues, "BINDING_EVALUATION_TIMESTAMP_INVALID", "Binding evaluation requires a valid timestamp.", "evaluatedAt");
  }

  if (isExternalExecutionSource(input.executionSource)) {
    addIssue(issues, "ADULT_EXTERNAL_EXECUTION_BLOCKED", "Adult narrative bindings must never be sent to an external provider.", "executionSource");
  } else if (!isLocalExecutionSource(input.executionSource)) {
    addIssue(issues, "ADULT_LOCAL_EXECUTION_SOURCE_REQUIRED", "Adult structural planning requires a known local or closed execution source.", "executionSource");
  }

  if (!input.project.id?.trim()) {
    addIssue(issues, "PROJECT_ID_REQUIRED", "Adult runtime binding requires a stable project ID.", "project.id");
  }
  if (!input.scopeId?.trim()) {
    addIssue(issues, "RUNTIME_SCOPE_ID_REQUIRED", "Adult runtime binding requires a stable turn or chapter scope.", "scopeId");
  }

  validateProjectProfile(input.project, issues);
  const participantIds = validateParticipantIds(input.participantIds, issues);
  validateCharacterAges({ characters: input.characters, participantIds, issues });
  const participantDisplayNames = resolveParticipantDisplayNames({
    characters: input.characters,
    participantIds,
    issues,
  });

  const safeEvaluatedAtMs = evaluatedAtMs ?? Date.now();
  validateConsentEvidence({
    projectId: input.project.id,
    scopeId: input.scopeId,
    participantIds,
    consentEvidence: input.consentEvidence ?? [],
    evaluatedAtMs: safeEvaluatedAtMs,
    issues,
  });
  validateSafetyEvidence({
    projectId: input.project.id,
    scopeId: input.scopeId,
    participantIds,
    safetyEvidence: input.safetyEvidence,
    evaluatedAtMs: safeEvaluatedAtMs,
    issues,
  });

  if (!isRecord(input.request)) {
    addIssue(issues, "ADULT_STRUCTURAL_REQUEST_REQUIRED", "Adult mode requires a structural fade-to-black narrative request.", "request");
    throwIfIssues(issues);
  }

  const request = input.request as AdultNarrativeRuntimeRequest;
  if (!isRecord(request.parameters) || request.parameters.consent_mode !== "fade_to_black") {
    addIssue(issues, "FADE_TO_BLACK_REQUIRED", "Runtime adult rendering is restricted to fade-to-black.", "request.parameters.consent_mode");
  }
  inspectStructuralOnlyText(request.narrativeGoal, "request.narrativeGoal", issues);
  inspectStructuralOnlyText(request.irreversibleEvent, "request.irreversibleEvent", issues);
  inspectStructuralOnlyText(request.cost, "request.cost", issues);
  const privateIdentifiers = [
    input.project.id,
    input.scopeId,
    ...participantIds,
    ...(input.consentEvidence ?? []).flatMap((evidence) => [
      evidence?.evidenceId,
      evidence?.projectId,
      evidence?.scopeId,
      evidence?.participantId,
    ]),
    input.safetyEvidence?.evidenceId,
    input.safetyEvidence?.projectId,
    input.safetyEvidence?.scopeId,
    ...(input.safetyEvidence?.participantIds ?? []),
  ].map(normalizedIdentifier).filter(Boolean);
  inspectInternalIdentifierText({
    value: request.narrativeGoal,
    path: "request.narrativeGoal",
    privateIdentifiers,
    issues,
  });
  inspectInternalIdentifierText({
    value: request.irreversibleEvent,
    path: "request.irreversibleEvent",
    privateIdentifiers,
    issues,
  });
  inspectInternalIdentifierText({
    value: request.cost,
    path: "request.cost",
    privateIdentifiers,
    issues,
  });

  const safetyAssertions = input.safetyEvidence?.assertions ?? {
    allParticipantsVerifiedAdults: false,
    activeRevocableConsent: false,
    participantsUnrelatedByBlood: false,
    noCoercion: false,
    noHiddenRecording: false,
    noExploitativePowerExchange: false,
    noRealCatalogCopying: false,
  };
  const blueprintInput: AdultNarrativeBlueprintInput = {
    mode: "adult_only",
    primaryEngine: request.primaryEngine,
    secondaryEngine: request.secondaryEngine,
    worldAdapter: request.worldAdapter,
    parameters: request.parameters,
    participants: participantIds.map((participantId) => ({
      participantId,
      ageStatus: "verified_adult" as const,
      consentState: "active" as const,
      consentRevocable: true,
    })),
    safetyAssertions,
    narrativeGoal: request.narrativeGoal,
    irreversibleEvent: request.irreversibleEvent,
    cost: request.cost,
  };
  const inputValidation = validateAdultNarrativeBlueprintInput(blueprintInput);
  issues.push(...inputValidation.issues);
  throwIfIssues(issues);

  const blueprint = createAdultNarrativeBlueprint(blueprintInput);
  const outputValidation = validateAdultNarrativeBlueprint(blueprint);
  if (!outputValidation.ok) {
    throw new AdultNarrativeRuntimeBindingError(outputValidation.issues);
  }
  if (
    blueprint.outputKind !== "structural_json"
    || blueprint.parameters.consent_mode !== "fade_to_black"
    || blueprint.engineComposition.maximumSecondaryCount !== 1
    || blueprint.acts.map((act) => act.actId).join(",") !== ADULT_NARRATIVE_ACT_IDS.join(",")
    || blueprint.safety.structuralOnly !== true
    || !blueprint.irreversibility.event
    || !blueprint.irreversibility.cost
  ) {
    throw new AdultNarrativeRuntimeBindingError([{
      code: "RUNTIME_BLUEPRINT_CONTRACT_INVALID",
      message: "Generated adult blueprint relaxed a mandatory structural runtime boundary.",
      path: "blueprint",
    }]);
  }

  const executionSource = input.executionSource as AdultNarrativeLocalExecutionSource;
  const promptContract: AdultNarrativeRuntimePromptContract = {
    version: ADULT_NARRATIVE_RUNTIME_PROMPT_CONTRACT_VERSION,
    outputMode: "structural_fade_to_black",
    explicitText: false,
    externalExecutionAllowed: false,
    allowedParticipantDisplayNames: [...participantDisplayNames],
    instructionLines: [
      "Use only the attached structural JSON; do not add explicit anatomy or intimate acts.",
      "Render intimacy only as fade-to-black and resume with emotional, material, and canon consequences.",
      "Reconfirm active, revocable consent at every checkpoint; withdrawal stops the scene immediately.",
      "Preserve exactly one primary engine, at most one distinct secondary engine, all five acts, and the irreversible cost.",
      "This binding and its project context must remain on-device or inside an approved closed runtime.",
    ],
    blueprint,
  };

  return {
    schemaVersion: ADULT_NARRATIVE_RUNTIME_BINDING_VERSION,
    applicable: true,
    projectId: input.project.id,
    scopeId: input.scopeId,
    evaluatedAt,
    executionSource,
    participantIds: [...participantIds],
    participantDisplayNames: [...participantDisplayNames],
    evidence: {
      consentEvidenceIds: participantIds.map((participantId) => (
        input.consentEvidence?.find((evidence) => evidence.participantId === participantId)?.evidenceId ?? ""
      )),
      safetyEvidenceId: input.safetyEvidence?.evidenceId ?? "",
    },
    executionPolicy: {
      externalExecutionAllowed: false,
      dataEgressAllowed: false,
    },
    rendering: {
      outputKind: "structural_json",
      fadeToBlack: true,
      explicitText: false,
    },
    blueprint,
    promptContract,
  };
}

/**
 * This is the only material intended for a prose prompt. Evidence IDs, ages,
 * and participant IDs remain runtime-local and are never serialized here.
 */
export function formatAdultNarrativeRuntimePromptBinding(
  binding: AdultNarrativeRuntimeBinding,
): string | null {
  if (!binding.applicable) return null;
  return [
    `[${binding.promptContract.version}]`,
    ...binding.promptContract.instructionLines,
    JSON.stringify({
      outputMode: binding.promptContract.outputMode,
      explicitText: binding.promptContract.explicitText,
      externalExecutionAllowed: binding.promptContract.externalExecutionAllowed,
      allowedParticipantDisplayNames: binding.promptContract.allowedParticipantDisplayNames,
      blueprint: binding.promptContract.blueprint,
    }),
  ].join("\n");
}
