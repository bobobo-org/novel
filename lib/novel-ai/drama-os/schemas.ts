import { z } from "zod";
import { DRAMA_OS_SCHEMA_VERSION } from "./types";
import { upstreamReferenceSchema } from "./upstream-references";

const uuid = z.string().uuid();
const support = z.enum(["SUPPORTED", "INFERRED", "UNKNOWN", "CONFLICTING"]);
const candidateStatus = z.enum(["draft", "awaiting_approval", "approved", "rejected", "stale", "private_simulation"]);
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
}).strict();

export const dramaSourceReferenceSchema = z.object({
  storyId: uuid,
  chapterId: uuid,
  chunkId: z.string().nullable(),
  excerpt: z.string().min(1).max(1200),
  textStart: z.number().int().nonnegative(),
  textEnd: z.number().int().positive(),
  sourceRevision: z.number().int().positive(),
  support,
}).strict().refine((value) => value.textEnd > value.textStart, "Source range must be ordered.");

export const dramaProjectSchema = domainRecord.extend({
  dramaOsSchemaVersion: z.literal(DRAMA_OS_SCHEMA_VERSION),
  dramaProjectId: uuid,
  storyId: uuid,
  sourceStoryRevision: z.number().int().positive(),
  sourceStoryBibleVersion: z.number().int().nonnegative(),
  title: z.string().min(1).max(200),
  formatProfile: z.enum(["DRAMA_60_SECONDS", "DRAMA_90_SECONDS", "DRAMA_3_MINUTES", "DRAMA_10_MINUTES", "DRAMA_30_MINUTES", "DRAMA_90_TO_120_MINUTES"]),
  seasonIds: z.array(uuid),
  canonicalAdaptationRevision: z.number().int().nonnegative(),
  status: candidateStatus,
  projectionTrace: z.object({
    storyId: uuid,
    sourceRevision: z.number().int().positive(),
    sourceChapterIds: z.array(uuid).min(1),
    sourceChunkIds: z.array(z.string()),
    storyBibleVersion: z.number().int().nonnegative(),
    retrievalTraceId: z.string().min(1),
    contextCompositionId: z.string().min(1),
    providerRunId: z.string().min(1),
    providerId: z.enum(["browser-ai", "local-ollama", "private-ai-hub", "deterministic-local", "openai", "gemini", "grok", "claude"]),
    promptHash: z.string().regex(/^[a-f0-9]{64}$/),
    outputHash: z.string().regex(/^[a-f0-9]{64}$/),
    taintTraceId: z.string().min(1),
  }).strict(),
  creationPreferenceRef: upstreamReferenceSchema.optional(),
  storyBlueprintRef: upstreamReferenceSchema.optional(),
  worldStateRefs: z.array(upstreamReferenceSchema).optional(),
  characterStateRefs: z.array(upstreamReferenceSchema).optional(),
  narrativePlanRef: upstreamReferenceSchema.optional(),
}).strict().refine((value) => value.id === value.dramaProjectId, "Drama project IDs must match.");

export const dramaBranchCandidateSchema = domainRecord.extend({
  branchCandidateId: uuid,
  episodeId: uuid,
  sourceRevision: z.number().int().positive(),
  choicePointId: uuid,
  choices: z.array(z.object({
    key: z.enum(["A", "B", "C"]),
    label: z.string().min(1).max(80),
    action: z.string().min(1).max(600),
    consequence: z.string().min(1).max(600),
    effects: z.object({
      characterGoal: z.string().optional(),
      relationshipState: z.string().optional(),
      risk: z.number().optional(),
      resource: z.number().optional(),
      timeline: z.string().optional(),
      futureScene: z.string().optional(),
      endingProbability: z.number().min(0).max(1).optional(),
    }).strict(),
  }).strict()).length(3),
  predictedConsequences: z.array(z.string()),
  continuityRisks: z.array(z.string()),
  mode: z.enum(["creator_candidate", "private_simulation"]),
  status: candidateStatus,
  approvalTransactionId: uuid.nullable(),
}).strict().refine((value) => value.id === value.branchCandidateId, "Branch candidate IDs must match.")
  .refine((value) => new Set(value.choices.map((choice) => JSON.stringify(choice.effects))).size === 3, "Branch effects must be materially distinct.");

export const dramaApprovalRecordSchema = domainRecord.extend({
  approvalId: uuid,
  dramaProjectId: uuid,
  idempotencyKey: z.string().min(12).max(200),
  payloadFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedDramaProjectRevision: z.number().int().positive(),
  sourceStoryRevision: z.number().int().positive(),
  sourceStoryBibleVersion: z.number().int().nonnegative(),
  resultingAdaptationRevision: z.number().int().positive(),
  approvedEntityIds: z.array(uuid).min(1),
  approvedBy: z.string().min(1).max(160),
  approvedAt: z.string().datetime(),
  status: z.literal("committed"),
}).strict().refine((value) => value.id === value.approvalId, "Approval IDs must match.");

export function validateDramaProject(input: unknown) {
  return dramaProjectSchema.safeParse(input);
}

export function validateDramaBranchCandidate(input: unknown) {
  return dramaBranchCandidateSchema.safeParse(input);
}

export function validateDramaApprovalRecord(input: unknown) {
  return dramaApprovalRecordSchema.safeParse(input);
}
