import { checkContinuity, stableId, type StorySource } from "../story-intelligence";
import type {
  GenerationEvaluation,
  GenerationLoopInput,
  QualityDimension,
  QualityScore,
} from "./types";

function score(dimension: QualityDimension, value: number, reasons: string[], source: StorySource, evaluator: QualityScore["evaluator"] = "deterministic"): QualityScore {
  return {
    dimension,
    score: Math.max(0, Math.min(100, Math.round(value))),
    reasons,
    sources: [source],
    evaluator,
  };
}

function paragraphRepetition(text: string) {
  const rows = text.split(/\n{2,}/).map((row) => row.replace(/\s+/g, "")).filter((row) => row.length > 20);
  return rows.length - new Set(rows).size;
}

function dialogueRatio(text: string) {
  const dialogue = (text.match(/[「『][^」』]+[」』]/g) ?? []).join("").length;
  return text.length ? dialogue / text.length : 0;
}

export function deterministicEvaluation(input: GenerationLoopInput, draft: string): GenerationEvaluation {
  const source: StorySource = {
    sourceChapterId: input.currentChapterId,
    sourceRevision: input.sourceRevision,
    evidenceExcerpt: draft,
    start: 0,
    end: draft.length,
  };
  const continuityReport = checkContinuity({
    canonicalFacts: input.canonicalFacts,
    draft,
    draftSource: source,
    expectedViewpoint: input.expectedViewpoint,
  });
  const namedCharacters = input.canonicalFacts
    .filter((fact) => fact.entityType === "character")
    .map((fact) => fact.entityId.split(":").at(-1) ?? "")
    .filter(Boolean);
  const referencedCharacters = namedCharacters.filter((name) => draft.includes(name)).length;
  const characterScore = namedCharacters.length ? 65 + Math.min(30, referencedCharacters * 10) : 72;
  const plotSignals = (draft.match(/因此|但是|然而|於是|導致|決定|必須/g) ?? []).length;
  const repetition = paragraphRepetition(draft);
  const styleSignals = dialogueRatio(draft);
  const characterReport = score("character_consistency", characterScore, namedCharacters.length ? ["依正式人物資料檢查角色引用"] : ["尚無足夠正式人物資料"], source);
  const plotReport = score("plot_coherence", 62 + Math.min(30, plotSignals * 4), plotSignals ? ["候選稿包含可辨識的因果或行動推進"] : ["因果連接訊號偏少"], source);
  const styleReport = score("style_consistency", 78 - repetition * 20 + (styleSignals <= 0.6 ? 5 : -5), repetition ? ["偵測到重複段落"] : ["未偵測到完全重複段落"], source);
  return {
    continuityReport,
    characterReport,
    plotReport,
    styleReport,
    modelScores: [],
    disagreements: [],
    passed: continuityReport.passed && Math.min(characterReport.score, plotReport.score, styleReport.score) >= 60,
  };
}

function isQualityScore(value: unknown): value is QualityScore {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.dimension === "string"
    && typeof row.score === "number"
    && Array.isArray(row.reasons);
}

export function mergeModelEvaluation(
  deterministic: GenerationEvaluation,
  value: unknown,
  source: StorySource,
): GenerationEvaluation {
  const raw = value && typeof value === "object" && Array.isArray((value as { scores?: unknown }).scores)
    ? (value as { scores: unknown[] }).scores
    : [];
  const modelScores = raw.filter(isQualityScore).map((row) => ({
    ...row,
    score: Math.max(0, Math.min(100, row.score)),
    sources: row.sources?.length ? row.sources : [source],
    evaluator: "model" as const,
  }));
  const deterministicScores = [
    { dimension: "continuity" as const, score: deterministic.continuityReport.score },
    deterministic.characterReport,
    deterministic.plotReport,
    deterministic.styleReport,
  ];
  const disagreements = modelScores.flatMap((model) => {
    const rule = deterministicScores.find((item) => item.dimension === model.dimension);
    if (!rule || Math.abs(rule.score - model.score) < 25) return [];
    return [{
      dimension: model.dimension,
      deterministicScore: rule.score,
      modelScore: model.score,
      resolution: rule.score < model.score ? "deterministic_wins" as const : "flag_for_review" as const,
    }];
  });
  return {
    ...deterministic,
    modelScores,
    disagreements,
    passed: deterministic.passed && !disagreements.some((row) => row.resolution === "flag_for_review"),
  };
}

export function evaluationFingerprint(evaluation: GenerationEvaluation) {
  return stableId("evaluation", evaluation);
}
