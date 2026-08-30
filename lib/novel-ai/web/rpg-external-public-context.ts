import { sha256Hex, stableStringify } from "../closed-ai-cache";
import type { RpgChoice, RpgChoiceResolution } from "../game/progression/rpg-progression";
import type { RpgChatSnapshot } from "./rpg-chat-turn";

export const EXTERNAL_RPG_PUBLIC_CONTEXT_SCHEMA = "external-rpg-public-context-v1" as const;
export const EXTERNAL_RPG_PUBLIC_FIELD_MANIFEST = Object.freeze([
  "outputLanguage",
  "project.title",
  "chapter.title",
  "chapter.recentTail",
  "selectedChoice",
  "lockedResult",
  "publicCharacters",
  "publicRelationships",
  "worldRules",
  "nonSecretLore",
  "timeline",
  "unresolvedThreads",
] as const);

const FORBIDDEN_KEYS = new Set([
  "attachments",
  "privateSecrets",
  "hiddenMotivations",
  "secretMotive",
  "authorPreferences",
  "forbiddenContradictions",
  "directorContext",
  "fullWork",
  "chapters",
]);

const INTERNAL_LORE_LINE = /(?:世界契約|題材契約|所屬家族\s*ID|contractStatement|canonicalStatus|VIRTUAL_CANDIDATE|schemaVersion|十因果維度)/iu;

/**
 * External prompts may contain only facts that a reader could already see.
 * A lore row is not public merely because its coarse `kind` is not `secret`:
 * organization rows can embed hidden conflicts, secret motives and unrevealed
 * relationship blocks inside otherwise public text.
 */
export function readerSafeExternalLoreContent(value: string) {
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !INTERNAL_LORE_LINE.test(line));
  const safeLines: string[] = [];
  let relationshipBlock: string[] | null = null;
  const flushRelationship = () => {
    if (!relationshipBlock) return;
    const unrevealed = relationshipBlock.some((line) => /強度\s*[：:].*未公開/u.test(line));
    if (!unrevealed) {
      safeLines.push(...relationshipBlock.filter((line) => (
        !/^(?:幕後動機|強度)\s*[：:]/u.test(line)
      )));
    }
    relationshipBlock = null;
  };
  for (const line of lines) {
    if (/^-\s*[^\n]+｜對象\s*[：:]/u.test(line)) {
      flushRelationship();
      relationshipBlock = [line];
      continue;
    }
    if (relationshipBlock && /^(?:階層、房系與資產|名冊規則)\s*[：:]/u.test(line)) {
      flushRelationship();
      safeLines.push(line);
      continue;
    }
    if (relationshipBlock) {
      relationshipBlock.push(line);
      continue;
    }
    if (/^(?:幕後動機|隱藏衝突|未公開關係)\s*[：:]/u.test(line)) continue;
    safeLines.push(line);
  }
  flushRelationship();
  return safeLines
    .join("\n")
    .replace(/(?:social-(?:family|institution)-[^\s，。；、)）]+|[\da-f]{8,}-[\da-f-]{20,})/giu, "既有勢力")
    .trim();
}

function bounded(value: unknown, maximum: number) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, maximum)
    : "";
}

function boundedOptionalValue(value: unknown, maximum: number) {
  if (typeof value === "string") return bounded(value, maximum);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return bounded((value as { value?: unknown }).value, maximum);
}

function publicChoice(choice: RpgChoice) {
  return {
    key: choice.key,
    title: bounded(choice.title, 80),
    description: bounded(choice.description, 360),
    consequenceTeaser: bounded(choice.consequenceTeaser, 220),
    approach: choice.approach,
    costLabels: choice.costLabels.slice(0, 6).map((value) => bounded(value, 80)),
    impactLabels: choice.impactLabels.slice(0, 6).map((value) => bounded(value, 80)),
  };
}

