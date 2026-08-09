import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Rc6TestHarness, assert } from "./rc6-test-harness.mjs";

const mode = process.argv[2] ?? "all";
const explicitBaseUrl = process.env.RC6_CONVERSATION_BASE_URL?.trim();
const baseUrl = (explicitBaseUrl || "http://127.0.0.1:3136").replace(/\/$/u, "");
const harness = new Rc6TestHarness("P2.4B RC6 conversation browser gate", mode);

let serverProcess = null;
let serverOutput = "";
let browser = null;
let desktopFixture = null;
let mobileFixture = null;

function captureServerOutput(chunk) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-12_000);
}

async function waitForStudio() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (serverProcess?.exitCode !== null && serverProcess?.exitCode !== undefined) {
      throw new Error(`RC6_CONVERSATION_SERVER_EXITED:${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/studio/create`, { redirect: "manual" });
      if (response.ok) return;
    } catch {
      // The local server has not accepted connections yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`RC6_CONVERSATION_SERVER_TIMEOUT:${serverOutput}`);
}

async function startServer() {
  if (!explicitBaseUrl && process.env.RC6_CONVERSATION_START_SERVER !== "0") {
    const provenance = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts/generate-release-provenance.mjs")],
      {
        cwd: process.cwd(),
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        encoding: "utf8",
      },
    );
    if (provenance.status !== 0) {
      throw new Error(
        `RC6_CONVERSATION_PROVENANCE_FAILED:${provenance.stderr || provenance.stdout || provenance.error?.message || "UNKNOWN"}`,
      );
    }
    const url = new URL(baseUrl);
    serverProcess = spawn(
      process.execPath,
      [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "dev", "-p", url.port],
      {
        cwd: process.cwd(),
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    serverProcess.stdout?.on("data", captureServerOutput);
    serverProcess.stderr?.on("data", captureServerOutput);
  }
  await waitForStudio();
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    try {
      return await chromium.launch({ channel: "msedge", headless: true });
    } catch {
      throw error;
    }
  }
}

async function createProject(page, title) {
  await page.goto(`${baseUrl}/studio/create`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("canonical-create-flow").waitFor({ state: "visible", timeout: 90_000 });
  await page.getByTestId("p2-project-title").fill(title);
  await page.getByTestId("create-play-mode-general").click();
  await page.locator(".p2CreationAssistantActions button").first().click();
  await page.locator(".p2FoundationReady").waitFor({ state: "visible" });

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
  await next.click();
  const primary = page.locator(".p2CreateSuccess a.primaryAction");
  await primary.waitFor({ state: "visible", timeout: 90_000 });
  const href = await primary.getAttribute("href");
  assert.match(href ?? "", /^\/studio\/project\/[^/]+\/chat$/u);
  const projectId = href.split("/")[3];
  await primary.click();
  await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 90_000 });
  await page.getByLabel("小說專案訊息").waitFor({ state: "visible" });
  return { projectId, href };
}

