import manifest from "@/release-manifest.json";
import contract from "@/release-metadata-contract.json";

const allowedArchitectureStages = new Set<string>(contract.allowedArchitectureStages);
if (!allowedArchitectureStages.has(manifest.architectureStage)) {
  throw new Error(`Unsupported release architecture stage: ${manifest.architectureStage}`);
}
if (!(new RegExp(contract.releaseTagPattern)).test(manifest.releaseTag)) {
  throw new Error(`Invalid release tag: ${manifest.releaseTag}`);
}

export const RELEASE_METADATA_CONTRACT = contract;

export const RELEASE_MANIFEST = {
  ...manifest,
  appCommit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_COMMIT || "local-development",
};