export function buildExternalRpgPublicPayload(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  outcomeLines: readonly string[];
}) {
  if (input.snapshot.project.adultMode) {
    throw Object.assign(new Error("成人模式 RPG 內容依本機安全邊界不得外送。"), {
      code: "EXTERNAL_RPG_ADULT_CONTENT_LOCAL_ONLY",
    });
  }
  const protagonistIds = new Set(input.snapshot.storyBible.protagonistIds);
  const characters = [...input.snapshot.characters]
    .sort((left, right) => Number(protagonistIds.has(right.id)) - Number(protagonistIds.has(left.id)))
    .slice(0, 12);
  const characterNames = new Map(input.snapshot.characters.map((character) => [character.id, character.name]));
  return {
    schemaVersion: EXTERNAL_RPG_PUBLIC_CONTEXT_SCHEMA,
    outputLanguage: input.snapshot.language,
    project: { title: bounded(input.snapshot.project.title, 120) },
    chapter: {
      title: bounded(input.snapshot.chapter.title, 120),
      recentTail: input.snapshot.chapter.content.normalize("NFKC").slice(-3_600),
    },
    selectedChoice: publicChoice(input.choice),
    lockedResult: {
      outcome: input.resolution.outcome,
      outcomeLabel: bounded(input.resolution.outcomeLabel, 80),
      summary: bounded(input.resolution.summary, 360),
      visibleSettlement: input.outcomeLines.slice(0, 12).map((value) => bounded(value, 160)),
    },
    publicCharacters: characters.map((character) => ({
      name: bounded(character.name, 80),
      identity: boundedOptionalValue(character.identity, 160),
      personality: boundedOptionalValue(character.personality, 180),
      goal: boundedOptionalValue(character.goal, 180),
      lifeStatus: character.lifeStatus,
      capabilities: (character.capabilities ?? []).slice(0, 6).map((value) => bounded(value, 100)),
      limitations: (character.limitations ?? []).slice(0, 6).map((value) => bounded(value, 100)),
    })),
    publicRelationships: input.snapshot.relationships.slice(0, 16).map((relationship) => ({
      from: bounded(characterNames.get(relationship.fromCharacterId), 80),
      to: bounded(characterNames.get(relationship.toCharacterId), 80),
      kind: bounded(relationship.kind, 80),
      summary: bounded(relationship.summary, 280),
    })),
    worldRules: input.snapshot.worldRules.slice(0, 12).map((rule) => ({
      title: bounded(rule.title, 120),
      description: bounded(rule.description, 420),
      immutable: rule.immutable,
    })),
    nonSecretLore: input.snapshot.lore
      .filter((entry) => entry.kind !== "secret")
      .slice(0, 10)
      .map((entry) => ({
        kind: entry.kind,
        title: bounded(entry.title, 120),
        content: bounded(readerSafeExternalLoreContent(entry.content), 480),
      }))
      .filter((entry) => entry.content),
    timeline: input.snapshot.timeline.slice(-10).map((event) => ({
      storyTime: bounded(event.storyTime, 80),
      title: bounded(event.title, 120),
      summary: bounded(event.summary, 320),
    })),
    unresolvedThreads: input.snapshot.storyBible.unresolvedThreads
      .slice(0, 10)
      .map((thread) => bounded(thread, 320)),
  };
}

export type ExternalRpgPublicPayload = ReturnType<typeof buildExternalRpgPublicPayload>;

function publicPayloadError(message: string) {
  return Object.assign(new Error(message), { code: "EXTERNAL_RPG_PUBLIC_PAYLOAD_INVALID" });
}

function exactRecord(value: unknown, path: string, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw publicPayloadError(`${path} must be an object.`);
  }
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw publicPayloadError(`${path} contains fields outside the canonical public manifest.`);
  }
  return value as Record<string, unknown>;
}

function publicString(value: unknown, path: string, maximum: number) {
  if (typeof value !== "string" || value.length > maximum) {
    throw publicPayloadError(`${path} is not a bounded public string.`);
  }
}

function publicStringArray(value: unknown, path: string, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw publicPayloadError(`${path} exceeds its public list boundary.`);
  }
  value.forEach((item, index) => publicString(item, `${path}[${index}]`, maximumLength));
}

