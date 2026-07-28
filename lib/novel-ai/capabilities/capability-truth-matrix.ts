export const CAPABILITY_TRUTH_MATRIX_VERSION = "closed-agent-os-capability-truth-v4" as const;

export type CapabilityTruthStatus =
  | "implemented"
  | "verified"
  | "available"
  | "contract_only"
  | "mock_only"
  | "unsupported"
  | "not_configured"
  | "started"
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
  { id: "model.supplyChain", status: "verified", evidence: ["SmolLM2 immutable commit hash", "teacher model and license digests", "local-only candidate artifact"], limitations: ["The LoRA candidate is not activated, merged, promoted, or shared"] },
  { id: "evaluation.layered", status: "verified", evidence: ["p23 layered evaluator matrix"], limitations: [] },
  { id: "browser.aiRuntime", status: "available", evidence: ["Chrome built-in Summarizer capability probe", "packaged extractive model with immutable digest", "fixed-input inference proof"], limitations: ["Chrome Summarizer remains device-dependent; the packaged fallback is an extractive light-task model, not a generative LLM"] },
  { id: "ollama.localRuntime", status: "implemented", evidence: ["paired loopback bridge", "authenticated fixed-input model verification", "streaming generation and cancellation"], limitations: ["Availability depends on the client device, Ollama process, installed model and in-memory pairing"] },
  { id: "privateHub.runtime", status: "implemented", evidence: ["self-hosted loopback private node", "independent pairing and work queue", "real model verification and streaming transport"], limitations: ["The private node must be running and paired on the client device; no remote cloud hub is claimed"] },
  { id: "closedAgentOS.sharedKernel", status: "verified", evidence: ["three-backend unified OS matrix", "Studio closed AI command center"], limitations: ["Backend availability remains runtime-dependent"] },
  { id: "closedAgentOS.noSilentFallback", status: "verified", evidence: ["backend lock and outage matrix"], limitations: ["A failed locked backend requires an explicit new request"] },
  { id: "closedAgentOS.permissionGateway", status: "verified", evidence: ["role scope and forbidden tool matrix"], limitations: ["Agents receive registered project-bound tools only"] },
  { id: "aiCache.sixLayer", status: "verified", evidence: ["exact, semantic, retrieval, plan, tool and model-session cache matrix", "runtime persistence test across all six layers"], limitations: ["Ollama owns its in-memory KV implementation; the application persists only runtime-handle metadata"] },
  { id: "aiCache.namespaceIsolation", status: "verified", evidence: ["fourteen-field namespace and targeted invalidation matrix", "role, privacy, revision and model-switch contamination tests"], limitations: [] },
  { id: "aiCache.runtimePersistence", status: "verified", evidence: ["Browser IndexedDB/OPFS split", "Local Ollama SQLite reopen proof", "Private Hub AES-256-GCM ciphertext and restart proof"], limitations: ["Each persistence adapter is available only when its corresponding browser or local runtime is active"] },
  { id: "aiCache.authorityBoundary", status: "verified", evidence: ["cache_candidate_only authority record", "zero Memory, Learning and Canon mutation counters", "signed approval transaction gate"], limitations: [] },
  { id: "learning.controlledOS", status: "verified", evidence: ["controlled-learning-os-v2 runtime suite", "consent, privacy filter, outcome labeling, evaluator, candidate, signed approval, A/B, version and rollback matrix"], limitations: ["L0/L1 are the active boundary; all adoption remains explicit and reversible"] },
  { id: "learning.signalPipeline", status: "verified", evidence: ["fourteen eligible outcome classes", "user edit and regenerated-choice tests", "negative-label-only abandoned content test"], limitations: ["Signals store digests and bounded metadata, never raw prompts, outputs, or chain-of-thought"] },
  { id: "learning.runtimePolicyApplication", status: "verified", evidence: ["router, planner, cache threshold/TTL, retrieval facet ranking, tool ordering and model-context policy tests"], limitations: ["An adopted policy guides the selected local/private model; it does not alter model weights"] },
  { id: "learning.signedApprovalTransaction", status: "verified", evidence: ["ECDSA approval block membership and full-ledger verification", "forged transaction rejection", "candidate/dataset/version integrity checks"], limitations: ["The verifiable ledger is local and blockchain-inspired, not a public consensus network"] },
  { id: "learning.l2l3Gate", status: "verified", evidence: ["automatic adapter-weight, private-model-training and distillation fail-closed tests", "separate operator-authorized training runtime"], limitations: ["A real LoRA candidate now exists, but activation and automatic adoption remain fail-closed"] },
  { id: "ledger.verifiable", status: "verified", evidence: ["verifiable architecture v2 matrix", "append-only hash chain, Merkle inclusion proof, ECDSA approval and scoped content-address verification"], limitations: ["Blockchain-inspired local/private evidence; not a blockchain or public consensus network"] },
  { id: "ledger.immutableEvidence", status: "verified", evidence: ["independently signed evidence bundle", "evidence digest, block hash, Merkle and signature tamper rejection"], limitations: ["Immutable means tampering is detectable; local storage is not claimed to be physically undeletable"] },
  { id: "ledger.dataLineage", status: "verified", evidence: ["same-ledger parent validation", "explicit rollback target", "queryable lineage trace and cross-ledger rejection"], limitations: ["Lineage records digests and identifiers, not raw private content"] },
  { id: "ledger.scopedContentAddressing", status: "verified", evidence: ["tenant/project namespace-bound CAS locator", "same-content cross-project isolation and retained-content rehash verification"], limitations: ["Retained content remains local and is omitted from evidence exports"] },
  { id: "ledger.noConsensusOrReplication", status: "verified", evidence: ["one Agent OS / three compute backend topology contract", "voting, consensus, public ledger, full replication and per-generation chain cost all disabled"], limitations: ["The three AI backends execute work; they are not ledger-maintaining blockchain nodes"] },
  { id: "learning.data", status: "implemented", evidence: ["controlled private learning records"], limitations: ["No shared training without explicit consent"] },
  { id: "learning.narrativeRuleAbstraction", status: "implemented", evidence: ["closed-ai sovereign learning service", "deterministic narrative DNA extraction", "local closed-AI deep extraction adapter"], limitations: ["Deep extraction requires an available local closed-AI runtime"] },
  { id: "learning.approvedRuleRag", status: "implemented", evidence: ["approved-rule context composer", "Studio closed generation integration"], limitations: ["Updates prompt/RAG behavior; it does not claim model-weight training"] },
  { id: "learning.preferenceFeedback", status: "implemented", evidence: ["accepted/edited/rejected local feedback profile"], limitations: ["Raw generated output is not retained"] },
  { id: "learning.sourceGovernance", status: "verified", evidence: ["rights gate", "prompt-injection quarantine", "credential block", "source revocation"], limitations: ["The user remains responsible for confirming source rights"] },
  { id: "learning.originalityGuard", status: "implemented", evidence: ["non-reversible source fingerprint overlap gate"], limitations: ["Fingerprint comparison is a safety signal, not a legal originality determination"] },
  { id: "learning.ruleCombinationEngine", status: "implemented", evidence: ["dimension-aware recipe generator and combination-space estimator"], limitations: ["Samples useful combinations instead of exhaustively enumerating an unbounded space"] },
  { id: "training.offlinePreferenceModel", status: "implemented", evidence: ["pairwise logistic gradient-descent trainer", "immutable artifact digest", "activation and rollback pointer", "Private Hub prompt adapter"], limitations: ["This trains an interpretable style preference adapter; it is not LoRA/QLoRA or an LLM weight update"] },
  { id: "training.model", status: "started", evidence: ["closed-ai-20260728T214010Z-4b4cf91d", "full-weight digest changed after one optimizer step", "LoRA checkpoint and inference proof"], limitations: ["Full-weight work is a pipeline qualification smoke; only the LoRA candidate checkpoint is persisted"] },
  { id: "training.lora", status: "verified", evidence: ["230400 trainable parameters updated", "two optimizer steps", "adapter digest 31d13501e0f0e28082060b196c313f1a205e08bbe63164068ab589b85b09835f", "post-training inference proof"], limitations: ["Candidate only; activation, merge, promotion and sharing require separate approval"] },
  { id: "training.qlora", status: "blocked", evidence: ["hardware probe: CUDA unavailable, Intel UHD 730"], limitations: ["QLoRA is not started on this device and cannot be relabeled as CPU LoRA"] },
  { id: "modelTraining", status: "started", evidence: ["verifiable full-weight smoke", "real PEFT LoRA candidate", "append-only training hash chain"], limitations: ["Program started; no model is automatically activated or promoted"] },
  { id: "distillation", status: "started", evidence: ["local qwen2.5:3b teacher", "four verified synthetic demonstrations", "sequence-level distillation dataset digest", "student LoRA candidate"], limitations: ["Synthetic dataset only; no private user content or cross-user data was used"] },
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
