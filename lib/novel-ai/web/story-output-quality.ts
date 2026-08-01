export function isUsableChineseStoryOutput(
  content: string,
  minimumHanCharacters = 20,
) {
  const text = content.trim();
  if (!text) return false;
  const hanCharacterCount = text.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  return hanCharacterCount >= minimumHanCharacters;
}
