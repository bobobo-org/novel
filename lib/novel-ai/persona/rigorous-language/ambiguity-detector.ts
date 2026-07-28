export function detectAmbiguity(text: string) {
  const patterns = [/\b(?:某些|一些|有人|相關人士)\b/g, /(?:很|非常|相當)(?:好|差|大|小)/g, /這(?:個|些)(?![\u3400-\u9fff]{1,8}(?:是|指))/g];
  return patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => ({
    text: match[0],
    index: match.index ?? -1,
    code: "AMBIGUOUS_REFERENCE",
  })));
}
