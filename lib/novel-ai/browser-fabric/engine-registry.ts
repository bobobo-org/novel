import { browserProviderSnapshot } from "../providers/browser-ai/browser-ai-provider";
import { browserSemanticRuntimeSnapshot } from "../providers/browser-ai/browser-semantic-runtime";
import { browserWebLLMRuntimeSnapshot } from "../providers/browser-ai/browser-webllm-runtime";
import { browserWebLLMModel } from "../providers/browser-ai/webllm-model-registry";
import type {
  BrowserDeviceQualificationProfile,
  BrowserFabricEngineDescriptor,
} from "./types";

function deterministicEngine(): BrowserFabricEngineDescriptor {
  return {
    id: "deterministic-js-wasm",
    label: "Deterministic JS / WASM",
    engineClass: "deterministic",
    status: "ready",
    executionProvider: typeof WebAssembly === "undefined" ? "js" : "wasm",
    capabilities: [
      "rpg-formula", "json-parse", "schema-validation", "json-repair",
      "candidate-digest", "cache-key", "approval-preview", "canon-precheck",
    ],
    modelTiers: ["MICRO"],
    modelId: "deterministic-browser-runtime-v1",
    modelDigest: "runtime-code-sealed-at-build",
    languageSupport: ["language-agnostic"],
    traditionalChineseGenerationQualified: false,
    productionQualified: true,
    reasonCode: "DETERMINISTIC_RUNTIME_READY",
  };
}

export async function browserFabricEngineRegistry(input: {
  profile: BrowserDeviceQualificationProfile;
  probes?: {
    webNnInferencePassed?: boolean;
    onnxWebGpuInferencePassed?: boolean;
    onnxWasmInferencePassed?: boolean;
  };
}): Promise<BrowserFabricEngineDescriptor[]> {
  const [semantic, webLlm, browser] = await Promise.all([
    browserSemanticRuntimeSnapshot().catch(() => null),
    browserWebLLMRuntimeSnapshot().catch(() => null),
    browserProviderSnapshot().catch(() => null),
  ]);
  const selected = webLlm?.models.find((model) => model.modelId === webLlm.selectedModelId) ?? null;
  const selectedManifest = browserWebLLMModel(selected?.modelId);
  const onnxWebGpuPassed = input.probes?.onnxWebGpuInferencePassed
    ?? Boolean(input.profile.webGpu && semantic?.model.cacheVerified);
  const onnxWasmPassed = input.probes?.onnxWasmInferencePassed
    ?? Boolean(input.profile.webAssembly && semantic?.model.cacheVerified);
  const webNnPassed = input.probes?.webNnInferencePassed ?? false;
  const onnxProvider = onnxWebGpuPassed
    ? "webgpu" as const
    : input.profile.webNn && webNnPassed
      ? "webnn" as const
      : onnxWasmPassed
        ? "wasm" as const
        : null;
  const webLlmReady = Boolean(
    selected
    && selected.shardIntegrityVerified
    && browser?.status === "ready"
    && browser.detail === "browser_hybrid_runtime_webllm_ready",
  );
  const builtInLanguageQualified = input.profile.chromeBuiltinLanguages.includes("zh-Hant");
  const builtInReady = Boolean(
    input.profile.chromeBuiltinAi
    && builtInLanguageQualified
    && browser?.status === "ready"
    && browser.detail === "browser_hybrid_runtime_native_prompt_ready",
  );

  return [
    deterministicEngine(),
    {
      id: "onnx-runtime-web",
      label: "ONNX Runtime Web",
      engineClass: "semantic",
      status: onnxProvider ? "ready" : input.profile.webAssembly ? "available_not_installed" : "unsupported",
      executionProvider: onnxProvider,
      capabilities: ["embedding", "reranking", "classification", "quality-scoring", "prompt-injection-detection"],
      modelTiers: ["MICRO"],
      modelId: semantic?.model.modelId ?? null,
      modelDigest: semantic?.model.modelDigest ?? null,
      languageSupport: ["multilingual", "zh-Hant"],
      traditionalChineseGenerationQualified: false,
      productionQualified: Boolean(onnxProvider),
      reasonCode: onnxProvider
        ? `ONNX_${onnxProvider.toUpperCase()}_INFERENCE_VERIFIED`
        : "ONNX_MODEL_INSTALL_OR_INFERENCE_PROOF_REQUIRED",
    },
    {
      id: "webllm",
      label: "WebLLM WebGPU Worker",
      engineClass: "generative",
      status: webLlmReady ? "ready" : input.profile.webGpu ? "available_not_installed" : "unsupported",
      executionProvider: input.profile.webGpu ? "webgpu" : null,
      capabilities: ["generation", "streaming", "cancellation", "json-mode", "offline-reopen"],
      modelTiers: ["FAST", "BALANCED", "QUALITY"],
      modelId: selected?.modelId ?? null,
      modelDigest: selected?.modelDigest ?? null,
      languageSupport: ["zh-Hant", "zh", "en"],
      traditionalChineseGenerationQualified: webLlmReady,
      productionQualified: webLlmReady && selectedManifest?.productionQualified !== false,
      reasonCode: webLlmReady
        ? selectedManifest?.productionQualified === false
          ? "WEBLLM_MODEL_LICENSE_NOT_PRODUCTION_QUALIFIED"
          : "WEBLLM_INFERENCE_AND_INTEGRITY_VERIFIED"
        : "WEBLLM_EXPLICIT_INSTALL_AND_BENCHMARK_REQUIRED",
    },
    {
      id: "chromium-built-in-ai",
      label: "Chromium Built-in AI",
      engineClass: "built-in",
      status: builtInReady
        ? "ready"
        : input.profile.chromeBuiltinAi
          ? "degraded"
          : "unsupported",
      executionProvider: input.profile.chromeBuiltinAi ? "browser-managed" : null,
      capabilities: ["prompt", "summarize", "write", "rewrite", "proofread", "translate", "language-detect"],
      modelTiers: ["FAST"],
      modelId: builtInReady ? browser?.modelId ?? null : null,
      modelDigest: builtInReady ? browser?.modelDigest ?? null : null,
      languageSupport: input.profile.chromeBuiltinLanguages,
      traditionalChineseGenerationQualified: builtInReady,
      productionQualified: builtInReady,
      reasonCode: builtInReady
        ? "CHROMIUM_ZH_HANT_INFERENCE_VERIFIED"
        : input.profile.chromeBuiltinAi
          ? "CHROMIUM_ZH_HANT_NOT_VERIFIED"
          : "CHROMIUM_BUILTIN_AI_NOT_AVAILABLE",
    },
    {
      id: "llamaweb-gguf",
      label: "Experimental LlamaWeb / GGUF",
      engineClass: "experimental",
      status: "experimental_not_qualified",
      executionProvider: null,
      capabilities: ["experimental-gguf-generation"],
      modelTiers: ["EXPERIMENTAL"],
      modelId: null,
      modelDigest: null,
      languageSupport: [],
      traditionalChineseGenerationQualified: false,
      productionQualified: false,
      reasonCode: "LLAMAWEB_PARSER_FUZZ_LICENSE_AND_CROSS_BROWSER_GATES_PENDING",
    },
  ];
}
