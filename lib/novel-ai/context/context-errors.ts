export class ContextComposerError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ContextComposerError";
    this.code = code;
    this.retryable = retryable;
  }
}
