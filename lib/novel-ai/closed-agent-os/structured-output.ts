const ABC_LABELS = ["A", "B", "C"] as const;

export type AbcChoiceLabel = (typeof ABC_LABELS)[number];

export type AbcChoice = {
  label: AbcChoiceLabel;
  text: string;
};

export type AbcChoiceNormalization =
  | {
      valid: true;
      sourceFormat:
        | "json-array"
        | "json-object"
        | "labeled-text"
        | "numbered-list"
        | "bullet-list"
        | "three-lines"
        | "three-paragraphs";
      choices: [AbcChoice, AbcChoice, AbcChoice];
      content: string;
      extractedItemCount: 3;
      materiallyDistinct: true;
      reasonCode: null;
    }
  | {
      valid: false;
      sourceFormat: "unrecognized";
      choices: AbcChoice[];
      content: null;
      extractedItemCount: number;
      materiallyDistinct: boolean;
      reasonCode: "ABC_CHOICES_INVALID_STRUCTURE";
    };

type ChoiceSourceFormat = Exclude<
  AbcChoiceNormalization["sourceFormat"],
  "unrecognized"
>;

function stripCodeFence(value: string) {
  const trimmed = value.replace(/\r\n?/gu, "\n").trim();
  const fenced = trimmed.match(/^```(?:json|text|markdown)?\s*\n?([\s\S]*?)\n?```$/iu);
  return (fenced?.[1] ?? trimmed).trim();
}

function cleanChoiceText(value: string) {
  return value
    .replace(/^\s*(?:[-*•]\s*)?(?:[ABCＡＢＣ]|\d{1,2})\s*[.．、:：)\]）-]\s*/u, "")
    .replace(/^[「『"'`]+|[」』"'`]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizedIdentity(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant-TW")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function recordValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return cleanChoiceText(String(value));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  const fields = ["title", "action", "text", "description", "content", "value"];
  const parts = fields
    .map((field) => recordValue(record[field]))
    .filter(Boolean)
    .filter((part, index, values) => values.indexOf(part) === index);
  return cleanChoiceText(parts.join("："));
}

function jsonCandidates(value: unknown): {
  format: "json-array" | "json-object";
  values: unknown[];
} | null {
  if (Array.isArray(value)) {
    return { format: "json-array", values: value };
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const letterEntries = Object.entries(record)
    .map(([key, entryValue]) => ({
      label: key.normalize("NFKC").toUpperCase(),
      value: entryValue,
    }))
    .filter(({ label }) => /^[A-Z]$/u.test(label));
  const abcEntries = new Map(
    letterEntries.map(({ label, value: entryValue }) => [label, entryValue]),
  );
  if (ABC_LABELS.every((label) => abcEntries.has(label))) {
    const strictAbcShape =
      letterEntries.length === 3
      && new Set(letterEntries.map(({ label }) => label)).size === 3;
    return {
      format: "json-object",
      values: strictAbcShape
        ? ABC_LABELS.map((label) => abcEntries.get(label))
        : [
            ...ABC_LABELS.map((label) => abcEntries.get(label)),
            ...letterEntries.map(({ value: entryValue }) => entryValue),
          ],
    };
  }
  for (const key of [
    "choices",
    "options",
    "candidates",
    "items",
    "選項",
    "候選",
  ]) {
    if (Array.isArray(record[key])) {
      return { format: "json-object", values: record[key] };
    }
  }
  return null;
}

function tryJson(value: string) {
  const candidates = [value];
  const objectStart = value.indexOf("{");
  const objectEnd = value.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(value.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = value.indexOf("[");
  const arrayEnd = value.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(value.slice(arrayStart, arrayEnd + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed = jsonCandidates(JSON.parse(candidate));
      if (parsed) return parsed;
    } catch {
      // The next bounded representation may still be valid JSON.
    }
  }
  return null;
}

function labeledChoices(value: string) {
  const markers = [...value.matchAll(
    /(?:^|\n)\s*(?:[-*•]\s*)?([A-ZＡ-Ｚ])\s*[.．、:：)\]）-]\s*/gu,
  )];
  if (markers.length === 0) return null;
  const labels = markers.map((match) =>
    match[1].normalize("NFKC").toUpperCase());
  const values = markers.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = markers[index + 1]?.index ?? value.length;
    return cleanChoiceText(value.slice(start, end));
  });
  return {
    valid:
      markers.length === 3
      && labels.every((label, index) => label === ABC_LABELS[index]),
    values,
  };
}

