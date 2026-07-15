export class LocalRuntimeError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "LocalRuntimeError";
    this.code = code;
    this.status = status;
  }
}

export function publicRuntimeError(error: unknown) {
  if (error instanceof LocalRuntimeError) {
    return { errorCode: error.code, errorType: error.name, userMessage: error.message };
  }
  return { errorCode: "LOCAL_RUNTIME_ERROR", errorType: "LocalRuntimeError", userMessage: "Local runtime request failed." };
}
