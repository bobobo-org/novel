import type { CanonicalLayer } from "./canon-layers";
import type { DramaProjectionPackage } from "./types";

export const PROPOSAL_ENVELOPE_SCHEMA_VERSION = "shared-proposal-envelope-v1" as const;

export type ProposalStatus =
  | "GENERATED"
  | "REVIEWING"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "CONFLICTED";

export type ProposalType =
  | "DRAMA_EPISODE"
  | "DRAMA_SCENE"
  | "DRAMA_BEAT"
  | "DRAMA_BRANCH"
  | "DRAMA_DIALOGUE";

export type ProposalEnvelope = {
  proposalId: string;
  proposalType: ProposalType;
  projectId: string;
  sourceRevision: number;
  sourceEntityIds: string[];
  generatedPayload: unknown;
  detectedChanges: string[];
  canonicalImpact: CanonicalLayer[];
  warnings: string[];
  status: ProposalStatus;
  createdAt: string;
};

function proposalStatus(result: DramaProjectionPackage): ProposalStatus {
  return result.project.status === "stale" ? "EXPIRED" : "GENERATED";
}

function canonicalImpact(result: DramaProjectionPackage): CanonicalLayer[] {
  return result.project.status === "private_simulation"
    ? ["PRIVATE_SIMULATION"]
    : ["DRAMA_ADAPTATION_CANON"];
}

export function mapDramaProjectionToProposalEnvelopes(
  result: DramaProjectionPackage,
): ProposalEnvelope[] {
  const status = proposalStatus(result);
  const impact = canonicalImpact(result);
  const base = {
    projectId: result.project.projectId,
    sourceRevision: result.project.sourceStoryRevision,
    canonicalImpact: impact,
    status,
  };
  const episodes: ProposalEnvelope[] = result.episodes.map((episode) => ({
    ...base,
    proposalId: `episode:${episode.episodeId}`,
    proposalType: "DRAMA_EPISODE",
    sourceEntityIds: episode.sourceChapterIds,
    generatedPayload: episode,
    detectedChanges: ["CREATE_DRAMA_EPISODE_CANDIDATE"],
    warnings: episode.continuityConstraints
      .filter((constraint) => constraint.severity !== "info")
      .map((constraint) => constraint.description),
    createdAt: episode.createdAt,
  }));
  const scenes: ProposalEnvelope[] = result.scenes.map((scene) => ({
    ...base,
    proposalId: `scene:${scene.sceneId}`,
    proposalType: "DRAMA_SCENE",
    sourceEntityIds: [...scene.sourceReferences.map((reference) => reference.chapterId), ...scene.participatingCharacterIds],
    generatedPayload: scene,
    detectedChanges: ["CREATE_DRAMA_SCENE_CANDIDATE"],
    warnings: scene.continuityConstraints
      .filter((constraint) => constraint.severity !== "info")
      .map((constraint) => constraint.description),
    createdAt: scene.createdAt,
  }));
  const beats: ProposalEnvelope[] = result.beats.map((beat) => ({
    ...base,
    proposalId: `beat:${beat.beatId}`,
    proposalType: "DRAMA_BEAT",
    sourceEntityIds: beat.sourceReferences.map((reference) => reference.chapterId),
    generatedPayload: beat,
    detectedChanges: ["CREATE_DRAMA_BEAT_CANDIDATE"],
    warnings: [],
    createdAt: beat.createdAt,
  }));
  const branches: ProposalEnvelope[] = result.branchCandidates.map((branch) => ({
    ...base,
    proposalId: `branch:${branch.branchCandidateId}`,
    proposalType: "DRAMA_BRANCH",
    sourceEntityIds: [branch.episodeId],
    generatedPayload: branch,
    detectedChanges: ["CREATE_DRAMA_BRANCH_CANDIDATE"],
    warnings: branch.continuityRisks,
    createdAt: branch.createdAt,
  }));
  const dialogue: ProposalEnvelope[] = result.scenes
    .filter((scene) => scene.dialogueBlocks.length > 0)
    .map((scene) => ({
      ...base,
      proposalId: `dialogue:${scene.sceneId}`,
      proposalType: "DRAMA_DIALOGUE",
      sourceEntityIds: [scene.sceneId, ...scene.participatingCharacterIds],
      generatedPayload: {
        sceneId: scene.sceneId,
        dialogueBlocks: scene.dialogueBlocks,
      },
      detectedChanges: ["ADAPT_DRAMA_DIALOGUE_CANDIDATE"],
      warnings: [],
      createdAt: scene.createdAt,
    }));
  return [...episodes, ...scenes, ...beats, ...branches, ...dialogue];
}
