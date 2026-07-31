import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const root = path.resolve(scriptDir, "..", "..");
const templatePath = path.join(
  scriptDir,
  "run-pr23-r22-edge-evidence.mjs",
);
const templateSha256 =
  "56cc8186a9425cfca761dcaec1a8833401b5327cb616a246c0662c4c871ea470";
const expectedBase = "94ff70847b449e08d53759bad6d0bf3f1ffa530f";
const protectedR22Tree = "122804d2974df57d0c37eb2f6e2116f281e4eab1";
const expectedOutputDir = path.join(
  root,
  "artifacts",
  "pr23-r23-edge-operator",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "") : fallback;
}

function replaceExact(source, search, replacement, label) {
  const first = source.indexOf(search);
  assert.notEqual(first, -1, `R23_TEMPLATE_MARKER_MISSING:${label}`);
  assert.equal(
    source.indexOf(search, first + search.length),
    -1,
    `R23_TEMPLATE_MARKER_DUPLICATED:${label}`,
  );
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceAllExact(
  source,
  search,
  replacement,
  expectedCount,
  label,
) {
  const count = source.split(search).length - 1;
  assert.equal(count, expectedCount, `R23_TEMPLATE_COUNT_MISMATCH:${label}`);
  return source.split(search).join(replacement);
}

function replaceBetween(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `R23_TEMPLATE_START_MISSING:${label}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `R23_TEMPLATE_END_MISSING:${label}`);
  return (
    source.slice(0, startIndex)
    + replacement
    + source.slice(endIndex)
  );
}

function parseAbcChoiceContent(value) {
  const raw = String(value ?? "").trim();
  const normalizeChoice = (item) => {
    if (typeof item === "string") return item.trim();
    if (!item || typeof item !== "object" || Array.isArray(item)) return "";
    for (const key of [
      "text",
      "content",
      "description",
      "title",
      "choice",
      "option",
      "summary",
    ]) {
      if (typeof item[key] === "string" && item[key].trim()) {
        return item[key].trim();
      }
    }
    return "";
  };
  const labeledChoices = ["A", "B", "C"].map((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const match = raw.match(
      new RegExp(
        `(?:^|\\n)\\s*${escaped}\\s*[.．、:：)）-]\\s*(.+)`,
        "u",
      ),
    );
    return match?.[1]?.trim() ?? "";
  });
  if (labeledChoices.every(Boolean)) {
    return {
      sourceFormat: "labeled_text",
      choices: labeledChoices,
    };
  }

  const jsonCandidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced?.[1]) jsonCandidates.push(fenced[1].trim());
  const objectIndex = raw.indexOf("{");
  const arrayIndex = raw.indexOf("[");
  const starts = [objectIndex, arrayIndex].filter((index) => index >= 0);
  if (starts.length > 0) {
    const start = Math.min(...starts);
    const objectEnd = raw.lastIndexOf("}");
    const arrayEnd = raw.lastIndexOf("]");
    const end = Math.max(objectEnd, arrayEnd);
    if (end > start) jsonCandidates.push(raw.slice(start, end + 1));
  }

  let parsed = null;
  for (const candidate of [...new Set(jsonCandidates)]) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // Try the next bounded JSON representation.
    }
  }
  if (parsed !== null) {
    if (Array.isArray(parsed)) {
      return {
        sourceFormat: "json:root_array",
        choices: parsed.map(normalizeChoice),
      };
    }
    if (typeof parsed === "object") {
      for (const key of [
        "choices",
        "options",
        "candidate",
        "candidates",
        "alternatives",
        "selections",
      ]) {
        if (Array.isArray(parsed[key])) {
          return {
            sourceFormat: `json:${key}`,
            choices: parsed[key].map(normalizeChoice),
          };
        }
      }
      const abcObject = ["A", "B", "C"].map((label) =>
        normalizeChoice(parsed[label] ?? parsed[label.toLowerCase()]));
      if (abcObject.some(Boolean)) {
        return {
          sourceFormat: "json:abc_object",
          choices: abcObject,
        };
      }
    }
  }

  return {
    sourceFormat: labeledChoices.some(Boolean)
      ? "partial_labeled_text"
      : "unrecognized",
    choices: labeledChoices,
  };
}

export function transformR22Runner(template, playwrightImportUrl) {
  assert.equal(sha256(template), templateSha256, "R23_TEMPLATE_SHA256_MISMATCH");
  let source = template;

  source = replaceExact(
    source,
    'import { chromium } from "@playwright/test";',
    `import playwrightPackage from ${JSON.stringify(playwrightImportUrl)};
const { chromium } = playwrightPackage;`,
    "playwright-import",
  );
  source = replaceExact(
    source,
    'const root = path.resolve(scriptDir, "..", "..");',
    "const root = process.cwd();",
    "root",
  );
  source = replaceExact(
    source,
    'const outputDir = path.join(root, "artifacts", "pr23-r22-luna-unblock");',
    `const outputDir = path.resolve(
  root,
  option("--output-dir", path.join(root, "artifacts", "pr23-r23-edge-operator")),
);
assert.equal(
  outputDir,
  path.join(root, "artifacts", "pr23-r23-edge-operator"),
  "R23_OUTPUT_DIR_MUST_BE_DEDICATED",
);`,
    "output-dir",
  );
  source = replaceExact(
    source,
    "const runId = `edge-${Date.now()}-${crypto.randomBytes(4).toString(\"hex\")}`;",
    "const runId = `r23-edge-${Date.now()}-${crypto.randomBytes(8).toString(\"hex\")}`;",
    "run-id",
  );
  source = replaceExact(
    source,
    "const profileDir = path.join(os.tmpdir(), `novel-pr23-r22-${runId}`);",
    "const profileDir = path.join(os.tmpdir(), `novel-pr23-r23-${runId}`);",
    "profile-dir",
  );
  source = replaceExact(
    source,
    "  const recordId = `r22-${String(sequence).padStart(5, \"0\")}-${duplicateKey.slice(0, 12)}`;",
    "  const recordId = `r23-${String(sequence).padStart(5, \"0\")}-${duplicateKey.slice(0, 12)}`;",
    "record-id",
  );

  source = replaceBetween(
    source,
    "async function inspectLocalPermission(page) {",
    "\nasync function pairLocalBridge(page) {",
    `async function inspectLocalPermission(page) {
  return page.evaluate(async () => {
    const states = {};
    const errors = {};
    for (const permissionName of ["local-network-access", "loopback-network"]) {
      try {
        const status = await navigator.permissions.query({
          name: permissionName,
        });
        states[permissionName] = status.state;
      } catch (error) {
        states[permissionName] = "not_queryable";
        errors[permissionName] = error instanceof Error ? error.name : "unknown";
      }
    }
    return {
      apiAvailable: Boolean(navigator.permissions?.query),
      permissionName: "local-network-access",
      state: states["local-network-access"],
      states,
      errors,
      browserDecisionRequired:
        !Object.values(states).some((state) => state === "granted"),
    };
  });
}
`,
    "permission-inspection",
  );
  source = replaceExact(
    source,
    `    await pairingInput.waitFor({
      state: "visible",
      timeout: 90_000,
    });`,
    `    await pairingInput.waitFor({
      state: "visible",
      timeout: 600_000,
    });`,
    "operator-wait",
  );
  source = replaceExact(
    source,
    '  assert.equal(proof["資料離開裝置"], "否");',
    `  const dataLeftDeviceLabel =
    proof["資料離開裝置"] ?? proof["離開裝置"];
  assert.equal(dataLeftDeviceLabel, "否");`,
    "model-proof-label",
  );
  source = replaceExact(
    source,
    `    permission: {
      before: permissionBefore,
      after: permissionAfter,
      decisionMethod: "real_microsoft_edge_native_permission",
      permissionInjectionUsed: false,
      browserPolicyModified: false,
    },`,
    `    permission: {
      before: permissionBefore,
      after: permissionAfter,
      decisionMethod: "real_microsoft_edge_native_permission",
      nativePermissionObserved:
        Object.values(permissionBefore.states ?? {}).some(
          (state) => state === "prompt",
        )
        && Object.values(permissionAfter.states ?? {}).some(
          (state) => state === "granted",
        ),
      permissionInjectionUsed: false,
      browserPolicyModified: false,
      localNetworkAccessBypassUsed: false,
      mockBrowserUsed: false,
      decisionActuator:
        process.env.PR23_NATIVE_ALLOW_DELEGATION
          === "codex_windows_ui_automation"
          ? "semantic_windows_ui_automation"
          : "human_operator",
    },`,
    "permission-result",
  );
  source = replaceExact(
    source,
    `  await page.getByTestId("studio-create-blank").click();
  await page.getByTestId("studio-project-title").fill(STORY_FIXTURES[0]);
  await page.getByTestId("studio-create-submit").click();`,
    `  await page.getByRole("button", {
    name: /空白建立/u,
  }).click();
  await page.getByLabel("作品名稱（可留白）").fill(STORY_FIXTURES[0]);
  await page.getByRole("button", {
    name: "建立作品",
    exact: true,
  }).click();`,
    "current-create-ui",
  );
  source = replaceAllExact(
    source,
    '"續寫下一段"',
    '"續寫下一章"',
    2,
    "current-continue-label",
  );
  source = replaceExact(
    source,
    '"改寫目前內容"',
    '"改寫選取內容"',
    "current-rewrite-label",
  );
  source = replaceAllExact(
    source,
    '"放棄不採用"',
    '"暫時不用"',
    2,
    "current-discard-label",
  );
  source = replaceAllExact(
    source,
    '"採用並寫入作品"',
    '"採用這份建議"',
    2,
    "current-quick-approval-label",
  );
  source = replaceExact(
    source,
    "    /原文 \\d+ 字.*候選內容 \\d+ 字/u,",
    "    /目前 \\d+ 字.*核准後 \\d+ 字/u,",
    "current-diff-summary",
  );
  source = replaceExact(
    source,
    '"採用全文並寫入作品"',
    '"核准並套用目前章節"',
    "current-workspace-approval-label",
  );
  source = replaceExact(
    source,
    `  await page.getByText("模式：CLOUD_DEGRADED", { exact: false }).waitFor({
    timeout: 60_000,
  });`,
    `  await page.getByText("模式：CLOUD_DEGRADED", { exact: false }).waitFor({
    timeout: 60_000,
  });
  await page.getByText("真實本機 AI 已連線", { exact: true })
    .first()
    .waitFor({ timeout: 120_000 });`,
    "session-recovery-readiness",
  );
  source = replaceExact(
    source,
    `  runtimeReady = true;
  const reloaded = await novelSnapshot(page, projectId);`,
    `  runtimeReady = true;
  await page.getByText("真實本機 AI 已連線", { exact: true })
    .first()
    .waitFor({ timeout: 120_000 });
  const reloaded = await novelSnapshot(page, projectId);`,
    "post-reload-session-recovery",
  );
  source = replaceBetween(
    source,
    "async function backupRestoreGate(page, projectId) {",
    "\nfunction writeFlowEvidence({",
    `async function backupRestoreGate(page, projectId) {
  const before = await novelSnapshot(page, projectId);
  const semanticHashBeforeBackup = canonHash(before);
  setPhase("BACKUP");
  await page.goto(\`\${previewUrl}/studio/project/\${projectId}/backups\`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", {
    name: "備份與還原",
    exact: true,
  }).first().waitFor();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", {
    name: "完整備份並下載",
    exact: true,
  }).click();
  const download = await downloadPromise;
  await page.getByText(/備份完成，大小約/u).waitFor({ timeout: 60_000 });
  assert.ok(await download.suggestedFilename());
  const fullBackupArticle = page
    .locator(".p2DataList article")
    .filter({
      has: page.getByText("完整備份", { exact: true }),
    })
    .first();
  setPhase("RESTORE");
  page.once("dialog", (dialog) => void dialog.accept());
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
    fullBackupArticle
      .getByRole("button", { name: "還原", exact: true })
      .click(),
  ]);
  await page.getByRole("heading", {
    name: "備份與還原",
    exact: true,
  }).first().waitFor();
  const restored = await novelSnapshot(page, projectId);
  const semanticHashAfterRestore = canonHash(restored);
  assert.equal(semanticHashAfterRestore, semanticHashBeforeBackup);
  return {
    semanticHashBeforeBackup,
    semanticHashAfterRestore,
    semanticHashMatch: true,
    productOwnedReload: true,
    downloaded: true,
  };
}
`,
    "current-backup-restore-ui",
  );

  source = replaceExact(
    source,
    `      loopbackResponses.push({
        method: request.method(),
        path: pathname,
        status: response.status(),
      });`,
    `      loopbackResponses.push({
        method: request.method(),
        path: pathname,
        status: response.status(),
        phase,
      });`,
    "loopback-response-phase",
  );
  source = replaceBetween(
    source,
    "    let abcEvidence = null;",
    "    return {\n      candidateIdDigest:",
    `    const parseAbcChoiceContent =
      ${parseAbcChoiceContent.toString()};
    let abcEvidence = null;
    if (task?.taskType === "chapter.abcChoices") {
      const parsedChoices = parseAbcChoiceContent(candidate.content);
      const choices = parsedChoices.choices;
      const normalizedChoices = choices.map((text) =>
        String(text ?? "").trim().toLowerCase());
      const nonEmptyChoices = normalizedChoices.filter(Boolean);
      abcEvidence = {
        sourceFormat: parsedChoices.sourceFormat,
        labels: choices.map((_, index) =>
          ["A", "B", "C"][index] ?? \`CHOICE_\${index + 1}\`),
        extractedItemCount: choices.length,
        choiceCount: nonEmptyChoices.length,
        allNonEmpty:
          choices.length === 3
          && nonEmptyChoices.length === 3,
        choiceDigests: await Promise.all(
          choices.map((text) => sha256(text)),
        ),
        materiallyDistinct:
          choices.length === 3
          && nonEmptyChoices.length === 3
          && new Set(normalizedChoices).size === 3,
      };
    }
`,
    "structured-abc-evidence",
  );
  source = replaceExact(
    source,
    `  assert.equal(abcChoices.abcEvidence?.choiceCount, 3);
  assert.equal(abcChoices.abcEvidence?.allNonEmpty, true);
  assert.equal(abcChoices.abcEvidence?.materiallyDistinct, true);`,
    `  if (
    abcChoices.abcEvidence?.choiceCount !== 3
    || abcChoices.abcEvidence?.allNonEmpty !== true
    || abcChoices.abcEvidence?.materiallyDistinct !== true
  ) {
    const error = new Error("ABC_CHOICES_INVALID_STRUCTURE");
    error.code = "ABC_CHOICES_INVALID_STRUCTURE";
    error.abcEvidence = abcChoices.abcEvidence ?? {
      sourceFormat: "missing",
      labels: [],
      extractedItemCount: 0,
      choiceCount: 0,
      allNonEmpty: false,
      choiceDigests: [],
      materiallyDistinct: false,
    };
    throw error;
  }`,
    "strict-abc-assertion",
  );
  source = replaceExact(
    source,
    `  writeJson("abc-choices.json", quickAssistant?.abcChoices
    ? {
      schemaVersion: "pr23-r2-2-abc-choices-v1",
      status: "PASS",
      ...quickAssistant.abcChoices,
    }
    : notRun("abc-choices"));`,
    `  writeJson("abc-choices.json", quickAssistant?.abcChoices
    ? {
      schemaVersion: "pr23-r2-2-abc-choices-v1",
      status: "PASS",
      ...quickAssistant.abcChoices,
    }
    : failure?.abcEvidence
      ? {
        schemaVersion: "pr23-r2-2-abc-choices-v1",
        status: "FAIL",
        reason: "ABC_CHOICES_INVALID_STRUCTURE",
        candidate: {
          abcEvidence: failure.abcEvidence,
        },
      }
      : notRun("abc-choices"));`,
    "abc-failure-diagnostics",
  );
  source = replaceBetween(
    source,
    "  if (\n    persistenceProbe",
    "  if (\n    cancelled",
    `  const cloudProbePhase = [
    "CONTEXT_LOAD",
    "CHAPTER_CONTINUE",
    "CANDIDATE_DISCARD",
    "CHAPTER_CONTINUE_APPROVAL",
    "CHAPTER_REWRITE",
    "ABC_CHOICES",
    "FULL_WORKSPACE",
    "BACKUP",
    "RESTORE",
    "RELOAD_RECOVERY",
  ].includes(record.phase);
  const cloudProbeRequestAbort = record.kind === "requestfailed";
  const cloudProbeConsoleMirror =
    record.kind === "console"
    && ["error", "assert"].includes(String(record.level))
    && /^Failed to load resource:\\s*net::ERR_FAILED$/iu.test(
      String(record.message ?? ""),
    )
    && rawRecords.some((candidate) =>
      candidate.kind === "requestfailed"
      && candidate.phase === record.phase
      && /\\/api\\/persistence\\/health/iu.test(
        String(candidate.requestUrlRedacted ?? ""),
      )
      && candidate.sequence <= record.sequence
      && record.sequence - candidate.sequence <= 2);
  if (
    persistenceProbe
    && cloudProbePhase
    && (cloudProbeRequestAbort || cloudProbeConsoleMirror)
  ) {
    return {
      classification: "EXPECTED_CLOUD_DEGRADED_PROBE",
      blocking: false,
      reason: cloudProbeConsoleMirror
        ? "Console mirrored the immediately preceding deliberate cloud persistence health abort."
        : "The audit deliberately aborted cloud persistence health to prove local canonical operation in CLOUD_DEGRADED mode.",
      expectedByContract: true,
      contractReference: "PR23 local canonical flow with cloud persistence unavailable",
      userVisibleImpact: false,
      retryable: true,
      resolvedDuringFlow: true,
    };
  }
`,
    "cloud-probe-console-mirror",
  );
  source = replaceExact(
    source,
    `  if (
    cancelled
    && ["CANDIDATE_DISCARD", "CLEANUP"].includes(record.phase)
  ) {
    return {
      classification: "EXPECTED_CANCELLED_REQUEST",
      blocking: false,
      reason: "The request was cancelled by an explicit discard or cleanup transition.",
      expectedByContract: true,
      contractReference: "candidate discard and audit cleanup cancellation contract",
      userVisibleImpact: false,
      retryable: true,
      resolvedDuringFlow: true,
    };
  }`,
    `  const loopbackPath = String(record.requestUrlRedacted ?? "").match(
    /^https?:\\/\\/(?:127\\.0\\.0\\.1|localhost|\\[::1\\]):3217(\\/[^?#]*)/iu,
  )?.[1] ?? null;
  const samePhaseLoopbackResponse = loopbackResponses.some((response) =>
    response.method === "POST"
    && response.path === loopbackPath
    && response.phase === record.phase
    && response.status >= 200
    && response.status < 300);
  const completedLoopbackPhase =
    (
      loopbackPath === "/generate"
      && [
        "CHAPTER_CONTINUE",
        "CHAPTER_REWRITE",
        "ABC_CHOICES",
        "FULL_WORKSPACE",
      ].includes(record.phase)
    )
    || (
      loopbackPath === "/model/verify"
      && [
        "PAIR_CONFIRM",
        "FULL_WORKSPACE",
        "RELOAD_RECOVERY",
        "BACKUP",
      ].includes(record.phase)
    );
  const pairedRuntimeAtRecord =
    record.runtimeReadyAtRecord === true
    && record.pairingStateAtRecord === "paired";
  const initialPairingVerification =
    loopbackPath === "/model/verify"
    && record.phase === "PAIR_CONFIRM"
    && record.runtimeReadyAtRecord === false
    && record.pairingStateAtRecord === "requested"
    && pairing?.bridge?.proofState === "inference_verified";
  const nativePermissionInterruptedPairRequest =
    record.kind === "requestfailed"
    && record.requestMethod === "POST"
    && loopbackPath === "/pair/request"
    && record.phase === "PAIR_REQUEST"
    && String(record.failureTextRedacted ?? "").toUpperCase()
      === "NET::ERR_ABORTED"
    && record.runtimeReadyAtRecord === false
    && record.pairingStateAtRecord === "requested"
    && pairing?.permission?.nativePermissionObserved === true
    && pairing?.bridge?.proofState === "inference_verified"
    && samePhaseLoopbackResponse;
  if (nativePermissionInterruptedPairRequest) {
    return {
      classification: "EXPECTED_CANCELLED_REQUEST",
      blocking: false,
      reason: "The native Local Network Access decision interrupted the initial pairing fetch; the exact same-phase pairing request then completed and the Bridge proof was inference-verified.",
      expectedByContract: true,
      contractReference: "operator-assisted native Local Network Access pairing retry contract",
      userVisibleImpact: false,
      retryable: false,
      resolvedDuringFlow: true,
    };
  }
  if (
    record.kind === "requestfailed"
    && record.requestMethod === "POST"
    && String(record.failureTextRedacted ?? "").toUpperCase()
      === "NET::ERR_ABORTED"
    && (pairedRuntimeAtRecord || initialPairingVerification)
    && completedLoopbackPhase
    && samePhaseLoopbackResponse
  ) {
    return {
      classification: "EXPECTED_CANCELLED_REQUEST",
      blocking: false,
      reason: "Edge reported a fetch abort after the exact same-phase loopback POST had already returned a successful response.",
      expectedByContract: true,
      contractReference: "successful local Bridge stream completion and reload session revalidation contract",
      userVisibleImpact: false,
      retryable: false,
      resolvedDuringFlow: true,
    };
  }
  const navigationCancelledVerifiedModelRefresh =
    record.kind === "requestfailed"
    && record.requestMethod === "POST"
    && loopbackPath === "/model/verify"
    && record.phase === "BACKUP"
    && String(record.failureTextRedacted ?? "").toUpperCase()
      === "NET::ERR_ABORTED"
    && pairedRuntimeAtRecord
    && pairing?.bridge?.proofState === "inference_verified"
    && fullWorkspace?.candidate?.actualExecutor === "local-ollama";
  if (navigationCancelledVerifiedModelRefresh) {
    return {
      classification: "EXPECTED_CANCELLED_REQUEST",
      blocking: false,
      reason: "Navigation to backup cancelled an optional model refresh after the Bridge and Local Ollama executor had already been inference-verified.",
      expectedByContract: true,
      contractReference: "verified local model session and backup navigation cancellation contract",
      userVisibleImpact: false,
      retryable: false,
      resolvedDuringFlow: true,
    };
  }
  const identityNavigationAbort =
    record.kind === "requestfailed"
    && record.requestMethod === "GET"
    && String(record.failureTextRedacted ?? "").toUpperCase()
      === "NET::ERR_ABORTED"
    && /^https:\\/\\/novel-[a-z0-9-]+\\.vercel\\.app\\/api\\/release\\/identity$/iu.test(
      String(record.requestUrlRedacted ?? ""),
    )
    && ["RELOAD_RECOVERY", "BACKUP", "RESTORE"].includes(record.phase)
    && releaseIdentity?.appCommit === expectedMergeRef
    && releaseIdentity?.deploymentId === expectedDeploymentId
    && releaseIdentity?.provenanceStatus === "verified";
  if (identityNavigationAbort) {
    return {
      classification: "EXPECTED_CANCELLED_REQUEST",
      blocking: false,
      reason: "Navigation cancelled a same-origin release identity refresh after the authoritative identity had already been verified.",
      expectedByContract: true,
      contractReference: "verified preview identity and navigation cancellation contract",
      userVisibleImpact: false,
      retryable: false,
      resolvedDuringFlow: true,
    };
  }
  if (
    cancelled
    && ["CANDIDATE_DISCARD", "CLEANUP"].includes(record.phase)
  ) {
    return {
      classification: "EXPECTED_CANCELLED_REQUEST",
      blocking: false,
      reason: "The request was cancelled by an explicit discard or cleanup transition.",
      expectedByContract: true,
      contractReference: "candidate discard and audit cleanup cancellation contract",
      userVisibleImpact: false,
      retryable: true,
      resolvedDuringFlow: true,
    };
  }`,
    "successful-loopback-abort",
  );
  source = replaceExact(
    source,
    "  if (security) {",
    `  const optionalPrivateHubHealthProbe =
    /http:\\/\\/127\\.0\\.0\\.1:3227\\/health(?:['"\\s]|$|[?#])/iu.test(text)
    && ["FULL_WORKSPACE", "RELOAD_RECOVERY"].includes(record.phase)
    && record.runtimeReadyAtRecord === true
    && record.pairingStateAtRecord === "paired"
    && pairing?.bridge?.proofState === "inference_verified"
    && fullWorkspace?.candidate?.actualExecutor === "local-ollama"
    && (
      (
        record.kind === "requestfailed"
        && record.requestMethod === "GET"
        && /(?:ERR_FAILED|ERR_CONNECTION_REFUSED)/iu.test(
          String(record.failureTextRedacted ?? ""),
        )
      )
      || (
        record.kind === "console"
        && (
          /blocked by CORS policy:[\\s\\S]*No 'Access-Control-Allow-Origin'/iu.test(
            String(record.message ?? ""),
          )
          || /^Failed to load resource:\\s*net::ERR_(?:FAILED|CONNECTION_REFUSED)$/iu.test(
            String(record.message ?? ""),
          )
        )
      )
    );
  if (optionalPrivateHubHealthProbe) {
    return {
      classification: "EXPECTED_OPTIONAL_BACKEND_PROBE",
      blocking: false,
      reason: "The optional Private Hub discovery endpoint was unavailable to the audited preview origin while the verified Local Ollama backend remained selected.",
      expectedByContract: true,
      contractReference: "three-backend discovery with locked local-ollama execution",
      userVisibleImpact: false,
      retryable: true,
      resolvedDuringFlow: true,
    };
  }
  if (security) {`,
    "optional-private-hub-health-probe",
  );
  source = replaceExact(
    source,
    `      "EXPECTED_CANCELLED_REQUEST",
      "EXPECTED_CLOUD_DEGRADED_PROBE",
      "BROWSER_NOISE",`,
    `      "EXPECTED_CANCELLED_REQUEST",
      "EXPECTED_CLOUD_DEGRADED_PROBE",
      "EXPECTED_OPTIONAL_BACKEND_PROBE",
      "BROWSER_NOISE",`,
    "optional-backend-summary-count",
  );
  source = replaceExact(
    source,
    "  const browserNoise = /(?:favicon\\.ico|DevTools failed to load source map|ResizeObserver loop limit exceeded|Autofocus processing was blocked)/iu.test(text);",
    `  const browserNoise =
    /(?:favicon\\.ico|DevTools failed to load source map|ResizeObserver loop limit exceeded|Autofocus processing was blocked)/iu.test(text)
    || (
      record.kind === "requestfailed"
      && cancelled
      && (
        /\\/\\.well-known\\/vercel\\/jwe/iu.test(text)
        || ["HEAD", "OPTIONS"].includes(String(record.requestMethod))
      )
    )
    || (
      ["console", "httperror", "requestfailed"].includes(record.kind)
      && /https:\\/\\/novel-[a-z0-9-]+\\.vercel\\.app\\/(?:legacy\\/novel-system\\.html|professional|studio(?:\\/[^?]*)?)\\?keys=_rsc/iu.test(text)
      && (record.httpStatus === 404 || /(?:404|ERR_ABORTED)/iu.test(text))
    )
    || (
      record.kind === "requestfailed"
      && cancelled
      && /(?:https:\\/\\/vercel\\.live\\/_next-live\\/|\\/file\\.svg)/iu.test(text)
    );`,
    "bounded-browser-noise",
  );
  source = replaceExact(
    source,
    `  const observedGateCount = rawRecords.filter((record) =>
    record.kind === "console"
    && ["error", "assert"].includes(String(record.level))).length;
  const currentGateCount = actualRunCompleted ? observedGateCount : null;`,
    `  const rawConsoleErrorCount = rawRecords.filter((record) =>
    record.kind === "console"
    && ["error", "assert"].includes(String(record.level))).length;
  const observedGateCount = classified.filter((row) => {
    const record = rawRecords.find((entry) => entry.recordId === row.recordId);
    return row.blocking
      && record?.kind === "console"
      && ["error", "assert"].includes(String(record.level));
  }).length;
  const currentGateCount = actualRunCompleted ? observedGateCount : null;`,
    "gate-count",
  );
  source = replaceExact(
    source,
    "    rawRecordCount: rawRecords.length,\n    classifiedRecordCount: classified.length,",
    "    rawRecordCount: rawRecords.length,\n    rawConsoleErrorCount,\n    classifiedRecordCount: classified.length,",
    "raw-console-count",
  );
  source = source.replaceAll(
    '"fresh_authoritative_rerun"',
    '"fresh_authoritative_operator_assisted_rerun"',
  );
  source = replaceExact(
    source,
    `      localNetworkPermissionBypassUsed: false,
      localNetworkPermissionInjectionUsed: false,
      browserPolicyModified: false,
    };`,
    `      localNetworkPermissionBypassUsed: false,
      localNetworkPermissionInjectionUsed: false,
      browserPolicyModified: false,
      userAgentContainsEdge: /Edg\\//u.test(userAgent),
      collectorAttached: true,
      listenersAttached: [
        "page.console",
        "page.pageerror",
        "page.requestfailed",
        "page.response",
        "context.weberror",
      ],
    };`,
    "browser-evidence",
  );
  source = replaceExact(
    source,
    `      permissionEvidence: runFailure?.permission ?? null,
    });`,
    `      permissionEvidence: runFailure?.permission ?? null,
      collectorAttached: Boolean(browserEvidence?.collectorAttached),
      listenersAttached: browserEvidence?.listenersAttached ?? [],
      nativePermissionObserved:
        pairing?.permission?.nativePermissionObserved ?? false,
      permissionInjectionUsed:
        pairing?.permission?.permissionInjectionUsed ?? false,
      localNetworkAccessBypassUsed:
        pairing?.permission?.localNetworkAccessBypassUsed ?? false,
      mockBrowserUsed: pairing?.permission?.mockBrowserUsed ?? false,
      protectedR22EvidenceTree:
        "122804d2974df57d0c37eb2f6e2116f281e4eab1",
      operatorAssisted: true,
      operatorDelegationMethod:
        process.env.PR23_NATIVE_ALLOW_DELEGATION ?? "human_operator",
      humanOperatorClicked:
        process.env.PR23_NATIVE_ALLOW_DELEGATION
          !== "codex_windows_ui_automation",
    });`,
    "metadata-attestation",
  );

  source = source
    .replaceAll("pr23-r2-2", "pr23-r2-3")
    .replaceAll("PR23 R2.2", "PR23 R2.3");

  assert.match(source, /R23_OUTPUT_DIR_MUST_BE_DEDICATED/u);
  assert.match(source, /nativePermissionObserved/u);
  assert.match(source, /作品名稱（可留白）/u);
  assert.match(source, /fresh_authoritative_operator_assisted_rerun/u);
  assert.doesNotMatch(source, /artifacts", "pr23-r22-luna-unblock/u);
  return source;
}

function git(args) {
  const result = spawnSync("git.exe", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `R23_GIT_CHECK_FAILED:${args.join(" ")}:${String(result.stderr).trim()}`,
  );
  return String(result.stdout).trim();
}

function verifyProtectedInputs() {
  assert.ok(existsSync(templatePath), "R23_TEMPLATE_MISSING");
  assert.equal(
    git(["rev-parse", `${expectedBase}^{commit}`]),
    expectedBase,
    "R23_BASE_MISSING",
  );
  assert.equal(
    git(["rev-parse", "HEAD:artifacts/pr23-r22-luna-unblock"]),
    protectedR22Tree,
    "R23_PROTECTED_R22_TREE_CHANGED",
  );
  assert.equal(
    git(["status", "--porcelain=v1", "--", "artifacts/pr23-r22-luna-unblock"]),
    "",
    "R23_PROTECTED_R22_WORKTREE_DIRTY",
  );
}

function resolvePlaywrightImport() {
  // A Git worktree does not share ignored node_modules. Resolve only from
  // another local worktree of the same repository; no package is installed
  // or downloaded by the audit runner.
  const parent = path.dirname(root);
  const preferred = [
    root,
    path.join(parent, "novel-pr23-r22-audit"),
    path.join(parent, "novel-closed-ai-runtime-r2"),
  ];
  const discovered = readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("novel-"))
    .map((entry) => path.join(parent, entry.name));
  for (const candidate of [...new Set([...preferred, ...discovered])]) {
    const packageJson = path.join(candidate, "package.json");
    if (!existsSync(packageJson)) continue;
    try {
      const requireFromCandidate = createRequire(pathToFileURL(packageJson));
      const resolved = requireFromCandidate.resolve("@playwright/test");
      if (existsSync(resolved)) return pathToFileURL(resolved).href;
    } catch {
      // Continue to the next same-repository worktree.
    }
  }
  throw new Error("R23_PLAYWRIGHT_DEPENDENCY_NOT_FOUND");
}

