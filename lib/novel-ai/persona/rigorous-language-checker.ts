import type { StorySource } from "../story-intelligence";

export const RIGOROUS_LANGUAGE_CHECKER_VERSION = "p22a-rigorous-language-v1" as const;

export type LanguageIssue = {
  code: string;
  severity: "info" | "warning" | "major";
  explanation: string;
  evidence: string;
};

function repeatedParagraphs(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((row) => row.trim()).filter((row) => row.length > 20);
  return paragraphs.filter((row, index) => paragraphs.indexOf(row) !== index);
}

export function evaluateRigorousLanguage(input: {
  text: string;
  taskInstruction: string;
  expectedViewpoint?: "first_person" | "third_person" | null;
  sources: StorySource[];
  fictionMode?: boolean;
}) {
  const issues: LanguageIssue[] = [];
  const text = input.text.trim();
  if (!text) issues.push({ code: "EMPTY_OUTPUT", severity: "major", explanation: "候選內容為空。", evidence: "" });
  if (/\b(?:TODO|TBD|placeholder)\b/i.test(text)) issues.push({ code: "PLACEHOLDER_TEXT", severity: "major", explanation: "候選仍含測試或占位文字。", evidence: text.match(/\b(?:TODO|TBD|placeholder)\b/i)?.[0] ?? "" });
  if (/(?:總而言之|值得注意的是|不可否認的是).{0,12}(?:總而言之|值得注意的是|不可否認的是)/.test(text)) {
    issues.push({ code: "EMPTY_TRANSITION_PHRASES", severity: "warning", explanation: "套語過密，削弱敘事精準度。", evidence: "重複轉折套語" });
  }
  for (const paragraph of repeatedParagraphs(text)) {
    issues.push({ code: "REPEATED_PARAGRAPH", severity: "major", explanation: "段落內容重複。", evidence: paragraph.slice(0, 120) });
  }
  if (input.expectedViewpoint === "first_person" && !/[我俺]/.test(text)) {
    issues.push({ code: "VIEWPOINT_NOT_CONFIRMED", severity: "warning", explanation: "未能確認第一人稱視角。", evidence: text.slice(0, 120) });
  }
  if (input.expectedViewpoint === "third_person" && /(^|[。！？\n])我(?:們)?/.test(text)) {
    issues.push({ code: "VIEWPOINT_DRIFT", severity: "major", explanation: "第三人稱候選疑似漂移到第一人稱。", evidence: text.match(/我(?:們)?[^。！？\n]*/)?.[0]?.slice(0, 120) ?? "我" });
  }
  const penalty = issues.reduce((sum, issue) => sum + (issue.severity === "major" ? 25 : issue.severity === "warning" ? 10 : 2), 0);
  const revisedCandidate = text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return {
    checkerVersion: RIGOROUS_LANGUAGE_CHECKER_VERSION,
    score: Math.max(0, 100 - penalty),
    issues,
    evidence: input.sources,
    suggestedRevision: issues.map((issue) => issue.explanation),
    revisedCandidate,
    answeredTask: Boolean(text && input.taskInstruction.trim()),
    fictionAware: input.fictionMode !== false,
  };
}
