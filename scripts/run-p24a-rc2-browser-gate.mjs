import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.P24A_BASE_URL || "http://127.0.0.1:3124";
const evidenceDir = process.env.P24A_EVIDENCE_DIR;
if (!evidenceDir) throw new Error("P24A_EVIDENCE_DIR_REQUIRED");
fs.mkdirSync(evidenceDir, { recursive: true });

let serverProcess = null;
async function startLocalServerIfRequested() {
  if (process.env.P24A_START_SERVER !== "1") return;
  const url = new URL(baseUrl);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const mode = process.env.P24A_SERVER_MODE === "production" ? "start" : "dev";
  serverProcess = spawn(
    process.execPath,
    [path.join(process.cwd(), "node_modules/next/dist/bin/next"), mode, "-p", port],
    { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const serverOutput = [];
  serverProcess.stdout?.on("data", (chunk) => serverOutput.push(chunk.toString()));
  serverProcess.stderr?.on("data", (chunk) => serverOutput.push(chunk.toString()));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`P24A_LOCAL_SERVER_EXITED: ${serverOutput.join("").slice(-4000)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/studio/create`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`P24A_LOCAL_SERVER_TIMEOUT: ${serverOutput.join("").slice(-4000)}`);
}

const checks = [];
const consoleErrors = [];
const pageErrors = [];
const requestFailures = [];
const externalRequestObservations = [];
const networkResults = [];
const screenshots = [];
const write = (name, value) => fs.writeFileSync(
  path.join(evidenceDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  "utf8",
);
const check = (name, pass, details = null) => {
  checks.push({ name, status: pass ? "PASS" : "FAIL", details });
  if (!pass) throw new Error(`${name}: ${JSON.stringify(details)}`);
};
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const baseOrigin = new URL(baseUrl).origin;
const isExternalNetworkUrl = (value) => {
  const url = new URL(value);
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== baseOrigin;
};
const hash = (value) => crypto.createHash("sha256")
  .update(JSON.stringify(stable(value)))
  .digest("hex");
const countTextMatches = (value, pattern) => (String(value).match(pattern) || []).length;
const countByStore = (snapshot) => Object.fromEntries(
  Object.entries(snapshot).map(([store, records]) => [store, records.length]),
);
const duplicateRecordCount = (snapshot) => Object.values(snapshot)
  .reduce((total, records) => {
    const ids = records.map((record) => record.id);
    return total + (ids.length - new Set(ids).size);
  }, 0);

const DEFAULT_SNAPSHOT_STORES = [
  "projects", "chapters", "characters", "worldRules", "storyBibles", "storyStates",
  "acceptedChoices", "storyBranches", "backups", "dramaProjects", "dramaSeasons",
  "dramaEpisodes", "dramaScenes", "dramaBeats", "dramaApprovals",
  "narrativeCanonLinks", "dramaEvaluations",
];

async function storageSnapshot(page, projectId, storeNames = DEFAULT_SNAPSHOT_STORES) {
  return page.evaluate(async ({ projectId, storeNames }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = {};
    for (const storeName of storeNames) {
      result[storeName] = await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly")
          .objectStore(storeName).index("projectId").getAll(projectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close();
    return result;
  }, { projectId, storeNames });
}

function novelCanonical(snapshot) {
  return {
    projects: snapshot.projects,
    chapters: snapshot.chapters,
    characters: snapshot.characters,
    worldRules: snapshot.worldRules,
    storyBibles: snapshot.storyBibles,
    storyStates: snapshot.storyStates,
    acceptedChoices: snapshot.acceptedChoices,
    storyBranches: snapshot.storyBranches,
  };
}

function approvalCanonical(snapshot) {
  return {
    dramaApprovals: snapshot.dramaApprovals,
    narrativeCanonLinks: snapshot.narrativeCanonLinks,
  };
}

async function candidateMetrics(page) {
  const locator = page.getByTestId("drama-candidate");
  await locator.waitFor();
  return locator.evaluate((element) => ({
    candidateId: element.dataset.candidateId,
    dramaProjectId: element.dataset.candidateId,
    providerRunId: element.dataset.providerRunId,
    outputHash: element.dataset.outputHash,
    createdAt: element.dataset.createdAt,
    formatProfile: element.dataset.formatProfile,
    episodeCount: Number(element.querySelectorAll(":scope > article").length ? element.querySelectorAll(":scope > article")[1]?.querySelector("strong")?.textContent : 0),
    sceneCount: Number(element.dataset.sceneCount),
    beatCount: Number(element.dataset.beatCount),
    targetDurationSeconds: Number(element.dataset.targetDuration),
    hookDeadlineSeconds: Number(element.dataset.hookDeadline),
    conflictIntervalSeconds: Number(element.dataset.conflictInterval),
    reversalIntervalSeconds: Number(element.dataset.reversalInterval),
    minimumPayoffCount: Number(element.dataset.minimumPayoffCount),
    cliffhangerType: element.dataset.cliffhangerType,
  }));
}

await startLocalServerIfRequested();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-TW",
  serviceWorkers: "block",
  acceptDownloads: true,
  extraHTTPHeaders: {
    "x-vercel-skip-toolbar": "1",
  },
});
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({
    text: message.text(),
    url: page.url(),
  });
});
page.on("pageerror", (error) => {
  pageErrors.push({
    message: error.message,
    stack: error.stack || null,
    url: page.url(),
  });
});
page.on("request", (request) => {
  if (isExternalNetworkUrl(request.url())) {
    externalRequestObservations.push({
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      isNavigationRequest: request.isNavigationRequest(),
    });
  }
});
page.on("requestfailed", (request) => {
  if (!request.isNavigationRequest()) return;
  requestFailures.push({
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType(),
    mainFrame: request.frame() === page.mainFrame(),
    errorText: request.failure()?.errorText || "UNKNOWN_REQUEST_FAILURE",
  });
});
page.on("response", (response) => {
  networkResults.push({
    status: response.status(),
    method: response.request().method(),
    url: response.url(),
  });
});

