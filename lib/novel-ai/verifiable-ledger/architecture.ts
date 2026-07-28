export const BLOCKCHAIN_INSPIRED_VERIFIABLE_ARCHITECTURE = {
  schemaVersion: "blockchain-inspired-verifiable-architecture-v1",
  formalName: "Blockchain-inspired verifiable architecture",
  isBlockchain: false,
  topology: {
    authority: "closed-agent-os",
    computeBackends: [
      "browser-ai",
      "local-ollama",
      "private-ai-hub",
    ],
    oneSharedSystem: true,
    backendNodesMaintainSharedChain: false,
  },
  mechanisms: {
    appendOnlyAuditLog: true,
    hashChain: true,
    merkleTree: true,
    signedApproval: true,
    contentAddressedStorage: true,
    immutableEvidence: true,
    learningCandidateLedger: true,
    versionRollback: true,
    dataLineageTracing: true,
  },
  exclusions: {
    threeBackendVoting: false,
    heavyConsensus: false,
    fullDataReplication: false,
    publicLedger: false,
    perGenerationBlockchainCost: false,
  },
} as const;
