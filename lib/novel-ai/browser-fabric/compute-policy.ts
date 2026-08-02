import type {
  BrowserFabricComputePolicy,
  BrowserFabricEngineDescriptor,
  BrowserFabricModelTier,
  BrowserFabricTask,
  BrowserDeviceQualificationProfile,
} from "./types";

export type BrowserFabricPolicyDecision = {
  policy: BrowserFabricComputePolicy;
  allowedModelTiers: BrowserFabricModelTier[];
  generationEngineId: BrowserFabricEngineDescriptor["id"];
  preAuthorizedClosedRefinement: boolean;
  externalFallbackAllowed: false;
  reasonCodes: string[];
};

export function resolveBrowserFabricComputePolicy(input: {
  task: BrowserFabricTask;
  profile: BrowserDeviceQualificationProfile;
  engines: BrowserFabricEngineDescriptor[];
}): BrowserFabricPolicyDecision {
  const policy = input.task.computePolicy ?? "BROWSER_FIRST";
  const requested = input.task.allowedModelTiers ?? ["MICRO", "FAST", "BALANCED", "QUALITY"];
  const memory = input.profile.deviceMemory ?? 0;
  const deviceAllowed: BrowserFabricModelTier[] = ["MICRO"];
  if (input.profile.webGpu && memory >= 4) deviceAllowed.push("FAST");
  if (input.profile.webGpu && memory >= 8 && !input.profile.mobile) deviceAllowed.push("BALANCED");
  if (input.profile.webGpu && memory >= 12 && !input.profile.mobile) deviceAllowed.push("QUALITY");
  const allowedModelTiers = requested.filter((tier) => deviceAllowed.includes(tier));
  const webLlm = input.engines.find((engine) => engine.id === "webllm");
  const builtIn = input.engines.find((engine) => engine.id === "chromium-built-in-ai");
  const requestedGenerationEngine = input.task.manualEngineId === "webllm"
    || input.task.manualEngineId === "chromium-built-in-ai"
    ? input.task.manualEngineId
    : null;
  const generationEngineId = requestedGenerationEngine
    ?? (webLlm?.status === "ready" && webLlm.productionQualified
      ? "webllm"
      : builtIn?.status === "ready"
        && builtIn.productionQualified
        && builtIn.traditionalChineseGenerationQualified
        ? "chromium-built-in-ai"
        // This is an installation target, not a fallback execution claim.
        // The generation call must fail closed until a verified model is ready.
        : "webllm");
  const selectedGenerationEngine = input.engines.find((engine) => engine.id === generationEngineId);
  const reasonCodes = [
    `policy:${policy}`,
    `generation:${generationEngineId}`,
    `tiers:${allowedModelTiers.join(",") || "MICRO"}`,
    selectedGenerationEngine?.status === "ready"
      && selectedGenerationEngine.productionQualified
      && selectedGenerationEngine.traditionalChineseGenerationQualified
      ? "generation_engine_verified"
      : "generation_engine_install_or_qualification_required",
    "deterministic_generation_fallback:blocked",
  ];
  return {
    policy,
    allowedModelTiers: allowedModelTiers.length ? allowedModelTiers : ["MICRO"],
    generationEngineId,
    preAuthorizedClosedRefinement: input.task.preAuthorizedClosedRefinement ?? false,
    externalFallbackAllowed: false,
    reasonCodes,
  };
}
