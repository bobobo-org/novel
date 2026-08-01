import { z } from "zod";
import { CHARACTER_AGENT_SCHEMA_VERSION } from "./types";

const uuid = z.string().uuid();
const support = z.enum(["SUPPORTED", "INFERRED", "UNKNOWN", "CONFLICTING"]);
const knowledgeScope = z.enum(["PUBLIC", "AUTHOR_ONLY", "CHARACTER_KNOWN", "FACTION_KNOWN", "READER_KNOWN", "FUTURE_REVEAL"]);
const canonicalTruth = z.enum(["TRUE", "FALSE", "UNKNOWN", "CONFLICTING"]);
const domainRecord = z.object({
  schemaVersion: z.literal("novel-domain-v1"),
  id: uuid,
  projectId: uuid,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().positive(),
  source: z.enum(["user", "ai_candidate", "migration", "system"]),
  provenance: z.object({
    source: z.enum(["user", "ai_candidate", "migration", "system"]),
    actor: z.enum(["author", "local-rule", "browser-ai", "local-ollama", "private-ai-hub", "external-ai", "migration"]),
    requestId: z.string().optional(),
    createdAt: z.string().datetime(),
  }).strict(),
  deletedAt: z.string().datetime().nullable().optional(),
  parentRevision: z.number().int().positive().nullable().optional(),
  migrationVersion: z.string().nullable().optional(),
});

const sourceReference = z.object({
  referenceId: z.string().min(1),
  entityId: z.string().min(1),
  entityType: z.enum(["character", "story_bible", "chapter", "scene", "world_rule", "timeline", "relationship", "user_input"]),
  sourceRevision: z.number().int().nonnegative(),
  excerpt: z.string().max(1200),
  support,
}).strict();

const sourcedStrings = z.object({
  value: z.array(z.string()).nullable(),
  support,
  sourceReferences: z.array(sourceReference),
  risk: z.string().nullable(),
}).strict();

export const characterAgentProfileSchema = domainRecord.extend({
  characterAgentSchemaVersion: z.literal(CHARACTER_AGENT_SCHEMA_VERSION),
  profileId: uuid,
  characterId: uuid,
  sourceCharacterRevision: z.number().int().positive(),
  sourceStoryBibleVersion: z.number().int().nonnegative(),
  sourceStoryRevision: z.number().int().positive(),
  name: z.string().min(1).max(200),
  aliases: z.array(z.string().max(200)),
  age: z.number().int().min(0).max(300).nullable(),
  ageVerified: z.boolean(),
  lifeStatus: z.enum(["unknown", "alive", "dead"]),
  identity: z.object({ value: z.string().nullable(), support, sourceReferences: z.array(sourceReference), risk: z.string().nullable() }).strict(),
  factionIds: z.array(z.string()),
  personalityTraits: sourcedStrings,
  appearance: sourcedStrings.optional(),
  values: sourcedStrings,
  goals: sourcedStrings,
  fears: sourcedStrings,
  flaws: sourcedStrings,
  motives: sourcedStrings,
  capabilities: sourcedStrings,
  limitations: sourcedStrings,
  forbiddenContradictions: z.array(z.string()),
  voiceProfile: z.object({
    formality: z.number().min(0).max(100),
    sentenceLength: z.enum(["short", "mixed", "long"]),
    vocabularyStyle: z.array(z.string()),
    directness: z.number().min(0).max(100),
    emotionalExpressiveness: z.number().min(0).max(100),
    humorStyle: z.string(),
    preferredAddressTerms: z.array(z.string()),
    avoidedPhrases: z.array(z.string()),
    speechPatterns: z.array(z.string()),
    dialogueExamples: z.array(z.string()),
    sourceReferences: z.array(sourceReference),
  }).strict(),
  privateBoundaries: z.array(z.string()),
  adultEligibility: z.object({
    isFictional: z.literal(true),
    ageAtLeast18: z.boolean(),
    ageVerified: z.boolean(),
    adultModeEnabled: z.boolean(),
    optedIn: z.boolean(),
    namespace: z.string().regex(/^(general|adult:[A-Za-z0-9_-]+)$/),
    eligible: z.boolean(),
  }).strict(),
  status: z.enum(["CURRENT", "STALE", "DISABLED", "PRIVATE_SIMULATION"]),
}).strict()
  .refine((value) => value.id === value.profileId, "Profile IDs must match.")
  .refine((value) => !value.ageVerified || value.age !== null, "Verified age requires an explicit age.")
  .refine((value) => value.adultEligibility.eligible === (
    value.adultEligibility.isFictional
    && value.adultEligibility.ageAtLeast18
    && value.adultEligibility.ageVerified
    && value.adultEligibility.adultModeEnabled
    && value.adultEligibility.optedIn
  ), "Adult eligibility must be derived from every required gate.");