export function assertExternalRpgPublicPayload(
  value: unknown,
): asserts value is ExternalRpgPublicPayload {
  const visit = (current: unknown, path = "payload") => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw Object.assign(new Error(`External RPG public payload contains forbidden field: ${path}.${key}`), {
          code: "EXTERNAL_RPG_PRIVATE_FIELD_BLOCKED",
        });
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(value);
  const root = exactRecord(value, "payload", [
    "schemaVersion", "outputLanguage", "project", "chapter", "selectedChoice",
    "lockedResult", "publicCharacters", "publicRelationships", "worldRules",
    "nonSecretLore", "timeline", "unresolvedThreads",
  ]);
  if (root.schemaVersion !== EXTERNAL_RPG_PUBLIC_CONTEXT_SCHEMA) {
    throw publicPayloadError("payload.schemaVersion is invalid.");
  }
  if (!["zh-TW", "zh-CN", "en"].includes(String(root.outputLanguage))) {
    throw publicPayloadError("payload.outputLanguage is invalid.");
  }
  const project = exactRecord(root.project, "payload.project", ["title"]);
  publicString(project.title, "payload.project.title", 120);
  const chapter = exactRecord(root.chapter, "payload.chapter", ["title", "recentTail"]);
  publicString(chapter.title, "payload.chapter.title", 120);
  publicString(chapter.recentTail, "payload.chapter.recentTail", 3_600);
  const choice = exactRecord(root.selectedChoice, "payload.selectedChoice", [
    "key", "title", "description", "consequenceTeaser", "approach", "costLabels", "impactLabels",
  ]);
  publicString(choice.key, "payload.selectedChoice.key", 16);
  publicString(choice.title, "payload.selectedChoice.title", 80);
  publicString(choice.description, "payload.selectedChoice.description", 360);
  publicString(choice.consequenceTeaser, "payload.selectedChoice.consequenceTeaser", 220);
  publicString(choice.approach, "payload.selectedChoice.approach", 40);
  publicStringArray(choice.costLabels, "payload.selectedChoice.costLabels", 6, 80);
  publicStringArray(choice.impactLabels, "payload.selectedChoice.impactLabels", 6, 80);
  const locked = exactRecord(root.lockedResult, "payload.lockedResult", [
    "outcome", "outcomeLabel", "summary", "visibleSettlement",
  ]);
  publicString(locked.outcome, "payload.lockedResult.outcome", 40);
  publicString(locked.outcomeLabel, "payload.lockedResult.outcomeLabel", 80);
  publicString(locked.summary, "payload.lockedResult.summary", 360);
  publicStringArray(locked.visibleSettlement, "payload.lockedResult.visibleSettlement", 12, 160);
  if (!Array.isArray(root.publicCharacters) || root.publicCharacters.length > 12) {
    throw publicPayloadError("payload.publicCharacters exceeds its public list boundary.");
  }
  root.publicCharacters.forEach((item, index) => {
    const row = exactRecord(item, `payload.publicCharacters[${index}]`, [
      "name", "identity", "personality", "goal", "lifeStatus", "capabilities", "limitations",
    ]);
    publicString(row.name, `payload.publicCharacters[${index}].name`, 80);
    publicString(row.identity, `payload.publicCharacters[${index}].identity`, 160);
    publicString(row.personality, `payload.publicCharacters[${index}].personality`, 180);
    publicString(row.goal, `payload.publicCharacters[${index}].goal`, 180);
    publicString(row.lifeStatus, `payload.publicCharacters[${index}].lifeStatus`, 40);
    publicStringArray(row.capabilities, `payload.publicCharacters[${index}].capabilities`, 6, 100);
    publicStringArray(row.limitations, `payload.publicCharacters[${index}].limitations`, 6, 100);
  });
  if (!Array.isArray(root.publicRelationships) || root.publicRelationships.length > 16) {
    throw publicPayloadError("payload.publicRelationships exceeds its public list boundary.");
  }
  root.publicRelationships.forEach((item, index) => {
    const row = exactRecord(item, `payload.publicRelationships[${index}]`, ["from", "to", "kind", "summary"]);
    publicString(row.from, `payload.publicRelationships[${index}].from`, 80);
    publicString(row.to, `payload.publicRelationships[${index}].to`, 80);
    publicString(row.kind, `payload.publicRelationships[${index}].kind`, 80);
    publicString(row.summary, `payload.publicRelationships[${index}].summary`, 280);
  });
  if (!Array.isArray(root.worldRules) || root.worldRules.length > 12) {
    throw publicPayloadError("payload.worldRules exceeds its public list boundary.");
  }
  root.worldRules.forEach((item, index) => {
    const row = exactRecord(item, `payload.worldRules[${index}]`, ["title", "description", "immutable"]);
    publicString(row.title, `payload.worldRules[${index}].title`, 120);
    publicString(row.description, `payload.worldRules[${index}].description`, 420);
    if (typeof row.immutable !== "boolean") throw publicPayloadError(`payload.worldRules[${index}].immutable is invalid.`);
  });
  if (!Array.isArray(root.nonSecretLore) || root.nonSecretLore.length > 10) {
    throw publicPayloadError("payload.nonSecretLore exceeds its public list boundary.");
  }
  root.nonSecretLore.forEach((item, index) => {
    const row = exactRecord(item, `payload.nonSecretLore[${index}]`, ["kind", "title", "content"]);
    publicString(row.kind, `payload.nonSecretLore[${index}].kind`, 40);
    publicString(row.title, `payload.nonSecretLore[${index}].title`, 120);
    publicString(row.content, `payload.nonSecretLore[${index}].content`, 480);
  });
  if (!Array.isArray(root.timeline) || root.timeline.length > 10) {
    throw publicPayloadError("payload.timeline exceeds its public list boundary.");
  }
  root.timeline.forEach((item, index) => {
    const row = exactRecord(item, `payload.timeline[${index}]`, ["storyTime", "title", "summary"]);
    publicString(row.storyTime, `payload.timeline[${index}].storyTime`, 80);
    publicString(row.title, `payload.timeline[${index}].title`, 120);
    publicString(row.summary, `payload.timeline[${index}].summary`, 320);
  });
  publicStringArray(root.unresolvedThreads, "payload.unresolvedThreads", 10, 320);
}

