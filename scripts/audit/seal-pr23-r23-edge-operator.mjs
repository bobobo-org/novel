import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const root = path.resolve(scriptDir, "..", "..");
const defaultOutputDir = path.join(
  root,
  "artifacts",
  "pr23-r23-edge-operator",
);
const repository = "bobobo-org/novel";
const prNumber = "23";
const ghPath = existsSync("C:\\Program Files\\GitHub CLI\\gh.exe")
  ? "C:\\Program Files\\GitHub CLI\\gh.exe"
  : "gh.exe";
const baseline = Object.freeze({
  baseMain: "d0e80323dc68bf08cb541e46c6b9114a71e05cd9",
  protectedPrHead: "6c00673bb3349e49a49f0f5d72cce499c67033d6",
  mergeRef: "169328016111d69e0adab784d817a5653113a852",
  r22AuditCommit: "94ff70847b449e08d53759bad6d0bf3f1ffa530f",
  r22EvidenceTree: "122804d2974df57d0c37eb2f6e2116f281e4eab1",
  r22Manifest:
    "a32e176398ccb55c583138292c3a34acf4c09149e1084ae42386174f0df24561",
  preview: "https://novel-15gi72tr4-lqtechs-projects.vercel.app",
  previewDeployment: "dpl_5G2ggFhtgvLJxB8Q29X94RMoXFxY",
  productionCommit: "d0e80323dc68bf08cb541e46c6b9114a71e05cd9",
  productionDeployment: "dpl_8vdPA2mFkDJUezr5Rfn5MuxqJuBa",
  productionPrimary: "https://novel-orcin.vercel.app",
  productionMirror: "https://novel-lqtechs-projects.vercel.app",
});
const rawFileNames = [
  "console-raw.ndjson",
  "page-errors-raw.ndjson",
  "network-failures-raw.ndjson",
  "http-errors-raw.ndjson",
];
const requiredListeners = [
  "page.console",
  "page.pageerror",
  "page.requestfailed",
  "page.response",
  "context.weberror",
];
const credentialPatterns = [
  ["vercel_personal_token", /\bvcp_[A-Za-z0-9]{20,}\b/gu],
  ["supabase_personal_token", /\bsbp_[A-Za-z0-9]{20,}\b/gu],
  ["github_token", /\bgh[opsu]_[A-Za-z0-9]{20,}\b/gu],
  ["github_fine_grained_token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gu],
  ["openai_style_key", /\bsk-[A-Za-z0-9_-]{20,}\b/gu],
  [
    "authorization_header",
    /\bAuthorization\s*:\s*(?!\[REDACTED_SECRET\])[^\r\n]+/giu,
  ],
  [
    "bearer_value",
    /\bBearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/-]{8,}/giu,
  ],
  [
    "cookie_value",
    /\b(?:set-)?cookie\s*:\s*(?!\[REDACTED_SECRET\])[^\r\n]+/giu,
  ],
  [
    "csrf_value",
    /\bcsrf\s*[:=]\s*(?!\[REDACTED_SECRET\])[^\s,;"']+/giu,
  ],
  ["pairing_or_otp_code", /\b\d{6}\b/gu],
];
const privateStoryFixtures = [
  "林澈",
  "在封閉車站找回失蹤名單",
  "午夜前任何人不得離開舊車站。",
  "末班車停下時，林澈在空月臺拾起一張寫著自己名字的舊票。",
  "依目前已核准內容續寫一個短場景，保留人物目標、世界規則與可驗證後果。",
];

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : fallback;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(
      Buffer.isBuffer(value)
        ? value
        : typeof value === "string"
          ? value
          : JSON.stringify(stable(value)),
    )
    .digest("hex");
}

function normalized(value) {
  return `${String(value).replace(/\r\n?/gu, "\n").replace(/\n*$/u, "")}\n`;
}

function writeJson(outputDir, name, value) {
  writeFileSync(
    path.join(outputDir, name),
    normalized(JSON.stringify(value, null, 2)),
    "utf8",
  );
}

function writeText(outputDir, name, value) {
  writeFileSync(path.join(outputDir, name), normalized(value), "utf8");
}

