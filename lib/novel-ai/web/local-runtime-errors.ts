export type WebLocalRuntimeErrorCode =
  | "LOCAL_RUNTIME_NOT_FOUND"
  | "LOCAL_RUNTIME_AUTH_FAILED"
  | "LOCAL_RUNTIME_VERSION_MISMATCH"
  | "LOCAL_RUNTIME_HOST_NOT_ALLOWED"
  | "LOCAL_RUNTIME_TOKEN_IN_URL_BLOCKED"
  | "LOCAL_RUNTIME_REQUEST_FAILED"
  | "TASK_CANCELLED"
  | "TASK_TIMEOUT";

export class WebLocalRuntimeError extends Error {
  readonly code: WebLocalRuntimeErrorCode;
  readonly status?: number;

  constructor(code: WebLocalRuntimeErrorCode, message: string, status?: number) {
    super(message);
    this.name = "WebLocalRuntimeError";
    this.code = code;
    this.status = status;
  }
}
