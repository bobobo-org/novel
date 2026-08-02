import { browserFabricDigest } from "./execution-receipt";

export async function createBrowserAssistedPlan(input: {
  target: "local-ollama" | "private-ai-hub";
  originalTokens: number;
  browserPreparedTokens: number;
  explicitEscalation: boolean;
}) {
  if (!input.explicitEscalation) {
    throw Object.assign(new Error("Closed backend escalation was not explicitly selected."), {
      code: "BROWSER_FABRIC_SILENT_ESCALATION_BLOCKED",
      dataLeftDevice: false,
    });
  }
  const tokensSaved = Math.max(0, input.originalTokens - input.browserPreparedTokens);
  return {
    schemaVersion: "browser-assisted-plan-v1",
    planDigest: await browserFabricDigest(input),
    target: input.target,
    browserPreprocessing: true,
    browserPostprocessing: true,
    originalTokens: input.originalTokens,
    browserPreparedTokens: input.browserPreparedTokens,
    tokensSaved,
    explicitEscalation: true,
  };
}