function readJson(outputDir, name) {
  return JSON.parse(readFileSync(path.join(outputDir, name), "utf8"));
}

function command(executable, args) {
  return execFileSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function git(...args) {
  return command("git.exe", args);
}

function gh(...args) {
  return command(ghPath, args);
}

function safePath(outputDir, filePath) {
  return path.relative(outputDir, filePath).replaceAll("\\", "/");
}

function listFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files.sort();
}

function hashFiles(outputDir, names = rawFileNames) {
  return Object.fromEntries(
    names.map((name) => {
      const target = path.join(outputDir, name);
      return [
        name,
        existsSync(target) ? sha256(readFileSync(target)) : null,
      ];
    }),
  );
}

function collectRawStats(outputDir) {
  const files = {};
  let totalRecords = 0;
  let parseErrorCount = 0;
  for (const name of rawFileNames) {
    const target = path.join(outputDir, name);
    if (!existsSync(target)) {
      files[name] = { exists: false, bytes: 0, records: 0, sha256: null };
      continue;
    }
    const bytes = readFileSync(target);
    const text = bytes.toString("utf8");
    const lines = text.split(/\r?\n/gu).filter((line) => line.trim());
    let validRecords = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
        validRecords += 1;
      } catch {
        parseErrorCount += 1;
      }
    }
    totalRecords += validRecords;
    files[name] = {
      exists: true,
      bytes: bytes.length,
      records: validRecords,
      sha256: sha256(bytes),
    };
  }
  return {
    files,
    allFilesPresent: Object.values(files).every((entry) => entry.exists),
    totalRecords,
    parseErrorCount,
  };
}

function scanEvidence(outputDir) {
  const credentialHits = [];
  const privateStoryHits = [];
  for (const target of listFiles(outputDir)) {
    const relativePath = safePath(outputDir, target);
    if (/evidence-manifest(?:\.sha256)?$/u.test(relativePath)) continue;
    const content = readFileSync(target, "utf8");
    for (const [name, pattern] of credentialPatterns) {
      pattern.lastIndex = 0;
      const matches = content.match(pattern) ?? [];
      if (matches.length > 0) {
        credentialHits.push({
          file: relativePath,
          pattern: name,
          count: matches.length,
        });
      }
    }
    for (const fixture of privateStoryFixtures) {
      if (content.includes(fixture)) {
        privateStoryHits.push({
          file: relativePath,
          fixtureDigest: sha256(fixture),
        });
      }
    }
  }
  return {
    credentialHits,
    credentialHitCount: credentialHits.reduce(
      (sum, row) => sum + row.count,
      0,
    ),
    privateStoryHits,
    privateStoryTextPersisted: privateStoryHits.length > 0,
  };
}

async function fetchSnapshot(url) {
  const response = await fetch(`${url}?gate=${Date.now()}`, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body,
    bodySha256: sha256(text),
    checkedAt: new Date().toISOString(),
  };
}

async function productionSnapshot(alias, role) {
  const [identity, health] = await Promise.all([
    fetchSnapshot(`${alias}/api/release/identity`),
    fetchSnapshot(`${alias}/api/ai/health`),
  ]);
  return {
    schemaVersion: "pr23-r2-3-production-identity-v1",
    status:
      identity.status === 404
      && health.status === 200
      && health.body?.appCommit === baseline.productionCommit
      && health.body?.deploymentId === baseline.productionDeployment
        ? "PASS"
        : "FAIL",
    role,
    alias,
    releaseIdentityEndpoint: {
      path: "/api/release/identity",
      expectedLegacyStatus: 404,
      observedStatus: identity.status,
      cacheControl: identity.cacheControl,
      responseBodySha256: identity.bodySha256,
      checkedAt: identity.checkedAt,
    },
    publicIdentityFallback: {
      path: "/api/ai/health",
      httpStatus: health.status,
      appCommit: health.body?.appCommit ?? null,
      deploymentId: health.body?.deploymentId ?? null,
      releaseTag: health.body?.releaseTag ?? null,
      architectureStage: health.body?.architectureStage ?? null,
      cacheControl: health.cacheControl,
      responseBodySha256: health.bodySha256,
      checkedAt: health.checkedAt,
    },
    productionUnchanged:
      health.body?.appCommit === baseline.productionCommit
      && health.body?.deploymentId === baseline.productionDeployment,
  };
}

