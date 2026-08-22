import {
  BROWSER_PROSE_CANDIDATE_V2_CONTEXT_PACK_VERSION,
  browserProseCandidateV2Sha256,
  type BrowserProseCandidateV2Context,
  type BrowserProseCandidateV2Genre,
} from "./browser-prose-candidate-v2";

const REQUIRED_CONTEXT_LABELS = [
  "APPROVED_STORY_BIBLE",
  "ACTIVE_CHAPTER",
  "CANONICAL_CHARACTER_IDENTITIES",
  "WORLD_RULES",
] as const;

type RequiredContextLabel = (typeof REQUIRED_CONTEXT_LABELS)[number];
type JsonRecord = Record<string, unknown>;

export type BrowserProseCandidateV2ParsedContext = {
  schemaVersion: typeof BROWSER_PROSE_CANDIDATE_V2_CONTEXT_PACK_VERSION;
  composerAuthority: "project-context-composer-v1";
  sourceLabels: readonly RequiredContextLabel[];
  context: BrowserProseCandidateV2Context;
  contextDigest: string;
  rawContextStored: false;
};

function candidateContextError(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}

function cleanText(value: unknown, maximum = 4_096): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/[\t\r ]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (!cleaned || cleaned.length > maximum) return null;
  return cleaned;
}

function uniqueBounded(values: Array<string | null>, maximum: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const cleaned = value.trim();
    if (cleaned.length < 2 || cleaned.length > 64 || seen.has(cleaned)) continue;
    seen.add(cleaned);
    output.push(cleaned);
    if (output.length >= maximum) break;
  }
  return output;
}

function inferGenre(value: unknown): BrowserProseCandidateV2Genre | null {
  const serialized = stableJson(value).toLowerCase();
  if (/(?:xianxia|wuxia|cultivation|仙俠|修真|武俠)/u.test(serialized)) return "xianxia";
  if (/(?:mystery|detective|suspense|推理|懸疑|刑偵)/u.test(serialized)) return "mystery";
  if (/(?:emotion|romance|relationship|情感|愛情|戀愛)/u.test(serialized)) return "emotion";
  if (/(?:adventure|fantasy|quest|冒險|奇幻|遠征)/u.test(serialized)) return "adventure";
  if (/(?:modern|urban|contemporary|現代|都市|當代)/u.test(serialized)) return "modern";
  return null;
}

function parseLabeledContext(context: readonly string[]): Map<RequiredContextLabel, unknown> {
  const required = new Set<string>(REQUIRED_CONTEXT_LABELS);
  const parsed = new Map<RequiredContextLabel, unknown>();
  for (const entry of context) {
    const match = /^\[([A-Z0-9_]+)\]\n([\s\S]+)$/u.exec(entry);
    if (!match || !required.has(match[1])) continue;
    const label = match[1] as RequiredContextLabel;
    if (parsed.has(label)) {
      candidateContextError("BROWSER_PROSE_CANDIDATE_V2_CONTEXT_LABEL_DUPLICATED");
    }
    try {
      parsed.set(label, JSON.parse(match[2]));
    } catch {
      candidateContextError("BROWSER_PROSE_CANDIDATE_V2_CONTEXT_JSON_INVALID");
    }
  }
  if (REQUIRED_CONTEXT_LABELS.some((label) => !parsed.has(label))) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_REQUIRED_CONTEXT_MISSING");
  }
  return parsed;
}

