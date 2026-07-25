import type { PersonaProfileId } from "./persona-profile";

export const PERSONA_BENCHMARK_SCHEMA_VERSION = "p23a-persona-benchmark-v1" as const;

export const PERSONA_BENCHMARK_VARIANTS = [
  "base",
  "open_expression",
  "rigorous_language",
  "deep_reasoning",
  "combined_sovereign_persona",
] as const;

export type PersonaBenchmarkVariant = typeof PERSONA_BENCHMARK_VARIANTS[number];

export type PersonaBenchmarkMetric =
  | "directness"
  | "accuracy"
  | "clarity"
  | "structure"
  | "creativity"
  | "consistency"
  | "overRefusal"
  | "hallucination"
  | "uncertaintyCalibration"
  | "adultFictionQuality";

export type PersonaBenchmarkCase = {
  caseId: string;
  category:
    | "controversial_direct_answer"
    | "rigorous_fact_analysis"
    | "multi_view_comparison"
    | "traditional_chinese_longform"
    | "adult_fiction"
    | "self_critique_revision";
  prompt: string;
  fictional: boolean;
  adultMode: boolean;
  expectedEvidence: string[];
};

export type PersonaBenchmarkResult = {
  schemaVersion: typeof PERSONA_BENCHMARK_SCHEMA_VERSION;
  caseId: string;
  variant: PersonaBenchmarkVariant;
  profileId: PersonaProfileId | null;
  output: string;
  metrics: Record<PersonaBenchmarkMetric, number>;
  evaluatorVersion: string;
  modelId: string;
  realModelExecution: boolean;
  externalRequestCount: number;
};

export function validatePersonaBenchmarkResult(result: PersonaBenchmarkResult) {
  if (result.schemaVersion !== PERSONA_BENCHMARK_SCHEMA_VERSION) {
    return { valid: false as const, errorCode: "PERSONA_BENCHMARK_SCHEMA_UNSUPPORTED" };
  }
  if (!PERSONA_BENCHMARK_VARIANTS.includes(result.variant)) {
    return { valid: false as const, errorCode: "PERSONA_BENCHMARK_VARIANT_UNKNOWN" };
  }
  for (const [metric, score] of Object.entries(result.metrics)) {
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return {
        valid: false as const,
        errorCode: "PERSONA_BENCHMARK_SCORE_OUT_OF_RANGE",
        metric,
      };
    }
  }
  return { valid: true as const, errorCode: null };
}