export function buildExternalRpgPromptFromPayload(payload: ExternalRpgPublicPayload) {
  assertExternalRpgPublicPayload(payload);
  const language = payload.outputLanguage;
  return [
    "你是外來小說 RPG 正文生成器。只能使用下方 bounded public payload，不得推測附件、完整作品、私密設定、隱藏動機或未列出的歷史。",
    "依 selectedChoice 與 lockedResult 寫一段可供作者核准、自然接在 recentTail 後的完整小說正文；不得改變鎖定結果。",
    language === "en"
      ? "Write a concrete literary title followed by 8-16 substantial prose paragraphs (1,100-2,200 characters)."
      : language === "zh-CN"
        ? "使用简体中文；第一行写具体文学标题，随后写 8 至 16 个完整小说段落、900 至 1600 个中文字。"
        : "使用繁體中文；第一行寫具體文學標題，隨後寫 8 至 16 個完整小說段落、900 至 1600 個中文字。",
    "必須讓選定行動落地、遇到阻力、付出代價、產生直接後果、改變人物關係或環境，並停在新的自然決策點。",
    "只輸出標題與小說正文；不得輸出 A/B/C、狀態面板、規則說明、分析、JSON、Markdown 程式碼框或聲稱已修改 Canon。",
    "",
    stableStringify(payload),
  ].join("\n");
}

export function buildExternalRpgPrompt(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  outcomeLines: readonly string[];
}) {
  const payload = buildExternalRpgPublicPayload(input);
  assertExternalRpgPublicPayload(payload);
  const prompt = buildExternalRpgPromptFromPayload(payload);
  return { payload, prompt };
}

export async function buildExternalRpgPromptBinding(input: {
  snapshot: RpgChatSnapshot;
  choice: RpgChoice;
  resolution: RpgChoiceResolution;
  outcomeLines: readonly string[];
}) {
  const built = buildExternalRpgPrompt(input);
  return {
    ...built,
    contextDigest: await sha256Hex(stableStringify(built.payload)),
    promptDigest: await sha256Hex(built.prompt),
    fieldManifestDigest: await sha256Hex(stableStringify(EXTERNAL_RPG_PUBLIC_FIELD_MANIFEST)),
  };
}
