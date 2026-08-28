import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { NOVEL_STORES } from "../lib/novel-ai/repository/contracts/index.ts";
import {
  INDEXEDDB_DATABASE_VERSION,
  INDEXEDDB_MIGRATION_VERSION,
  PERSISTENCE_FAILURE_SCHEMA_VERSION,
} from "../lib/novel-ai/repository/persistence-recovery.ts";

const baseUrl = (process.env.RC6_2_BASE_URL || "http://127.0.0.1:3136").replace(/\/$/u, "");
const requiredStores = [...new Set([...NOVEL_STORES, "requestLedger"])].sort();
const results = [];
const consoleErrors = [];
let serverProcess = null;

const OPTIONAL_LOOPBACK_HEALTH_URLS = new Set([
  "http://127.0.0.1:3217/health",
  "http://127.0.0.1:3227/health",
]);

async function fulfillUnavailableOptionalLoopbackHealth(route) {
  const request = route.request();
  const headers = {
    "Access-Control-Allow-Origin": new URL(baseUrl).origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": request.headers()["access-control-request-headers"]
      ?? "X-Bridge-Protocol, X-Private-Hub-Protocol",
    Vary: "Origin",
  };
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers, body: "" });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers,
    body: JSON.stringify({
      bridgeProcessAlive: false,
      runtimeReady: false,
      ollamaReachable: false,
      models: [],
    }),
  });
}

function check(name, condition, details = null) {
  const result = { name, status: condition ? "PASS" : "FAIL", details };
  results.push(result);
  assert.equal(Boolean(condition), true, `${name}:${JSON.stringify(details)}`);
}

async function startServer() {
  if (process.env.RC6_2_START_SERVER !== "1") return;
  const port = new URL(baseUrl).port || "3136";
  const mode = process.env.RC6_2_SERVER_MODE === "production" ? "start" : "dev";
  serverProcess = spawn(
    process.execPath,
    [path.join(process.cwd(), "node_modules/next/dist/bin/next"), mode, "-p", port],
    { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const output = [];
  serverProcess.stdout?.on("data", (chunk) => output.push(chunk.toString()));
  serverProcess.stderr?.on("data", (chunk) => output.push(chunk.toString()));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (serverProcess.exitCode !== null) throw new Error(`RC6_2_SERVER_EXITED:${output.join("").slice(-3000)}`);
    try {
      const response = await fetch(`${baseUrl}/studio/create`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`RC6_2_SERVER_TIMEOUT:${output.join("").slice(-3000)}`);
}

async function createProject(page, title) {
  await page.goto(`${baseUrl}/studio/create`, { waitUntil: "networkidle" });
  await page.getByTestId("p2-project-title").fill(title);
  await page.getByTestId("create-play-mode-general").click();
  await page.locator('[data-topic-id="classic-topic-002"]').click();
  await page.getByTestId("create-ai-story-seed").click();
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="create-ai-story-seed"]');
    const status = document.querySelector('[data-testid="create-ai-story-seed-status"]');
    return Boolean(button && !button.hasAttribute("disabled") && status?.textContent?.trim());
  }, undefined, { timeout: 90_000 });

  const stepBar = page.locator(".p2StepBar");
  const next = page.locator(".p2CreatePanel > footer button.gold");
  for (let expectedStep = 2; expectedStep <= 3; expectedStep += 1) {
    const previous = await stepBar.getAttribute("aria-label");
    await next.click();
    await page.waitForFunction(
      ({ selector, previous }) => document.querySelector(selector)?.getAttribute("aria-label") !== previous,
      { selector: ".p2StepBar", previous },
    );
    assert.match(await stepBar.getAttribute("aria-label") ?? "", new RegExp(String(expectedStep), "u"));
  }

  const familyCandidates = page.getByTestId("creation-stage-family-candidates");
  await familyCandidates.waitFor({ state: "visible" });
  await familyCandidates.getByRole("button", { name: /選擇這組上場群像/u }).first().click();
  await page.locator(".p2FoundationReady").waitFor({ state: "visible" });
  await next.click();
  await page.locator(".p2CreateSuccess").waitFor({ timeout: 90_000 });
  const href = await page.locator('.p2CreateSuccess a[href*="/chat"]').first().getAttribute("href");
  const projectId = href?.match(/\/studio\/project\/([^/]+)\/chat/u)?.[1] ?? "";
  assert.ok(projectId, `PROJECT_ID_MISSING:${href}`);
  return decodeURIComponent(projectId);
}

