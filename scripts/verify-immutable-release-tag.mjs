import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import manifest from "../release-manifest.json" with { type: "json" };
import contract from "../release-metadata-contract.json" with { type: "json" };

const FULL_COMMIT = /^[0-9a-f]{40}$/u;

function readGit(args, cwd = process.cwd()) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export function verifyImmutableReleasePolicy({
  releaseManifest = manifest,
  releaseContract = contract,
  productCommit,
  checkoutCommit,
}) {
  for (const [field, expected] of Object.entries(releaseContract.immutableReleaseIdentity || {})) {
    if (releaseManifest[field] !== expected) {
      throw Object.assign(new Error(`IMMUTABLE_RELEASE_IDENTITY_MISMATCH:${field}`), {
        code: "IMMUTABLE_RELEASE_IDENTITY_MISMATCH",
      });
    }
  }
  const normalizedProduct = String(productCommit || "").trim().toLowerCase();
  const normalizedCheckout = String(checkoutCommit || "").trim().toLowerCase();
  if (!FULL_COMMIT.test(normalizedProduct) || !FULL_COMMIT.test(normalizedCheckout)) {
    throw Object.assign(new Error("RELEASE_PRODUCT_COMMIT_INVALID"), {
      code: "RELEASE_PRODUCT_COMMIT_INVALID",
    });
  }
  if (normalizedProduct !== normalizedCheckout) {
    throw Object.assign(new Error("RELEASE_PRODUCT_COMMIT_CHECKOUT_MISMATCH"), {
      code: "RELEASE_PRODUCT_COMMIT_CHECKOUT_MISMATCH",
    });
  }
  if (releaseManifest.legacyTagTruth !== "RC6_LEGACY_TAG_WAS_MISSING"
    || releaseContract.legacyTagTruth !== releaseManifest.legacyTagTruth) {
    throw new Error("LEGACY_RELEASE_TAG_TRUTH_MISMATCH");
  }
  return {
    releaseLine: releaseManifest.releaseLine,
    releaseTag: releaseManifest.releaseTag,
    releaseRevision: releaseManifest.releaseRevision,
    productCommit: normalizedProduct,
    legacyTagTruth: releaseManifest.legacyTagTruth,
  };
}

export function verifyAnnotatedRemoteTag({ releaseTag, productCommit, lsRemoteOutput }) {
  const directRef = `refs/tags/${releaseTag}`;
  const peeledRef = `${directRef}^{}`;
  const refs = new Map();
  for (const line of String(lsRemoteOutput || "").split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const [objectId, refName, ...extra] = line.trim().split(/\s+/u);
    if (extra.length || !FULL_COMMIT.test(objectId) || !refName || refs.has(refName)) {
      throw Object.assign(new Error("REMOTE_RELEASE_TAG_RESPONSE_INVALID"), {
        code: "REMOTE_RELEASE_TAG_RESPONSE_INVALID",
      });
    }
    refs.set(refName, objectId.toLowerCase());
  }
  const tagObject = refs.get(directRef);
  const peeledCommit = refs.get(peeledRef);
  if (!tagObject || !peeledCommit || refs.size !== 2 || tagObject === peeledCommit) {
    throw Object.assign(new Error("REMOTE_RELEASE_TAG_NOT_ANNOTATED"), {
      code: "REMOTE_RELEASE_TAG_NOT_ANNOTATED",
    });
  }
  if (peeledCommit !== String(productCommit).toLowerCase()) {
    throw Object.assign(new Error("REMOTE_RELEASE_TAG_COMMIT_MISMATCH"), {
      code: "REMOTE_RELEASE_TAG_COMMIT_MISMATCH",
    });
  }
  return { tagObject, peeledCommit };
}

function tagMessageFromObject(rawTagObject) {
  const source = String(rawTagObject || "");
  const separator = /\r?\n\r?\n/u.exec(source);
  if (!separator) {
    throw Object.assign(new Error("REMOTE_RELEASE_TAG_MESSAGE_MISSING"), {
      code: "REMOTE_RELEASE_TAG_MESSAGE_MISSING",
    });
  }
  return source.slice(separator.index + separator[0].length).trim();
}

