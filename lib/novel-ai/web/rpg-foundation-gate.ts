export type RpgFoundationIssueCode =
  | "PROTAGONIST_REQUIRED"
  | "STORY_PREMISE_REQUIRED"
  | "STORY_CONTEXT_REQUIRED";

export type RpgFoundationIssue = {
  code: RpgFoundationIssueCode;
  label: string;
};

export type RpgFoundationInput = {
  protagonistName?: string | null;
  coreIdea?: string | null;
  theme?: string | null;
  chapterContent?: string | null;
  unresolvedThreadCount?: number | null;
};

export type RpgFoundationInspection = {
  ready: boolean;
  issues: RpgFoundationIssue[];
};

const MINIMUM_STORY_CONTEXT_CHARACTERS = 80;

export function inspectRpgFoundation(input: RpgFoundationInput): RpgFoundationInspection {
  const issues: RpgFoundationIssue[] = [];
  if (!input.protagonistName?.trim()) {
    issues.push({ code: "PROTAGONIST_REQUIRED", label: "一位已命名主角" });
  }
  if (!input.coreIdea?.trim() && !input.theme?.trim()) {
    issues.push({ code: "STORY_PREMISE_REQUIRED", label: "故事核心或主題" });
  }
  if (
    (input.chapterContent?.trim().length ?? 0) < MINIMUM_STORY_CONTEXT_CHARACTERS
    && (input.unresolvedThreadCount ?? 0) < 1
  ) {
    issues.push({ code: "STORY_CONTEXT_REQUIRED", label: "至少一段開場正文或一條未解衝突" });
  }
  return { ready: issues.length === 0, issues };
}

export const RPG_FOUNDATION_MINIMUM_CONTEXT_CHARACTERS = MINIMUM_STORY_CONTEXT_CHARACTERS;
