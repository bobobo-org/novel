import type {
  CharacterAgentRun,
  CharacterCanonContext,
  CharacterMemory,
  CharacterPrivateArc,
  CharacterProposalEnvelope,
  CharacterRelationshipEvent,
} from "./types";

export type RevisionBoundCharacterArtifact =
  | CharacterAgentRun
  | CharacterMemory
  | CharacterRelationshipEvent
  | CharacterPrivateArc
  | CharacterProposalEnvelope;

function artifactCanonContextId(artifact: RevisionBoundCharacterArtifact) {
  if ("canonContext" in artifact) return artifact.canonContext.canonContextId;
  return artifact.canonContextId;
}

export function markCharacterArtifactStale<T extends RevisionBoundCharacterArtifact>(
  artifact: T,
  currentCanonContext: CharacterCanonContext,
) {
  if (artifactCanonContextId(artifact) === currentCanonContext.canonContextId) {
    return structuredClone(artifact);
  }
  const stale = {
    ...structuredClone(artifact),
    freshnessStatus: "STALE" as const,
    staleReason: "CANON_CONTEXT_REVISION_CHANGED" as const,
  };
  if ("agentRunId" in stale) return { ...stale, status: "BLOCKED" as const };
  if ("proposalId" in stale && (stale.status === "GENERATED" || stale.status === "REVIEWING")) {
    return { ...stale, status: "CONFLICTED" as const };
  }
  return stale;
}

export function markCharacterArtifactsStale<T extends RevisionBoundCharacterArtifact>(
  artifacts: T[],
  currentCanonContext: CharacterCanonContext,
) {
  return artifacts.map((artifact) => markCharacterArtifactStale(artifact, currentCanonContext));
}
