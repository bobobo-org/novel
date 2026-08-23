import "server-only";

import { sha256Hex, stableStringify } from "./hashing";
import {
  isLearningRuleDimension,
  isLearningRuleFamily,
  normalizeSharedLearningRules,
  SHARED_LEARNING_DATABASE_FETCH_LIMIT,
  SHARED_LEARNING_QUERY_LIMIT,
  SHARED_LEARNING_SCHEMA_VERSION,
  type SharedLearningPublishReceipt,
  type SharedLearningRule,
  type SharedLearningSnapshot,
  type SharedLearningSourceChannel,
} from "./shared-learning-contract";
import type { LearningRuleDimension, LearningRuleDraft, LearningRuleFamily } from "./types";
import {
  getAllModeChoiceCurriculumDrafts,
  MODE_CHOICE_CAUSAL_TEACHER_VERSION,
} from "./mode-choice-causal-curriculum";
import {
  getPublicStoryResearchLearningRuleDrafts,
  PUBLIC_STORY_RESEARCH_TEACHER_VERSION,
} from "./public-story-research";
import { getBaselineViralDramaCurriculum, VERIFIED_STORY_TEACHER_VERSION } from "./verified-story-teacher";

type FetchLike = typeof fetch;
type QueryInput = {
  families?: LearningRuleFamily[];
  dimensions?: LearningRuleDimension[];
  tags?: string[];
  limit?: number;
};

type DatabaseRuleRow = {
  rule_hash: string;
  family: LearningRuleFamily;
  dimension: LearningRuleDimension;
  statement: string;
  tags: string[];
  parameters_json: Record<string, string | number | boolean>;
  recipe_json: LearningRuleDraft["recipe"];
  confidence: number;
  quality_score: number;
  abstraction_score: number;
  source_overlap_score: number;
  longest_source_match: number;
  teacher_version: string;
  extractor_kind: LearningRuleDraft["extractorKind"];
  extractor_provider: string;
  extractor_model: string | null;
  observation_count: number;
};

type CacheEntry = { expiresAt: number; snapshot: SharedLearningSnapshot };
const cache = new Map<string, CacheEntry>();
const SHARED_LEARNING_FETCH_TIMEOUT_MS = 3_000;

function boundedFetchTimeoutMs(value: unknown) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return SHARED_LEARNING_FETCH_TIMEOUT_MS;
  return Math.max(25, Math.min(SHARED_LEARNING_FETCH_TIMEOUT_MS, Math.floor(requested)));
}

async function withinSharedLearningDeadline<T>(
  promise: Promise<T>,
  deadlineAt: number,
  controller: AbortController,
  timeoutCode: "SHARED_LEARNING_PUBLISH_TIMEOUT" | "SHARED_LEARNING_QUERY_TIMEOUT",
) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    controller.abort(timeoutCode);
    throw new Error(timeoutCode);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutCode);
          reject(new Error(timeoutCode));
        }, remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function supabaseConfig() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/u, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key };
}

function serviceRoleHeaders(key: string) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
}

function boundedInput(input: QueryInput) {
  return {
    families: [...new Set(input.families ?? [])].filter((value) => isLearningRuleFamily(value)).slice(0, 9),
    dimensions: [...new Set(input.dimensions ?? [])].filter((value) => isLearningRuleDimension(value)).slice(0, 16),
    tags: [...new Set((input.tags ?? []).map((value) => value.trim().slice(0, 32)).filter(Boolean))].slice(0, 8),
    limit: Math.max(1, Math.min(32, Math.floor(input.limit ?? SHARED_LEARNING_QUERY_LIMIT))),
  };
}

function rankingScore(rule: SharedLearningRule, input: ReturnType<typeof boundedInput>) {
  const familyMatch = input.families.length && input.families.includes(rule.family) ? 0.12 : 0;
  const dimensionMatch = input.dimensions.length && input.dimensions.includes(rule.dimension) ? 0.1 : 0;
  const tagMatches = input.tags.filter((tag) => rule.tags.some((candidate) => candidate.includes(tag))).length;
  return rule.qualityScore
    + Math.min(0.08, Math.log10(Math.max(1, rule.observationCount)) * 0.025)
    + familyMatch
    + dimensionMatch
    + Math.min(0.12, tagMatches * 0.04);
}

async function baselineRules() {
  const drafts = await getBaselineViralDramaCurriculum();
  const [storyRules, modeChoiceRules, publicResearchRules] = await Promise.all([
    normalizeSharedLearningRules({
      rules: drafts,
      teacherVersion: VERIFIED_STORY_TEACHER_VERSION,
      observationCount: 1,
    }),
    normalizeSharedLearningRules({
      rules: getAllModeChoiceCurriculumDrafts(),
      teacherVersion: MODE_CHOICE_CAUSAL_TEACHER_VERSION,
      observationCount: 1,
    }),
    normalizeSharedLearningRules({
      rules: getPublicStoryResearchLearningRuleDrafts(),
      teacherVersion: PUBLIC_STORY_RESEARCH_TEACHER_VERSION,
      observationCount: 1,
    }),
  ]);
  return [...storyRules.rules, ...modeChoiceRules.rules, ...publicResearchRules.rules];
}

