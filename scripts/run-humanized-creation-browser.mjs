import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";

const baseUrl = String(process.argv.slice(2).find((value) => value !== "--") || "http://127.0.0.1:4174").replace(/\/$/u, "");
const engineName = process.env.MOBILE_BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const browserType = engineName === "webkit" ? webkit : chromium;
const viewportMatch = /^(\d{3,4})x(\d{3,4})$/u.exec(process.env.MOBILE_VIEWPORT || "390x844");
assert.ok(viewportMatch, "MOBILE_VIEWPORT must use WIDTHxHEIGHT, for example 390x844");
const mobileViewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
let browser = null;
let context = null;
const consoleErrors = [];
const requestFailures = [];
const pageErrors = [];
let page = null;

function attachDiagnostics(targetPage) {
  targetPage.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({
        text: message.text(),
        url: message.location().url ?? "",
      });
    }
  });
  targetPage.on("requestfailed", (request) => {
    requestFailures.push({
      url: request.url(),
      errorText: request.failure()?.errorText ?? "unknown",
      method: request.method(),
      resourceType: request.resourceType(),
    });
  });
  targetPage.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
}

async function openFreshPage(url) {
  if (page) await page.close();
  consoleErrors.length = 0;
  requestFailures.length = 0;
  pageErrors.length = 0;
  page = await context.newPage();
  attachDiagnostics(page);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

async function resetLocalStorageAndOpen(url) {
  if (page) {
    await page.close();
    page = null;
  }
  const storagePage = await context.newPage();
  await storagePage.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await storagePage.evaluate(() => window.localStorage.clear());
  await storagePage.close();
  await openFreshPage(url);
}

function assertCleanDiagnostics(label) {
  assert.deepEqual(pageErrors, [], `${label}: page errors: ${JSON.stringify(pageErrors)}`);
  assert.deepEqual(consoleErrors, [], `${label}: console errors: ${JSON.stringify(consoleErrors)}`);
  assert.deepEqual(requestFailures, [], `${label}: failed requests: ${JSON.stringify(requestFailures)}`);
}

const results = [];
let createdProjectId = "";
async function check(name, work) {
  await work();
  results.push({ name, status: "PASS" });
}

try {
  browser = await browserType.launch({ headless: true });
  context = await browser.newContext({
    locale: "zh-TW",
    viewport: mobileViewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    serviceWorkers: "allow",
  });
  await resetLocalStorageAndOpen(`${baseUrl}/studio/create`);

  await check("title is required before mode or creation path", async () => {
    await page.getByTestId("canonical-create-flow").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("create-play-mode-general").isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: /快速開始/ }).isDisabled(), true);
    assert.equal(await page.getByTestId("rpg-choice-A").count(), 0);

    await page.getByTestId("p2-project-title").fill("入口流程驗收作品");
    assert.equal(await page.getByTestId("create-play-mode-general").isEnabled(), true);
    await page.getByTestId("create-play-mode-general").click();
    await page.getByRole("button", { name: /引導建立/ }).click();
    await page.locator(".p2TopicGrid button").first().click();
    await page.getByTestId("creation-primary-next").click();
    await page.getByText("第 1 題／共 5 題").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("p2-project-title").inputValue(), "入口流程驗收作品");
  });

  assertCleanDiagnostics("general creation validation");
  await resetLocalStorageAndOpen(`${baseUrl}/studio/create`);

  await check("incomplete RPG setup has no choices and cannot start", async () => {
    await page.getByTestId("p2-project-title").fill("必要設定 Gate 驗收");
    await page.getByTestId("create-play-structure-choice").click();
    await page.getByTestId("create-play-mode-rpg").click();
    await page.getByRole("button", { name: /引導建立/ }).click();
    await page.locator(".p2TopicGrid button").first().click();
    await page.getByTestId("creation-primary-next").click();
    await page.getByTestId("creation-primary-next").click();
    await page.getByText(/請先回答第 1 題/u).waitFor({ state: "visible" });
    await page.locator(".p2FoundationWarning").waitFor({ state: "visible" });
    assert.equal(await page.locator(".p2StepBar").getAttribute("aria-label"), "第 2 步，共 6 步");
    assert.equal(await page.getByRole("button", { name: "建立「RPG 養成」作品" }).count(), 0);
    assert.equal(await page.getByTestId("rpg-choice-A").count(), 0);
  });

  await check("guide creates editable foundations without changing the title", async () => {
    for (let step = 1; step <= 5; step += 1) {
      await page.locator(".p2GuidedChoices button").first().click();
      if (step < 5) {
        await page.getByTestId("creation-primary-next").click();
        await page.locator(".p2StepBar").waitFor({ state: "visible" });
        assert.equal(await page.locator(".p2StepBar").getAttribute("aria-label"), `第 ${step + 2} 步，共 6 步`);
      }
    }
    await page.getByRole("button", { name: "選擇這組上場群像", exact: true }).first().click();
    await page.getByText("故事起點已完整").waitFor({ state: "visible" });
    assert.equal((await page.getByTestId("p2-project-title").inputValue()).trim(), "必要設定 Gate 驗收");
    const preview = await page.locator(".p2SeedPreview").innerText();
    assert.equal(preview.includes("稍後補充"), false);
    assert.equal(await page.getByRole("button", { name: "建立「RPG 養成」作品" }).isEnabled(), true);
    const finalMobile = await page.evaluate(() => {
      const footer = document.querySelector(".p2CreatePanel > footer")?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight,
        footerVisible: Boolean(footer && footer.top >= 0 && footer.bottom <= innerHeight + 1),
        expandedLongPanels: document.querySelectorAll(".p2FoundationSetup details[open]").length,
      };
    });
    assert.equal(finalMobile.overflow, false);
    assert.equal(finalMobile.footerVisible, true);
    assert.equal(finalMobile.expandedLongPanels, 0);
    assert.ok(finalMobile.height < 7_500, `mobile final setup is still ${finalMobile.height}px tall`);
  });

  await check("RPG start reaches a playable first turn", async () => {
    await page.getByRole("button", { name: "建立「RPG 養成」作品" }).click();
    const playLink = page.getByRole("link", { name: "在故事工作台開始遊玩" });
    const playHref = await playLink.getAttribute("href");
    assert.match(playHref, /\/chat\?mode=play$/u);
    try {
      await Promise.all([
        page.waitForURL(/\/studio\/project\/[^/]+\/chat\?mode=play$/u, { timeout: 60_000 }),
        playLink.click(),
      ]);
      await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 60_000 });
    } catch (error) {
      throw new Error(
        `PLAY_WORKSPACE_NAVIGATION_FAILED ${JSON.stringify({
          currentUrl: page.url(),
          expectedHref: playHref,
          consoleErrors,
          requestFailures,
          pageErrors,
        })}`,
        { cause: error },
      );
    }
    assert.match(new URL(page.url()).pathname, /\/studio\/project\/[^/]+\/chat$/u);
    createdProjectId = new URL(page.url()).pathname.split("/")[3] || "";
    assert.ok(createdProjectId);
    await page.getByText("開始目前玩法的第一回合。", { exact: true }).waitFor({ state: "visible", timeout: 60_000 });
    await page.getByTestId("rpg-inline-choices").waitFor({ state: "visible", timeout: 180_000 });
    for (const choice of ["A", "B", "C"]) {
      await page.getByTestId(`rpg-choice-${choice}`).waitFor({ state: "visible" });
    }
  });

  await check("mobile onboarding has no horizontal overflow", async () => {
    const chatUrl = page.url();
    assertCleanDiagnostics("RPG creation and workspace navigation");
    await openFreshPage(chatUrl);
    await page.setViewportSize(mobileViewport);
    await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false);
    assert.equal(await page.locator("header a:visible").filter({ hasText: /系統首頁|作品管理中心/u }).count(), 0);
    await page.getByTestId("conversation-mobile-sidebar-toggle").click();
    await page.getByTestId("conversation-session-sidebar").waitFor({ state: "visible" });
    await page.getByTestId("conversation-active-session").waitFor({ state: "visible" });
    const sessionActionTargetsHandle = await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll(
        '[data-testid="conversation-active-session"] span button',
      )];
      const targets = buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.getAttribute("aria-label") || "",
          width: rect.width,
          height: rect.height,
          hasIcon: Boolean(button.querySelector("svg")),
        };
      });
      return targets.length === 3
        && targets.every((target) => (
          target.label
          && target.hasIcon
          && target.width >= 44
          && target.height >= 44
        ))
        ? targets
        : false;
    }, undefined, { timeout: 10_000 });
    const sessionActionTargets = await sessionActionTargetsHandle.jsonValue();
    await sessionActionTargetsHandle.dispose();
    assert.equal(sessionActionTargets.length, 3);
    assert.ok(
      sessionActionTargets.every((target) => (
        target.label
        && target.hasIcon
        && target.width >= 44
        && target.height >= 44
      )),
      JSON.stringify(sessionActionTargets),
    );
    await page.getByTestId("conversation-sidebar-close").click();
    const composer = page.getByLabel("小說專案訊息");
    await composer.focus();
    const keyboardViewport = {
      width: mobileViewport.width,
      height: Math.max(360, Math.min(560, mobileViewport.height - 208)),
    };
    await page.setViewportSize(keyboardViewport);
    await page.waitForFunction(() => {
      const shell = document.querySelector('[data-testid="conversation-first-workspace"]');
      const visualHeight = window.visualViewport?.height ?? window.innerHeight;
      return shell?.getAttribute("data-visual-viewport") === "bound"
        && getComputedStyle(shell).getPropertyValue("--conversation-visual-height").trim() === `${Math.round(visualHeight)}px`;
    });
    await page.waitForTimeout(350);
    const keyboardState = await page.evaluate(() => {
      const visualViewport = window.visualViewport;
      const visualTop = visualViewport?.offsetTop ?? 0;
      const visualBottom = visualTop + (visualViewport?.height ?? window.innerHeight);
      const input = document.querySelector('[aria-label="小說專案訊息"]')?.getBoundingClientRect();
      const send = [...document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "送出")
        ?.getBoundingClientRect();
      const workspace = document.querySelector('[data-testid="conversation-first-workspace"] > div')?.getBoundingClientRect();
      const main = document.querySelector('[data-testid="conversation-first-workspace"] section')?.getBoundingClientRect();
      const shell = document.querySelector('[data-testid="conversation-first-workspace"]');
      const mainElement = document.querySelector('[data-testid="conversation-first-workspace"] section');
      const maxTouchPoints = navigator.maxTouchPoints;
      const coarsePointer = matchMedia("(pointer: coarse)").matches;
      return {
        inputVisible: Boolean(input && input.top >= visualTop - 1 && input.bottom <= visualBottom + 1),
        sendVisible: Boolean(send && send.top >= visualTop - 1 && send.bottom <= visualBottom + 1),
        visualViewportBound: document.querySelector('[data-testid="conversation-first-workspace"]')?.getAttribute("data-visual-viewport") === "bound",
        touchCapable: maxTouchPoints > 0 || coarsePointer,
        maxTouchPoints,
        coarsePointer,
        visualTop,
        visualBottom,
        inputTop: input?.top ?? null,
        inputBottom: input?.bottom ?? null,
        sendTop: send?.top ?? null,
        sendBottom: send?.bottom ?? null,
        workspaceTop: workspace?.top ?? null,
        workspaceBottom: workspace?.bottom ?? null,
        mainTop: main?.top ?? null,
        mainBottom: main?.bottom ?? null,
        shellTop: shell?.getBoundingClientRect().top ?? null,
        shellPosition: shell ? getComputedStyle(shell).position : null,
        scrollY: window.scrollY,
        visualPageTop: visualViewport?.pageTop ?? null,
        bodyHeight: document.body.scrollHeight,
        mainGridRows: mainElement ? getComputedStyle(mainElement).gridTemplateRows : null,
        mainChildren: mainElement ? [...mainElement.children].map((child) => {
          const rect = child.getBoundingClientRect();
          return { className: String(child.className), top: rect.top, bottom: rect.bottom, height: rect.height };
        }) : [],
      };
    });
    const keyboardDiagnostic = JSON.stringify(keyboardState);
    assert.equal(keyboardState.visualViewportBound, true, keyboardDiagnostic);
    assert.equal(keyboardState.touchCapable, true, keyboardDiagnostic);
    assert.equal(keyboardState.inputVisible, true, keyboardDiagnostic);
    assert.equal(keyboardState.sendVisible, true, keyboardDiagnostic);
    await page.setViewportSize(mobileViewport);
  });

  await check("mobile project drawer opens the complete management center", async () => {
    const projectId = createdProjectId;
    assert.ok(projectId, "the created project identity must remain available");
    await page.setViewportSize(mobileViewport);
    await page.getByTestId("conversation-mobile-sidebar-toggle").tap();
    const managementLink = page.getByRole("link", { name: /作品管理中心/u }).first();
    await Promise.all([
      page.waitForURL(/\/professional\?intent=library&projectId=/u, { timeout: 60_000 }),
      managementLink.tap(),
    ]);
    await page.getByTestId("professional-canonical-workbench").waitFor({ state: "visible" });
    for (const heading of ["故事與章節", "角色、世界與記憶", "任務、成就與檢查", "作品、存檔與備份", "自動協調器與學習", "研究與作者輔助"]) {
      await page.getByRole("heading", { name: heading }).waitFor({ state: "visible" });
    }
    const mobileState = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      groupColumns: getComputedStyle(document.querySelector(".professionalActionGroups")).gridTemplateColumns.split(" ").length,
      managementVisible: document.querySelector('[data-testid="professional-canonical-workbench"]')?.getBoundingClientRect().height > 0,
    }));
    assert.equal(mobileState.overflow, false);
    assert.equal(mobileState.groupColumns, 1);
    assert.equal(mobileState.managementVisible, true);
  });

  await check("real mobile reader keeps compact controls and readable width", async () => {
    const readerLink = page.getByRole("link", { name: "閱讀作品", exact: true }).first();
    await Promise.all([
      page.waitForURL(new RegExp(`/studio/read/${createdProjectId}$`, "u"), { timeout: 60_000 }),
      readerLink.tap(),
    ]);
    await page.locator(".readerShell").waitFor({ state: "visible" });
    assert.equal(await page.locator("#reader-controls").count(), 0);
    await page.getByRole("button", { name: "閱讀設定" }).click();
    await page.locator("#reader-controls").waitFor({ state: "visible" });
    const readerState = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      articleRight: document.querySelector(".readerArticle")?.getBoundingClientRect().right ?? 0,
      viewport: document.documentElement.clientWidth,
      shortTargets: [...document.querySelectorAll(".readerTop a,.readerTop button,.readerControls select")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.height < 44;
        }).length,
    }));
    assert.equal(readerState.overflow, false);
    assert.ok(readerState.articleRight <= readerState.viewport + 1);
    assert.equal(readerState.shortTargets, 0);
  });

  await check("old project-home links converge on the complete management center", async () => {
    const projectId = createdProjectId;
    assert.ok(projectId, "the created project identity must remain available");
    await page.setViewportSize(mobileViewport);
    assertCleanDiagnostics("mobile workspace, management, and reader journey");
    await openFreshPage(`${baseUrl}/studio?screen=home&projectId=${encodeURIComponent(projectId)}`);
    await page.getByTestId("professional-canonical-workbench").waitFor({ state: "visible" });
    assert.equal(new URL(page.url()).pathname, "/professional");
  });

  await check("browser console has no unexpected errors or repeated native permission probes", async () => {
    assertCleanDiagnostics("legacy management redirect");
  });

  console.log(JSON.stringify({
    suite: "HUMANIZED_CREATION_BROWSER",
    engineName,
    viewport: mobileViewport,
    pass: results.length,
    fail: 0,
    results,
  }, null, 2));
} finally {
  await context?.close();
  await browser?.close();
}
