export const CAPABILITY_TRUTH_MATRIX_VERSION = "closed-agent-os-capability-truth-v1" as const;

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
  { id: "browser.aiRuntime", status: "available", evidence: ["Chrome built-in Summarizer capability probe", "fixed-input inference proof"], limitations: ["Availability and model download state depend on the client device"] },
  { id: "ollama.localRuntime", status: "implemented", evidence: ["paired loopback bridge", "authenticated fixed-input model verification", "streaming generation and cancellation"], limitations: ["Availability depends on the client device, Ollama process, installed model and in-memory pairing"] },
  { id: "privateHub.runtime", status: "implemented", evidence: ["self-hosted loopback private node", "independent pairing and work queue", "real model verification and streaming transport"], limitations: ["The private node must be running and paired on the client device; no remote cloud hub is claimed"] },
  { id: "closedAgentOS.sharedKernel", status: "verified", evidence: ["three-backend unified OS matrix", "Studio closed AI command center"], limitations: ["Backend availability remains runtime-dependent"] },
  { id: "closedAgentOS.noSilentFallback", status: "verified", evidence: ["backend lock and outage matrix"], limitations: ["A failed locked backend requires an explicit new request"] },
  { id: "closedAgentOS.permissionGateway", status: "verified", evidence: ["role scope and forbidden tool matrix"], limitations: ["Agents receive registered project-bound tools only"] },
  { id: "aiCache.sixLayer", status: "verified", evidence: ["exact, semantic, retrieval, plan, tool and model-session cache matrix"], limitations: ["Model KV reuse requires support from the selected runtime"] },
  { id: "aiCache.namespaceIsolation", status: "verified", evidence: ["fourteen-field namespace and targeted invalidation matrix"], limitations: [] },
  { id: "learning.controlledOS", status: "verified", evidence: ["consent, privacy filter, evaluator, approval, A/B, version and rollback matrix"], limitations: ["L0/L1 remain the automatic boundary; preference model training and activation require explicit user actions"] },
  { id: "ledger.verifiable", status: "verified", evidence: ["append-only hash-chain, Merkle, ECDSA and content-address matrix"], limitations: ["Blockchain-inspired local evidence; not a public blockchain"] },
  { id: "learning.data", status: "implemented", evidence: ["controlled private learning records"], limitations: ["No shared training without explicit consent"] },
  { id: "learning.narrativeRuleAbstraction", status: "implemented", evidence: ["closed-ai sovereign learning service", "deterministic narrative DNA extraction", "local closed-AI deep extraction adapter"], limitations: ["Deep extraction requires an available local closed-AI runtime"] },
  { id: "learning.approvedRuleRag", status: "implemented", evidence: ["approved-rule context composer", "Studio closed generation integration"], limitations: ["Updates prompt/RAG behavior; it does not claim model-weight training"] },
  { id: "learning.preferenceFeedback", status: "implemented", evidence: ["accepted/edited/rejected local feedback profile"], limitations: ["Raw generated output is not retained"] },
  { id: "learning.sourceGovernance", status: "verified", evidence: ["rights gate", "prompt-injection quarantine", "credential block", "source revocation"], limitations: ["The user remains responsible for confirming source rights"] },
  { id: "learning.originalityGuard", status: "implemented", evidence: ["non-reversible source fingerprint overlap gate"], limitations: ["Fingerprint comparison is a safety signal, not a legal originality determination"] },
  { id: "learning.ruleCombinationEngine", status: "implemented", evidence: ["dimension-aware recipe generator and combination-space estimator"], limitations: ["Samples useful combinations instead of exhaustively enumerating an unbounded space"] },
  { id: "training.offlinePreferenceModel", status: "implemented", evidence: ["pairwise logistic gradient-descent trainer", "immutable artifact digest", "activation and rollback pointer", "Private Hub prompt adapter"], limitations: ["This trains an interpretable style preference adapter; it is not LoRA/QLoRA or an LLM weight update"] },
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