async function collectLiveState() {
  const pr = JSON.parse(gh(
    "pr",
    "view",
    prNumber,
    "--repo",
    repository,
    "--json",
    "number,state,isDraft,mergeable,mergeStateStatus,headRefName,headRefOid,baseRefName,baseRefOid,reviewDecision,url",
  ));
  const refs = Object.fromEntries(
    git(
      "ls-remote",
      "origin",
      "refs/heads/main",
      "refs/heads/agent/closed-ai-runtime-truth-r2",
      "refs/pull/23/head",
      "refs/pull/23/merge",
    )
      .split(/\r?\n/gu)
      .filter(Boolean)
      .map((line) => {
        const [oid, ref] = line.trim().split(/\s+/u);
        return [ref, oid];
      }),
  );
  const preview = await fetchSnapshot(
    `${baseline.preview}/api/release/identity`,
  );
  const [productionPrimary, productionMirror] = await Promise.all([
    productionSnapshot(baseline.productionPrimary, "primary"),
    productionSnapshot(baseline.productionMirror, "mirror"),
  ]);
  const r22WorktreeStatus = git(
    "status",
    "--porcelain=v1",
    "--",
    "artifacts/pr23-r22-luna-unblock",
  );
  const r22Tree = git(
    "rev-parse",
    "HEAD:artifacts/pr23-r22-luna-unblock",
  );
  return {
    pr,
    refs,
    preview: {
      status: preview.status,
      appCommit: preview.body?.appCommit ?? null,
      deploymentId: preview.body?.deploymentId ?? null,
      environment: preview.body?.environment ?? null,
      provenanceStatus: preview.body?.provenanceStatus ?? null,
      releaseTag: preview.body?.releaseTag ?? null,
      bodySha256: preview.bodySha256,
      checkedAt: preview.checkedAt,
    },
    productionPrimary,
    productionMirror,
    r22: {
      tree: r22Tree,
      worktreeClean: r22WorktreeStatus === "",
    },
  };
}

function requirement(id, pass, evidence = null) {
  return { id, pass: Boolean(pass), evidence };
}

