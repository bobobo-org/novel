export function isUsableChineseStoryOutput(
  content: string,
  minimumHanCharacters = 20,
) {
  const text = content.trim();
  if (!text) return false;
  const hanCharacterCount = text.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  return hanCharacterCount >= minimumHanCharacters;
}

export function hasVerifiedExecutedStoryOutput(input: {
  content: string;
  provider: string;
  actualExecutor: string;
  modelDigest?: string | null;
}) {
  return Boolean(
    input.content.trim()
    && input.modelDigest?.trim()
    && ["local-ollama", "browser-ai"].includes(input.provider)
    && input.actualExecutor === input.provider,
  );
}
