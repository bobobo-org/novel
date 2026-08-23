import {
  PUBLIC_STORY_RESEARCH_SEED_V1,
  PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1,
  validatePublicStoryResearchSeed,
} from "./seed-v1";
import {
  PUBLIC_STORY_RESEARCH_SCHEMA_VERSION,
  PUBLIC_STORY_RESEARCH_SEED_VERSION,
  TEN_CAUSAL_DIMENSIONS,
  type AbstractCausalRuleFeedback,
  type AbstractResearchInferenceRule,
  type CausalRuntimeConsumer,
  type CausalTeacherResearchCandidate,
  type PublicStoryResearchHit,
  type PublicStoryResearchIndex,
  type PublicStoryResearchIndexEntry,
  type ResearchSourceRecord,
  type SharedCausalResearchLibrary,
  type SharedStoryExperienceMode,
  type TenCausalDimension,
  type ValidatedCausalResearchSnapshot,
} from "./types";
import type { LearningRuleDimension, LearningRuleDraft, LearningRuleFamily } from "../types";

export const MAX_VALIDATED_CAUSAL_SNAPSHOT_RULES = 24;
export const MAX_PUBLIC_STORY_RESEARCH_TOP_K = 8;
export const PUBLIC_STORY_RESEARCH_TEACHER_VERSION =
  "public-story-research-ten-causal-teacher-v1" as const;

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value!)));
}

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/\s+/gu, " ").trim();
}

function searchTokens(value: string) {
  const normalized = normalizeSearchText(value);
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9]+(?:[\/_-][a-z0-9]+)*/gu) ?? []) {
    tokens.add(word);
    for (const part of word.split(/[\/_-]+/gu)) if (part) tokens.add(part);
  }
  for (const block of normalized.match(/[\u3400-\u9fff]+/gu) ?? []) {
    tokens.add(block);
    if (block.length <= 2) {
      for (const character of block) tokens.add(character);
      continue;
    }
    for (let size = 2; size <= Math.min(3, block.length); size += 1) {
      for (let index = 0; index <= block.length - size; index += 1) {
        tokens.add(block.slice(index, index + size));
      }
    }
  }
  return tokens;
}

function snapshotError(code: string) {
  return Object.assign(new Error(code), { code });
}

// Control-plane operation: this may inspect the accumulating shared library.
// Runtime retrieval never receives that library; it only receives the bounded snapshot.
export function createValidatedCausalResearchSnapshot(input: {
  library?: SharedCausalResearchLibrary;
  maximumSnapshotRules?: number;
  snapshotVersion?: string;
  createdAt?: string;
} = {}): ValidatedCausalResearchSnapshot {
  const validation = validatePublicStoryResearchSeed();
  if (!validation.valid) throw snapshotError(`RESEARCH_SEED_INVALID:${validation.errorCodes.join(",")}`);
  const library = input.library ?? PUBLIC_STORY_RESEARCH_SHARED_LIBRARY_V1;
  if (
    library.learningSemantics !== "knowledge_retrieval_and_rule_weight_learning"
    || library.modelWeightTraining
  ) {
    throw snapshotError("RESEARCH_LIBRARY_CAPABILITY_SEMANTICS_INVALID");
  }
  const maximumSnapshotRules = boundedInteger(
    input.maximumSnapshotRules,
    MAX_VALIDATED_CAUSAL_SNAPSHOT_RULES,
    1,
    MAX_VALIDATED_CAUSAL_SNAPSHOT_RULES,
  );
  const entries = library.entries
    .filter((entry) =>
      entry.approvalStatus === "approved"
      && entry.rawStoryRetained === false
      && entry.chainOfThoughtRetained === false
      && entry.rule.candidateOnly
      && entry.rule.autoApprove === false
      && entry.rule.outcomeGuarantee === false)
    .sort((left, right) =>
      right.abstractWeight - left.abstractWeight
      || left.rule.ruleId.localeCompare(right.rule.ruleId))
    .slice(0, maximumSnapshotRules)
    .map((entry) => ({
      rule: entry.rule,
      abstractWeight: Math.max(0, Math.min(2, entry.abstractWeight)),
      evidenceRefs: [...new Set(entry.evidenceRefs)],
    }));
  if (!entries.length) throw snapshotError("RESEARCH_SNAPSHOT_HAS_NO_APPROVED_RULES");
  for (const entry of entries) {
    if (Object.keys(entry.rule.tenDimensions).length !== TEN_CAUSAL_DIMENSIONS.length) {
      throw snapshotError(`RESEARCH_SNAPSHOT_TEN_DIMENSIONS_INVALID:${entry.rule.ruleId}`);
    }
  }
  return {
    snapshotVersion: input.snapshotVersion
      ?? `${PUBLIC_STORY_RESEARCH_SEED_VERSION}:validated-snapshot-v1:${entries.length}`,
    sourceLibraryVersion: library.libraryVersion,
    seedVersion: PUBLIC_STORY_RESEARCH_SEED_VERSION,
    createdAt: input.createdAt ?? "2026-08-23T00:00:00.000Z",
    validationStatus: "schema_provenance_and_rights_validated",
    runtimeSemantics: "knowledge_retrieval",
    teacherAdoption: "candidate_only",
    modelWeightTraining: false,
    maximumSnapshotRules,
    entries,
    rawSourceDocumentCount: 0,
    runtimeNetworkRequests: 0,
  };
}
export const PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1 =
  createValidatedCausalResearchSnapshot();