export function evaluateGate(model) {
  const {
    metadata,
    edgeProfile,
    permission,
    bridge,
    ollama,
    executor,
    canonDiscard,
    canonApproval,
    reloadPersistence,
    abcChoices,
    fullWorkspace,
    backupRestore,
    remoteGate,
    consoleSummary,
    rawStats,
    rawPreserved,
    scan,
    live,
  } = model;
  const metrics = remoteGate?.requiredRuntimeMetrics ?? {};
  const listeners = metadata?.listenersAttached ?? [];
  const listenerSetComplete = requiredListeners.every((name) =>
    listeners.includes(name));
  const zeroRawAllowed =
    rawStats?.totalRecords !== 0
    || (
      metadata?.status === "PASS"
      && metadata?.actualEdgeRunExecuted === true
      && metadata?.actualEdgeFlowCompleted === true
      && metadata?.collectorAttached === true
      && listenerSetComplete
      && edgeProfile?.realInstalledBrowser === true
      && edgeProfile?.userAgentContainsEdge === true
      && consoleSummary?.currentGateCount === 0
    );
  const observedExecutors = executor?.observed ?? [];
  const requirements = [
    requirement("runner_status_pass", metadata?.status === "PASS", metadata?.status),
    requirement(
      "actual_edge_run_executed",
      metadata?.actualEdgeRunExecuted === true,
    ),
    requirement(
      "actual_edge_flow_completed",
      metadata?.actualEdgeFlowCompleted === true,
    ),
    requirement(
      "native_microsoft_edge",
      edgeProfile?.status === "PASS"
      && edgeProfile?.realInstalledBrowser === true
      && edgeProfile?.freshIsolatedProfile === true
      && edgeProfile?.sandboxEnabled === true
      && edgeProfile?.userAgentContainsEdge === true
      && /msedge\.exe$/iu.test(edgeProfile?.executablePath ?? ""),
    ),
    requirement(
      "raw_collectors_attached",
      metadata?.collectorAttached === true && listenerSetComplete,
      listeners,
    ),
    requirement(
      "native_permission_observed",
      permission?.nativePermissionObserved === true
      && Object.values(permission?.after?.states ?? {}).some(
        (state) => state === "granted",
      ),
    ),
    requirement(
      "no_permission_injection_policy_bypass_or_mock",
      permission?.permissionInjectionUsed === false
      && permission?.browserPolicyModified === false
      && permission?.localNetworkAccessBypassUsed === false
      && permission?.mockBrowserUsed === false
      && metadata?.permissionInjectionUsed === false
      && metadata?.localNetworkAccessBypassUsed === false
      && metadata?.mockBrowserUsed === false,
    ),
    requirement(
      "real_local_bridge_and_qwen",
      bridge?.status === "PASS"
      && bridge?.protocolVersion === "novel-local-bridge/v1"
      && bridge?.pairingSecretPersisted === false
      && bridge?.dataLeftDevice === false
      && ollama?.status === "PASS"
      && ollama?.modelId === "qwen2.5:3b"
      && /^[a-f0-9]{64}$/u.test(ollama?.modelDigest ?? "")
      && ollama?.proofState === "inference_verified",
    ),
    requirement(
      "real_generation_local_executor",
      executor?.status === "PASS"
      && observedExecutors.length >= 4
      && observedExecutors.every((value) => value === "local-ollama")
      && metrics.actualExecutor === "local-ollama"
      && metrics.modelId === "qwen2.5:3b"
      && metrics.proofState === "inference_verified"
      && Number(metrics.generatedTokenEvents) > 0
      && Number(metrics.generatePostSuccess) > 0,
    ),
    requirement(
      "no_external_ai_or_data_egress",
      metrics.externalRequest === false
      && metrics.dataLeftDevice === false
      && metrics.silentExternalFallback === false
      && Number(metrics.browserPackagedTaskProseGeneration) === 0
      && Number(metrics.geminiRequestCount) === 0
      && Number(metrics.otherExternalAiRequestCount) === 0
      && Number(remoteGate?.externalAiRequestCount) === 0,
    ),
    requirement(
      "canon_discard_unchanged",
      canonDiscard?.status === "PASS"
      && canonDiscard?.unchanged === true
      && canonDiscard?.preCanonHash === canonDiscard?.postCanonHash,
    ),
    requirement(
      "canon_approval_revision_plus_one",
      canonApproval?.status === "PASS"
      && Number(canonApproval?.revisionAfter)
        === Number(canonApproval?.revisionBefore) + 1
      && canonApproval?.preCanonHash !== canonApproval?.postCanonHash,
    ),
    requirement(
      "reload_persistence",
      reloadPersistence?.status === "PASS"
      && reloadPersistence?.persistent === true
      && reloadPersistence?.expectedCanonHash
        === reloadPersistence?.actualCanonHash,
    ),
    requirement(
      "abc_distinct",
      abcChoices?.status === "PASS"
      && abcChoices?.candidate?.abcEvidence?.choiceCount === 3
      && abcChoices?.candidate?.abcEvidence?.allNonEmpty === true
      && abcChoices?.candidate?.abcEvidence?.materiallyDistinct === true,
    ),
    requirement(
      "full_workspace_approval_reload",
      fullWorkspace?.status === "PASS"
      && fullWorkspace?.reloadPersistent === true
      && fullWorkspace?.postCanonHash === fullWorkspace?.reloadHash
      && Number(fullWorkspace?.revisionAfter)
        === Number(fullWorkspace?.revisionBefore) + 1,
    ),
    requirement(
      "backup_restore_semantic_hash",
      backupRestore?.status === "PASS"
      && backupRestore?.semanticHashMatch === true
      && backupRestore?.semanticHashBeforeBackup
        === backupRestore?.semanticHashAfterRestore,
    ),
    requirement(
      "canon_safety_counters_zero",
      Number(metrics.canonicalMutationBeforeApproval) === 0
      && Number(metrics.duplicateApproval) === 0
      && Number(metrics.staleRevisionAccepted) === 0,
    ),
    requirement(
      "console_fully_classified_without_blockers",
      consoleSummary?.status === "SEALED"
      && consoleSummary?.pass === true
      && Number(consoleSummary?.currentGateCount) === 0
      && Number(consoleSummary?.productErrorCount) === 0
      && Number(consoleSummary?.securityErrorCount) === 0
      && Number(consoleSummary?.unclassifiedCount) === 0
      && Number(consoleSummary?.blockingCount) === 0,
    ),
    requirement(
      "raw_files_present_and_parseable",
      rawStats?.allFilesPresent === true
      && Number(rawStats?.parseErrorCount) === 0
      && Number(rawStats?.totalRecords)
        === Number(consoleSummary?.rawRecordCount),
    ),
    requirement("zero_raw_records_rule", zeroRawAllowed),
    requirement("raw_evidence_preserved", rawPreserved === true),
    requirement(
      "credential_free",
      Number(scan?.credentialHitCount) === 0,
      scan?.credentialHits ?? [],
    ),
    requirement(
      "private_story_text_not_persisted",
      scan?.privateStoryTextPersisted === false,
    ),
    requirement(
      "preview_identity_frozen",
      live?.preview?.status === 200
      && live?.preview?.appCommit === baseline.mergeRef
      && live?.preview?.deploymentId === baseline.previewDeployment
      && live?.preview?.environment === "preview"
      && live?.preview?.provenanceStatus === "verified",
    ),
    requirement(
      "pr_head_unchanged_and_unmerged",
      live?.pr?.state === "OPEN"
      && live?.pr?.headRefOid === baseline.protectedPrHead
      && live?.pr?.baseRefOid === baseline.baseMain
      && live?.refs?.["refs/pull/23/head"] === baseline.protectedPrHead
      && live?.refs?.["refs/pull/23/merge"] === baseline.mergeRef
      && live?.refs?.["refs/heads/agent/closed-ai-runtime-truth-r2"]
        === baseline.protectedPrHead
      && live?.refs?.["refs/heads/main"] === baseline.baseMain,
    ),
    requirement(
      "production_unchanged",
      live?.productionPrimary?.status === "PASS"
      && live?.productionMirror?.status === "PASS"
      && live?.productionPrimary?.productionUnchanged === true
      && live?.productionMirror?.productionUnchanged === true,
    ),
    requirement(
      "r22_evidence_immutable",
      live?.r22?.tree === baseline.r22EvidenceTree
      && live?.r22?.worktreeClean === true,
    ),
  ];

  const blocked = metadata?.status === "EDGE_ENVIRONMENT_BLOCKED";
  const pass = requirements.every((row) => row.pass);
  return {
    verdict: blocked
      ? "PR23_R2_3_EDGE_OPERATOR_GATE_BLOCKED"
      : pass
        ? "PR23_R2_3_EDGE_OPERATOR_GATE_PASS"
        : "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
    pass,
    blocked,
    requirements,
    failures: requirements.filter((row) => !row.pass).map((row) => row.id),
  };
}

