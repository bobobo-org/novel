import crypto from "crypto";
import type { CorpusNormalizedText } from "./corpus-import-types";

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeCorpusText(rawText: string): CorpusNormalizedText {
  const changes: string[] = [];
  let text = rawText;
  const rawTextHash = hash(text);
  const beforeBom = text;
  text = text.replace(/^\uFEFF/, "");
  if (text !== beforeBom) changes.push("bom_removed");
  const beforeUnicode = text;
  text = text.normalize("NFC");
  if (text !== beforeUnicode) changes.push("unicode_nfc");
  const beforeTags = text;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<ruby[\s\S]*?<\/ruby>/gi, "").replace(/<[^>]+>/g, " ");
  if (text !== beforeTags) changes.push("html_removed");
  const beforeNewlines = text;
  text = text.replace(/\r\n?/g, "\n").replace(/\u00ad/g, "");
  if (text !== beforeNewlines) changes.push("newline_soft_hyphen_normalized");
  const beforeWhitespace = text;
  text = text.replace(/[ \t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (text !== beforeWhitespace) changes.push("whitespace_normalized");
  const beforePages = text;
  text = text.split("\n").filter((line) => !/^\s*(page\s*)?\d+\s*$/i.test(line)).join("\n");
  if (text !== beforePages) changes.push("page_numbers_removed");
  return {
    rawText,
    normalizedText: text,
    rawTextHash,
    normalizedTextHash: hash(text),
    normalizationProfile: "h2d2-normalization-v1",
    normalizationChanges: changes,
  };
}