function dimensionKeywords(dimensions: readonly TenCausalDimension[]) {
  return dimensions.flatMap((dimension) => {
    if (dimension === "prop/resource") return [dimension, "prop", "resource", "道具", "資源"];
    if (dimension === "relationship tension") return [dimension, "relationship", "tension", "關係", "張力"];
    if (dimension === "aftermath hook") return [dimension, "aftermath", "hook", "餘波", "鉤子", "收束"];
    return [dimension];
  });
}

// Snapshot-index build is also control-plane work and runs once for the bundled fallback.
export function buildPublicStoryResearchIndex(
  snapshot: ValidatedCausalResearchSnapshot = PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1,
): PublicStoryResearchIndex {
  if (snapshot.entries.length > MAX_VALIDATED_CAUSAL_SNAPSHOT_RULES) {
    throw snapshotError("RESEARCH_SNAPSHOT_RUNTIME_LIMIT_EXCEEDED");
  }
  const entries: PublicStoryResearchIndexEntry[] = snapshot.entries.map((snapshotEntry) => {
    const rule = snapshotEntry.rule;
    const dimensions = TEN_CAUSAL_DIMENSIONS.filter((dimension) =>
      rule.tenDimensions[dimension].basis !== "baseline_causal_schema");
    const searchable = [
      rule.ruleId,
      rule.statement,
      rule.rationale,
      ...rule.tags,
      ...rule.experienceModes,
      ...rule.consumerFits,
      ...rule.triggerParameters.map((item) => item.key),
      ...dimensionKeywords(dimensions.length ? dimensions : TEN_CAUSAL_DIMENSIONS),
      ...TEN_CAUSAL_DIMENSIONS.map((dimension) => rule.tenDimensions[dimension].operation),
    ].join(" ");
    return {
      ruleId: rule.ruleId,
      experienceModes: rule.experienceModes,
      consumerFits: rule.consumerFits,
      dimensions: dimensions.length ? dimensions : TEN_CAUSAL_DIMENSIONS,
      sourceFactRefs: rule.sourceFactRefs,
      searchTokens: searchTokens(searchable),
      priority: snapshotEntry.abstractWeight,
    };
  });
  const entryByRuleId = new Map(entries.map((entry) => [entry.ruleId, entry]));
  const tokenPostings = new Map<string, string[]>();
  const scopePostings = new Map<string, string[]>();
  for (const entry of entries) {
    for (const token of entry.searchTokens) {
      tokenPostings.set(token, [...(tokenPostings.get(token) ?? []), entry.ruleId]);
    }
    for (const mode of entry.experienceModes) {
      for (const consumer of entry.consumerFits) {
        const key = `${mode}:${consumer}`;
        scopePostings.set(key, [...(scopePostings.get(key) ?? []), entry.ruleId]);
      }
    }
  }
  const rankedRuleIds = [...entries]
    .sort((left, right) => right.priority - left.priority || left.ruleId.localeCompare(right.ruleId))
    .map((entry) => entry.ruleId);
  return {
    schemaVersion: PUBLIC_STORY_RESEARCH_SCHEMA_VERSION,
    seedVersion: PUBLIC_STORY_RESEARCH_SEED_VERSION,
    abstractRuleCount: entries.length,
    rawSourceDocumentCount: 0,
    entries,
    entryByRuleId,
    tokenPostings,
    scopePostings,
    rankedRuleIds,
  };
}

export const PUBLIC_STORY_RESEARCH_RUNTIME_INDEX_V1 =
  buildPublicStoryResearchIndex(PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1);

