import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import releaseManifest from "../release-manifest.json" with { type: "json" };
import releaseContract from "../release-metadata-contract.json" with { type: "json" };

const FULL_COMMIT = /^[0-9a-f]{40}$/i;

function readGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function resolveBuildCommit({ env = process.env, cwd = process.cwd(), git = readGit } = {}) {
  const candidates = [
    ["vercel_git_commit_sha", env.VERCEL_GIT_COMMIT_SHA],
    ["explicit_build_commit", env.NOVEL_BUILD_APP_COMMIT],
  ];
  for (const [source, value] of candidates) {
    if (!value) continue;
    const commit = String(value).trim();
    if (!FULL_COMMIT.test(commit)) throw new Error(`INVALID_BUILD_COMMIT:${source}`);
    return { appCommit: commit.toLowerCase(), source };
  }
  try {
    const commit = git(["rev-parse", "HEAD"], cwd);
    if (!FULL_COMMIT.test(commit)) throw new Error("INVALID_BUILD_COMMIT:git_head");
    return { appCommit: commit.toLowerCase(), source: "git_head" };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("INVALID_BUILD_COMMIT")) throw error;
    throw new Error("BUILD_COMMIT_UNAVAILABLE");
  }
}

function resolveSealedAt({ env, cwd, appCommit, git }) {
  if (env.NOVEL_BUILD_SEALED_AT) {
    const explicit = new Date(env.NOVEL_BUILD_SEALED_AT);
    if (Number.isNaN(explicit.getTime())) throw new Error("INVALID_BUILD_SEALED_AT");
    return explicit.toISOString();
  }
  try {
    const commitTime = git(["show", "-s", "--format=%cI", appCommit], cwd);
    const parsed = new Date(commitTime);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  } catch {}
  return new Date(releaseManifest.buildTime).toISOString();
}

export function provenancePayload(provenance) {
  return {
    schemaVersion: provenance.schemaVersion,
    appCommit: provenance.appCommit,
    releaseTag: provenance.releaseTag,
    architectureStage: provenance.architectureStage,
    sealedAt: provenance.sealedAt,
    source: provenance.source,
  };
}

export function verifyReleaseProvenance(provenance) {
  const allowedSchemas = releaseContract.allowedProvenanceSchemaVersions
    ?? [releaseContract.provenanceSchemaVersion];
  if (!allowedSchemas.includes(provenance.schemaVersion)) return false;
  if (!releaseContract.allowedProvenanceSources.includes(provenance.source)) return false;
  if (!FULL_COMMIT.test(provenance.appCommit)) return false;
  if (provenance.releaseTag !== releaseManifest.releaseTag) return false;
  if (provenance.architectureStage !== releaseManifest.architectureStage) return false;
  if (provenance.integrity?.algorithm !== releaseContract.provenanceHashAlgorithm) return false;
  const hash = createHash("sha256")
    .update(JSON.stringify(provenancePayload(provenance)), "utf8")
    .digest("hex");
  return hash === provenance.integrity.payloadHash;
}

export function generateReleaseProvenance({
  env = process.env,
  cwd = process.cwd(),
  git = readGit,
  outputPath = "generated/release-provenance.json",
  write = true,
} = {}) {
  const resolved = resolveBuildCommit({ env, cwd, git });
  const payload = {
    schemaVersion: releaseContract.provenanceSchemaVersion,
    appCommit: resolved.appCommit,
    releaseTag: releaseManifest.releaseTag,
    architectureStage: releaseManifest.architectureStage,
    sealedAt: resolveSealedAt({ env, cwd, appCommit: resolved.appCommit, git }),
    source: resolved.source,
  };
  const provenance = {
    ...payload,
    integrity: {
      algorithm: releaseContract.provenanceHashAlgorithm,
      payloadHash: createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex"),
    },
  };
  if (!verifyReleaseProvenance(provenance)) throw new Error("BUILD_PROVENANCE_VALIDATION_FAILED");
  if (write) {
    mkdirSync("generated", { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");
  }
  return provenance;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const provenance = generateReleaseProvenance();
  console.log(JSON.stringify({
    status: "PASS",
    schemaVersion: provenance.schemaVersion,
    appCommit: provenance.appCommit,
    source: provenance.source,
    payloadHash: provenance.integrity.payloadHash,
  }));
}
