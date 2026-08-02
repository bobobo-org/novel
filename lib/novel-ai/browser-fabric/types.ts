import type { ClosedAINamespace, ClosedAIPrivacyLevel } from "../closed-ai-cache";

export const BROWSER_SOVEREIGN_FABRIC_VERSION =
  "browser-sovereign-ai-fabric-rc5-v1" as const;

export const BROWSER_FABRIC_ENGINE_IDS = [
  "deterministic-js-wasm",
  "onnx-runtime-web",
  "webllm",
  "chromium-built-in-ai",
  "llamaweb-gguf",
] as const;

export type BrowserFabricEngineId = (typeof BROWSER_FABRIC_ENGINE_IDS)[number];

export const BROWSER_FABRIC_NODE_KINDS = [
  "LOAD_AUTHORITY",
  "BUILD_MEMORY_VIEW",
  "RETRIEVE",
  "RERANK",
  "COMPRESS",
  "PLAN",
  "GENERATE",
  "CRITIC",
  "REVISE",
  "STRUCTURE_REPAIR",
  "CANON_CHECK",
  "QUALITY_GATE",
  "CANDIDATE",
] as const;

export type BrowserFabricNodeKind = (typeof BROWSER_FABRIC_NODE_KINDS)[number];
export type BrowserFabricModelTier =
  | "MICRO"
  | "FAST"
  | "BALANCED"
  | "QUALITY"
  | "EXPERIMENTAL";
export type BrowserFabricComputePolicy =
  | "BROWSER_FIRST"
  | "BALANCED"
  | "QUALITY_FIRST"
  | "MANUAL";
export type BrowserFabricNodeStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type BrowserFabricVisibility =
  | "ACTOR"
  | "EVALUATOR"
  | "BOTH"
  | "AUTHOR_ONLY"
  | "FUTURE_REVEAL";

export type BrowserFabricContextItem = {
  id: string;
  kind:
    | "canon"
    | "story-state"
    | "story-bible"
    | "chapter"
    | "retrieval"
    | "accepted-choice"
    | "learning-rule"
    | "user-request";
  text: string;
  digest?: string;
  visibility: BrowserFabricVisibility;
  privacyLevel: ClosedAIPrivacyLevel;
  approved: boolean;
  revision?: number;
  authorityWeight?: number;
  metadata?: Record<string, string | number | boolean | null>;
};

export type BrowserFabricTask = {
  taskId: string;
  taskType: string;
  namespace: ClosedAINamespace;
  objective: string;
  context: BrowserFabricContextItem[];
  privacyLevel: ClosedAIPrivacyLevel;
  computePolicy?: BrowserFabricComputePolicy;
  manualEngineId?: BrowserFabricEngineId;
  allowedModelTiers?: BrowserFabricModelTier[];
  preAuthorizedClosedRefinement?: boolean;
  requiresStructuredOutput?: boolean;
  outputSchema?: Record<string, unknown>;
  expectedOutputTokens?: number;
  regeneration?: {
    previousCandidateDigest: string;
    regenerationNonce: string;
    seed: number;
    cacheBypass: true;
  };
  signal?: AbortSignal;
};

export type BrowserFabricNodeReceipt = {
  nodeId: string;
  taskId: string;
  engineId: BrowserFabricEngineId;
  modelId: string | null;
  modelDigest: string | null;
  inputDigest: string;
  outputDigest: string | null;
  privacyLevel: ClosedAIPrivacyLevel;
  cachePolicy: "bypass" | "read-through" | "write-through" | "none";
  timeoutMs: number;
  estimatedTokens: number;
  actualTokens: number;
  startedAt: string;
  completedAt: string | null;
  status: BrowserFabricNodeStatus;
  retryCount: number;
  failureCode: string | null;
  dataLeftDevice: false;
  canonicalMutationCount: 0;
};

export type BrowserFabricTaskNode = {
  nodeId: string;
  kind: BrowserFabricNodeKind;
  dependsOn: string[];
  engineId: BrowserFabricEngineId;
  modelTier: BrowserFabricModelTier | null;
  modelId: string | null;
  modelDigest: string | null;
  timeoutMs: number;
  cachePolicy: BrowserFabricNodeReceipt["cachePolicy"];
  estimatedTokens: number;
  optional: boolean;
};