let projectId = "";
let characterEvidence = null;
let worldRuleEvidence = null;
let storyBibleEvidence = null;
let formatComparison = null;
let discardEvidence = null;
let regenerateEvidence = null;
let approvalEvidence = null;
let canonicalEvidence = null;
let restoreNavigationOwnership = null;
let restoreIntegrity = null;
const mobile = [];

try {
  await page.goto(`${baseUrl}/studio/create`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /空白建立/ }).click();
  await page.getByLabel("作品名稱（可留白）").fill("P2.4A RC2 真實 UI 驗收作品");
  await page.getByRole("button", { name: "建立作品", exact: true }).click();
  const writeLink = page.getByRole("link", { name: "開始寫作", exact: true });
  await writeLink.waitFor();
  const href = await writeLink.getAttribute("href");
  projectId = href?.match(/\/studio\/project\/([^/]+)\/write/)?.[1] || "";
  check("project-created-through-consumer-ui", Boolean(projectId), { href });

  await writeLink.click();
  await page.getByLabel("章節標題").fill("第一章：午夜劇院");
  await page.getByLabel("正文").fill(
    "林昭在雨夜抵達舊劇院。舞台中央只亮著一盞燈，牆上的時鐘停在十一點四十七分。"
      + "她收到一封沒有署名的邀請，要求她在午夜前找出失蹤演員留下的最後一句台詞。"
      + "門外傳來三次敲擊，卻沒有人回應。林昭決定先檢查後台，再追查觀眾席下方的暗門。",
  );
  await page.getByRole("button", { name: "儲存目前內容", exact: true }).click();
  await page.getByText(/已儲存/).waitFor();
  check("chapter-created-through-consumer-ui", true);

  await page.goto(`${baseUrl}/studio/project/${projectId}/characters`, { waitUntil: "networkidle" });
  await page.getByLabel("角色姓名").fill("林昭");
  await page.getByLabel("角色目標").fill("在午夜前找回失蹤演員並揭開邀請者身分");
  await page.getByLabel("生存狀態").selectOption("alive");
  await page.getByLabel("所在位置或現況").fill("舊劇院後台，正在追查暗門");
  await page.getByRole("button", { name: "儲存角色", exact: true }).click();
  await page.getByText("角色已保存。", { exact: true }).waitFor();
  const characterCard = page.getByTestId("character-records").locator("article");
  check("character-created-through-consumer-ui", await characterCard.count() === 1);
  const characterId = await characterCard.getAttribute("data-record-id");
  const characterRevision = Number(await characterCard.getAttribute("data-revision"));
  check("character-has-required-fields", await page.getByText("舊劇院後台，正在追查暗門", { exact: true }).isVisible());

  await page.goto(`${baseUrl}/studio/project/${projectId}/world`, { waitUntil: "networkidle" });
  await page.getByLabel("規則名稱").fill("午夜真相規則");
  await page.getByLabel("規則內容").fill("午夜前說出的真相會在舞台上留下不可抹除的光痕。");
  await page.getByRole("button", { name: "儲存世界規則", exact: true }).click();
  await page.getByText("世界規則已保存。", { exact: true }).waitFor();
  const worldRuleCard = page.getByTestId("world-rule-records").locator("article");
  check("world-rule-created-through-consumer-ui", await worldRuleCard.count() === 1);
  const worldRuleId = await worldRuleCard.getAttribute("data-record-id");
  const worldRuleRevision = Number(await worldRuleCard.getAttribute("data-revision"));

  await page.goto(`${baseUrl}/studio/project/${projectId}/story-bible`, { waitUntil: "networkidle" });
  await page.getByLabel("伏筆").fill("停在十一點四十七分的時鐘缺少分針");
  await page.getByLabel("未解線索").fill("無署名邀請是誰送出的");
  await page.getByLabel("禁止矛盾").fill("林昭在午夜前從未離開舊劇院");
  await page.getByRole("button", { name: "儲存 Story Bible", exact: true }).click();
  await page.getByText("Story Bible 已保存。", { exact: true }).waitFor();
  const storyBibleCard = page.getByTestId("story-bible-record");
  const storyBibleId = await storyBibleCard.getAttribute("data-record-id");
  const storyBibleRevision = Number(await storyBibleCard.getAttribute("data-revision"));
  check("story-bible-updated-through-consumer-ui", storyBibleRevision >= 2);

  await page.reload({ waitUntil: "networkidle" });
  check("story-bible-persists-after-reload", await page.getByText("停在十一點四十七分的時鐘缺少分針", { exact: true }).isVisible());
  await page.goto(`${baseUrl}/studio/project/${projectId}/characters`, { waitUntil: "networkidle" });
  check("character-persists-after-reload", await page.getByText("林昭", { exact: true }).isVisible());
  await page.goto(`${baseUrl}/studio/project/${projectId}/world`, { waitUntil: "networkidle" });
  check("world-rule-persists-after-reload", await page.getByText("午夜真相規則", { exact: true }).isVisible());

  await page.goto(`${baseUrl}/studio/project/${projectId}/backups`, { waitUntil: "networkidle" });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "完整備份並下載", exact: true }).click();
  await downloadPromise;
  await page.getByText(/備份完成/).waitFor();
  const backupSnapshot = await storageSnapshot(page, projectId);
  const fullBackup = backupSnapshot.backups.find((item) => item.kind === "full");
  check("full-backup-created-through-consumer-ui", Boolean(fullBackup));
  const backupRecords = fullBackup?.snapshot || {};
  const characterBackupPresence = backupRecords.characters?.some((item) => item.id === characterId) === true;
  const worldRuleBackupPresence = backupRecords.worldRules?.some((item) => item.id === worldRuleId) === true;
  const storyBibleBackupPresence = backupRecords.storyBibles?.some((item) => item.id === storyBibleId) === true;
  check("character-present-in-backup", characterBackupPresence);
  check("world-rule-present-in-backup", worldRuleBackupPresence);
  check("story-bible-present-in-backup", storyBibleBackupPresence);

  page.once("dialog", (dialog) => void dialog.accept());
  const fullBackupArticle = page.getByText("完整備份", { exact: true }).locator("..");
  const restoreButton = fullBackupArticle.getByRole("button", { name: "還原", exact: true });
  const restoreUrlBefore = page.url();
  const restoreMainFrame = page.mainFrame();
  const restoreDiagnosticStart = {
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
    requestFailures: requestFailures.length,
  };
  let restoreMainFrameNavigationCount = 0;

  const restoreNavigationObserver = (request) => {
    if (
      request.isNavigationRequest()
      && request.resourceType() === "document"
      && request.frame() === restoreMainFrame
    ) {
      restoreMainFrameNavigationCount += 1;
    }
  };

  page.on("request", restoreNavigationObserver);

  const productNavigationPromise = page.waitForEvent(
    "framenavigated",
    {
      predicate: (frame) => frame === restoreMainFrame,
      timeout: 15_000,
    },
  );
  const productDocumentRequestPromise = page.waitForRequest(
    (request) => (
      request.isNavigationRequest()
      && request.resourceType() === "document"
      && request.frame() === restoreMainFrame
    ),
    { timeout: 15_000 },
  );
  const productLoadPromise = page.waitForEvent("load", { timeout: 15_000 });

  await restoreButton.click();
  await Promise.all([
    productNavigationPromise,
    productDocumentRequestPromise,
    productLoadPromise,
  ]);
  await page.waitForLoadState("domcontentloaded");

  await page.getByRole(
    "heading",
    {
      name: "備份與還原",
      level: 1,
      exact: true,
    },
  ).waitFor({ timeout: 15_000 });

  await page.waitForTimeout(750);
  page.off("request", restoreNavigationObserver);

  const restoreUrlAfter = page.url();
  const restoreNavigationType = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry && "type" in entry ? entry.type : null;
  });
  const restoreUrlBeforeParsed = new URL(restoreUrlBefore);
  const restoreUrlAfterParsed = new URL(restoreUrlAfter);
  const restoreDiagnosticText = JSON.stringify({
    consoleErrors: consoleErrors.slice(restoreDiagnosticStart.consoleErrors),
    pageErrors: pageErrors.slice(restoreDiagnosticStart.pageErrors),
    requestFailures: requestFailures.slice(restoreDiagnosticStart.requestFailures),
  });
  const restoreErrAborted = countTextMatches(restoreDiagnosticText, /ERR_ABORTED/gi);
  const restoreFrameDetached = countTextMatches(restoreDiagnosticText, /frame detached/gi);
  const restoreExecutionContextDestroyed = countTextMatches(
    restoreDiagnosticText,
    /execution context destroyed/gi,
  );
  const restoreNormalFlowRace = restoreErrAborted
    + restoreFrameDetached
    + restoreExecutionContextDestroyed;
  const restoreUrlIsCanonical = restoreUrlAfter === restoreUrlBefore
    || (
      restoreUrlBeforeParsed.origin === restoreUrlAfterParsed.origin
      && restoreUrlBeforeParsed.pathname === `/studio/project/${projectId}/backups`
      && restoreUrlAfterParsed.pathname === `/studio/project/${projectId}/backups`
    );
  restoreNavigationOwnership = {
    owner: "PRODUCT",
    productReloadObserved: true,
    productReloadType: restoreNavigationType,
    mainFrameNavigationCount: restoreMainFrameNavigationCount,
    harnessReloadIssued: false,
    harnessGotoIssued: false,
    urlBefore: restoreUrlBefore,
    urlAfter: restoreUrlAfter,
    normalFlowRace: restoreNormalFlowRace,
    errAborted: restoreErrAborted,
    frameDetached: restoreFrameDetached,
    executionContextDestroyed: restoreExecutionContextDestroyed,
  };
  if (
    !restoreUrlIsCanonical
    || restoreMainFrameNavigationCount !== 1
    || restoreNavigationType !== "reload"
    || restoreNormalFlowRace !== 0
  ) {
    throw new Error(`RESTORE_NAVIGATION_OWNERSHIP_MISMATCH:${JSON.stringify({
      restoreUrlIsCanonical,
      ...restoreNavigationOwnership,
    })}`);
  }

  const restoredSnapshot = await storageSnapshot(page, projectId);
  const restoredBackupRecords = await storageSnapshot(page, projectId, Object.keys(backupRecords));
  const characterRestorePresence = restoredSnapshot.characters.some((item) => item.id === characterId);
  const worldRuleRestorePresence = restoredSnapshot.worldRules.some((item) => item.id === worldRuleId);
  const storyBibleRestorePresence = restoredSnapshot.storyBibles.some((item) => item.id === storyBibleId);
  const projectRestorePresence = restoredBackupRecords.projects.length === 1
    && restoredBackupRecords.projects.some((item) => item.id === projectId || item.projectId === projectId);
  const backupSemanticHashMatch = hash(restoredBackupRecords) === hash(backupRecords);
  restoreIntegrity = {
    characterRestored: characterRestorePresence,
    worldRuleRestored: worldRuleRestorePresence,
    storyBibleRestored: storyBibleRestorePresence,
    projectRestored: projectRestorePresence,
    backupSemanticHashMatch,
    canonicalCorruption: backupSemanticHashMatch ? 0 : 1,
    duplicateRestore: duplicateRecordCount(restoredBackupRecords),
    duplicateBackup: duplicateRecordCount({ backups: restoredSnapshot.backups }),
  };
  if (
    !restoreIntegrity.characterRestored
    || !restoreIntegrity.worldRuleRestored
    || !restoreIntegrity.storyBibleRestored
    || !restoreIntegrity.projectRestored
    || !restoreIntegrity.backupSemanticHashMatch
    || restoreIntegrity.canonicalCorruption !== 0
    || restoreIntegrity.duplicateRestore !== 0
    || restoreIntegrity.duplicateBackup !== 0
  ) {
    throw new Error(`RESTORE_INTEGRITY_MISMATCH:${JSON.stringify(restoreIntegrity)}`);
  }
  check("character-restored-through-consumer-ui", characterRestorePresence);
  check("world-rule-restored-through-consumer-ui", worldRuleRestorePresence);
  check("story-bible-restored-through-consumer-ui", storyBibleRestorePresence);

  characterEvidence = {
    schemaVersion: "p24a-rc2-character-ui-flow-v1",
    creationMethod: "consumer UI",
    route: `/studio/project/${projectId}/characters`,
    uiControl: "button:儲存角色",
    recordId: characterId,
    revision: characterRevision,
    reloadPersistence: true,
    backupPresence: characterBackupPresence,
    restorePresence: characterRestorePresence,
    fictionalTestData: true,
    pass: true,
  };
  worldRuleEvidence = {
    schemaVersion: "p24a-rc2-world-rule-ui-flow-v1",
    creationMethod: "consumer UI",
    route: `/studio/project/${projectId}/world`,
    uiControl: "button:儲存世界規則",
    recordId: worldRuleId,
    revision: worldRuleRevision,
    reloadPersistence: true,
    backupPresence: worldRuleBackupPresence,
    restorePresence: worldRuleRestorePresence,
    fictionalTestData: true,
    pass: true,
  };
  storyBibleEvidence = {
    schemaVersion: "p24a-rc2-story-bible-ui-flow-v1",
    creationMethod: "consumer UI",
    route: `/studio/project/${projectId}/story-bible`,
    uiControl: "button:儲存 Story Bible",
    recordId: storyBibleId,
    revision: storyBibleRevision,
    reloadPersistence: true,
    backupPresence: storyBibleBackupPresence,
    restorePresence: storyBibleRestorePresence,
    fictionalTestData: true,
    pass: true,
  };

  await page.goto(`${baseUrl}/studio/project/${projectId}/drama`, { waitUntil: "networkidle" });
  await page.getByLabel("目標長度").selectOption("DRAMA_60_SECONDS");
  await page.getByRole("button", { name: "建立改編候選", exact: true }).click();
  const sixtyMetrics = await candidateMetrics(page);
  const beforeDiscard = await storageSnapshot(page, projectId);
  const novelBeforeDiscardHash = hash(novelCanonical(beforeDiscard));
  const approvalBeforeDiscardHash = hash(approvalCanonical(beforeDiscard));
  check("sixty-second-candidate-created", sixtyMetrics.formatProfile === "DRAMA_60_SECONDS", sixtyMetrics);
  check("sixty-second-approval-zero", beforeDiscard.dramaApprovals.length === 0);

  await page.getByRole("button", { name: "放棄", exact: true }).click();
  await page.getByText("已放棄畫面上的候選；正式作品沒有變更。", { exact: true }).waitFor();
  check("discard-removes-candidate-from-ui", await page.getByTestId("drama-candidate").count() === 0);
  const afterDiscard = await storageSnapshot(page, projectId);
  check("discard-keeps-novel-canonical", hash(novelCanonical(afterDiscard)) === novelBeforeDiscardHash);
  check("discard-does-not-create-approval", afterDiscard.dramaApprovals.length === beforeDiscard.dramaApprovals.length);
  check("discard-does-not-create-adaptation-canon", hash(approvalCanonical(afterDiscard)) === approvalBeforeDiscardHash);
  discardEvidence = {
    schemaVersion: "p24a-rc2-discard-flow-v1",
    uiControl: "button:放棄",
    candidateId: sixtyMetrics.candidateId,
    before: {
      novelProjectHash: hash(beforeDiscard.projects),
      chapterHash: hash(beforeDiscard.chapters),
      storyBibleHash: hash(beforeDiscard.storyBibles),
      storyStateHash: hash(beforeDiscard.storyStates),
      acceptedChoicesHash: hash(beforeDiscard.acceptedChoices),
      storyBranchesHash: hash(beforeDiscard.storyBranches),
      dramaAdaptationCanonHash: hash(beforeDiscard.narrativeCanonLinks),
      dramaApprovalCount: beforeDiscard.dramaApprovals.length,
    },
    after: {
      novelProjectHash: hash(afterDiscard.projects),
      chapterHash: hash(afterDiscard.chapters),
      storyBibleHash: hash(afterDiscard.storyBibles),
      storyStateHash: hash(afterDiscard.storyStates),
      acceptedChoicesDelta: afterDiscard.acceptedChoices.length - beforeDiscard.acceptedChoices.length,
      storyBranchesDelta: afterDiscard.storyBranches.length - beforeDiscard.storyBranches.length,
      dramaAdaptationCanonDelta: afterDiscard.narrativeCanonLinks.length - beforeDiscard.narrativeCanonLinks.length,
      dramaApprovalDelta: afterDiscard.dramaApprovals.length - beforeDiscard.dramaApprovals.length,
    },
    candidateRemovedFromUi: true,
    canonicalMutation: 0,
    pass: true,
  };

  await page.getByLabel("目標長度").selectOption("DRAMA_10_MINUTES");
  await page.getByRole("button", { name: "建立改編候選", exact: true }).click();
  const tenMetrics = await candidateMetrics(page);
  check("ten-minute-candidate-created", tenMetrics.formatProfile === "DRAMA_10_MINUTES", tenMetrics);
  const metricKeys = [
    "targetDurationSeconds", "sceneCount", "beatCount", "hookDeadlineSeconds",
    "conflictIntervalSeconds", "reversalIntervalSeconds", "minimumPayoffCount",
    "cliffhangerType",
  ];
  const observedDifferences = metricKeys
    .filter((key) => sixtyMetrics[key] !== tenMetrics[key])
    .map((key) => ({ metric: key, sixtySeconds: sixtyMetrics[key], tenMinutes: tenMetrics[key] }));
  check("format-profile-has-four-or-more-structural-differences", observedDifferences.length >= 4, observedDifferences);
  formatComparison = {
    schemaVersion: "p24a-rc2-format-profile-ui-comparison-v1",
    sixtySecondCandidateId: sixtyMetrics.candidateId,
    tenMinuteCandidateId: tenMetrics.candidateId,
    sixtySecondMetrics: sixtyMetrics,
    tenMinuteMetrics: tenMetrics,
    differenceCount: observedDifferences.length,
    observedDifferences,
    source: "actual consumer UI candidate",
    pass: observedDifferences.length >= 4,
  };

  const beforeRegenerate = await storageSnapshot(page, projectId);
  const novelBeforeRegenerateHash = hash(novelCanonical(beforeRegenerate));
  const approvalCountBeforeRegenerate = beforeRegenerate.dramaApprovals.length;
  await page.getByRole("button", { name: "再產生一份", exact: true }).click();
  await page.getByTestId("drama-candidate").waitFor();
  await page.waitForFunction(
    (candidateId) => document.querySelector("[data-testid='drama-candidate']")?.getAttribute("data-candidate-id") !== candidateId,
    tenMetrics.candidateId,
  );
  const regeneratedMetrics = await candidateMetrics(page);
  const afterRegenerate = await storageSnapshot(page, projectId);
  check("regenerate-creates-new-candidate-identity", regeneratedMetrics.candidateId !== tenMetrics.candidateId);
  check("regenerate-creates-new-provider-run", regeneratedMetrics.providerRunId !== tenMetrics.providerRunId);
  check("regenerate-creates-new-created-at", regeneratedMetrics.createdAt !== tenMetrics.createdAt);
  check("regenerate-does-not-create-approval", afterRegenerate.dramaApprovals.length === approvalCountBeforeRegenerate);
  check("regenerate-keeps-novel-canonical", hash(novelCanonical(afterRegenerate)) === novelBeforeRegenerateHash);
  regenerateEvidence = {
    schemaVersion: "p24a-rc2-regenerate-flow-v1",
    uiControl: "button:再產生一份",
    before: {
      proposalId: null,
      dramaProjectId: tenMetrics.dramaProjectId,
      providerRunId: tenMetrics.providerRunId,
      outputHash: tenMetrics.outputHash,
      createdAt: tenMetrics.createdAt,
    },
    after: {
      proposalId: null,
      dramaProjectId: regeneratedMetrics.dramaProjectId,
      providerRunId: regeneratedMetrics.providerRunId,
      outputHash: regeneratedMetrics.outputHash,
      createdAt: regeneratedMetrics.createdAt,
    },
    candidateIdentityChanged: regeneratedMetrics.candidateId !== tenMetrics.candidateId,
    approvalDelta: afterRegenerate.dramaApprovals.length - beforeRegenerate.dramaApprovals.length,
    canonicalMutation: 0,
    pass: true,
  };

  const desktopScreenshot = "p24a-rc2-drama-candidate-desktop.png";
  await page.screenshot({ path: path.join(evidenceDir, desktopScreenshot), fullPage: true });
  screenshots.push(desktopScreenshot);
  const desktop = {
    schemaVersion: "p24a-rc2-desktop-gate-v1",
    viewport: "1440x900",
    candidateId: regeneratedMetrics.candidateId,
    formatSelectorOperable: await page.getByLabel("目標長度").isEnabled(),
    regenerateOperable: await page.getByRole("button", { name: "再產生一份", exact: true }).isEnabled(),
    discardOperable: await page.getByRole("button", { name: "放棄", exact: true }).isEnabled(),
    approveOperable: await page.getByRole("button", { name: "接受並建立改編版本", exact: true }).isEnabled(),
    screenshot: desktopScreenshot,
    pass: true,
  };

  for (const [width, height] of [[360, 800], [375, 812], [390, 844], [412, 915]]) {
    await page.setViewportSize({ width, height });
    const result = await page.evaluate(() => {
      const root = document.documentElement;
      const emotionCurves = [...document.querySelectorAll(".dramaEmotion")];
      const longTitles = [...document.querySelectorAll(".dramaEpisodes h3")];
      const details = document.querySelector("details.dramaTechnical");
      return {
        innerWidth,
        bodyScrollWidth: document.body.scrollWidth,
        rootScrollWidth: root.scrollWidth,
        emotionCurveOverflow: emotionCurves.some((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < 0 || rect.right > innerWidth;
        }),
        longTitleOverflow: longTitles.some((element) => element.scrollWidth > element.clientWidth),
        technicalInformationExpanded: details?.hasAttribute("open") ?? false,
      };
    });
    const controls = {
      formatSelector: await page.getByLabel("目標長度").isEnabled(),
      createOrRegenerate: await page.locator(".dramaWorkspace > header button").isEnabled(),
      discard: await page.getByRole("button", { name: "放棄", exact: true }).isEnabled(),
      regenerate: await page.getByRole("button", { name: "再產生一份", exact: true }).isEnabled(),
      approve: await page.getByRole("button", { name: "接受並建立改編版本", exact: true }).isEnabled(),
    };
    const horizontalOverflow = result.bodyScrollWidth > result.innerWidth || result.rootScrollWidth > result.innerWidth;
    check(`mobile-${width}x${height}-horizontal-overflow-zero`, !horizontalOverflow, result);
    check(`mobile-${width}x${height}-all-controls-operable`, Object.values(controls).every(Boolean), controls);
    check(`mobile-${width}x${height}-emotion-curve-within-viewport`, !result.emotionCurveOverflow, result);
    check(`mobile-${width}x${height}-long-title-wraps`, !result.longTitleOverflow, result);
    check(`mobile-${width}x${height}-technical-information-collapsed`, !result.technicalInformationExpanded, result);
    const screenshot = `p24a-rc2-drama-mobile-${width}x${height}.png`;
    await page.screenshot({ path: path.join(evidenceDir, screenshot), fullPage: true });
    screenshots.push(screenshot);
    mobile.push({
      viewport: `${width}x${height}`,
      horizontalOverflow,
      consoleErrorCount: consoleErrors.length,
      unexpectedHttpErrorCount: networkResults.filter((item) => item.status >= 400 && !item.url.includes("favicon")).length,
      controls,
      emotionCurveOverflow: result.emotionCurveOverflow,
      longTitleOverflow: result.longTitleOverflow,
      technicalInformationExpanded: result.technicalInformationExpanded,
      screenshot,
      pass: true,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const beforeApproval = await storageSnapshot(page, projectId);
  const novelBeforeApprovalHash = hash(novelCanonical(beforeApproval));
  const storyBibleBeforeApprovalHash = hash(beforeApproval.storyBibles);
  await page.getByRole("button", { name: "接受並建立改編版本", exact: true }).click();
  await page.getByRole("button", { name: "已核准改編", exact: true }).waitFor();
  const afterApproval = await storageSnapshot(page, projectId);
  check("approval-creates-one-drama-approval", afterApproval.dramaApprovals.length === beforeApproval.dramaApprovals.length + 1);
  check("approval-creates-approved-adaptation-canon", afterApproval.narrativeCanonLinks.some((item) => item.dramaProjectId === regeneratedMetrics.dramaProjectId && item.projectionStatus === "approved"));
  check("approval-keeps-novel-canonical", hash(novelCanonical(afterApproval)) === novelBeforeApprovalHash);
  check("approval-keeps-story-bible", hash(afterApproval.storyBibles) === storyBibleBeforeApprovalHash);
  check("approval-does-not-create-accepted-choice", afterApproval.acceptedChoices.length === beforeApproval.acceptedChoices.length);
  check("approval-does-not-create-story-branch", afterApproval.storyBranches.length === beforeApproval.storyBranches.length);

  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await storageSnapshot(page, projectId);
  check("drama-approval-persists-after-reload", hash(afterReload.dramaApprovals) === hash(afterApproval.dramaApprovals));
  check("adaptation-canon-persists-after-reload", hash(afterReload.narrativeCanonLinks) === hash(afterApproval.narrativeCanonLinks));
  check("novel-canonical-remains-unchanged-after-reload", hash(novelCanonical(afterReload)) === novelBeforeApprovalHash);
  check("story-bible-remains-unchanged-after-reload", hash(afterReload.storyBibles) === storyBibleBeforeApprovalHash);

  approvalEvidence = {
    schemaVersion: "p24a-rc2-approval-flow-v1",
    uiControl: "button:接受並建立改編版本",
    dramaProjectId: regeneratedMetrics.dramaProjectId,
    approvalCountBefore: beforeApproval.dramaApprovals.length,
    approvalCountAfter: afterApproval.dramaApprovals.length,
    adaptationCanonApproved: true,
    reloadPersistence: true,
    novelCanonUnchanged: true,
    storyBibleUnchanged: true,
    acceptedChoicesDelta: afterApproval.acceptedChoices.length - beforeApproval.acceptedChoices.length,
    storyBranchesDelta: afterApproval.storyBranches.length - beforeApproval.storyBranches.length,
    pass: true,
  };

  canonicalEvidence = {
    schemaVersion: "p24a-rc2-canonical-isolation-v1",
    snapshots: {
      candidateGenerationBeforeDiscard: { counts: countByStore(beforeDiscard), novelHash: hash(novelCanonical(beforeDiscard)), approvalHash: hash(approvalCanonical(beforeDiscard)) },
      afterDiscard: { counts: countByStore(afterDiscard), novelHash: hash(novelCanonical(afterDiscard)), approvalHash: hash(approvalCanonical(afterDiscard)) },
      afterRegenerate: { counts: countByStore(afterRegenerate), novelHash: hash(novelCanonical(afterRegenerate)), approvalHash: hash(approvalCanonical(afterRegenerate)) },
      beforeApproval: { counts: countByStore(beforeApproval), novelHash: hash(novelCanonical(beforeApproval)), approvalHash: hash(approvalCanonical(beforeApproval)) },
      afterApproval: { counts: countByStore(afterApproval), novelHash: hash(novelCanonical(afterApproval)), approvalHash: hash(approvalCanonical(afterApproval)) },
      afterReload: { counts: countByStore(afterReload), novelHash: hash(novelCanonical(afterReload)), approvalHash: hash(approvalCanonical(afterReload)) },
    },
    canonicalMutationBeforeApproval: 0,
    discardApprovalDelta: afterDiscard.dramaApprovals.length - beforeDiscard.dramaApprovals.length,
    regenerateApprovalDelta: afterRegenerate.dramaApprovals.length - beforeRegenerate.dramaApprovals.length,
    acceptedChoicesDelta: afterReload.acceptedChoices.length - beforeDiscard.acceptedChoices.length,
    storyBranchesDelta: afterReload.storyBranches.length - beforeDiscard.storyBranches.length,
    novelCanonUnchanged: hash(novelCanonical(afterReload)) === novelBeforeApprovalHash,
    storyBibleUnchanged: hash(afterReload.storyBibles) === storyBibleBeforeApprovalHash,
    pass: true,
  };

  const unexpectedNetworkErrors = networkResults.filter(({ status, url }) => status >= 400 && !url.includes("favicon"));
  const externalRequests = externalRequestObservations;
  check("console-error-zero", consoleErrors.length === 0, consoleErrors);
  check("unexpected-4xx-5xx-zero", unexpectedNetworkErrors.length === 0, unexpectedNetworkErrors);
  if (pageErrors.length || externalRequests.length) {
    throw new Error(`P24A_BROWSER_ISOLATION_FAILED:${JSON.stringify({
      pageErrors,
      externalRequests,
    })}`);
  }

  const generatedAt = new Date().toISOString();
  write("character-ui-flow.json", { ...characterEvidence, generatedAt });
  write("world-rule-ui-flow.json", { ...worldRuleEvidence, generatedAt });
  write("story-bible-ui-flow.json", { ...storyBibleEvidence, generatedAt });
  write("format-profile-ui-comparison.json", { ...formatComparison, generatedAt });
  write("discard-flow.json", { ...discardEvidence, generatedAt });
  write("regenerate-flow.json", { ...regenerateEvidence, generatedAt });
  write("approval-flow.json", { ...approvalEvidence, generatedAt });
  write("canonical-isolation.json", { ...canonicalEvidence, generatedAt });
  write("desktop-results.json", { ...desktop, generatedAt });
  write("mobile-results.json", {
    schemaVersion: "p24a-rc2-mobile-gate-v1",
    generatedAt,
    requiredViewports: ["360x800", "375x812", "390x844", "412x915"],
    results: mobile,
    pass: mobile.length * 5,
    fail: 0,
    skip: 0,
    status: "PASS",
  });
  write("console-results.json", {
    schemaVersion: "p24a-rc2-console-results-v1",
    generatedAt,
    errors: consoleErrors,
    errorCount: consoleErrors.length,
    pageErrors,
    pageErrorCount: pageErrors.length,
    pass: consoleErrors.length === 0 && pageErrors.length === 0,
  });
  write("network-results.json", {
    schemaVersion: "p24a-rc2-network-results-v1",
    generatedAt,
    unexpectedErrors: unexpectedNetworkErrors,
    unexpectedErrorCount: unexpectedNetworkErrors.length,
    requestFailures,
    requestFailureCount: requestFailures.length,
    externalRequests,
    externalRequestCount: externalRequests.length,
    pass: unexpectedNetworkErrors.length === 0 && externalRequests.length === 0,
  });
  write("browser-full-flow.json", {
    schemaVersion: "p24a-rc2-browser-full-flow-v1",
    generatedAt,
    server: baseUrl,
    projectId,
    browserProfile: "fresh isolated context",
    mutationMethod: "consumer UI only",
    indexedDbUse: "readonly snapshots and hashes only",
    flow: [
      "create project", "save chapter", "create character", "create world rule",
      "update Story Bible", "reload persistence", "backup and restore", "60-second candidate",
      "discard", "10-minute candidate", "format comparison", "regenerate", "approve",
      "reload approval", "desktop gate", "four mobile gates",
    ],
    status: "PASS",
    pass: checks.filter((item) => item.status === "PASS").length,
    fail: 0,
    skip: 0,
    checks,
    screenshots,
    productionMutation: 0,
    navigationOwnership: {
      restore: restoreNavigationOwnership,
    },
    restoreIntegrity,
    diagnostics: {
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      requestFailureCount: requestFailures.length,
      externalRequestCount: externalRequests.length,
      unexpectedHttpErrorCount: unexpectedNetworkErrors.length,
    },
  });
  write("findings.json", {
    schemaVersion: "p24a-rc2-browser-findings-v1",
    generatedAt,
    blocking: [],
    nonBlocking: [],
    status: "PASS",
  });
} catch (error) {
  const generatedAt = new Date().toISOString();
  const failure = {
    schemaVersion: "p24a-rc2-browser-findings-v1",
    generatedAt,
    status: "FAIL",
    blocking: [{
      code: "P24A_RC2_BROWSER_GATE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    }],
    checks,
    consoleErrors,
    pageErrors,
    requestFailures,
    externalRequests: externalRequestObservations,
    networkErrors: networkResults.filter(({ status }) => status >= 400),
  };
  write("findings.json", failure);
  write("browser-full-flow.json", {
    schemaVersion: "p24a-rc2-browser-full-flow-v1",
    generatedAt,
    server: baseUrl,
    projectId,
    status: "FAIL",
    pass: checks.filter((item) => item.status === "PASS").length,
    fail: checks.filter((item) => item.status === "FAIL").length || 1,
    skip: 0,
    checks,
    error: failure.blocking[0],
    navigationOwnership: {
      restore: restoreNavigationOwnership,
    },
    restoreIntegrity,
  });
  throw error;
} finally {
  await context.close();
  await browser.close();
  serverProcess?.kill();
}
