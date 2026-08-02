export type BrowserFabricFailure = {
  code: string;
  category: "cancelled" | "timeout" | "integrity" | "capability" | "quality" | "runtime";
  retryable: boolean;
};

export function classifyBrowserFabricFailure(error: unknown): BrowserFabricFailure {
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof candidate?.code === "string"
    ? candidate.code
    : candidate?.name === "AbortError"
      ? "BROWSER_FABRIC_CANCELLED"
      : "BROWSER_FABRIC_RUNTIME_FAILED";
  if (code.includes("CANCEL") || candidate?.name === "AbortError") {
    return { code, category: "cancelled", retryable: false };
  }
  if (code.includes("TIMEOUT")) return { code, category: "timeout", retryable: true };
  if (code.includes("INTEGRITY") || code.includes("DIGEST")) {
    return { code, category: "integrity", retryable: false };
  }
  if (code.includes("UNSUPPORTED") || code.includes("NOT_READY") || code.includes("CAPABILITY")) {
    return { code, category: "capability", retryable: false };
  }
  if (code.includes("QUALITY") || code.includes("STRUCTURED") || code.includes("CANON")) {
    return { code, category: "quality", retryable: false };
  }
  return { code, category: "runtime", retryable: true };
}
