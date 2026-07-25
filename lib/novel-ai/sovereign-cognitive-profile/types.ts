export const COGNITIVE_PROFILE_SCHEMA_VERSION = "p23-cognitive-profile-v1" as const;

export type CognitivePrincipleSource = "user_defined" | "ai_proposed" | "learned_preference" | "temporary_assumption";

export type CognitivePrinciple = {
  principleId: string;
  statement: string;
  source: CognitivePrincipleSource;
  confidence: number;
  evidence: string[];
  createdAt: string;
};

export type SovereignCognitiveProfile = {
  schemaVersion: typeof COGNITIVE_PROFILE_SCHEMA_VERSION;
  profileId: string;
  ownerId: string;
  corePrinciples: CognitivePrinciple[];
  creativePhilosophy: string[];
  aestheticPreferences: string[];
  genrePreferences: string[];
  narrativeBeliefs: string[];
  characterBeliefs: string[];
  worldviewPatterns: string[];
  acceptedIdeas: string[];
  rejectedIdeas: string[];
  contradictionLog: Array<{ statementA: string; statementB: string; status: "open" | "resolved"; evidence: string[] }>;
  beliefRevisionHistory: Array<{ proposalId: string; action: "accepted" | "rejected" | "reverted"; at: string }>;
  confidence: number;
  evidence: string[];
  version: number;
  parentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CognitiveProposal = {
  proposalId: string;
  profileId: string;
  proposal: string;
  reason: string;
  evidence: string[];
  counterargument: string;
  expectedImpact: string;
  confidence: number;
  target: "corePrinciples" | "creativePhilosophy" | "aestheticPreferences" | "genrePreferences" | "narrativeBeliefs" | "characterBeliefs" | "worldviewPatterns";
  status: "proposed" | "approved" | "rejected" | "committed";
  createdAt: string;
};