function listChoices(value: string) {
  const nonEmptyLines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const numbered = nonEmptyLines
    .map((line) => line.match(/^\s*\d{1,2}\s*[.．、:：)\]）-]\s*(.+)$/u)?.[1] ?? "")
    .filter(Boolean);
  if (numbered.length === 3) {
    return { format: "numbered-list" as const, values: numbered };
  }
  const bullets = nonEmptyLines
    .map((line) => line.match(/^\s*[-*•]\s+(.+)$/u)?.[1] ?? "")
    .filter(Boolean);
  if (bullets.length === 3) {
    return { format: "bullet-list" as const, values: bullets };
  }
  const paragraphs = value
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 3) {
    return { format: "three-paragraphs" as const, values: paragraphs };
  }
  if (nonEmptyLines.length === 3) {
    return { format: "three-lines" as const, values: nonEmptyLines };
  }
  return {
    format: "unrecognized" as const,
    values: numbered.length > bullets.length ? numbered : bullets,
  };
}

function finalize(
  sourceFormat: ChoiceSourceFormat | "unrecognized",
  values: unknown[],
): AbcChoiceNormalization {
  const texts = values.map(recordValue).filter(Boolean);
  const identities = texts.map(normalizedIdentity);
  const materiallyDistinct =
    identities.length === 3
    && identities.every((identity) => identity.length >= 4)
    && new Set(identities).size === 3;
  const choices = texts.slice(0, 3).map((text, index) => ({
    label: ABC_LABELS[index],
    text,
  }));
  if (
    sourceFormat === "unrecognized"
    || texts.length !== 3
    || !materiallyDistinct
  ) {
    return {
      valid: false,
      sourceFormat: "unrecognized",
      choices,
      content: null,
      extractedItemCount: texts.length,
      materiallyDistinct,
      reasonCode: "ABC_CHOICES_INVALID_STRUCTURE",
    };
  }
  const tuple = choices as [AbcChoice, AbcChoice, AbcChoice];
  return {
    valid: true,
    sourceFormat,
    choices: tuple,
    content: tuple.map((choice) => `${choice.label}. ${choice.text}`).join("\n"),
    extractedItemCount: 3,
    materiallyDistinct: true,
    reasonCode: null,
  };
}

export function normalizeAbcChoicesCandidate(
  input: string,
): AbcChoiceNormalization {
  const value = stripCodeFence(input);
  const json = tryJson(value);
  if (json) return finalize(json.format, json.values);
  const labeled = labeledChoices(value);
  if (labeled) {
    return finalize(
      labeled.valid ? "labeled-text" : "unrecognized",
      labeled.values,
    );
  }
  const list = listChoices(value);
  return finalize(list.format, list.values);
}

/**
 * The Closed Agent OS historically canonicalized every valid A/B/C response to
 * three display lines. That is useful for prose-only callers, but it destroys
 * structured RPG fields such as consequence and continuityReason before the
 * product-level validator can inspect them. Preserve validated JSON payloads
 * while retaining the legacy normalization for line-oriented responses.
 */
export function normalizeAbcChoicesExecutionContent(
  input: string,
): AbcChoiceNormalization {
  const normalized = normalizeAbcChoicesCandidate(input);
  if (
    !normalized.valid
    || (normalized.sourceFormat !== "json-array"
      && normalized.sourceFormat !== "json-object")
  ) {
    return normalized;
  }
  return {
    ...normalized,
    content: stripCodeFence(input),
  };
}
