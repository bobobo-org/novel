import crypto from "node:crypto";

export const BENCHMARK_CONTAMINATION_SCHEMA_VERSION = "p23-benchmark-contamination-v1" as const;
export type DatasetSplit = "training" | "validation" | "holdout" | "adversarial" | "human_blind_test";

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-TW").replace(/\s+/g, " ").trim();
}

function fingerprint(value: string) {
  return crypto.createHash("sha256").update(normalize(value), "utf8").digest("hex");
}

function tokens(value: string) {
  return new Set(normalize(value).split(/[\s，。！？、；：「」『』（）()[\]]+/).filter((part) => part.length > 1));
}

function overlap(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  return [...a].filter((token) => b.has(token)).length / Math.min(a.size, b.size);
}

export function analyzeBenchmarkContamination(records: Array<{
  id: string;
  split: DatasetSplit;
  content: string;
  trainingEligible: boolean;
}>) {
  const collisions: Array<{ leftId: string; rightId: string; type: "exact" | "near_duplicate"; overlap: number }> = [];
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      if (records[left].split === records[right].split) continue;
      const exact = fingerprint(records[left].content) === fingerprint(records[right].content);
      const score = exact ? 1 : overlap(records[left].content, records[right].content);
      if (exact || score >= 0.8) collisions.push({
        leftId: records[left].id,
        rightId: records[right].id,
        type: exact ? "exact" : "near_duplicate",
        overlap: score,
      });
    }
  }
  const benchmarkTrainingLeaks = records
    .filter((record) => record.split !== "training" && record.trainingEligible)
    .map((record) => record.id);
  return {
    schemaVersion: BENCHMARK_CONTAMINATION_SCHEMA_VERSION,
    clean: collisions.length === 0 && benchmarkTrainingLeaks.length === 0,
    collisions,
    benchmarkTrainingLeaks,
  };
}