const RULE_BY_ID = new Map<string, AbstractResearchInferenceRule>(
  PUBLIC_STORY_RESEARCH_SEED_V1.inferenceRules.map((rule) => [rule.ruleId, rule]),
);
const SOURCE_BY_FACT_ID = new Map<string, ResearchSourceRecord>(
  PUBLIC_STORY_RESEARCH_SEED_V1.sources.flatMap((source) =>
    source.sourceFacts.map((fact) => [fact.factId, source] as const)),
);

function ruleSources(factRefs: readonly string[]) {
  return [...new Map(factRefs.flatMap((factRef) => {
    const source = SOURCE_BY_FACT_ID.get(factRef);
    return source ? [[source.sourceId, source] as const] : [];
  })).values()];
}

function selectedCandidateIds(input: {
  tokens: ReadonlySet<string>;
  experience: SharedStoryExperienceMode;
  consumer: CausalRuntimeConsumer;
  index: PublicStoryResearchIndex;
}) {
  const scopeIds = input.index.scopePostings.get(`${input.experience}:${input.consumer}`) ?? [];
  const scoped = new Set(scopeIds);
  const tokenIds = new Set<string>();
  for (const token of input.tokens) {
    for (const ruleId of input.index.tokenPostings.get(token) ?? []) tokenIds.add(ruleId);
  }
  if (!tokenIds.size) return scopeIds;
  const intersection = [...tokenIds].filter((ruleId) => scoped.has(ruleId));
  return intersection.length ? intersection : scopeIds;
}

export function retrievePublicStoryResearchRules(input: {
  query: string;
  experience: SharedStoryExperienceMode;
  consumer?: CausalRuntimeConsumer;
  topK?: number;
  snapshot?: ValidatedCausalResearchSnapshot;
  index?: PublicStoryResearchIndex;
}) {
  const consumer = input.consumer ?? "planner";
  const snapshot = input.snapshot ?? PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1;
  const index = input.index
    ?? (snapshot === PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1
      ? PUBLIC_STORY_RESEARCH_RUNTIME_INDEX_V1
      : buildPublicStoryResearchIndex(snapshot));
  if (snapshot.entries.length > snapshot.maximumSnapshotRules
    || snapshot.entries.length > MAX_VALIDATED_CAUSAL_SNAPSHOT_RULES) {
    throw snapshotError("RESEARCH_RUNTIME_SNAPSHOT_BOUNDARY_INVALID");
  }
  const queryText = normalizeSearchText(input.query);
  const tokens = searchTokens(queryText);
  const candidateIds = selectedCandidateIds({
    tokens,
    experience: input.experience,
    consumer,
    index,
  });
  const maximum = boundedInteger(input.topK, 5, 1, MAX_PUBLIC_STORY_RESEARCH_TOP_K);
  const snapshotWeight = new Map(snapshot.entries.map((entry) => [entry.rule.ruleId, entry.abstractWeight]));
  const hits: PublicStoryResearchHit[] = candidateIds.flatMap((ruleId) => {
    const entry = index.entryByRuleId.get(ruleId);
    const rule = RULE_BY_ID.get(ruleId)
      ?? snapshot.entries.find((item) => item.rule.ruleId === ruleId)?.rule;
    if (!entry || !rule) return [];
    const matchedTokens = [...tokens].filter((token) => entry.searchTokens.has(token));
    const exactPhraseBoost = queryText.length >= 2
      && normalizeSearchText([rule.statement, ...rule.tags].join(" ")).includes(queryText)
      ? 4
      : 0;
    const modeSpecificBoost = rule.experienceModes.length === 1 ? 1.2 : 0.45;
    const consumerSpecificBoost = rule.consumerFits.length < 5 ? 0.6 : 0.25;
    const score = Number((
      (snapshotWeight.get(ruleId) ?? entry.priority) * 2
      + matchedTokens.length * 2.75
      + matchedTokens.length / Math.max(1, tokens.size)
      + exactPhraseBoost
      + modeSpecificBoost
      + consumerSpecificBoost
    ).toFixed(6));
    return [{
      rule,
      score,
      matchedTokens,
      provenanceSourceIds: ruleSources(rule.sourceFactRefs).map((source) => source.sourceId),
    }];
  });
  hits.sort((left, right) => right.score - left.score || left.rule.ruleId.localeCompare(right.rule.ruleId));
  return {
    seedVersion: PUBLIC_STORY_RESEARCH_SEED_VERSION,
    snapshotVersion: snapshot.snapshotVersion,
    sourceLibraryVersion: snapshot.sourceLibraryVersion,
    experience: input.experience,
    consumer,
    hits: hits.slice(0, maximum),
    trace: {
      requestedTopK: input.topK ?? 5,
      effectiveTopK: maximum,
      maximumTopK: MAX_PUBLIC_STORY_RESEARCH_TOP_K,
      sharedLibraryScanCount: 0 as const,
      snapshotRuleCount: snapshot.entries.length,
      candidatePostingCount: candidateIds.length,
      rawSourceDocumentsLoaded: 0 as const,
      networkRequestCount: 0 as const,
      runtimeSemantics: "knowledge_retrieval" as const,
      modelWeightTraining: false as const,
    },
  };
}

