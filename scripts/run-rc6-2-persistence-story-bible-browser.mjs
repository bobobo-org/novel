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
  await page.locator(".p2CreationAssistantActions > button").first().click();
  for (let step = 0; step < 4; step += 1) {
    const action = page.locator(".p2CreatePanel > footer button.gold");
    await action.waitFor();
    const label = (await action.textContent()) ?? "";
    await action.click();
    if (label.includes("建立") && label.includes("作品")) {
      await page.locator(".p2CreateSuccess").waitFor({ timeout: 30_000 });
      break;
    }
  }
  await page.locator(".p2CreateSuccess").waitFor({ timeout: 30_000 });
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

async function waitForPersistedStoryBible(page, projectId, {
  afterRevision,
  expectedFields,
  timeoutMs = 20_000,
}) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  const listFields = {
    foreshadowing: "foreshadowing",
    unresolved: "unresolvedThreads",
    contradictions: "forbiddenContradictions",
    preferences: "authorPreferences",
  };
  while (Date.now() < deadline) {
    const records = await storyBiblesByProject(page, [projectId]);
    latest = records[projectId]?.[0] ?? null;
    const fieldsMatch = Object.entries(expectedFields).every(([field, expected]) => {
      if (field === "theme" || field === "style") return latest?.[field]?.value === expected;
      const stored = latest?.[listFields[field]];
      return Array.isArray(stored) && stored.join("\n") === expected;
    });
    if (Number(latest?.revision) > afterRevision && fieldsMatch) return latest;
    await page.waitForTimeout(100);
  }
  throw new Error(`STORY_BIBLE_PERSISTENCE_TIMEOUT:${JSON.stringify({
    projectId,
    afterRevision,
    observedRevision: latest?.revision ?? null,
    expectedFieldNames: Object.keys(expectedFields),
  })}`);
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
    await appPage.goto(`${baseUrl}/studio/project/rc6-2-blocked/story-bible`, { waitUntil: "domcontentloaded" });
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
    await appPage.goto(`${baseUrl}/studio/project/rc6-2-version-a/story-bible`, { waitUntil: "networkidle" });
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
    await appPage.goto(`${baseUrl}/studio/project/rc6-2-version-b/story-bible`, { waitUntil: "domcontentloaded" });
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
    await page.goto(`${baseUrl}/studio/project/rc6-2-unavailable/story-bible`, { waitUntil: "domcontentloaded" });
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

  await page.goto(`${baseUrl}/studio/project/${encodeURIComponent(firstProjectId)}/story-bible`, { waitUntil: "networkidle" });
  const runtime = page.getByTestId("project-indexeddb-runtime");
  check("fresh project runtime is indexeddb and non-degraded", await runtime.getAttribute("data-persistence-backend") === "indexeddb"
    && await runtime.getAttribute("data-persistence-degraded") === "false"
    && await runtime.getAttribute("data-memory-fallback") === "false");
  const firstValues = {
    theme: "RC6.2 第一作品唯一主題 7f9a",
    style: "第一作品敘事風格",
    foreshadowing: "第一作品祕密伏筆 alpha-only",
    unresolved: "第一作品未解線索",
    contradictions: "第一作品禁止矛盾",
    preferences: "第一作品作者偏好",
  };
  const initialFirstRevision = Number(
    await page.getByTestId("story-bible-record").getAttribute("data-revision"),
  );
  await page.getByTestId("story-bible-theme").fill(firstValues.theme);
  await page.getByTestId("story-bible-style").fill(firstValues.style);
  await page.getByTestId("story-bible-foreshadowing").fill(firstValues.foreshadowing);
  await page.getByTestId("story-bible-unresolved").fill(firstValues.unresolved);
  await page.getByTestId("story-bible-contradictions").fill(firstValues.contradictions);
  await page.getByTestId("story-bible-preferences").fill(firstValues.preferences);
  await page.getByTestId("story-bible-save").click();
  await page.locator('.p2InlineEditor [role="status"]').filter({ hasText: "Story Bible 已保存" }).waitFor();
  const persistedFirstStoryBible = await waitForPersistedStoryBible(page, firstProjectId, {
    afterRevision: initialFirstRevision,
    expectedFields: firstValues,
  });
  const firstRevision = Number(persistedFirstStoryBible.revision);
  check("Story Bible write increments revision", firstRevision > initialFirstRevision, {
    initialFirstRevision,
    firstRevision,
  });
  await page.reload({ waitUntil: "networkidle" });
  check("Story Bible reload restores every edited field", await page.getByTestId("story-bible-theme").inputValue() === firstValues.theme
    && await page.getByTestId("story-bible-style").inputValue() === firstValues.style
    && await page.getByTestId("story-bible-foreshadowing").inputValue() === firstValues.foreshadowing
    && await page.getByTestId("story-bible-unresolved").inputValue() === firstValues.unresolved
    && await page.getByTestId("story-bible-contradictions").inputValue() === firstValues.contradictions
    && await page.getByTestId("story-bible-preferences").inputValue() === firstValues.preferences);

  const conversationLink = page.getByTestId("story-bible-conversation-link");
  check("Story Bible conversation link is project scoped", await conversationLink.getAttribute("data-project-id") === firstProjectId);
  await conversationLink.click();
  await page.getByTestId("conversation-first-workspace").waitFor({ timeout: 20_000 });
  check("Story Bible conversation access opens same project", new URL(page.url()).pathname.includes(`/studio/project/${encodeURIComponent(firstProjectId)}/chat`));
  const composer = page.getByTestId("conversation-message-composer").locator("textarea");
  await composer.waitFor();
  check("Story Bible conversation carries a scoped non-mutating request", new URL(page.url()).searchParams.get("prompt")?.includes("Story Bible") === true
    && new URL(page.url()).searchParams.get("prompt")?.includes("不要直接修改 Canon") === true);

  const secondProjectId = await createProject(page, "RC6.2 Fresh Story Two");
  check("second project has a distinct id", secondProjectId !== firstProjectId, { firstProjectId, secondProjectId });
  await page.goto(`${baseUrl}/studio/project/${encodeURIComponent(secondProjectId)}/story-bible`, { waitUntil: "networkidle" });
  check("second project editor does not retain first project state", !(await page.getByTestId("story-bible-theme").inputValue()).includes("第一作品")
    && !(await page.getByTestId("story-bible-foreshadowing").inputValue()).includes("alpha-only")
    && !(await page.locator("body").innerText()).includes(firstValues.foreshadowing));
  const secondValues = {
    theme: "RC6.2 第二作品唯一主題 3c1b",
    foreshadowing: "第二作品伏筆 beta-only",
  };
  const initialSecondRevision = Number(
    await page.getByTestId("story-bible-record").getAttribute("data-revision"),
  );
  await page.getByTestId("story-bible-theme").fill(secondValues.theme);
  await page.getByTestId("story-bible-foreshadowing").fill(secondValues.foreshadowing);
  await page.getByTestId("story-bible-save").click();
  await waitForPersistedStoryBible(page, secondProjectId, {
    afterRevision: initialSecondRevision,
    expectedFields: secondValues,
  });
  await page.locator('.p2InlineEditor [role="status"]').filter({ hasText: "Story Bible 已保存" }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  check("second Story Bible reload is exact", await page.getByTestId("story-bible-theme").inputValue() === secondValues.theme
    && await page.getByTestId("story-bible-foreshadowing").inputValue() === secondValues.foreshadowing);
  const isolated = await storyBiblesByProject(page, [firstProjectId, secondProjectId]);
  check("Story Bible records are isolated by project", isolated[firstProjectId].length === 1
    && isolated[secondProjectId].length === 1
    && isolated[firstProjectId][0].theme.value === firstValues.theme
    && isolated[secondProjectId][0].theme.value === secondValues.theme
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