export function verifyFetchedAnnotatedTag({
  tagObject,
  peeledCommit,
  fetchedTagObject,
  fetchedPeeledCommit,
  objectType,
  rawTagObject,
  releaseName,
  productCommit,
  releaseRevision,
  architectureStage,
}) {
  if (objectType !== "tag") {
    throw Object.assign(new Error("REMOTE_RELEASE_TAG_OBJECT_TYPE_INVALID"), {
      code: "REMOTE_RELEASE_TAG_OBJECT_TYPE_INVALID",
    });
  }
  if (fetchedTagObject !== tagObject || fetchedPeeledCommit !== peeledCommit) {
    throw Object.assign(new Error("REMOTE_RELEASE_TAG_CHANGED_DURING_VERIFICATION"), {
      code: "REMOTE_RELEASE_TAG_CHANGED_DURING_VERIFICATION",
    });
  }
  const message = tagMessageFromObject(rawTagObject);
  const requiredFields = {
    releaseName,
    productCommit,
    releaseRevision,
    architectureStage,
  };
  for (const [field, value] of Object.entries(requiredFields)) {
    const expected = String(value || "").trim();
    if (!expected || !message.includes(expected)) {
      throw Object.assign(new Error(`REMOTE_RELEASE_TAG_MESSAGE_FIELD_MISSING:${field}`), {
        code: "REMOTE_RELEASE_TAG_MESSAGE_FIELD_MISSING",
      });
    }
  }
  return {
    tagObject,
    peeledCommit,
    messageFieldsVerified: true,
    tagMessageDigest: createHash("sha256").update(message).digest("hex"),
  };
}