async function makeFixture(viewport, title) {
  const context = await browser.newContext({
    viewport,
    locale: "zh-TW",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const created = await createProject(page, title);
  return { context, page, pageErrors, ...created };
}

async function getDesktopFixture() {
  desktopFixture ??= await makeFixture(
    { width: 1440, height: 900 },
    `RC6 對話工作區 ${crypto.randomUUID().slice(0, 8)}`,
  );
  return desktopFixture;
}

async function getMobileFixture() {
  mobileFixture ??= await makeFixture(
    { width: 390, height: 844 },
    `RC6 手機對話 ${crypto.randomUUID().slice(0, 8)}`,
  );
  return mobileFixture;
}

async function waitUntilIdle(page) {
  await page.waitForFunction(() => {
    const composer = document.querySelector('textarea[aria-label="小說專案訊息"]');
    return composer instanceof HTMLTextAreaElement && !composer.disabled;
  });
}

async function sendLocalStatusQuery(page) {
  const composer = page.getByLabel("小說專案訊息");
  await composer.fill("查看狀態");
  await composer.press("Enter");
  await page.locator('article[data-role="user"]').filter({ hasText: "查看狀態" }).last()
    .waitFor({ state: "visible" });
  await page.getByLabel("作品結果抽屜").waitFor({ state: "visible" });
  await waitUntilIdle(page);
}

async function seedRpgPresentationFixture(page, projectId) {
  await page.evaluate(async ({ projectId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessionId = sessionStorage.getItem(`novel:conversation-active:${projectId}`);
    if (!sessionId) throw new Error("RC6_ACTIVE_SESSION_MISSING");
    const now = new Date(Date.now() + 2_000).toISOString();
    const messageId = crypto.randomUUID();
    const artifactId = crypto.randomUUID();
    const base = {
      schemaVersion: "novel-domain-v1",
      projectId,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      source: "ai_candidate",
      provenance: { source: "ai_candidate", actor: "local-rule", createdAt: now },
      deletedAt: null,
      parentRevision: null,
      migrationVersion: null,
    };
    const choices = [
      { key: "A", strategyLabel: "穩健／觀察", title: "先看清局勢", description: "壓低聲息，確認出口與敵人的真正意圖。", consequence: "風險較低，但可能錯過先機。" },
      { key: "B", strategyLabel: "資源／關係", title: "借盟友之手", description: "以既有信任換取情報與一條安全退路。", consequence: "關係加深，也會欠下一份人情。" },
      { key: "C", strategyLabel: "高風險／突破", title: "正面破局", description: "趁敵人尚未合圍，直接奪取主動權。", consequence: "可能一舉翻盤，也可能立刻受創。" },
    ];
    const envelope = {
      schemaVersion: "conversation-rpg-choices-v1",
      chapterId: "rc6-browser-fixture-chapter",
      chapterRevision: 1,
      storyStateRevision: 1,
      plan: {
        schemaVersion: "rpg-chat-turn-v1",
        choices,
        taskId: crypto.randomUUID(),
        candidateId: crypto.randomUUID(),
        contentDigest: "a".repeat(64),
        model: "fixture-local-model",
        modelDigest: "b".repeat(64),
        actualExecutor: "fixture-render-only",
        executionReceipt: null,
        contextDigest: "c".repeat(64),
        canonicalMutationCount: 0,
        dataLeftDevice: false,
        externalRequest: false,
      },
    };
    const paragraphs = Array.from({ length: 10 }, (_, index) => (
      `第${index + 1}段，夜雨敲在青瓦上，明檀循著燈影走進長廊。她聽見門後有人壓低聲音交換密令，便停下腳步，示意同伴守住退路。冷風穿過衣袖，帶來藥香與鐵鏽味；下一步若選錯，整座坊市都會驚醒。`
    ));
    const candidateContent = JSON.stringify({
      schemaVersion: "conversation-rpg-candidate-v1",
      candidate: {
        schemaVersion: "rpg-chat-turn-v1",
        story: paragraphs.join("\n\n"),
        outcomeLines: ["取得敵方暗號", "盟友警戒提升", "下一回合仍待選擇"],
      },
    });
    const transaction = database.transaction(
      ["conversationMessages", "conversationArtifacts"],
      "readwrite",
    );
    transaction.objectStore("conversationMessages").put({
      ...base,
      id: messageId,
      conversationSchemaVersion: "conversation-message-v1",
      sessionId,
      role: "assistant",
      content: `[[NOVEL_RPG_CHOICES_V1]]\n${JSON.stringify(envelope)}`,
      contentDigest: "d".repeat(64),
      status: "completed",
      parentMessageId: null,
      sourceMessageId: null,
      candidateIds: [artifactId],
      toolInvocationIds: [],
      attachmentIds: [],
      completedAt: now,
    });
    transaction.objectStore("conversationArtifacts").put({
      ...base,
      id: artifactId,
      conversationSchemaVersion: "conversation-artifact-v1",
      sessionId,
      sourceMessageId: messageId,
      artifactType: "rpg",
      targetStore: "chapters",
      targetRecordId: "rc6-browser-fixture-chapter",
      sourceRevision: 1,
      candidateContent,
      candidateDigest: "e".repeat(64),
      status: "candidate",
      approvedAt: null,
      approvedRevision: null,
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, { projectId });
}

harness.test("browser", "route and component source expose the complete conversation-first contract", () => {
  const pageSource = readFileSync("app/studio/project/[projectId]/chat/page.tsx", "utf8");
  const workspaceSource = readFileSync("app/studio/project/[projectId]/chat/conversation-workspace.tsx", "utf8");
  const cssSource = readFileSync("app/studio/project/[projectId]/chat/conversation.module.css", "utf8");
  const manualLearningGateSource = readFileSync("scripts/run-rc6-manual-learning.mjs", "utf8");
  const browserRunnerSource = readFileSync("scripts/run-conversation-first-browser-rc6.mjs", "utf8");
  assert.match(pageSource, /ConversationWorkspace/u);
  assert.match(
    browserRunnerSource,
    /scripts\/generate-release-provenance\.mjs/u,
    "a clean checkout must generate ephemeral release provenance before starting Next",
  );
  for (const contract of [
    "conversation-first-workspace",
    "＋ 新對話",
    "搜尋對話",
    "重新命名",
    "封存",
    "刪除",
    "小說專案訊息",
    "停止生成",
    "重新產生",
    "latestInvocation?.actualExecutor",
    "dataLeftDevice",
    "result.toolExecutions",
    "conversation-agent-tool:",
    "toolInvocations:",
    "rpg-inline-choices",
    "outcomeDetails",
    "修改後採用",
    "查看 Diff",
    "比較候選",
  ]) assert(workspaceSource.includes(contract), `missing UI contract: ${contract}`);
  assert(
    workspaceSource.includes('actualExecutor: "browser-main-thread"'),
    "local parser receipts must report their real browser main-thread executor",
  );
  if (workspaceSource.includes('actualExecutor: "browser-worker"')) {
    assert.match(
      workspaceSource,
      /new\s+Worker\s*\(/u,
      "browser-worker receipts require a real Worker product call site",
    );
  }
  assert.doesNotMatch(
    manualLearningGateSource,
    /actualExecutor:\s*"browser-worker"/u,
    "manual-learning Gate fixtures must not claim a Worker that did not execute",
  );
  assert.match(
    manualLearningGateSource,
    /actualExecutor:\s*"browser-main-thread"/u,
    "manual-learning Gate fixtures preserve the direct parser executor truth",
  );
  const importInvocationIndex = workspaceSource.indexOf('taskType: "learning.import.atomic"');
  const importStartIndex = workspaceSource.indexOf("started = await learning.start(");
  assert(importInvocationIndex >= 0 && importInvocationIndex < importStartIndex, "learning.start must run inside a persisted invocation");
  const resumeFunctionIndex = workspaceSource.indexOf("async function resumeAtomicLearningImport");
  const resumeInvocationIndex = workspaceSource.indexOf('taskType: "learning.import.resume"', resumeFunctionIndex);
  const resumeLookupIndex = workspaceSource.indexOf(
    'const importSession = await repository.get<LearningImportSession>',
    resumeFunctionIndex,
  );
  assert(
    resumeInvocationIndex >= 0 && resumeInvocationIndex < resumeLookupIndex,
    "learning Resume validation errors must terminate a persisted invocation",
  );
  for (const exactExecutorPropagation of [
    "actualExecutor: plan.actualExecutor",
    "actualExecutor: candidate.actualExecutor",
    "actualExecutor: result.candidate.actualExecutor",
  ]) {
    assert(workspaceSource.includes(exactExecutorPropagation), `missing exact executor propagation: ${exactExecutorPropagation}`);
  }
  assert.doesNotMatch(
    workspaceSource,
    /actualExecutor:\s*(?:plan|candidate)\.actualExecutor\.includes\("ollama"\)/u,
    "RPG receipts must not collapse the actual executor into a generic backend",
  );
  assert.doesNotMatch(
    workspaceSource,
    /actualExecutor:\s*result\.candidate\.backendId/u,
    "Closed Agent receipts must use execution truth rather than the planned backend",
  );
  assert.match(workspaceSource, /type="file"\s+multiple\s+accept="\.txt,\.md,\.markdown,\.html,\.htm,\.json,\.pdf,\.docx"/u);
  assert.doesNotMatch(workspaceSource, /ChatGPT|OpenAI/u);
  assert.match(cssSource, /env\(safe-area-inset-bottom\)/u);
  assert.match(cssSource, /@media \(max-width: 900px\)/u);
  assert.match(cssSource, /\.artifactDrawer\s*\{[\s\S]*?position:\s*fixed/u);
  assert.match(cssSource, /\.choices\s*\{\s*grid-template-columns:\s*1fr/u);
});

harness.test("browser", "desktop creates a project and lands on a usable chat workspace", async () => {
  const { page, href, pageErrors } = await getDesktopFixture();
  assert.equal(new URL(page.url()).pathname, href);
  assert.equal(await page.getByLabel("小說專案欄").isVisible(), true);
  assert.equal(await page.getByLabel("作品結果抽屜").count(), 0);
  assert.equal(await page.getByLabel("小說專案訊息").isEnabled(), true);
  assert.match(await page.getByTestId("conversation-first-workspace").innerText(), /Closed-only/u);
  assert.deepEqual(pageErrors, []);
});

harness.test("browser", "session create, rename, search, archive and delete stay in the project", async () => {
  const { page } = await getDesktopFixture();
  const sidebar = page.getByLabel("小說專案欄");
  const rows = sidebar.locator("[data-active]");
  const originalCount = await rows.count();

  await sidebar.getByRole("button", { name: "＋ 新對話" }).click();
  await page.waitForFunction((count) => document.querySelectorAll('aside[aria-label="小說專案欄"] [data-active]').length === count + 1, originalCount);
  page.once("dialog", (dialog) => dialog.accept("RC6 第二對話"));
  await sidebar.locator('[data-active="true"] button[title="重新命名"]').click();
  await sidebar.getByRole("button", { name: "RC6 第二對話" }).waitFor();
  await sidebar.getByLabel("搜尋對話").fill("第二對話");
  assert.equal(await rows.count(), 1);
  await sidebar.getByLabel("搜尋對話").fill("");

  await sidebar.getByRole("button", { name: "＋ 新對話" }).click();
  page.once("dialog", (dialog) => dialog.accept("RC6 待封存"));
  await sidebar.locator('[data-active="true"] button[title="重新命名"]').click();
  await sidebar.getByRole("button", { name: "RC6 待封存" }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await sidebar.locator('[data-active="true"] button[title="封存"]').click();
  await sidebar.getByRole("button", { name: "顯示封存" }).click();
  const archivedRow = sidebar.locator("[data-active]").filter({ hasText: "RC6 待封存" });
  await archivedRow.waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await archivedRow.locator('button[title="刪除"]').click();
  await archivedRow.waitFor({ state: "detached" });
  assert.equal(await sidebar.getByText("RC6 待封存").count(), 0);
});

harness.test("browser", "natural-language dashboard query, branching, and reload persistence work in one thread", async () => {
  const { page, pageErrors } = await getDesktopFixture();
  const sidebar = page.getByLabel("小說專案欄");
  await sidebar.locator('[data-active="true"] .sessionButton, [data-active="true"] button').first().waitFor();
  const composer = page.getByLabel("小說專案訊息");
  await composer.fill("第一行");
  await composer.press("Shift+Enter");
  assert.match(await composer.inputValue(), /\n/u);
  await sendLocalStatusQuery(page);
  assert.equal(await page.getByLabel("作品結果抽屜").isVisible(), true);
  assert.equal(await page.getByLabel("作品結果抽屜").locator("pre").count(), 1);
  await page.getByRole("button", { name: "關閉作品結果" }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-first-workspace").waitFor();
  await page.locator('article[data-role="user"]').filter({ hasText: "查看狀態" }).waitFor();
  const beforeBranch = await sidebar.locator("[data-active]").count();
  await page.locator('article[data-role="user"]').filter({ hasText: "查看狀態" })
    .getByRole("button", { name: /從這裡.*分支/u }).click();
  await page.waitForFunction((count) => document.querySelectorAll('aside[aria-label="小說專案欄"] [data-active]').length === count + 1, beforeBranch);
  assert.equal(await page.locator('article[data-role="user"]').filter({ hasText: "查看狀態" }).count(), 1);
  assert.deepEqual(pageErrors, []);
});

harness.test("mobile", "390x844 keeps the composer usable and turns side panels into drawers", async () => {
  const { page, pageErrors } = await getMobileFixture();
  const layout = await page.evaluate(() => {
    const composer = document.querySelector('textarea[aria-label="小說專案訊息"]')?.getBoundingClientRect();
    const send = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "送出")?.getBoundingClientRect();
    const sidebar = document.querySelector('aside[aria-label="小說專案欄"]')?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      composer: composer ? { left: composer.left, right: composer.right, bottom: composer.bottom } : null,
      send: send ? { left: send.left, right: send.right, bottom: send.bottom, height: send.height } : null,
      sidebarRight: sidebar?.right ?? null,
    };
  });
  assert.equal(layout.overflow, false);
  assert(layout.composer && layout.composer.left >= 0 && layout.composer.right <= 390 && layout.composer.bottom <= 844);
  assert(layout.send && layout.send.left >= 0 && layout.send.right <= 390 && layout.send.bottom <= 844 && layout.send.height >= 39);
  assert(layout.sidebarRight !== null && layout.sidebarRight <= 0);

  await page.getByRole("button", { name: "打開專案欄" }).click();
  const sidebar = page.getByLabel("小說專案欄");
  await page.waitForFunction(() => {
    const element = document.querySelector('aside[aria-label="小說專案欄"]');
    return element?.getAttribute("data-open") === "true" && element.getBoundingClientRect().left >= -1;
  });
  const openSidebar = await sidebar.boundingBox();
  assert(openSidebar && openSidebar.x >= -1 && openSidebar.x + openSidebar.width <= 391, JSON.stringify(openSidebar));
  await page.getByRole("button", { name: "關閉抽屜" }).click({ position: { x: 370, y: 400 } });
  assert.deepEqual(pageErrors, []);
});

harness.test("mobile", "dashboard stays hidden until requested and opens as a bottom sheet", async () => {
  const { page } = await getMobileFixture();
  assert.equal(await page.getByLabel("作品結果抽屜").count(), 0);
  await sendLocalStatusQuery(page);
  const drawer = page.getByLabel("作品結果抽屜");
  const box = await drawer.boundingBox();
  assert(
    box
      && box.x >= -1
      && box.x + box.width <= 391
      && box.y + box.height <= 845
      && box.y + box.height >= 842,
    JSON.stringify(box),
  );
  assert(box.height <= 640 && box.height < 844);
  await page.getByRole("button", { name: "關閉作品結果" }).click();
  await drawer.waitFor({ state: "detached" });
});

harness.test("mobile", "inline A/B/C choices are single-column touch targets and RPG outcome is collapsed", async () => {
  const { page, projectId } = await getMobileFixture();
  await seedRpgPresentationFixture(page, projectId);
  await page.reload({ waitUntil: "domcontentloaded" });
  const choices = page.getByTestId("rpg-inline-choices").locator("button");
  await choices.first().waitFor({ state: "visible" });
  assert.equal(await choices.count(), 3);
  assert.equal(await choices.first().isEnabled(), false);
  assert.match(await choices.first().innerText(), /舊版選項僅供查看/u);
  const boxes = await choices.evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
  }));
  assert(boxes.every((box) => box.left >= 0 && box.right <= 390 && box.height >= 104));
  assert(boxes[1].top >= boxes[0].bottom && boxes[2].top >= boxes[1].bottom);
  assert.match(await choices.nth(0).innerText(), /^A/u);
  assert.match(await choices.nth(1).innerText(), /^B/u);
  assert.match(await choices.nth(2).innerText(), /^C/u);
  const outcome = page.locator("details").filter({ hasText: "行動結果與數值變化" });
  await outcome.waitFor();
  assert.equal(await outcome.evaluate((element) => element.open), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await page.getByLabel("小說專案訊息").fill("自訂行動：先熄燈，再從屋脊繞到後門。");
  assert.equal(await page.getByRole("button", { name: "送出" }).isEnabled(), true);
});

await startServer();
browser = await launchBrowser();
try {
  await harness.run();
} finally {
  await desktopFixture?.context.close();
  await mobileFixture?.context.close();
  await browser.close();
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
}
