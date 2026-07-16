import type { CorpusDetectedChapter, CorpusQualityResult } from "./corpus-import-types";

export function checkCorpusQuality(text: string, chapters: CorpusDetectedChapter[], warnings: string[] = []): CorpusQualityResult {
  const flags: CorpusQualityResult["flags"] = [];
  if (!text.trim()) flags.push({ flagType: "empty_text", severity: "blocking", explanation: "No text was extracted." });
  if (text.trim().length < 120) flags.push({ flagType: "extremely_short_text", severity: "major", explanation: "Extracted text is unusually short." });
  if ((text.match(/�/g) ?? []).length > 3) flags.push({ flagType: "malformed_encoding", severity: "major", explanation: "Replacement characters suggest encoding damage." });
  if (chapters.length === 1 && chapters[0]?.detectionRule === "no-chapter-fallback") flags.push({ flagType: "missing_chapter", severity: "warning", explanation: "No explicit chapter headings were detected." });
  if (/(<html|<\/div>|<\/p>)/i.test(text)) flags.push({ flagType: "html_residue", severity: "warning", explanation: "HTML residue remains after normalization." });
  const qualityStatus =
    flags.some((flag) => flag.severity === "blocking") ? "blocked" :
    flags.some((flag) => flag.severity === "major") ? "review_required" :
    flags.length ? "accepted_with_warnings" : "accepted";
  return { qualityStatus, flags, warnings: [...warnings, ...flags.map((flag) => flag.flagType)] };
}
