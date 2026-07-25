import crypto from "node:crypto";
import { COGNITIVE_PROFILE_SCHEMA_VERSION, type CognitiveProposal, type SovereignCognitiveProfile } from "./types";

function id(prefix: string, value: string) {
  return `${prefix}_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function createSovereignCognitiveProfile(ownerId: string): SovereignCognitiveProfile {
  const now = new Date().toISOString();
  return {
    schemaVersion: COGNITIVE_PROFILE_SCHEMA_VERSION,
    profileId: id("cognitive", ownerId),
    ownerId,
    corePrinciples: [],
    creativePhilosophy: [],
    aestheticPreferences: [],
    genrePreferences: [],
    narrativeBeliefs: [],
    characterBeliefs: [],
    worldviewPatterns: [],
    acceptedIdeas: [],
    rejectedIdeas: [],
    contradictionLog: [],
    beliefRevisionHistory: [],
    confidence: 0,
    evidence: [],
    version: 1,
    parentVersionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function proposeCognitiveRevision(input: Omit<CognitiveProposal, "proposalId" | "status" | "createdAt">): CognitiveProposal {
  if (!input.proposal.trim() || !input.reason.trim() || !input.counterargument.trim() || !input.expectedImpact.trim()) {
    throw Object.assign(new Error("認知提案必須包含理由、反方觀點與影響。"), { code: "COGNITIVE_PROPOSAL_INCOMPLETE" });
  }
  if (!input.evidence.length) throw Object.assign(new Error("認知提案必須附證據。"), { code: "COGNITIVE_PROPOSAL_EVIDENCE_REQUIRED" });
  return {
    ...input,
    proposalId: id("belief_proposal", `${input.profileId}|${input.proposal}|${Date.now()}`),
    confidence: Math.max(0, Math.min(100, input.confidence)),
    status: "proposed",
    createdAt: new Date().toISOString(),
  };
}

export function rejectCognitiveProposal(profile: SovereignCognitiveProfile, proposal: CognitiveProposal) {
  return {
    profile: {
      ...profile,
      rejectedIdeas: [...profile.rejectedIdeas, proposal.proposal],
      beliefRevisionHistory: [...profile.beliefRevisionHistory, { proposalId: proposal.proposalId, action: "rejected" as const, at: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    },
    proposal: { ...proposal, status: "rejected" as const },
  };
}

export function commitCognitiveProposal(input: {
  profile: SovereignCognitiveProfile;
  proposal: CognitiveProposal;
  userApproved: boolean;
}) {
  if (!input.userApproved || input.proposal.status !== "approved") {
    throw Object.assign(new Error("認知提案尚未取得使用者核准。"), { code: "COGNITIVE_USER_APPROVAL_REQUIRED" });
  }
  if (input.profile.profileId !== input.proposal.profileId) {
    throw Object.assign(new Error("認知提案不屬於此檔案。"), { code: "COGNITIVE_PROFILE_MISMATCH" });
  }
  const now = new Date().toISOString();
  const versionId = id("cognitive_version", `${input.profile.profileId}|${input.profile.version}|${input.profile.updatedAt}`);
  const target = input.proposal.target;
  const profile: SovereignCognitiveProfile = {
    ...input.profile,
    [target]: target === "corePrinciples"
      ? [...input.profile.corePrinciples, {
          principleId: id("principle", input.proposal.proposal),
          statement: input.proposal.proposal,
          source: "ai_proposed",
          confidence: input.proposal.confidence,
          evidence: input.proposal.evidence,
          createdAt: now,
        }]
      : [...input.profile[target], input.proposal.proposal],
    acceptedIdeas: [...input.profile.acceptedIdeas, input.proposal.proposal],
    beliefRevisionHistory: [...input.profile.beliefRevisionHistory, { proposalId: input.proposal.proposalId, action: "accepted", at: now }],
    confidence: Math.round((input.profile.confidence + input.proposal.confidence) / 2),
    evidence: [...new Set([...input.profile.evidence, ...input.proposal.evidence])],
    version: input.profile.version + 1,
    parentVersionId: versionId,
    updatedAt: now,
  };
  return { profile, proposal: { ...input.proposal, status: "committed" as const } };
}

export function approveCognitiveProposal(proposal: CognitiveProposal) {
  return { ...proposal, status: "approved" as const };
}

export function compareCognitiveProfiles(from: SovereignCognitiveProfile, to: SovereignCognitiveProfile) {
  return {
    fromVersion: from.version,
    toVersion: to.version,
    addedAcceptedIdeas: to.acceptedIdeas.filter((item) => !from.acceptedIdeas.includes(item)),
    addedRejectedIdeas: to.rejectedIdeas.filter((item) => !from.rejectedIdeas.includes(item)),
  };
}

export function revertCognitiveProfile(current: SovereignCognitiveProfile, target: SovereignCognitiveProfile) {
  if (current.profileId !== target.profileId) throw Object.assign(new Error("不可跨認知檔案回復。"), { code: "COGNITIVE_PROFILE_MISMATCH" });
  return {
    ...structuredClone(target),
    version: current.version + 1,
    parentVersionId: id("cognitive_version", `${current.profileId}|${current.version}|${current.updatedAt}`),
    beliefRevisionHistory: [...target.beliefRevisionHistory, { proposalId: `revert-to-${target.version}`, action: "reverted" as const, at: new Date().toISOString() }],
    updatedAt: new Date().toISOString(),
  };
}
