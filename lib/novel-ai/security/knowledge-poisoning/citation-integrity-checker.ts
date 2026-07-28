export function verifyCitationIntegrity(input: {
  sourceId: string;
  sourceRevision: string;
  sourceText: string;
  excerpt: string;
  start: number;
  end: number;
}) {
  const valid = input.start >= 0
    && input.end >= input.start
    && input.sourceText.slice(input.start, input.end) === input.excerpt;
  return {
    valid,
    sourceId: input.sourceId,
    sourceRevision: input.sourceRevision,
    errorCode: valid ? null : "KNOWLEDGE_CITATION_INTEGRITY_FAILED",
  };
}
