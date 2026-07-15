export function normalizeChunkText(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function compactChunkWhitespace(text: string) {
  return normalizeChunkText(text).replace(/[ \t]+/g, " ");
}
