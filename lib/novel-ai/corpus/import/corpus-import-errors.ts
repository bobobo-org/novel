export class CorpusImportError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, options: { retryable?: boolean; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = "CorpusImportError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? {};
  }
}

export function assertCorpusImport(condition: unknown, code: string, message: string, details?: Record<string, unknown>): asserts condition {
  if (!condition) throw new CorpusImportError(code, message, { details });
}