export function verifyRemoteImmutableReleaseTag({
  releaseTag,
  productCommit,
  releaseName = manifest.releaseName,
  releaseRevision = manifest.releaseRevision,
  architectureStage = manifest.architectureStage,
  cwd = process.cwd(),
  git = readGit,
}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(String(releaseTag || ""))) {
    throw Object.assign(new Error("REMOTE_RELEASE_TAG_NAME_INVALID"), {
      code: "REMOTE_RELEASE_TAG_NAME_INVALID",
    });
  }
  const remoteArguments = [
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${releaseTag}`,
    `refs/tags/${releaseTag}^{}`,
  ];
  const remote = verifyAnnotatedRemoteTag({
    releaseTag,
    productCommit,
    lsRemoteOutput: git(remoteArguments, cwd),
  });
  const verificationRef = `refs/novel-release-verification/${createHash("sha256")
    .update(`${releaseTag}:${productCommit}`)
    .digest("hex")}`;
  try {
    git([
      "fetch",
      "--no-tags",
      "--force",
      "origin",
      `refs/tags/${releaseTag}:${verificationRef}`,
    ], cwd);
    const inspected = verifyFetchedAnnotatedTag({
      ...remote,
      fetchedTagObject: git(["rev-parse", verificationRef], cwd).toLowerCase(),
      fetchedPeeledCommit: git(["rev-parse", `${verificationRef}^{}`], cwd).toLowerCase(),
      objectType: git(["cat-file", "-t", verificationRef], cwd),
      rawTagObject: git(["cat-file", "-p", verificationRef], cwd),
      releaseName,
      productCommit,
      releaseRevision,
      architectureStage,
    });
    const stableRemote = verifyAnnotatedRemoteTag({
      releaseTag,
      productCommit,
      lsRemoteOutput: git(remoteArguments, cwd),
    });
    if (stableRemote.tagObject !== inspected.tagObject
      || stableRemote.peeledCommit !== inspected.peeledCommit) {
      throw Object.assign(new Error("REMOTE_RELEASE_TAG_CHANGED_DURING_VERIFICATION"), {
        code: "REMOTE_RELEASE_TAG_CHANGED_DURING_VERIFICATION",
      });
    }
    return {
      ...inspected,
      remoteFetchVerified: true,
      remoteStable: true,
    };
  } finally {
    try {
      git(["update-ref", "-d", verificationRef], cwd);
    } catch {
      // Verification refs are best-effort cleanup only and never release evidence.
    }
  }
}

async function readGithubJson(fetcher, url, token) {
  const response = await fetcher(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "novel-rc6.5-immutable-tag-verifier",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response?.ok) {
    try {
      await response?.body?.cancel();
    } catch {
      // The status code is sufficient and response bodies are never evidence.
    }
    throw Object.assign(new Error(`REMOTE_IMMUTABLE_RELEASE_API_FAILED:${response?.status || 0}`), {
      code: "REMOTE_IMMUTABLE_RELEASE_API_FAILED",
    });
  }
  return response.json();
}

export async function verifyImmutableReleaseControlPlane({
  repository,
  releaseTag,
  releaseName,
  productCommit,
  releaseRevision,
  architectureStage,
  token,
  requireRepositorySetting = false,
  fetcher = fetch,
  now = Date.now(),
}) {
  const normalizedRepository = String(repository || "").trim();
  const normalizedToken = String(token || "").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(normalizedRepository)) {
    throw Object.assign(new Error("REMOTE_IMMUTABLE_RELEASE_REPOSITORY_INVALID"), {
      code: "REMOTE_IMMUTABLE_RELEASE_REPOSITORY_INVALID",
    });
  }
  if (!normalizedToken) {
    throw Object.assign(new Error("REMOTE_IMMUTABLE_RELEASE_TOKEN_MISSING"), {
      code: "REMOTE_IMMUTABLE_RELEASE_TOKEN_MISSING",
    });
  }
  const apiRoot = `https://api.github.com/repos/${normalizedRepository}`;
  let settings = null;
  if (requireRepositorySetting) {
    settings = await readGithubJson(fetcher, `${apiRoot}/immutable-releases`, normalizedToken);
    if (settings?.enabled !== true || typeof settings?.enforced_by_owner !== "boolean") {
      throw Object.assign(new Error("REMOTE_IMMUTABLE_RELEASES_NOT_ENABLED"), {
        code: "REMOTE_IMMUTABLE_RELEASES_NOT_ENABLED",
      });
    }
  }
  const release = await readGithubJson(
    fetcher,
    `${apiRoot}/releases/tags/${encodeURIComponent(releaseTag)}`,
    normalizedToken,
  );
  const publishedAt = Date.parse(String(release?.published_at || ""));
  const requiredBodyValues = [releaseName, productCommit, releaseRevision, architectureStage]
    .map((value) => String(value || "").trim());
  if (!Number.isSafeInteger(release?.id)
    || release.id <= 0
    || release?.immutable !== true
    || release?.draft !== false
    || release?.tag_name !== releaseTag
    || release?.name !== releaseName
    || !Number.isFinite(publishedAt)
    || publishedAt > now + 60_000
    || requiredBodyValues.some((value) => !value || !String(release?.body || "").includes(value))) {
    throw Object.assign(new Error("REMOTE_RELEASE_NOT_IMMUTABLE"), {
      code: "REMOTE_RELEASE_NOT_IMMUTABLE",
    });
  }
  const protection = {
    repositoryImmutableReleasesSettingVerified: requireRepositorySetting,
    repositoryImmutableReleasesEnabled: requireRepositorySetting ? true : null,
    enforcedByOwner: requireRepositorySetting ? settings.enforced_by_owner : null,
    immutableReleaseId: release.id,
    immutableReleasePublishedAt: new Date(publishedAt).toISOString(),
    immutableReleaseTag: release.tag_name,
  };
  return {
    ...protection,
    immutableReleaseVerified: true,
    immutableReleaseDigest: createHash("sha256").update(JSON.stringify(protection)).digest("hex"),
  };
}

export async function verifyImmutableRemoteRelease({
  controlPlaneOptions,
  remoteTagOptions,
  controlPlaneVerifier = verifyImmutableReleaseControlPlane,
  remoteTagVerifier = verifyRemoteImmutableReleaseTag,
}) {
  const protection = await controlPlaneVerifier(controlPlaneOptions);
  const remote = remoteTagVerifier(remoteTagOptions);
  return { protection, remote };
}

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`MISSING_ENVIRONMENT:${name}`);
  return value;
}