export function retrieveCausalTeacherResearchRules(input: {
  query: string;
  experience: SharedStoryExperienceMode;
  consumer?: CausalRuntimeConsumer;
  topK?: number;
  snapshot?: ValidatedCausalResearchSnapshot;
}) {
  const retrieval = retrievePublicStoryResearchRules(input);
  const candidates: CausalTeacherResearchCandidate[] = retrieval.hits.map((hit) => {
    const sources = ruleSources(hit.rule.sourceFactRefs);
    return {
      candidateId: `causal-research:${retrieval.snapshotVersion}:${retrieval.experience}:${retrieval.consumer}:${hit.rule.ruleId}`,
      seedVersion: PUBLIC_STORY_RESEARCH_SEED_VERSION,
      experience: retrieval.experience,
      consumer: retrieval.consumer,
      status: "candidate",
      inferenceKind: hit.rule.claimKind,
      ruleId: hit.rule.ruleId,
      statement: hit.rule.statement,
      triggerParameters: hit.rule.triggerParameters,
      tenDimensions: hit.rule.tenDimensions,
      evaluationSignals: hit.rule.evaluationSignals,
      guardrails: hit.rule.guardrails,
      provenance: {
        sourceIds: sources.map((source) => source.sourceId),
        factRefs: hit.rule.sourceFactRefs,
        urls: sources.map((source) => source.url),
        rightsReviewed: true,
        rawSourceRetained: false,
      },
      autoApprove: false,
      outcomeGuarantee: false,
      humanReviewRequired: true,
      capabilitySemantics: "knowledge_retrieval_and_rule_weight_learning",
      modelWeightTraining: false,
    };
  });
  const usedFactRefs = new Set(candidates.flatMap((candidate) => candidate.provenance.factRefs));
  return {
    pipeline: {
      sharedLibraryVersion: retrieval.sourceLibraryVersion,
      validatedSnapshotVersion: retrieval.snapshotVersion,
      runtimeTopKLimit: MAX_PUBLIC_STORY_RESEARCH_TOP_K,
      stages: ["shared_approved_abstract_library", "validated_bounded_snapshot", "closed_ai_runtime_top_k"] as const,
      runtimeNetworkRequests: 0 as const,
      rawSourceDocumentsLoaded: 0 as const,
      capabilitySemantics: "knowledge_retrieval_and_rule_weight_learning" as const,
      modelWeightTraining: false as const,
    },
    // Facts remain a separate evidence plane; candidates contain only references.
    sourceEvidence: PUBLIC_STORY_RESEARCH_SEED_V1.sources.flatMap((source) => {
      const facts = source.sourceFacts.filter((fact) => usedFactRefs.has(fact.factId));
      return facts.length ? [{
        sourceId: source.sourceId,
        url: source.url,
        platform: source.platform,
        sourceType: source.sourceType,
        facts,
        rights: source.rights,
        robots: source.robots,
        publicAccess: source.publicAccess,
        provenance: source.provenance,
      }] : [];
    }),
    candidates,
    trace: retrieval.trace,
  };
}

function sharedLearningProjection(ruleId: string): {
  family: LearningRuleFamily;
  dimension: LearningRuleDimension;
} {
  if (ruleId.includes("foreshadow") || ruleId.includes("closure")) {
    return { family: "foreshadowing", dimension: "foreshadow_payoff" };
  }
  if (ruleId.includes("romance")) {
    return { family: "relationship", dimension: "relationship_movement" };
  }
  if (ruleId.includes("management") || ruleId.includes("resource")) {
    return { family: "worldbuilding", dimension: "world_rule_delivery" };
  }
  if (ruleId.includes("suspense") || ruleId.includes("setback") || ruleId.includes("short-drama")) {
    return { family: "pacing", dimension: "character_pressure" };
  }
  if (ruleId.includes("cost")) {
    return { family: "structure", dimension: "information_control" };
  }
  if (ruleId.includes("measurement") || ruleId.includes("taxonomy")) {
    return { family: "revision", dimension: "other" };
  }
  return { family: "structure", dimension: "conflict_escalation" };
}

