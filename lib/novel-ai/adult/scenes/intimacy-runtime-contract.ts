export const INTIMACY_RUNTIME_CONTRACT_VERSION = "h2p3-runtime-contract-v1";

export const INTIMACY_RUNTIME_ROUTES = [
  "/api/local/intimacy/scenes/plan",
  "/api/local/intimacy/scenes/:sceneId/stages/:stageId/transition",
  "/api/local/intimacy/scenes/:sceneId/stages/:stageId/versions",
  "/api/local/intimacy/scenes/:sceneId/branches",
  "/api/local/intimacy/scenes/:sceneId/continuity",
] as const;

export const INTIMACY_RUNTIME_GUARDS = {
  externalAiRequests: "blocked",
  explicitDraftGeneration: "not_implemented",
  participantVerification: "required",
  branchIsolation: "required",
  continuitySnapshot: "required",
  localOnly: true,
} as const;

export function intimacyRuntimeContract() {
  return {
    version: INTIMACY_RUNTIME_CONTRACT_VERSION,
    routes: INTIMACY_RUNTIME_ROUTES,
    guards: INTIMACY_RUNTIME_GUARDS,
    status: "contract_ready" as const,
  };
}
