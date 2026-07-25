export const REASONING_ENGINE_SCHEMA_VERSION = "p23-reasoning-engine-v1" as const;

export const REASONING_AGENT_ROLES = [
  "planner",
  "researcher",
  "story_architect",
  "writer",
  "character_agent",
  "world_agent",
  "continuity_agent",
  "critic",
  "adversarial_reviewer",
  "judge",
] as const;

export type ReasoningAgentRole = typeof REASONING_AGENT_ROLES[number];
export type ReasoningTaskClass = "creative" | "fact" | "analysis" | "research" | "adult_creative" | "high_risk_real_world";

export type SovereignToolDefinition<Input = unknown, Output = unknown> = {
  toolId: string;
  description: string;
  scopes: string[];
  localOnly: boolean;
  projectBound: boolean;
  execute: (input: Input, context: { projectId: string; requestId: string; signal?: AbortSignal }) => Promise<Output>;
};

export type ReasoningEngineInput = {
  requestId: string;
  projectId: string;
  taskClass: ReasoningTaskClass;
  instruction: string;
  contextRefs: string[];
  allowedToolIds: string[];
  permissionScopes: string[];
  maxAgentSteps: number;
  maxCritiqueRounds: 0 | 1;
  timeoutMs: number;
  sourceDocuments?: Array<{
    sourceRef: string;
    revision: string;
    title: string;
    text: string;
  }>;
  signal?: AbortSignal;
};

export type ReasoningEngineOutput = {
  schemaVersion: typeof REASONING_ENGINE_SCHEMA_VERSION;
  requestId: string;
  answer: string;
  keyReasons: string[];
  supportingEvidence: string[];
  majorAlternatives: string[];
  uncertainty: string[];
  limitations: string[];
  confidence: number;
  agentsUsed: ReasoningAgentRole[];
  toolsUsed: string[];
  deliberativePlan: {
    plannerVersion: string;
    hypothesisCount: number;
    verificationGates: string[];
  };
  sourceSynthesis: {
    synthesisVersion: string;
    citationCoverage: number;
    unsupportedFactCount: number;
    contradictionCount: number;
  } | null;
  externalRequestCount: 0;
  rawInternalReasoningExposed: false;
};