function databaseQuery(input: ReturnType<typeof boundedInput>) {
  const parts = [
    "status=eq.active",
    "select=rule_hash,family,dimension,statement,tags,parameters_json,recipe_json,confidence,quality_score,abstraction_score,source_overlap_score,longest_source_match,teacher_version,extractor_kind,extractor_provider,extractor_model,observation_count",
    "order=quality_score.desc,observation_count.desc,updated_at.desc",
    `limit=${SHARED_LEARNING_DATABASE_FETCH_LIMIT}`,
  ];
  if (input.families.length) parts.push(`family=in.(${input.families.join(",")})`);
  if (input.dimensions.length) parts.push(`dimension=in.(${input.dimensions.join(",")})`);
  return parts.join("&");
}

async function normalizeDatabaseRows(rows: DatabaseRuleRow[]) {
  const output: SharedLearningRule[] = [];
  for (const row of rows.slice(0, SHARED_LEARNING_DATABASE_FETCH_LIMIT)) {
    const normalized = await normalizeSharedLearningRules({
      teacherVersion: row.teacher_version,
      observationCount: row.observation_count,
      rules: [{
        family: row.family,
        dimension: row.dimension,
        statement: row.statement,
        tags: row.tags,
        parameters: row.parameters_json,
        recipe: row.recipe_json,
        confidence: row.confidence,
        extractorKind: row.extractor_kind,
        extractorProvider: row.extractor_provider,
        extractorModel: row.extractor_model,
        abstractionScore: row.abstraction_score,
        sourceOverlapScore: row.source_overlap_score,
        longestSourceMatch: row.longest_source_match,
        conflictKey: null,
      }],
    });
    const rule = normalized.rules[0];
    if (rule && rule.ruleHash === row.rule_hash) output.push(rule);
  }
  return output;
}

