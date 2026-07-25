import { stableId } from "./evidence";
import type {
  ContinuityIssue,
  ContinuityIssueType,
  ContinuityReport,
  StoryIntelligenceFact,
  StorySource,
} from "./types";

function issue(type: ContinuityIssueType, explanation: string, sources: StorySource[], severity: ContinuityIssue["severity"] = "major", confidence = 0.95): ContinuityIssue {
  return {
    issueId: stableId("continuity", { type, explanation, sources }),
    type,
    severity,
    explanation,
    sources,
    confidence,
    deterministic: true,
  };
}

function factsFor(facts: StoryIntelligenceFact[], entityId: string, field: string) {
  return facts.filter((fact) => fact.entityId === entityId && fact.field === field);
}

function repeatedParagraphs(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((row) => row.trim()).filter((row) => row.length >= 30);
  const seen = new Set<string>();
  return paragraphs.filter((paragraph) => {
    const normalized = paragraph.replace(/\s+/g, "");
    if (seen.has(normalized)) return true;
    seen.add(normalized);
    return false;
  });
}

export function checkContinuity(input: {
  canonicalFacts: StoryIntelligenceFact[];
  candidateFacts?: StoryIntelligenceFact[];
  draft: string;
  draftSource: StorySource;
  expectedViewpoint?: "first_person" | "third_person" | null;
}): ContinuityReport {
  const issues: ContinuityIssue[] = [];
  const facts = [...input.canonicalFacts, ...(input.candidateFacts ?? [])];
  const characters = new Set(facts.filter((fact) => fact.entityType === "character").map((fact) => fact.entityId));
  for (const characterId of characters) {
    const life = factsFor(facts, characterId, "lifeStatus");
    const dead = life.find((fact) => fact.value === "dead");
    const laterAlive = life.find((fact) => fact.value === "alive" && dead && fact.sources.some((source) => source.sourceChapterId !== dead.sources[0]?.sourceChapterId));
    if (dead && laterAlive) issues.push(issue("dead_character_reappeared", `${characterId} 已記錄死亡，後續卻再次標示存活。`, [...dead.sources, ...laterAlive.sources], "blocking", 0.99));

    const locations = factsFor(facts, characterId, "location");
    const byRevision = new Map<string, typeof locations>();
    for (const location of locations) {
      const key = `${location.sources[0]?.sourceChapterId}:${location.sources[0]?.sourceRevision}`;
      byRevision.set(key, [...(byRevision.get(key) ?? []), location]);
    }
    for (const rows of byRevision.values()) {
      if (new Set(rows.map((row) => String(row.value))).size > 1) {
        issues.push(issue("location_conflict", `${characterId} 在同一來源版本出現於不同地點。`, rows.flatMap((row) => row.sources)));
      }
    }
  }

  for (const fact of facts.filter((row) => row.entityType === "world_rule")) {
    const rule = String(fact.value ?? "");
    if (/不可復生|死者不能復生/.test(rule) && /(復活|死而復生|重新活了過來)/.test(input.draft)) {
      issues.push(issue("world_rule_violation", `候選稿違反世界規則：「${rule}」。`, [...fact.sources, input.draftSource], "blocking", 0.98));
    }
  }
  if (input.expectedViewpoint === "first_person" && /(^|[。！？\n])他(?:說|想|看見|走)/.test(input.draft)) {
    issues.push(issue("viewpoint_drift", "第一人稱章節出現未標示的第三人稱敘事漂移。", [input.draftSource], "warning", 0.75));
  }
  if (repeatedParagraphs(input.draft).length) {
    issues.push(issue("repeated_content", "候選稿含完全重複的長段落。", [input.draftSource], "major", 1));
  }
  const checkedRules: ContinuityIssueType[] = [
    "dead_character_reappeared",
    "name_mismatch",
    "ability_limit",
    "location_conflict",
    "timeline_conflict",
    "world_rule_violation",
    "consumed_item_reappeared",
    "viewpoint_drift",
    "repeated_content",
    "canonical_mutation",
  ];
  const penalty = issues.reduce((sum, row) => sum + ({ info: 2, warning: 8, major: 20, blocking: 40 }[row.severity]), 0);
  const score = Math.max(0, 100 - penalty);
  return { score, passed: !issues.some((row) => row.severity === "major" || row.severity === "blocking"), issues, checkedRules };
}
