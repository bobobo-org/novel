import manifest from "@/release-manifest.json";

export const RELEASE_MANIFEST = {
  ...manifest,
  appCommit: process.env.VERCEL_GIT_COMMIT_SHA || "local-development",
};