export async function parseBrowserProseCandidateV2Context(input: {
  composerAuthority: "project-context-composer-v1";
  context: readonly string[];
  nextActionGoal: string;
  genre?: BrowserProseCandidateV2Genre;
}): Promise<BrowserProseCandidateV2ParsedContext> {
  if (input.composerAuthority !== "project-context-composer-v1") {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_CONTEXT_AUTHORITY_INVALID");
  }
  const nextActionGoal = cleanText(input.nextActionGoal, 1_024);
  if (!nextActionGoal) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_NEXT_ACTION_GOAL_MISSING");
  }
  const parsed = parseLabeledContext(input.context);
  const storyBibleValue = parsed.get("APPROVED_STORY_BIBLE");
  const activeChapterValue = parsed.get("ACTIVE_CHAPTER");
  const identitiesValue = parsed.get("CANONICAL_CHARACTER_IDENTITIES");
  const worldRulesValue = parsed.get("WORLD_RULES");
  if (
    !isRecord(storyBibleValue)
    || !isRecord(activeChapterValue)
    || !Array.isArray(identitiesValue)
    || !Array.isArray(worldRulesValue)
  ) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_CONTEXT_SHAPE_INVALID");
  }

  const currentChapter = cleanText(activeChapterValue.content, 12_000)
    ?? cleanText(activeChapterValue.summary, 4_096);
  if (!currentChapter) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_ACTIVE_CHAPTER_CONTENT_MISSING");
  }
  const characterAnchors = uniqueBounded(
    identitiesValue.flatMap((identity) => {
      if (!isRecord(identity)) return [];
      return [
        cleanText(identity.name, 64),
        ...(Array.isArray(identity.aliases)
          ? identity.aliases.map((alias) => cleanText(alias, 64))
          : []),
      ];
    }),
    16,
  );
  if (!characterAnchors.length) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_CHARACTER_ANCHOR_MISSING");
  }

  const worldRules = worldRulesValue.flatMap((rule) => {
    if (!isRecord(rule)) return [];
    const title = cleanText(rule.title, 128);
    const description = cleanText(rule.description, 1_024);
    const combined = [title, description].filter(Boolean).join("：");
    return combined ? [combined] : [];
  }).slice(0, 16);
  if (!worldRules.length) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_WORLD_RULE_MISSING");
  }

  const contextAnchors = uniqueBounded([
    cleanText(activeChapterValue.title, 64),
    ...worldRulesValue.flatMap((rule) => (
      isRecord(rule) ? [cleanText(rule.title, 64)] : []
    )),
    cleanText(storyBibleValue.title, 64),
    cleanText(storyBibleValue.world, 64),
    cleanText(storyBibleValue.setting, 64),
    cleanText(storyBibleValue.location, 64),
  ], 12);
  if (!contextAnchors.length) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_CONTEXT_ANCHOR_MISSING");
  }

  const genre = input.genre ?? inferGenre(storyBibleValue);
  if (!genre) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_GENRE_UNRESOLVED");
  }
  const contextValue: BrowserProseCandidateV2Context = {
    storyBible: stableJson(storyBibleValue),
    currentChapter,
    characterAnchors,
    contextAnchors,
    worldRules,
    nextActionGoal,
    genre,
  };
  const contextDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-context-pack-v1\n${stableJson(contextValue)}`,
  );
  return {
    schemaVersion: BROWSER_PROSE_CANDIDATE_V2_CONTEXT_PACK_VERSION,
    composerAuthority: input.composerAuthority,
    sourceLabels: REQUIRED_CONTEXT_LABELS,
    context: contextValue,
    contextDigest,
    rawContextStored: false,
  };
}

export async function assertBrowserProseCandidateV2ParsedContext(
  parsed: BrowserProseCandidateV2ParsedContext,
): Promise<void> {
  if (
    parsed.schemaVersion !== BROWSER_PROSE_CANDIDATE_V2_CONTEXT_PACK_VERSION
    || parsed.composerAuthority !== "project-context-composer-v1"
    || parsed.rawContextStored !== false
    || parsed.sourceLabels.length !== REQUIRED_CONTEXT_LABELS.length
    || parsed.sourceLabels.some((label, index) => label !== REQUIRED_CONTEXT_LABELS[index])
    || !parsed.context.storyBible
    || !parsed.context.currentChapter
    || !parsed.context.nextActionGoal
    || parsed.context.characterAnchors.length < 1
    || parsed.context.contextAnchors.length < 1
    || parsed.context.worldRules.length < 1
  ) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_PARSED_CONTEXT_REJECTED");
  }
  const expectedDigest = await browserProseCandidateV2Sha256(
    `browser-prose-candidate-v2-context-pack-v1\n${stableJson(parsed.context)}`,
  );
  if (parsed.contextDigest !== expectedDigest) {
    candidateContextError("BROWSER_PROSE_CANDIDATE_V2_CONTEXT_DIGEST_MISMATCH");
  }
}