function loadModel(outputDir, rawPreserved, scan, live) {
  return {
    metadata: readJson(outputDir, "edge-run-metadata.json"),
    edgeProfile: readJson(outputDir, "edge-profile.json"),
    permission: readJson(outputDir, "local-network-permission.json"),
    bridge: readJson(outputDir, "local-bridge-runtime.json"),
    ollama: readJson(outputDir, "local-ollama-execution.json"),
    executor: readJson(outputDir, "actual-executor.json"),
    canonDiscard: readJson(outputDir, "canon-discard.json"),
    canonApproval: readJson(outputDir, "canon-approval.json"),
    reloadPersistence: readJson(outputDir, "reload-persistence.json"),
    abcChoices: readJson(outputDir, "abc-choices.json"),
    fullWorkspace: readJson(outputDir, "full-workspace.json"),
    backupRestore: readJson(outputDir, "backup-restore.json"),
    remoteGate: readJson(outputDir, "remote-preview-gate-v3.json"),
    consoleSummary: readJson(outputDir, "console-summary.json"),
    rawStats: collectRawStats(outputDir),
    rawPreserved,
    scan,
    live,
  };
}

function makePassModel() {
  const digest = "a".repeat(64);
  const candidate = {
    abcEvidence: {
      choiceCount: 3,
      allNonEmpty: true,
      materiallyDistinct: true,
    },
  };
  return {
    metadata: {
      status: "PASS",
      actualEdgeRunExecuted: true,
      actualEdgeFlowCompleted: true,
      collectorAttached: true,
      listenersAttached: [...requiredListeners],
      permissionInjectionUsed: false,
      localNetworkAccessBypassUsed: false,
      mockBrowserUsed: false,
    },
    edgeProfile: {
      status: "PASS",
      realInstalledBrowser: true,
      freshIsolatedProfile: true,
      sandboxEnabled: true,
      userAgentContainsEdge: true,
      executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    },
    permission: {
      nativePermissionObserved: true,
      after: { states: { "local-network-access": "granted" } },
      permissionInjectionUsed: false,
      browserPolicyModified: false,
      localNetworkAccessBypassUsed: false,
      mockBrowserUsed: false,
    },
    bridge: {
      status: "PASS",
      protocolVersion: "novel-local-bridge/v1",
      pairingSecretPersisted: false,
      dataLeftDevice: false,
    },
    ollama: {
      status: "PASS",
      modelId: "qwen2.5:3b",
      modelDigest: digest,
      proofState: "inference_verified",
    },
    executor: {
      status: "PASS",
      observed: Array(4).fill("local-ollama"),
    },
    canonDiscard: {
      status: "PASS",
      unchanged: true,
      preCanonHash: digest,
      postCanonHash: digest,
    },
    canonApproval: {
      status: "PASS",
      revisionBefore: 1,
      revisionAfter: 2,
      preCanonHash: digest,
      postCanonHash: "b".repeat(64),
    },
    reloadPersistence: {
      status: "PASS",
      persistent: true,
      expectedCanonHash: digest,
      actualCanonHash: digest,
    },
    abcChoices: { status: "PASS", candidate },
    fullWorkspace: {
      status: "PASS",
      reloadPersistent: true,
      postCanonHash: digest,
      reloadHash: digest,
      revisionBefore: 2,
      revisionAfter: 3,
    },
    backupRestore: {
      status: "PASS",
      semanticHashMatch: true,
      semanticHashBeforeBackup: digest,
      semanticHashAfterRestore: digest,
    },
    remoteGate: {
      externalAiRequestCount: 0,
      requiredRuntimeMetrics: {
        actualExecutor: "local-ollama",
        modelId: "qwen2.5:3b",
        proofState: "inference_verified",
        generatedTokenEvents: 10,
        generatePostSuccess: 4,
        externalRequest: false,
        dataLeftDevice: false,
        silentExternalFallback: false,
        canonicalMutationBeforeApproval: 0,
        duplicateApproval: 0,
        staleRevisionAccepted: 0,
        browserPackagedTaskProseGeneration: 0,
        geminiRequestCount: 0,
        otherExternalAiRequestCount: 0,
      },
    },
    consoleSummary: {
      status: "SEALED",
      pass: true,
      currentGateCount: 0,
      productErrorCount: 0,
      securityErrorCount: 0,
      unclassifiedCount: 0,
      blockingCount: 0,
      rawRecordCount: 0,
    },
    rawStats: {
      allFilesPresent: true,
      parseErrorCount: 0,
      totalRecords: 0,
    },
    rawPreserved: true,
    scan: {
      credentialHitCount: 0,
      credentialHits: [],
      privateStoryTextPersisted: false,
    },
    live: {
      preview: {
        status: 200,
        appCommit: baseline.mergeRef,
        deploymentId: baseline.previewDeployment,
        environment: "preview",
        provenanceStatus: "verified",
      },
      pr: {
        state: "OPEN",
        headRefOid: baseline.protectedPrHead,
        baseRefOid: baseline.baseMain,
      },
      refs: {
        "refs/pull/23/head": baseline.protectedPrHead,
        "refs/pull/23/merge": baseline.mergeRef,
        "refs/heads/agent/closed-ai-runtime-truth-r2":
          baseline.protectedPrHead,
        "refs/heads/main": baseline.baseMain,
      },
      productionPrimary: { status: "PASS", productionUnchanged: true },
      productionMirror: { status: "PASS", productionUnchanged: true },
      r22: { tree: baseline.r22EvidenceTree, worktreeClean: true },
    },
  };
}