export async function publishSharedLearningRules(input: {
  sourceDigest: string;
  sourceChannel: SharedLearningSourceChannel;
  teacherVersion: string;
  rules: unknown[];
}, dependencies: { fetchImpl?: FetchLike; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<SharedLearningPublishReceipt> {
  const normalized = await normalizeSharedLearningRules({
    rules: input.rules,
    teacherVersion: input.teacherVersion,
  });
  if (!/^[a-f0-9]{64}$/u.test(input.sourceDigest) || !normalized.rules.length) {
    return {
      status: "no_safe_rules",
      publishedCount: 0,
      newObservationCount: 0,
      rejectedCount: normalized.rejectedCount || input.rules.length,
      rawStoryReceived: false,
      abstractRulesOnly: true,
    };
  }
  const config = supabaseConfig();
  if (!config.url || !config.key) {
    return {
      status: "persistence_not_configured",
      publishedCount: 0,
      newObservationCount: 0,
      rejectedCount: normalized.rejectedCount,
      rawStoryReceived: false,
      abstractRulesOnly: true,
    };
  }
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(dependencies.signal?.reason ?? "SHARED_LEARNING_CALLER_ABORTED");
  if (dependencies.signal?.aborted) abortFromCaller();
  else dependencies.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutMs = boundedFetchTimeoutMs(dependencies.timeoutMs);
  const deadlineAt = Date.now() + timeoutMs;
  try {
    if (controller.signal.aborted) throw new Error("SHARED_LEARNING_CALLER_ABORTED");
    const response = await withinSharedLearningDeadline(fetchImpl(`${config.url}/rest/v1/rpc/novel_shared_learning_publish`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: serviceRoleHeaders(config.key),
      body: JSON.stringify({
        p_source_digest: input.sourceDigest,
        p_source_channel: input.sourceChannel,
        p_teacher_version: input.teacherVersion.slice(0, 120),
        p_rules: normalized.rules.map((rule) => ({
          schemaVersion: SHARED_LEARNING_SCHEMA_VERSION,
          ruleHash: rule.ruleHash,
          family: rule.family,
          dimension: rule.dimension,
          statement: rule.statement,
          tags: rule.tags,
          parameters: rule.parameters,
          recipe: rule.recipe,
          confidence: rule.confidence,
          qualityScore: rule.qualityScore,
          abstractionScore: rule.abstractionScore,
          sourceOverlapScore: rule.sourceOverlapScore,
          longestSourceMatch: rule.longestSourceMatch,
          extractorKind: rule.extractorKind,
          extractorProvider: rule.extractorProvider,
          extractorModel: rule.extractorModel,
        })),
      }),
    }), deadlineAt, controller, "SHARED_LEARNING_PUBLISH_TIMEOUT");
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`SHARED_LEARNING_PUBLISH_HTTP_${response.status}`);
    }
    const payload = await withinSharedLearningDeadline(
      response.json(),
      deadlineAt,
      controller,
      "SHARED_LEARNING_PUBLISH_TIMEOUT",
    ) as Array<{
      result_status?: string;
      result_published_count?: number;
      result_new_observation_count?: number;
    }>;
    const receipt = payload[0];
    cache.clear();
    return {
      status: receipt?.result_status === "durably_recorded" ? "durably_recorded" : "persistence_degraded",
      publishedCount: Number(receipt?.result_published_count) || 0,
      newObservationCount: Number(receipt?.result_new_observation_count) || 0,
      rejectedCount: normalized.rejectedCount,
      rawStoryReceived: false,
      abstractRulesOnly: true,
    };
  } catch {
    return {
      status: "persistence_degraded",
      publishedCount: 0,
      newObservationCount: 0,
      rejectedCount: normalized.rejectedCount,
      rawStoryReceived: false,
      abstractRulesOnly: true,
    };
  } finally {
    dependencies.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function querySharedLearningLibrary(
  rawInput: QueryInput = {},
  dependencies: { fetchImpl?: FetchLike; now?: () => number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<SharedLearningSnapshot> {
  const input = boundedInput(rawInput);
  const now = dependencies.now?.() ?? Date.now();
  const cacheKey = stableStringify(input);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return structuredClone(cached.snapshot);
  const builtIn = await baselineRules();
  const config = supabaseConfig();
  let databaseRules: SharedLearningRule[] = [];
  let persistenceStatus: SharedLearningSnapshot["persistenceStatus"] = config.url && config.key ? "ready" : "baseline_only";
  if (config.url && config.key) {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(dependencies.signal?.reason ?? "SHARED_LEARNING_CALLER_ABORTED");
    if (dependencies.signal?.aborted) abortFromCaller();
    else dependencies.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const deadlineAt = Date.now() + boundedFetchTimeoutMs(dependencies.timeoutMs);
    try {
      if (controller.signal.aborted) throw new Error("SHARED_LEARNING_CALLER_ABORTED");
      const response = await withinSharedLearningDeadline(
        (dependencies.fetchImpl ?? fetch)(
          `${config.url}/rest/v1/shared_abstract_learning_rules?${databaseQuery(input)}`,
          { cache: "no-store", signal: controller.signal, headers: serviceRoleHeaders(config.key) },
        ),
        deadlineAt,
        controller,
        "SHARED_LEARNING_QUERY_TIMEOUT",
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`SHARED_LEARNING_QUERY_HTTP_${response.status}`);
      }
      const rows = await withinSharedLearningDeadline(
        response.json(),
        deadlineAt,
        controller,
        "SHARED_LEARNING_QUERY_TIMEOUT",
      ) as DatabaseRuleRow[];
      databaseRules = await normalizeDatabaseRows(rows);
    } catch {
      persistenceStatus = "degraded";
    } finally {
      dependencies.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
  const unique = new Map<string, SharedLearningRule>();
  for (const rule of [...databaseRules, ...builtIn]) {
    if (input.families.length && !input.families.includes(rule.family)) continue;
    if (input.dimensions.length && !input.dimensions.includes(rule.dimension)) continue;
    const current = unique.get(rule.ruleHash);
    if (!current || rankingScore(rule, input) > rankingScore(current, input)) unique.set(rule.ruleHash, rule);
  }
  const rules = [...unique.values()]
    .sort((left, right) => rankingScore(right, input) - rankingScore(left, input) || left.ruleHash.localeCompare(right.ruleHash))
    .slice(0, input.limit);
  const snapshot: SharedLearningSnapshot = {
    schemaVersion: SHARED_LEARNING_SCHEMA_VERSION,
    libraryDigest: await sha256Hex(stableStringify(rules.map((rule) => rule.ruleHash))),
    generatedAt: new Date(now).toISOString(),
    rules,
    selection: {
      requestedLimit: input.limit,
      returnedCount: rules.length,
      databaseFetchLimit: SHARED_LEARNING_DATABASE_FETCH_LIMIT,
      entireLibraryScanned: false,
      cacheTtlSeconds: 60,
    },
    persistenceStatus,
    privacy: {
      rawStoryIncluded: false,
      sourceSentencesIncluded: false,
      namedEntitiesIncluded: false,
      abstractRulesOnly: true,
    },
  };
  if (cache.size >= 100) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
  cache.set(cacheKey, { expiresAt: now + 60_000, snapshot });
  return structuredClone(snapshot);
}

export function clearSharedLearningQueryCacheForTests() {
  cache.clear();
}
