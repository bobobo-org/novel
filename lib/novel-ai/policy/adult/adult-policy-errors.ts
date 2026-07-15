export class AdultPolicyError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AdultPolicyError";
    this.code = code;
    this.details = details;
  }
}

export function adultPolicyError(code: string, message: string, details?: unknown) {
  return new AdultPolicyError(code, message, details);
}
