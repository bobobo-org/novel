import manifest from "@/release-manifest.json";
import contract from "@/release-metadata-contract.json";
import provenance from "@/generated/release-provenance.json";

export type ReleaseProvenance = {
  schemaVersion: string;
  appCommit: string;
  releaseTag: string;
  architectureStage: string;
  sealedAt: string;
  source: string;
  integrity: {
    algorithm: string;
    payloadHash: string;
  };
};

const allowedArchitectureStages = new Set<string>(contract.allowedArchitectureStages);
if (!allowedArchitectureStages.has(manifest.architectureStage)) {
  throw new Error(`Unsupported release architecture stage: ${manifest.architectureStage}`);
}
if (!(new RegExp(contract.releaseTagPattern)).test(manifest.releaseTag)) {
  throw new Error(`Invalid release tag: ${manifest.releaseTag}`);
}
if (provenance.schemaVersion !== contract.provenanceSchemaVersion) {
  throw new Error(`Unsupported release provenance schema: ${provenance.schemaVersion}`);
}
if (!contract.allowedProvenanceSources.includes(provenance.source)) {
  throw new Error(`Unsupported release provenance source: ${provenance.source}`);
}
if (!/^[0-9a-f]{40}$/i.test(provenance.appCommit)) {
  throw new Error("Release provenance does not contain a full Git commit.");
}
if (provenance.releaseTag !== manifest.releaseTag || provenance.architectureStage !== manifest.architectureStage) {
  throw new Error("Release provenance does not match the release manifest.");
}
if (provenance.integrity.algorithm !== contract.provenanceHashAlgorithm || !/^[0-9a-f]{64}$/i.test(provenance.integrity.payloadHash)) {
  throw new Error("Release provenance integrity metadata is invalid.");
}

export const RELEASE_METADATA_CONTRACT = contract;
export const RELEASE_PROVENANCE = provenance as ReleaseProvenance;

export const RELEASE_MANIFEST = {
  ...manifest,
  appCommit: provenance.appCommit,
  commitProvenanceSource: "build_sealed",
  commitProvenanceStatus: "verified",
  commitProvenanceSchemaVersion: provenance.schemaVersion,
  commitProvenanceHash: provenance.integrity.payloadHash,
};