function runSelfTest() {
  const tests = [];
  const run = (name, mutate, expected) => {
    const model = structuredClone(makePassModel());
    mutate(model);
    const result = evaluateGate(model);
    assert.equal(result.verdict, expected, name);
    tests.push({ name, verdict: result.verdict });
  };
  run("pass_metadata_can_pass", () => {}, "PR23_R2_3_EDGE_OPERATOR_GATE_PASS");
  run(
    "blocked_does_not_become_pass",
    (model) => {
      model.metadata.status = "EDGE_ENVIRONMENT_BLOCKED";
      model.metadata.actualEdgeRunExecuted = false;
      model.metadata.actualEdgeFlowCompleted = false;
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_BLOCKED",
  );
  run(
    "fail_does_not_become_pass",
    (model) => {
      model.metadata.status = "FAIL";
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
  );
  run(
    "r22_evidence_change_blocks",
    (model) => {
      model.live.r22.tree = "b".repeat(40);
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
  );
  run(
    "raw_mutation_blocks",
    (model) => {
      model.rawPreserved = false;
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
  );
  run(
    "zero_raw_valid_when_full_run_and_collectors_proven",
    () => {},
    "PR23_R2_3_EDGE_OPERATOR_GATE_PASS",
  );
  run(
    "zero_raw_invalid_without_collector",
    (model) => {
      model.metadata.collectorAttached = false;
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
  );
  for (const [name, key] of [
    ["product_error_blocks", "productErrorCount"],
    ["security_error_blocks", "securityErrorCount"],
    ["unclassified_blocks", "unclassifiedCount"],
  ]) {
    run(
      name,
      (model) => {
        model.consoleSummary[key] = 1;
        model.consoleSummary.blockingCount = 1;
        model.consoleSummary.pass = false;
      },
      "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
    );
  }
  run(
    "external_ai_blocks",
    (model) => {
      model.remoteGate.requiredRuntimeMetrics.silentExternalFallback = true;
      model.remoteGate.externalAiRequestCount = 1;
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
  );
  run(
    "data_egress_blocks",
    (model) => {
      model.remoteGate.requiredRuntimeMetrics.dataLeftDevice = true;
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
  );
  run(
    "pr_identity_change_blocks",
    (model) => {
      model.live.pr.headRefOid = "c".repeat(40);
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
  );
  run(
    "production_identity_change_blocks",
    (model) => {
      model.live.productionMirror.productionUnchanged = false;
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
  );
  run(
    "credential_hit_blocks",
    (model) => {
      model.scan.credentialHitCount = 1;
      model.scan.credentialHits = [{ file: "raw", pattern: "token", count: 1 }];
    },
    "PR23_R2_3_EDGE_OPERATOR_GATE_FAILED",
  );
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    suite: "pr23-r23-pass-capable-sealer",
    testCount: tests.length,
    tests,
  })}\n`);
}

async function main() {
  const outputDir = path.resolve(option("--output-dir", defaultOutputDir));
  assert.equal(outputDir, defaultOutputDir, "R23_OUTPUT_DIR_MUST_BE_DEDICATED");
  const rawBefore = hashFiles(outputDir);
  const live = await collectLiveState();
  writeJson(outputDir, "audit-baseline.json", {
    schemaVersion: "pr23-r2-3-audit-baseline-v1",
    capturedAt: new Date().toISOString(),
    ...baseline,
  });
  writeJson(outputDir, "pr-head-verification.json", {
    schemaVersion: "pr23-r2-3-pr-head-verification-v1",
    status:
      live.pr.state === "OPEN"
      && live.pr.headRefOid === baseline.protectedPrHead
        ? "PASS"
        : "FAIL",
    ...live.pr,
    refs: live.refs,
  });
  writeJson(outputDir, "preview-release-identity.json", {
    schemaVersion: "pr23-r2-3-preview-release-identity-v1",
    status:
      live.preview.status === 200
      && live.preview.appCommit === baseline.mergeRef
      && live.preview.deploymentId === baseline.previewDeployment
        ? "PASS"
        : "FAIL",
    url: baseline.preview,
    ...live.preview,
  });
  writeJson(
    outputDir,
    "production-primary-identity.json",
    live.productionPrimary,
  );
  writeJson(
    outputDir,
    "production-mirror-identity.json",
    live.productionMirror,
  );
  const rawAfterIdentity = hashFiles(outputDir);
  const rawPreserved =
    JSON.stringify(rawBefore) === JSON.stringify(rawAfterIdentity);
  const scan = scanEvidence(outputDir);
  writeJson(outputDir, "redaction-report.json", {
    schemaVersion: "pr23-r2-3-redaction-report-v1",
    generatedAt: new Date().toISOString(),
    ...scan,
  });
  const model = loadModel(outputDir, rawPreserved, scan, live);
  const evaluation = evaluateGate(model);
  writeJson(outputDir, "findings.json", {
    schemaVersion: "pr23-r2-3-findings-v1",
    generatedAt: new Date().toISOString(),
    verdict: evaluation.verdict,
    pass: evaluation.pass,
    blocked: evaluation.blocked,
    requirements: evaluation.requirements,
    failures: evaluation.failures,
  });
  writeText(outputDir, "executive-summary.md", `# PR23 R2.3 Native Edge operator gate

- Verdict: ${evaluation.verdict}
- Actual Edge run: ${model.metadata.actualEdgeRunExecuted}
- Full flow complete: ${model.metadata.actualEdgeFlowCompleted}
- Raw records: ${model.rawStats.totalRecords}
- Current blocking console gate count: ${model.consoleSummary.currentGateCount}
- Product errors: ${model.consoleSummary.productErrorCount}
- Security errors: ${model.consoleSummary.securityErrorCount}
- Unclassified records: ${model.consoleSummary.unclassifiedCount}
- Credential hits: ${scan.credentialHitCount}
- PR #23 Head unchanged: ${live.pr.headRefOid === baseline.protectedPrHead}
- Production unchanged: ${
  live.productionPrimary.productionUnchanged
  && live.productionMirror.productionUnchanged
}
- R2.2 evidence tree unchanged: ${
  live.r22.tree === baseline.r22EvidenceTree && live.r22.worktreeClean
}
`);

  const rawAfterSeal = hashFiles(outputDir);
  assert.deepEqual(rawAfterSeal, rawBefore, "R23_SEALER_MUTATED_RAW_EVIDENCE");
  const files = listFiles(outputDir)
    .filter((file) =>
      !["evidence-manifest.json", "evidence-manifest.sha256"].includes(
        path.basename(file),
      ))
    .map((file) => {
      const bytes = readFileSync(file);
      return {
        path: safePath(outputDir, file),
        bytes: statSync(file).size,
        sha256: sha256(bytes),
      };
    });
  const manifest = {
    schemaVersion: "pr23-r2-3-edge-operator-manifest-v1",
    generatedAt: new Date().toISOString(),
    verdict: evaluation.verdict,
    pass: evaluation.pass,
    blocked: evaluation.blocked,
    baseline,
    requirements: evaluation.requirements,
    failures: evaluation.failures,
    rawEvidence: {
      before: rawBefore,
      after: rawAfterSeal,
      preserved: true,
      ...model.rawStats,
    },
    redaction: scan,
    files,
  };
  writeJson(outputDir, "evidence-manifest.json", manifest);
  const manifestBytes = readFileSync(
    path.join(outputDir, "evidence-manifest.json"),
  );
  const manifestSha = sha256(manifestBytes);
  writeText(
    outputDir,
    "evidence-manifest.sha256",
    `${manifestSha}  evidence-manifest.json`,
  );
  process.stdout.write(`${JSON.stringify({
    status: evaluation.pass ? "PASS" : evaluation.blocked ? "BLOCKED" : "FAIL",
    verdict: evaluation.verdict,
    manifestSha256: manifestSha,
    failures: evaluation.failures,
  })}\n`);
  if (!evaluation.pass) process.exitCode = evaluation.blocked ? 2 : 1;
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  await main();
}
