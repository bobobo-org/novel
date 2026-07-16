import type { CorpusLanguage, CorpusLanguageResult } from "./corpus-import-types";

export function detectCorpusLanguage(text: string): CorpusLanguageResult {
  const sample = text.slice(0, 4000);
  const counts = {
    hant: (sample.match(/[龍門萬與無臺體國劍風雲]/g) ?? []).length,
    hans: (sample.match(/[龙门万与无台体国剑风云]/g) ?? []).length,
    cjk: (sample.match(/[\u3400-\u9fff]/g) ?? []).length,
    kana: (sample.match(/[\u3040-\u30ff]/g) ?? []).length,
    hangul: (sample.match(/[\uac00-\ud7af]/g) ?? []).length,
    latin: (sample.match(/[A-Za-z]/g) ?? []).length,
    cyrillic: (sample.match(/[\u0400-\u04ff]/g) ?? []).length,
  };
  let primaryLanguage: CorpusLanguage = "unknown";
  let script: CorpusLanguageResult["script"] = "unknown";
  if (counts.cjk > counts.latin && counts.cjk > 5) {
    primaryLanguage = counts.hans > counts.hant ? "zh-Hans" : "zh-Hant";
    script = counts.hans && counts.hant ? "mixed" : counts.hans > counts.hant ? "Simplified-dominant" : "Traditional-dominant";
  } else if (counts.kana > 5) {
    primaryLanguage = "ja"; script = "cjk";
  } else if (counts.hangul > 5) {
    primaryLanguage = "ko"; script = "cjk";
  } else if (counts.cyrillic > 5) {
    primaryLanguage = "ru"; script = "unknown";
  } else if (counts.latin > 5) {
    primaryLanguage = "en"; script = "latin";
  }
  const confidence = primaryLanguage === "unknown" ? 0.2 : 0.86;
  return {
    primaryLanguage,
    detectedLanguages: [{ language: primaryLanguage, confidence }],
    confidence,
    script,
    warnings: primaryLanguage === "unknown" ? ["language_unknown_manual_review"] : [],
  };
}