// Projection for the existing shared-learning library. It carries only abstract
// rule mechanics and scalar metadata; the ten-dimensional payload remains in the
// validated runtime snapshot and no story text or source expression is copied.
export function getPublicStoryResearchLearningRuleDrafts(): LearningRuleDraft[] {
  return PUBLIC_STORY_RESEARCH_RUNTIME_SNAPSHOT_V1.entries.map(({ rule }) => {
    const projection = sharedLearningProjection(rule.ruleId);
    const focusedDimensions = TEN_CAUSAL_DIMENSIONS.filter((dimension) =>
      rule.tenDimensions[dimension].basis !== "baseline_causal_schema");
    const operations = (focusedDimensions.length ? focusedDimensions : TEN_CAUSAL_DIMENSIONS)
      .map((dimension) => rule.tenDimensions[dimension].operation)
      .join("；")
      .slice(0, 320);
    return {
      family: projection.family,
      dimension: projection.dimension,
      statement: rule.statement.slice(0, 320),
      tags: [...new Set([
        ...rule.tags,
        "十維因果",
        "公開研究抽象",
        "knowledge-retrieval",
      ])].slice(0, 10),
      parameters: {
        researchRuleId: rule.ruleId,
        seedVersion: PUBLIC_STORY_RESEARCH_SEED_VERSION,
        tenDimensions: TEN_CAUSAL_DIMENSIONS.join("|"),
        experienceModes: rule.experienceModes.join(","),
        consumerFits: rule.consumerFits.join(","),
        candidateOnly: true,
        outcomeGuarantee: false,
        modelWeightTraining: false,
      },
      recipe: {
        when: rule.triggerParameters.map((item) => item.key).join("、").slice(0, 240)
          || "閉端 AI 需要因果候選規則時",
        operation: operations,
        constraint: rule.guardrails.join("；").slice(0, 320),
        evaluate: rule.evaluationSignals.join("、").slice(0, 320),
      },
      confidence: rule.claimKind === "product_safety_policy" ? 0.96 : 0.84,
      extractorKind: "deterministic_pattern",
      extractorProvider: "public-story-research-seed",
      extractorModel: null,
      sourceOverlapScore: 0,
      longestSourceMatch: 0,
      abstractionScore: 1,
      conflictKey: `public-story-research:${rule.ruleId}`,
    };
  });
}

const FEEDBACK_KEYS = new Set([
  "ruleId",
  "decision",
  "aggregateWeightDelta",
  "recordedAt",
  "rawStoryRetained",
  "chainOfThoughtRetained",
]);

// Feedback is deliberately metadata-only. Raw prose, prompts, outputs and CoT are
// rejected by the exact-key gate before an abstract weight/statistic can change.
export function recordAbstractCausalRuleFeedback(
  library: SharedCausalResearchLibrary,
  input: AbstractCausalRuleFeedback,
): SharedCausalResearchLibrary {
  if (Object.keys(input).some((key) => !FEEDBACK_KEYS.has(key))) {
    throw snapshotError("RESEARCH_FEEDBACK_METADATA_ONLY");
  }
  if (input.rawStoryRetained !== false || input.chainOfThoughtRetained !== false) {
    throw snapshotError("RESEARCH_FEEDBACK_RETENTION_FORBIDDEN");
  }
  if (!Number.isFinite(input.aggregateWeightDelta) || Math.abs(input.aggregateWeightDelta) > 0.25) {
    throw snapshotError("RESEARCH_FEEDBACK_WEIGHT_DELTA_INVALID");
  }
  if (!library.entries.some((entry) => entry.rule.ruleId === input.ruleId)) {
    throw snapshotError("RESEARCH_FEEDBACK_RULE_NOT_FOUND");
  }
  return {
    ...library,
    libraryVersion: `${library.libraryVersion}:feedback:${input.recordedAt}:${input.ruleId}`,
    entries: library.entries.map((entry) => {
      if (entry.rule.ruleId !== input.ruleId) return entry;
      return {
        ...entry,
        abstractWeight: Math.max(0, Math.min(2, entry.abstractWeight + input.aggregateWeightDelta)),
        aggregateFeedback: {
          ...entry.aggregateFeedback,
          [input.decision]: entry.aggregateFeedback[input.decision] + 1,
        },
        rawStoryRetained: false,
        chainOfThoughtRetained: false,
      };
    }),
    learningSemantics: "knowledge_retrieval_and_rule_weight_learning",
    modelWeightTraining: false,
  };
}