function runSelfTest() {
  const template = readFileSync(templatePath, "utf8");
  const delegatedAllowHelper = readFileSync(
    path.join(scriptDir, "invoke-pr23-r24-native-edge-allow.ps1"),
    "utf8",
  );
  const pairingRetryHelper = readFileSync(
    path.join(scriptDir, "invoke-pr23-r24-pairing-retry.ps1"),
    "utf8",
  );
  const fixturePlaywrightUrl =
    "file:///C:/dev/novel-pr23-r22-audit/node_modules/@playwright/test/index.js";
  const transformed = transformR22Runner(
    template,
    fixturePlaywrightUrl,
  );
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "novel-r23-syntax-"));
  const transformedPath = path.join(tempDir, "transformed-runner.mjs");
  writeFileSync(transformedPath, transformed, "utf8");
  const syntax = spawnSync(process.execPath, ["--check", transformedPath], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  rmSync(tempDir, { recursive: true, force: true });
  const installedPlaywright = resolvePlaywrightImport();
  const dependencyProbe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import pkg from ${JSON.stringify(installedPlaywright)}; if (!pkg.chromium) process.exit(2);`,
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  const labeledFixture = parseAbcChoiceContent(
    "A. 調查鐘樓\nB. 追蹤黑影\nC. 保護證人",
  );
  const jsonFixture = parseAbcChoiceContent(JSON.stringify({
    choices: [
      { title: "調查鐘樓" },
      { description: "追蹤黑影" },
      { text: "保護證人" },
    ],
  }));
  const twoChoiceFixture = parseAbcChoiceContent(JSON.stringify({
    candidate: [
      { title: "調查鐘樓" },
      { title: "追蹤黑影" },
    ],
  }));
  const checks = {
    templateShaPinned: sha256(template) === templateSha256,
    dedicatedOutput: transformed.includes("R23_OUTPUT_DIR_MUST_BE_DEDICATED"),
    freshProfile: transformed.includes("novel-pr23-r23-${runId}"),
    nativeEdge: transformed.includes("userAgentContainsEdge"),
    nativePermission: transformed.includes("nativePermissionObserved"),
    noInjection: transformed.includes("permissionInjectionUsed"),
    noBypass: transformed.includes("localNetworkAccessBypassUsed"),
    rawListeners: transformed.includes("context.weberror"),
    currentCreateUi:
      transformed.includes("name: /空白建立/u")
      && transformed.includes("作品名稱（可留白）"),
    currentQuickAssistantUi:
      transformed.includes('"續寫下一章"')
      && transformed.includes('"改寫選取內容"')
      && transformed.includes('"暫時不用"')
      && transformed.includes('"採用這份建議"')
      && transformed.includes("/目前 \\d+ 字.*核准後 \\d+ 字/u")
      && transformed.split('"真實本機 AI 已連線"').length - 1 === 2,
    currentWorkspaceUi:
      transformed.includes('"核准並套用目前章節"'),
    currentBackupRestoreUi:
      transformed.includes('"完整備份並下載"')
      && transformed.includes('"備份與還原"'),
    boundedNavigationNoise:
      transformed.includes("legacy\\/novel-system\\.html")
      && transformed.includes("vercel\\.live\\/_next-live"),
    loopbackResponsePhaseBound:
      transformed.includes('let phase = "BOOT"')
      && transformed.includes("phase,")
      && !transformed.includes("currentPhase"),
    cloudProbeConsoleMirrorBound:
      transformed.includes("cloudProbeConsoleMirror")
      && transformed.includes("record.sequence - candidate.sequence <= 2"),
    completedLoopbackAbortBound:
      transformed.includes("samePhaseLoopbackResponse")
      && transformed.includes('loopbackPath === "/model/verify"')
      && transformed.includes("initialPairingVerification"),
    nativePermissionPairRetryBound:
      transformed.includes("nativePermissionInterruptedPairRequest")
      && transformed.includes('loopbackPath === "/pair/request"')
      && transformed.includes(
        "pairing?.permission?.nativePermissionObserved === true",
      ),
    backupModelRefreshAbortBound:
      transformed.includes("navigationCancelledVerifiedModelRefresh")
      && transformed.includes('record.phase === "BACKUP"')
      && transformed.includes(
        'fullWorkspace?.candidate?.actualExecutor === "local-ollama"',
      ),
    identityNavigationAbortBound:
      transformed.includes("identityNavigationAbort")
      && transformed.includes(
        "releaseIdentity?.deploymentId === expectedDeploymentId",
      ),
    optionalPrivateHubProbeBound:
      transformed.includes("optionalPrivateHubHealthProbe")
      && transformed.includes("127\\.0\\.0\\.1:3227\\/health")
      && transformed.includes("EXPECTED_OPTIONAL_BACKEND_PROBE")
      && transformed.includes(
        'fullWorkspace?.candidate?.actualExecutor === "local-ollama"',
      ),
    strictAbcDiagnostics:
      transformed.includes("ABC_CHOICES_INVALID_STRUCTURE")
      && transformed.includes("sourceFormat: parsedChoices.sourceFormat"),
    labeledAbcParsed:
      labeledFixture.sourceFormat === "labeled_text"
      && labeledFixture.choices.length === 3
      && labeledFixture.choices.every(Boolean),
    jsonAbcParsed:
      jsonFixture.sourceFormat === "json:choices"
      && jsonFixture.choices.length === 3
      && new Set(jsonFixture.choices).size === 3,
    twoChoiceJsonNotPromoted:
      twoChoiceFixture.sourceFormat === "json:candidate"
      && twoChoiceFixture.choices.length === 2,
    correctedProofLabel: transformed.includes('proof["離開裝置"]'),
    operatorWait: transformed.includes("timeout: 600_000"),
    delegatedDecisionIsAuditable:
      transformed.includes("semantic_windows_ui_automation")
      && transformed.includes("humanOperatorClicked"),
    delegatedHelperWindowScoped:
      delegatedAllowHelper.includes("AutomationElement]::FromHandle")
      && delegatedAllowHelper.includes("$windowElement.FindAll")
      && !delegatedAllowHelper.includes("AutomationElement]::RootElement.FindAll"),
    delegatedHelperVerifiesEffectiveDecision:
      delegatedAllowHelper.includes("SetForegroundWindow")
      && delegatedAllowHelper.includes("nativePromptDismissed")
      && delegatedAllowHelper.includes("$promptStillPresent"),
    delegatedHelperStartsConditionalPairingRetry:
      delegatedAllowHelper.includes("invoke-pr23-r24-pairing-retry.ps1")
      && delegatedAllowHelper.includes("-AllowNotNeeded"),
    pairingRetryHelperWindowScoped:
      pairingRetryHelper.includes("AutomationElement]::FromHandle")
      && pairingRetryHelper.includes("$windowElement.FindAll")
      && !pairingRetryHelper.includes("AutomationElement]::RootElement.FindAll"),
    pairingRetryHelperVerifiesEffectiveInvocation:
      pairingRetryHelper.includes("pairingControlDismissedOrDisabled")
      && pairingRetryHelper.includes("$invocationEffective")
      && pairingRetryHelper.includes("INVOCATION_NOT_EFFECTIVE"),
    gateCountIsBlockingCount: transformed.includes(
      "const rawConsoleErrorCount",
    ),
    operatorRerunReason: transformed.includes(
      "fresh_authoritative_operator_assisted_rerun",
    ),
    protectedOutputNotReferenced:
      !transformed.includes('artifacts", "pr23-r22-luna-unblock'),
    transformedSyntaxValid: syntax.status === 0,
    installedPlaywrightResolvable:
      /^file:/u.test(installedPlaywright) && dependencyProbe.status === 0,
    dependencyUrlNotRewritten: transformed.includes(fixturePlaywrightUrl),
  };
  assert.ok(
    Object.values(checks).every(Boolean),
    `R23_RUNNER_SELF_TEST_FAILED:${JSON.stringify(checks)}`,
  );
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    suite: "pr23-r23-runner-transform",
    checks,
  })}\n`);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  verifyProtectedInputs();
  const outputDir = path.resolve(option("--output-dir", expectedOutputDir));
  assert.equal(outputDir, expectedOutputDir, "R23_OUTPUT_DIR_MUST_BE_DEDICATED");
  const previewUrl = option("--preview-url");
  const deploymentId = option("--expected-deployment-id");
  const mergeRef = option("--expected-merge-ref");
  assert.match(previewUrl, /^https:\/\/novel-[a-z0-9-]+\.vercel\.app\/?$/u);
  assert.match(deploymentId, /^dpl_[A-Za-z0-9]+$/u);
  assert.match(mergeRef, /^[a-f0-9]{40}$/u);

  const template = readFileSync(templatePath, "utf8");
  const playwrightImportUrl = resolvePlaywrightImport();
  const transformed = transformR22Runner(template, playwrightImportUrl);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "novel-r23-runner-"));
  const delegatePath = path.join(tempDir, "run-pr23-r23-delegate.mjs");
  writeFileSync(delegatePath, transformed, "utf8");
  try {
    const forwarded = process.argv.slice(2).filter((value) => value !== "--self-test");
    const result = spawnSync(process.execPath, [delegatePath, ...forwarded], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      windowsHide: false,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
