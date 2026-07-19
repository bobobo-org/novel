export const CLOSED_AI_BENCHMARK_SCHEMA_VERSION = "closed-ai-benchmark-v1";
export type BenchmarkLayer = "contract_test" | "deterministic_regression" | "model_quality_evaluation" | "human_review" | "production_e2e";
export type ClosedAIBenchmarkFixture = { schemaVersion: typeof CLOSED_AI_BENCHMARK_SCHEMA_VERSION; fixtureId: string; taskType: string; input: string; expectedConstraints: string[]; scoringDimensions: string[]; providerEligibility: string[]; offlineRequired: boolean; layers: BenchmarkLayer[] };
export type ClosedAIBenchmarkResult = { schemaVersion: typeof CLOSED_AI_BENCHMARK_SCHEMA_VERSION; fixtureId: string; layer: BenchmarkLayer; status: "PASS" | "FAIL" | "NOT_RUN"; score: number | null; assertions: Array<{ name: string; passed: boolean }>; evidence: Record<string, unknown>; errorCode: string | null };

export function validateBenchmarkFixture(value: ClosedAIBenchmarkFixture) {
  if (value.schemaVersion !== CLOSED_AI_BENCHMARK_SCHEMA_VERSION) return { valid: false, errorCode: "BENCHMARK_SCHEMA_UNSUPPORTED" };
  if (!value.fixtureId || !value.taskType || !value.expectedConstraints.length) return { valid: false, errorCode: "BENCHMARK_FIXTURE_INVALID" };
  if (!value.layers.length) return { valid: false, errorCode: "BENCHMARK_LAYER_REQUIRED" };
  return { valid: true, errorCode: null };
}

export function runDeterministicBenchmark(fixture: ClosedAIBenchmarkFixture, output: string): ClosedAIBenchmarkResult {
  const assertions = fixture.expectedConstraints.map((constraint) => ({ name: constraint, passed: output.includes(constraint) }));
  const passed = assertions.every((item) => item.passed);
  return { schemaVersion: CLOSED_AI_BENCHMARK_SCHEMA_VERSION, fixtureId: fixture.fixtureId, layer: "deterministic_regression", status: passed ? "PASS" : "FAIL", score: assertions.length ? assertions.filter((item) => item.passed).length / assertions.length : 0, assertions, evidence: { outputLength: output.length }, errorCode: passed ? null : "BENCHMARK_CONSTRAINT_MISSED" };
}

export function migrateBenchmarkFixture(value: Record<string, unknown>): ClosedAIBenchmarkFixture | null {
  if (value.schemaVersion === CLOSED_AI_BENCHMARK_SCHEMA_VERSION) return value as ClosedAIBenchmarkFixture;
  return null;
}
