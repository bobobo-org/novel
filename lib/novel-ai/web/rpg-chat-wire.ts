import type { RpgChoice } from "../game/progression/rpg-progression";

export function normalizeRpgChoiceWireText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function rpgChoiceWireText(choice: Pick<RpgChoice, "key" | "title">) {
  return `選擇 ${choice.key}｜${normalizeRpgChoiceWireText(choice.title)}`;
}

export function parseRpgChoiceSelection(
  input: string,
  choices: readonly RpgChoice[],
): RpgChoice | null {
  const value = normalizeRpgChoiceWireText(input);
  // Current wire format is intentionally exact: both the key and the complete
  // normalized title must match. This prevents overlapping titles (for
  // example, "進城" and "進城救人") from selecting the wrong branch.
  const exactWire = choices.find((choice) => (
    value === normalizeRpgChoiceWireText(rpgChoiceWireText(choice))
  ));
  if (exactWire) return exactWire;

  // Legacy saved messages may contain only a bare A/B/C. Accept exactly that
  // spelling—never ordinal, strategy, substring or punctuation heuristics.
  const legacyKey = value.toUpperCase();
  return /^[ABC]$/u.test(legacyKey)
    ? choices.find((choice) => choice.key === legacyKey) ?? null
    : null;
}