export type BrowserFabricExecutionPlan = {
  schemaVersion: typeof BROWSER_SOVEREIGN_FABRIC_VERSION;
  planId: string;
  taskId: string;
  policy: BrowserFabricComputePolicy;
  nodes: BrowserFabricTaskNode[];
  allowedBrowserModelTiers: BrowserFabricModelTier[];
  preAuthorizedClosedRefinement: boolean;
  externalFallbackAllowed: false;
  canonicalMutationAllowed: false;
  createdAt: string;
};

export type BrowserFabricExecutionReceipt = {
  schemaVersion: typeof BROWSER_SOVEREIGN_FABRIC_VERSION;
  receiptId: string;
  planId: string;
  taskId: string;
  taskType: string;
  namespaceDigest: string;
  plannedNodeCount: number;
  completedNodeCount: number;
  nodeReceipts: BrowserFabricNodeReceipt[];
  actualExecutor: BrowserFabricEngineId | null;
  modelId: string | null;
  modelDigest: string | null;
  candidateDigest: string | null;
  candidateOnly: true;
  externalRequest: false;
  dataLeftDevice: false;
  preApprovalMutation: 0;
  rawStoryTextPersisted: false;
  rawPromptPersisted: false;
  rawChainOfThoughtPersisted: false;
  startedAt: string;
  completedAt: string;
  status: "succeeded" | "failed" | "cancelled";
  failureCode: string | null;
};

export type BrowserFabricEngineStatus =
  | "ready"
  | "available_not_installed"
  | "unsupported"
  | "degraded"
  | "experimental_not_qualified"
  | "disabled";

export type BrowserFabricEngineDescriptor = {
  id: BrowserFabricEngineId;
  label: string;
  engineClass: "deterministic" | "semantic" | "generative" | "built-in" | "experimental";
  status: BrowserFabricEngineStatus;
  executionProvider: "js" | "wasm" | "webgpu" | "webnn" | "browser-managed" | null;
  capabilities: string[];
  modelTiers: BrowserFabricModelTier[];
  modelId: string | null;
  modelDigest: string | null;
  languageSupport: string[];
  traditionalChineseGenerationQualified: boolean;
  productionQualified: boolean;
  reasonCode: string;
};

export type BrowserDeviceQualificationProfile = {
  schemaVersion: "browser-device-qualification-v1";
  browser: string;
  browserVersion: string;
  operatingSystem: string;
  mobile: boolean;
  webGpu: boolean;
  webAssembly: boolean;
  worker: boolean;
  indexedDb: boolean;
  opfs: boolean;
  storageQuota: number | null;
  storageAvailable: number | null;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  maxStorageBufferBindingSize: number | null;
  shaderF16: boolean;
  subgroups: boolean;
  timestampQuery: boolean;
  webNn: boolean;
  chromeBuiltinAi: boolean;
  chromeBuiltinLanguages: string[];
  saveData: boolean;
  effectiveConnectionType: string | null;
  qualifiedAt: string;
};

export type BrowserDeviceBenchmarkResult = {
  schemaVersion: "browser-device-benchmark-v1";
  benchmarkId: string;
  profileDigest: string;
  initializationMs: number;
  coldFirstTokenMs: number | null;
  warmFirstTokenMs: number | null;
  prefillTokensPerSecond: number | null;
  decodeTokensPerSecond: number | null;
  structuredOutputSuccess: boolean;
  peakEstimatedMemoryMB: number | null;
  workerCrashCount: number;
  gpuDeviceLostCount: number;
  cacheReopenMs: number;
  measuredAt: string;
  benchmarkPassed: boolean;
  failureCodes: string[];
};

export type BrowserFabricNodeValue = {
  value: unknown;
  actualTokens?: number;
  engineId?: BrowserFabricEngineId;
  modelId?: string | null;
  modelDigest?: string | null;
};

export type BrowserFabricEphemeralState = {
  task: BrowserFabricTask;
  values: Map<BrowserFabricNodeKind, unknown>;
};

export type BrowserFabricNodeHandler = (
  node: BrowserFabricTaskNode,
  state: BrowserFabricEphemeralState,
  signal: AbortSignal,
) => Promise<BrowserFabricNodeValue>;

export type BrowserFabricExecutionResult<TCandidate = unknown> = {
  plan: BrowserFabricExecutionPlan;
  receipt: BrowserFabricExecutionReceipt;
  candidate: TCandidate;
};
