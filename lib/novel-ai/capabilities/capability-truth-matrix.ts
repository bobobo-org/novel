export const CAPABILITY_TRUTH_MATRIX_VERSION = "p23-capability-truth-v1" as const;

export type CapabilityTruthStatus =
  | "implemented"
  | "verified"
  | "available"
  | "contract_only"
  | "mock_only"
  | "unsupported"
  | "not_configured"
  | "not_started"
  | "not_implemented"
  | "blocked";

export type CapabilityTruthRecord = {
  id: string;
  status: CapabilityTruthStatus;
  evidence: string[];
  limitations: string[];
};

export const CAPABILITY_TRUTH_MATRIX: CapabilityTruthRecord[] = [
  { id: "knowledge.promptInjectionProtection", status: "verified", evidence: ["p23 security matrix"], limitations: [] },
  { id: "knowledge.taintTracking", status: "verified", evidence: ["p23 taint propagation matrix"], limitations: [] },
  { id: "knowledge.poisoningProtection", status: "verified", evidence: ["p23 poisoning matrix"], limitations: [] },
  { id: "knowledge.parserSandbox", status: "verified", evidence: ["p23 parser policy matrix"], limitations: ["PDF and archive parsing remain isolated adapters"] },
  { id: "model.supplyChain", status: "contract_only", evidence: ["p23 model supply-chain contract"], limitations: ["No model download or activation performed"] },
  { id: "evaluation.layered", status: "verified", evidence: ["p23 layered evaluator matrix"], limitations: [] },
  { id: "browser.aiRuntime", status: "not_configured", evidence: ["browser provider contract"], limitations: ["Requires an installed browser model runtime"] },
  { id: "ollama.localRuntime", status: "implemented", evidence: ["loopback bridge and provider adapter"], limitations: ["Availability depends on the client device"] },
  { id: "privateHub.runtime", status: "contract_only", evidence: ["private hub request contract"], limitations: ["No runtime is connected"] },
  { id: "learning.data", status: "implemented", evidence: ["controlled private learning records"], limitations: ["No shared training without explicit consent"] },
  { id: "training.model", status: "not_started", evidence: ["P2.4A architecture roadmap entry"], limitations: ["No product implementation, training run, model artifact, or callable runtime exists"] },
  { id: "modelTraining", status: "not_started", evidence: ["P2.4A architecture roadmap entry"], limitations: ["No product implementation, training run, model artifact, or callable runtime exists"] },
  { id: "distillation", status: "not_started", evidence: ["P2.4A architecture roadmap entry"], limitations: ["No product implementation, distillation run, model artifact, or callable runtime exists"] },
  { id: "media.storyboard", status: "implemented", evidence: ["story media candidate package"], limitations: ["Candidate only"] },
  { id: "media.videoPrompt", status: "implemented", evidence: ["video prompt package"], limitations: ["Candidate only"] },
  { id: "media.videoGeneration", status: "contract_only", evidence: ["generic video adapter contract"], limitations: ["No video runtime connected"] },
  { id: "externalAI", status: "not_configured", evidence: ["external provider requires explicit consent"], limitations: ["Never selected in closed-only mode"] },
  { id: "characterAgentCore", status: "verified", evidence: ["P2.4B Character Agent core matrix"], limitations: ["Runtime depends on the client environment"] },
  { id: "characterPerspectiveContext", status: "verified", evidence: ["P2.4B actor/evaluator noninterference matrix"], limitations: ["Runtime depends on client storage"] },
  { id: "knowledgeScopedCharacterContext", status: "verified", evidence: ["P2.4B knowledge scope matrix"], limitations: [] },
  { id: "characterBeliefEngine", status: "verified", evidence: ["P2.4B belief boundary matrix"], limitations: [] },
  { id: "characterMemory", status: "verified", evidence: ["P2.4B memory promotion and temporal matrix"], limitations: ["Runtime depends on client storage"] },
  { id: "relationshipGraph", status: "verified", evidence: ["P2.4B directed relationship matrix"], limitations: ["Runtime depends on client storage"] },
  { id: "relationshipHistory", status: "verified", evidence: ["P2.4B relationship idempotency matrix"], limitations: ["Runtime depends on client storage"] },
  { id: "privateCharacterSimulation", status: "verified", evidence: ["P2.4B private simulation isolation matrix"], limitations: ["Candidate only until approval"] },
  { id: "multiCharacterSimulation", status: "verified", evidence: ["P2.4B simulation termination and replay matrix"], limitations: ["True model text is not claimed deterministic"] },
  { id: "characterProposalApproval", status: "verified", evidence: ["P2.4B atomic approval and rollback matrix"], limitations: ["Runtime depends on IndexedDB"] },
];

export function capabilityTruthMatrix() {
  return {
    schemaVersion: CAPABILITY_TRUTH_MATRIX_VERSION,
    capabilities: Object.fromEntries(CAPABILITY_TRUTH_MATRIX.map((row) => [row.id, row])),
  };
}
