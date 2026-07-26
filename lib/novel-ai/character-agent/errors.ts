export class CharacterAgentError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "CharacterAgentError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function assertCharacterAgent(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new CharacterAgentError(code, message);
}