export const characterKnowledgeRecordSchema = domainRecord.extend({
  characterAgentSchemaVersion: z.literal(CHARACTER_AGENT_SCHEMA_VERSION),
  knowledgeId: uuid,
  canonContextId: z.string().min(1),
  subjectEntityIds: z.array(z.string()),
  claim: z.string().min(1).max(12_000),
  canonicalTruthStatus: canonicalTruth,
  scope: knowledgeScope,
  authorizedCharacterIds: z.array(z.string()),
  authorizedFactionIds: z.array(z.string()),
  revealConditionId: z.string().nullable(),
  sourceReferences: z.array(sourceReference),
  confidence: z.number().min(0).max(1),
  acquiredAt: z.string().datetime().nullable(),
  usableAfterTimelinePosition: z.string().min(1),
  expiresAt: z.string().datetime().nullable(),
  status: z.enum(["CURRENT", "REVOKED", "EXPIRED"]),
}).strict()
  .refine((value) => value.id === value.knowledgeId, "Knowledge IDs must match.")
  .refine((value) => value.scope !== "CHARACTER_KNOWN" || value.authorizedCharacterIds.length > 0, "Character scope requires an authorized character.")
  .refine((value) => value.scope !== "FACTION_KNOWN" || value.authorizedFactionIds.length > 0, "Faction scope requires an authorized faction.")
  .refine((value) => value.scope !== "FUTURE_REVEAL" || Boolean(value.revealConditionId), "Future reveal requires a condition.");

export const characterBeliefSchema = domainRecord.extend({
  characterAgentSchemaVersion: z.literal(CHARACTER_AGENT_SCHEMA_VERSION),
  beliefId: uuid,
  characterId: uuid,
  canonContextId: z.string().min(1),
  proposition: z.string().min(1),
  beliefStrength: z.number().min(0).max(100),
  beliefStatus: z.enum(["BELIEVED_TRUE", "BELIEVED_FALSE", "UNCERTAIN", "SUSPICIOUS", "DISPROVEN"]),
  supportingEvidenceIds: z.array(z.string()),
  contradictingEvidenceIds: z.array(z.string()),
  beliefSource: z.enum(["OBSERVATION", "MEMORY", "RUMOR", "INFERENCE", "USER"]),
  formedAt: z.string().datetime(),
  effectiveFromTimelinePosition: z.string().min(1),
  effectiveToTimelinePosition: z.string().nullable(),
}).strict().refine((value) => value.id === value.beliefId, "Belief IDs must match.");

const relationshipMetrics = {
  trust: z.number().int().min(-100).max(100),
  affection: z.number().int().min(-100).max(100),
  attraction: z.number().int().min(-100).max(100),
  fear: z.number().int().min(-100).max(100),
  resentment: z.number().int().min(-100).max(100),
  loyalty: z.number().int().min(-100).max(100),
  debt: z.number().int().min(-100).max(100),
  dependency: z.number().int().min(-100).max(100),
  conflict: z.number().int().min(-100).max(100),
  powerBalance: z.number().int().min(-100).max(100),
};

export const characterRelationshipEdgeSchema = domainRecord.extend({
  characterAgentSchemaVersion: z.literal(CHARACTER_AGENT_SCHEMA_VERSION),
  relationshipId: uuid,
  canonContextId: z.string().min(1),
  fromCharacterId: uuid,
  toCharacterId: uuid,
  relationshipTypes: z.array(z.string()).min(1),
  ...relationshipMetrics,
  publicStatus: z.string(),
  privateStatus: z.string(),
  knownByCharacterIds: z.array(uuid),
  sourceReferences: z.array(sourceReference),
  effectiveFromTimelinePosition: z.string().min(1),
  effectiveToTimelinePosition: z.string().nullable(),
}).strict()
  .refine((value) => value.id === value.relationshipId, "Relationship IDs must match.")
  .refine((value) => value.fromCharacterId !== value.toCharacterId, "A directed relationship must connect two characters.");

export function validateCharacterAgentProfile(input: unknown) {
  return characterAgentProfileSchema.safeParse(input);
}

export function validateCharacterKnowledgeRecord(input: unknown) {
  return characterKnowledgeRecordSchema.safeParse(input);
}

export function validateCharacterBelief(input: unknown) {
  return characterBeliefSchema.safeParse(input);
}

export function validateCharacterRelationshipEdge(input: unknown) {
  return characterRelationshipEdgeSchema.safeParse(input);
}