async function databaseSnapshot(page) {
  return page.evaluate(async ({ databaseName, requiredStores }) => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open(databaseName);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const actualStores = [...db.objectStoreNames].sort();
    const missingStores = requiredStores.filter((store) => !actualStores.includes(store));
    const readAll = (store) => new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const projects = await readAll("projects");
    const storyBibles = await readAll("storyBibles");
    const version = db.version;
    db.close();
    return { version, actualStores, missingStores, projects, storyBibles };
  }, { databaseName: "novel-intelligence-platform", requiredStores });
}

async function transactionAndQuotaProbe(page) {
  return page.evaluate(async () => {
    const estimate = await navigator.storage.estimate();
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open("novel-intelligence-platform");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const id = `rc6-2-transaction-probe-${crypto.randomUUID()}`;
    const row = { id, projectId: "rc6-2-probe", revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put(row);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    const stored = await new Promise((resolve, reject) => {
      const request = db.transaction("settings", "readonly").objectStore("settings").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").delete(id);
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    const removed = await new Promise((resolve, reject) => {
      const request = db.transaction("settings", "readonly").objectStore("settings").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return {
      transactionCommitted: stored?.id === id,
      cleanupComplete: removed === undefined,
      quota: estimate.quota ?? null,
      usage: estimate.usage ?? null,
    };
  });
}

async function storyBiblesByProject(page, projectIds) {
  return page.evaluate(async (projectIds) => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open("novel-intelligence-platform");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const result = {};
    for (const projectId of projectIds) {
      result[projectId] = await new Promise((resolve, reject) => {
        const request = db.transaction("storyBibles", "readonly").objectStore("storyBibles").index("projectId").getAll(projectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close();
    return result;
  }, projectIds);
}

async function waitForProjectStoryBibleCandidate(page, projectId, expectedFields, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let candidates = [];
  const listFields = {
    foreshadowing: "foreshadowing",
    unresolved: "unresolvedThreads",
    contradictions: "forbiddenContradictions",
    preferences: "authorPreferences",
  };
  while (Date.now() < deadline) {
    const records = await storyBiblesByProject(page, [projectId]);
    candidates = records[projectId] ?? [];
    const match = candidates.find((candidate) => Object.entries(expectedFields).every(([field, expected]) => {
      if (field === "theme" || field === "style") return candidate?.[field]?.value === expected;
      const stored = candidate?.[listFields[field]];
      return Array.isArray(stored) && stored.join("\n") === expected;
    }));
    if (match) return match;
    await page.waitForTimeout(100);
  }
  throw new Error(`STORY_BIBLE_CANDIDATE_TIMEOUT:${JSON.stringify({
    projectId,
    observedCandidates: candidates.map((candidate) => ({ id: candidate.id, revision: candidate.revision })),
    expectedFieldNames: Object.keys(expectedFields),
  })}`);
}

async function createAndCopyGlobalStoryBible(page, projectId, title, values) {
  await page.goto(`${baseUrl}/canon?targetProjectId=${encodeURIComponent(projectId)}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("global-canon-editor").waitFor();
  await page.getByTestId("global-canon-characters").waitFor();
  const targetProject = page.getByTestId("global-canon-target-project");
  await targetProject.selectOption(projectId);
  await page.getByRole("tab", { name: "Story Bible", exact: true }).click();
  const workspace = page.getByTestId("global-canon-story-bibles");
  await workspace.waitFor();
  await workspace.getByLabel("名稱", { exact: true }).fill(title);
  await workspace.getByLabel("核心主題", { exact: true }).fill(values.theme ?? "");
  await workspace.getByLabel("敘事風格", { exact: true }).fill(values.style ?? "");
  await workspace.getByLabel(/伏筆/u).fill(values.foreshadowing ?? "");
  await workspace.getByLabel("未解線索", { exact: true }).fill(values.unresolved ?? "");
  await workspace.getByLabel("禁止矛盾", { exact: true }).fill(values.contradictions ?? "");
  await workspace.getByLabel("作者偏好", { exact: true }).fill(values.preferences ?? "");
  await workspace.getByRole("button", { name: "加入 Story Bible 總庫", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Story Bible 已加入全域總庫" }).waitFor();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("global-canon-characters").waitFor();
  await page.getByRole("tab", { name: "Story Bible", exact: true }).click();
  const persistedWorkspace = page.getByTestId("global-canon-story-bibles");
  const record = persistedWorkspace.locator("article").filter({ hasText: title });
  await record.waitFor();
  check(`global Story Bible reload restores ${title}`, (await record.innerText()).includes(values.theme ?? "")
    && (await record.innerText()).includes(values.style ?? ""));
  await record.getByRole("button", { name: "整套複製為作品候選", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "複製成作品候選" }).waitFor();
}

async function blockedUpgradeAndRetry(browser) {
  const context = await browser.newContext({ locale: "zh-TW", serviceWorkers: "block" });
  const blockerPage = await context.newPage();
  const appPage = await context.newPage();
  try {
    await blockerPage.goto(`${baseUrl}/api/release/identity`);
    await blockerPage.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase("novel-intelligence-platform");
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      globalThis.__rc62Blocker = await new Promise((resolve, reject) => {
        const request = indexedDB.open("novel-intelligence-platform", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("legacy", { keyPath: "id" });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    });
    await appPage.goto(`${baseUrl}/studio/project/rc6-2-blocked/tasks`, { waitUntil: "domcontentloaded" });
    const recovery = appPage.getByTestId("indexeddb-recovery");
    await recovery.waitFor({ timeout: 15_000 });
    const reason = await recovery.getAttribute("data-database-error-code");
    check("blocked upgrade returns safe reason", reason === "INDEXEDDB_UPGRADE_BLOCKED", { reason });
    await blockerPage.evaluate(() => globalThis.__rc62Blocker.close());
    await blockerPage.close();
    await recovery.getByRole("button", { name: /IndexedDB/u }).click();
    await appPage.getByRole("heading", { name: "找不到作品" }).waitFor({ timeout: 15_000 });
    const snapshot = await databaseSnapshot(appPage);
    check("blocked upgrade retry opens current schema", snapshot.version === INDEXEDDB_DATABASE_VERSION && snapshot.missingStores.length === 0, {
      version: snapshot.version,
      missingStores: snapshot.missingStores,
    });
  } finally {
    await context.close();
  }
}

async function versionChangeGate(browser) {
  const context = await browser.newContext({ locale: "zh-TW", serviceWorkers: "block" });
  const appPage = await context.newPage();
  const upgrader = await context.newPage();
  try {
    await appPage.goto(`${baseUrl}/studio/project/rc6-2-version-a/tasks`, { waitUntil: "networkidle" });
    await appPage.getByRole("heading", { name: "找不到作品" }).waitFor();
    await upgrader.goto(`${baseUrl}/api/release/identity`);
    await upgrader.evaluate(async (version) => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("novel-intelligence-platform", version);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("VERSIONCHANGE_BLOCKED"));
      });
      db.close();
    }, INDEXEDDB_DATABASE_VERSION + 1);
    await appPage.goto(`${baseUrl}/studio/project/rc6-2-version-b/tasks`, { waitUntil: "domcontentloaded" });
    const recovery = appPage.getByTestId("indexeddb-recovery");
    await recovery.waitFor({ timeout: 15_000 });
    const reason = await recovery.getAttribute("data-database-error-code");
    check("versionchange closes stale connection and reports safe reason", reason === "INDEXEDDB_VERSION_CHANGED", { reason });
  } finally {
    await context.close();
  }
}

async function unavailableStorageGate(browser) {
  const context = await browser.newContext({ locale: "zh-TW", serviceWorkers: "block" });
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/studio/project/rc6-2-unavailable/tasks`, { waitUntil: "domcontentloaded" });
    const recovery = page.getByTestId("indexeddb-recovery");
    await recovery.waitFor({ timeout: 15_000 });
    const safeTruth = await recovery.evaluate((element) => ({
      databaseErrorCode: element.dataset.databaseErrorCode,
      fallbackReason: element.dataset.fallbackReason,
      schemaVersion: element.dataset.schemaVersion,
      migrationVersion: element.dataset.migrationVersion,
      memoryFallback: element.dataset.memoryFallback,
      text: element.textContent,
    }));
    check("unavailable storage is explicit and never memory", safeTruth.databaseErrorCode === "INDEXEDDB_UNAVAILABLE"
      && safeTruth.fallbackReason === "fail_closed:indexeddb_unavailable"
      && safeTruth.schemaVersion === PERSISTENCE_FAILURE_SCHEMA_VERSION
      && safeTruth.migrationVersion === INDEXEDDB_MIGRATION_VERSION
      && safeTruth.memoryFallback === "false"
      && !safeTruth.text.includes("stack"), safeTruth);
    check("safe recovery exposes retry and reload", await recovery.getByRole("button").count() === 2);
  } finally {
    await context.close();
  }
}

await startServer();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-TW", serviceWorkers: "block" });
for (const endpoint of OPTIONAL_LOOPBACK_HEALTH_URLS) {
  await context.route(endpoint, fulfillUnavailableOptionalLoopbackHealth);
}
const page = await context.newPage();
page.setDefaultNavigationTimeout(90_000);
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({
    type: "console",
    text: message.text(),
    pageUrl: page.url(),
    sourceUrl: message.location().url,
  });
});
page.on("pageerror", (error) => consoleErrors.push({ type: "pageerror", text: error.message, pageUrl: page.url() }));

let report;
try {
  await page.goto(`${baseUrl}/studio/create`, { waitUntil: "networkidle" });
  const initialDatabases = await page.evaluate(async () => typeof indexedDB.databases === "function" ? indexedDB.databases() : []);
  check("fresh browser starts without application database", initialDatabases.every((item) => item.name !== "novel-intelligence-platform"), initialDatabases);

  const firstProjectId = await createProject(page, "RC6.2 Fresh Story One");
  const fresh = await databaseSnapshot(page);
  check("fresh IndexedDB version is current", fresh.version === INDEXEDDB_DATABASE_VERSION, { version: fresh.version });
  check("fresh IndexedDB contains every required store", fresh.missingStores.length === 0, { missingStores: fresh.missingStores, storeCount: fresh.actualStores.length });
  check("fresh project creates project and Story Bible atomically", fresh.projects.length === 1
    && fresh.storyBibles.length === 1
    && fresh.storyBibles[0].projectId === firstProjectId, {
      projects: fresh.projects.map((item) => item.id),
      storyBibles: fresh.storyBibles.map((item) => ({ id: item.id, projectId: item.projectId })),
    });

  const transaction = await transactionAndQuotaProbe(page);
  check("real IndexedDB readwrite transaction commits and cleans up", transaction.transactionCommitted && transaction.cleanupComplete, transaction);
  check("browser storage quota is available", Number.isFinite(transaction.quota) && transaction.quota > 0, transaction);

  await page.goto(`${baseUrl}/studio/project/${encodeURIComponent(firstProjectId)}/tasks`, { waitUntil: "domcontentloaded" });
  const runtime = page.getByTestId("project-indexeddb-runtime");
  check("fresh project runtime is indexeddb and non-degraded", await runtime.getAttribute("data-persistence-backend") === "indexeddb"
    && await runtime.getAttribute("data-persistence-degraded") === "false"
    && await runtime.getAttribute("data-memory-fallback") === "false");
  await page.goto(`${baseUrl}/professional?intent=library&projectId=${encodeURIComponent(firstProjectId)}#character-world-memory-home`, { waitUntil: "domcontentloaded" });
  const firstProjectSummary = page.getByTestId("professional-canon-readonly-summary");
  await firstProjectSummary.waitFor();
  check("project management keeps Canon read-only and links to the global editor", await firstProjectSummary.getAttribute("data-canon-edit-surface") === "readonly-selection-links"
    && await page.getByTestId("story-bible-editor").count() === 0
    && await page.getByTestId("professional-canon-editor-link").getAttribute("href") === `/canon?targetProjectId=${encodeURIComponent(firstProjectId)}`);
  const firstValues = {
    theme: "RC6.2 第一作品唯一主題 7f9a",
    style: "第一作品敘事風格",
    foreshadowing: "第一作品祕密伏筆 alpha-only",
    unresolved: "第一作品未解線索",
    contradictions: "第一作品禁止矛盾",
    preferences: "第一作品作者偏好",
  };
  await createAndCopyGlobalStoryBible(page, firstProjectId, "RC6.2 第一作品全域 Bible", firstValues);
  const persistedFirstStoryBible = await waitForProjectStoryBibleCandidate(page, firstProjectId, firstValues);
  check("global Story Bible copy creates an immutable project candidate without changing it in place", Boolean(persistedFirstStoryBible.id)
    && Number(persistedFirstStoryBible.revision) >= 1, persistedFirstStoryBible);

  await page.goto(`${baseUrl}/studio/project/${encodeURIComponent(firstProjectId)}/story-bible`, { waitUntil: "domcontentloaded" });
  const selectionPage = page.getByTestId("story-stage-selection-page");
  const selectionSelector = page.getByTestId("story-stage-selector");
  await selectionSelector.waitFor();
  check("story route is selection-only and exposes no Story Bible Canon editor", await selectionPage.getAttribute("data-canon-edit-surface") === "story-selection-only"
    && await selectionSelector.getAttribute("data-canon-edit-surface") === "story-selection-only"
    && await page.getByTestId("story-bible-editor").count() === 0
    && await page.getByTestId("story-bible-save").count() === 0
    && await page.getByTestId("story-bible-theme").count() === 0);
  const firstCandidateButton = page.getByTestId("story-stage-bible-candidate").filter({ hasText: firstValues.theme });
  await firstCandidateButton.waitFor();
  if (await firstCandidateButton.getAttribute("aria-pressed") !== "true") await firstCandidateButton.click();
  await page.getByTestId("story-stage-bible-readonly").filter({ hasText: firstValues.theme }).waitFor();
  check("story route selects and renders the copied Story Bible as read-only", (await page.getByTestId("story-stage-bible-readonly").innerText()).includes(firstValues.theme));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("story-stage-bible-readonly").filter({ hasText: firstValues.theme }).waitFor();
  check("selected Story Bible survives a browser reload", (await page.getByTestId("story-stage-bible-readonly").innerText()).includes(firstValues.theme));
  const conversationLink = page.locator(`nav[aria-label="作品導覽"] a[href="/studio/project/${encodeURIComponent(firstProjectId)}/chat"]`).first();
  check("selection-only Story Bible links to the same project chat", await conversationLink.count() === 1);
  await conversationLink.click();
  await page.getByTestId("conversation-first-workspace").waitFor({ timeout: 20_000 });
  check("Story Bible conversation access opens same project", new URL(page.url()).pathname.includes(`/studio/project/${encodeURIComponent(firstProjectId)}/chat`));

  const secondProjectId = await createProject(page, "RC6.2 Fresh Story Two");
  check("second project has a distinct id", secondProjectId !== firstProjectId, { firstProjectId, secondProjectId });
  await page.goto(`${baseUrl}/professional?intent=library&projectId=${encodeURIComponent(secondProjectId)}#character-world-memory-home`, { waitUntil: "domcontentloaded" });
  const secondProjectSummary = page.getByTestId("professional-canon-readonly-summary");
  await secondProjectSummary.waitFor();
  check("second project management surface is also read-only", await secondProjectSummary.getAttribute("data-canon-edit-surface") === "readonly-selection-links"
    && await page.getByTestId("story-bible-editor").count() === 0
    && await page.getByTestId("professional-canon-editor-link").getAttribute("href") === `/canon?targetProjectId=${encodeURIComponent(secondProjectId)}`);
  const secondValues = {
    theme: "RC6.2 第二作品唯一主題 3c1b",
    style: "第二作品敘事風格",
    foreshadowing: "第二作品伏筆 beta-only",
  };
  await createAndCopyGlobalStoryBible(page, secondProjectId, "RC6.2 第二作品全域 Bible", secondValues);
  await waitForProjectStoryBibleCandidate(page, secondProjectId, secondValues);
  await page.goto(`${baseUrl}/studio/project/${encodeURIComponent(secondProjectId)}/story-bible`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("story-stage-selector").waitFor();
  check("second project candidate list does not contain the first project's copied Bible", !(await page.getByTestId("story-stage-selector").innerText()).includes(firstValues.theme));
  const secondCandidateButton = page.getByTestId("story-stage-bible-candidate").filter({ hasText: secondValues.theme });
  await secondCandidateButton.waitFor();
  if (await secondCandidateButton.getAttribute("aria-pressed") !== "true") await secondCandidateButton.click();
  await page.getByTestId("story-stage-bible-readonly").filter({ hasText: secondValues.theme }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("story-stage-bible-readonly").filter({ hasText: secondValues.theme }).waitFor();
  check("second selected Story Bible reload is exact", (await page.getByTestId("story-stage-bible-readonly").innerText()).includes(secondValues.theme));
  const isolated = await storyBiblesByProject(page, [firstProjectId, secondProjectId]);
  check("Story Bible candidate snapshots are isolated by project", isolated[firstProjectId].length === 2
    && isolated[secondProjectId].length === 2
    && isolated[firstProjectId].some((candidate) => candidate.theme.value === firstValues.theme)
    && isolated[secondProjectId].some((candidate) => candidate.theme.value === secondValues.theme)
    && !JSON.stringify(isolated[firstProjectId]).includes("beta-only")
    && !JSON.stringify(isolated[secondProjectId]).includes("alpha-only"), {
      firstCount: isolated[firstProjectId].length,
      secondCount: isolated[secondProjectId].length,
    });

  const publicHealthResponse = await page.request.get(`${baseUrl}/api/ai/health`);
  const publicHealth = await publicHealthResponse.json();
  check("public health does not misreport client as memory degraded", publicHealth.activeProjectPersistence?.backend === "indexeddb"
    && publicHealth.activeProjectPersistence?.runtimeStatus === "client_probe_required"
    && publicHealth.activeProjectPersistence?.memoryFallback === false
    && publicHealth.primaryStorage === "INDEXEDDB_BROWSER_ACTIVE_PROJECT"
    && publicHealth.canonicalAuthority === "INDEXEDDB_CLIENT_PROJECT"
    && publicHealth.storageAdapterType === "indexeddb-canonical-client"
    && publicHealth.legacyServerStorage?.scope === "legacy_analysis_training_only"
    && publicHealth.legacyServerStorage?.affectsActiveProjectPersistence === false
    && publicHealth.database === "client_probe_required"
    && publicHealth.persistenceStatus === "client_probe_required"
    && publicHealth.serverPersistence?.affectsActiveProjectPersistence === false, {
      activeProjectPersistence: publicHealth.activeProjectPersistence,
      primaryStorage: publicHealth.primaryStorage,
      canonicalAuthority: publicHealth.canonicalAuthority,
      storageAdapterType: publicHealth.storageAdapterType,
      legacyServerStorage: publicHealth.legacyServerStorage,
      database: publicHealth.database,
      persistenceStatus: publicHealth.persistenceStatus,
      serverPersistence: publicHealth.serverPersistence,
    });

  await blockedUpgradeAndRetry(browser);
  await versionChangeGate(browser);
  await unavailableStorageGate(browser);
  check("primary browser has no console or page errors", consoleErrors.length === 0, consoleErrors);

  report = {
    schemaVersion: "rc6.2-persistence-story-bible-browser-v1",
    status: "PASS",
    baseUrl,
    persistenceBackend: "indexeddb",
    degraded: false,
    memoryFallback: false,
    databaseVersion: fresh.version,
    migrationVersion: INDEXEDDB_MIGRATION_VERSION,
    requiredStoreCount: requiredStores.length,
    firstProjectId,
    secondProjectId,
    checks: results,
  };
} catch (error) {
  report = {
    schemaVersion: "rc6.2-persistence-story-bible-browser-v1",
    status: "FAIL",
    baseUrl,
    error: error instanceof Error ? error.message : String(error),
    checks: results,
    consoleErrors,
  };
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
}

const evidencePath = process.env.RC6_2_EVIDENCE_PATH;
if (evidencePath) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(report, null, 2));