async function main() {
  const mode = process.argv[2] || "policy";
  const checkoutCommit = readGit(["rev-parse", "HEAD"]);
  const productCommit = requiredEnvironment("EXPECTED_PRODUCT_COMMIT");
  const policy = verifyImmutableReleasePolicy({ productCommit, checkoutCommit });
  if (mode !== "policy" && mode !== "remote") {
    throw new Error(`UNKNOWN_RELEASE_TAG_VERIFICATION_MODE:${mode}`);
  }
  const verifiedRemote = mode === "remote"
    ? await verifyImmutableRemoteRelease({
      controlPlaneOptions: {
        repository: requiredEnvironment("GITHUB_REPOSITORY"),
        releaseTag: policy.releaseTag,
        releaseName: manifest.releaseName,
        productCommit: policy.productCommit,
        releaseRevision: policy.releaseRevision,
        architectureStage: manifest.architectureStage,
        token: requiredEnvironment("GITHUB_TOKEN"),
        requireRepositorySetting:
          /^(?:1|true)$/iu.test(String(process.env.IMMUTABLE_RELEASE_REQUIRE_REPOSITORY_SETTING || "")),
      },
      remoteTagOptions: {
        releaseTag: policy.releaseTag,
        productCommit: policy.productCommit,
      },
    })
    : { protection: null, remote: null };
  const { protection, remote } = verifiedRemote;
  if (process.env.RELEASE_TAG_PROOF_PATH) {
    const core = {
      schemaVersion: "p24b-rc6.5-immutable-release-tag-proof-v1",
      status: "PASS",
      mode,
      releaseLine: policy.releaseLine,
      releaseTag: policy.releaseTag,
      releaseRevision: policy.releaseRevision,
      productCommit: policy.productCommit,
      annotated: Boolean(remote),
      tagObject: remote?.tagObject || null,
      peeledCommit: remote?.peeledCommit || null,
      remoteFetchVerified: remote?.remoteFetchVerified || false,
      remoteStable: remote?.remoteStable || false,
      messageFieldsVerified: remote?.messageFieldsVerified || false,
      tagMessageDigest: remote?.tagMessageDigest || null,
      repositoryImmutableReleasesSettingVerified:
        protection?.repositoryImmutableReleasesSettingVerified || false,
      repositoryImmutableReleasesEnabled:
        protection?.repositoryImmutableReleasesEnabled ?? null,
      immutableReleaseVerified: protection?.immutableReleaseVerified || false,
      immutableReleaseId: protection?.immutableReleaseId || null,
      immutableReleasePublishedAt: protection?.immutableReleasePublishedAt || null,
      immutableReleaseDigest: protection?.immutableReleaseDigest || null,
      legacyTagTruth: policy.legacyTagTruth,
      verifiedAt: new Date().toISOString(),
    };
    const proof = {
      ...core,
      proofDigest: createHash("sha256").update(JSON.stringify(core)).digest("hex"),
    };
    writeFileSync(process.env.RELEASE_TAG_PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({
    status: "PASS",
    mode,
    releaseLine: policy.releaseLine,
    releaseTag: policy.releaseTag,
    releaseRevision: policy.releaseRevision,
    productCommit: policy.productCommit,
    legacyTagTruth: policy.legacyTagTruth,
    remoteAnnotated: Boolean(remote),
    remoteFetchVerified: remote?.remoteFetchVerified || false,
    messageFieldsVerified: remote?.messageFieldsVerified || false,
    repositoryImmutableReleasesSettingVerified:
      protection?.repositoryImmutableReleasesSettingVerified || false,
    repositoryImmutableReleasesEnabled:
      protection?.repositoryImmutableReleasesEnabled ?? null,
    immutableReleaseVerified: protection?.immutableReleaseVerified || false,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "immutable_release_tag_verification_failed",
      errorCode: String(error?.code || error?.message || "UNKNOWN_RELEASE_TAG_ERROR"),
    }));
    process.exitCode = 1;
  });
}
