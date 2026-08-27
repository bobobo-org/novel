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
const unexpectedLoopbackRequests = [];
const expectedNavigationCancellations = [];
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
      rscHeader: request.headers().rsc ?? "",
    });
  });
  targetPage.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        && ["3217", "3227"].includes(url.port)
      ) unexpectedLoopbackRequests.push(request.url());
    } catch {
      // Browser-internal URLs are outside the public Companion boundary.
    }
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
  unexpectedLoopbackRequests.length = 0;
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

function isSupersededRscCancellation(failure, target) {
  const expectedErrorText = engineName === "webkit" ? "Load request cancelled" : "net::ERR_ABORTED";
  if (
    failure.errorText !== expectedErrorText
    || failure.method !== "GET"
    || failure.resourceType !== "fetch"
    || failure.rscHeader !== "1"
  ) return false;

  try {
    const requestUrl = new URL(failure.url);
    const rscTokens = requestUrl.searchParams.getAll("_rsc");
    const queryKeys = [...requestUrl.searchParams.keys()];
    const expectedSearch = Object.entries(target.search ?? {});
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === target.pathname
      && queryKeys.length === expectedSearch.length + 1
      && new Set(queryKeys).size === expectedSearch.length + 1
      && rscTokens.length === 1
      && /^[A-Za-z0-9_-]{1,64}$/u.test(rscTokens[0])
      && expectedSearch.every(([key, value]) => {
        const values = requestUrl.searchParams.getAll(key);
        return values.length === 1 && values[0] === value;
      });
  } catch {
    return false;
  }
}

function isCompletedLegacyRedirectCancellation(failure, projectId) {
  if (
    engineName !== "webkit"
    || failure.errorText !== "Load request cancelled"
    || failure.method !== "GET"
    || failure.resourceType !== "document"
  ) return false;

  try {
    const requestUrl = new URL(failure.url);
    const queryKeys = [...requestUrl.searchParams.keys()];
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === "/professional"
      && queryKeys.length === 2
      && new Set(queryKeys).size === 2
      && requestUrl.searchParams.getAll("intent").length === 1
      && requestUrl.searchParams.get("intent") === "library"
      && requestUrl.searchParams.getAll("projectId").length === 1
      && requestUrl.searchParams.get("projectId") === projectId;
  } catch {
    return false;
  }
}

function isSupersededHealthCancellation(failure) {
  try {
    const requestUrl = new URL(failure.url);
    const queryKeys = [...requestUrl.searchParams.keys()];
    const expectedErrorText = engineName === "webkit" ? "Load request cancelled" : "net::ERR_ABORTED";
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === "/api/ai/health"
      && queryKeys.length === 0
      && failure.errorText === expectedErrorText
      && failure.method === "GET"
      && failure.resourceType === "fetch"
      && !failure.rscHeader;
  } catch {
    return false;
  }
}

function isCompletedFrontdoorHealthCancellation(failure, visitStartedAt, editorArrivedAt) {
  try {
    const requestUrl = new URL(failure.url);
    const queryKeys = [...requestUrl.searchParams.keys()];
    const expectedErrorText = engineName === "webkit" ? "Load request cancelled" : "net::ERR_ABORTED";
    const requestTimestamp = Number(requestUrl.searchParams.get("frontdoor"));
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === "/api/persistence/health"
      && queryKeys.length === 1
      && queryKeys[0] === "frontdoor"
      && requestUrl.searchParams.getAll("frontdoor").length === 1
      && /^\d{13}$/u.test(requestUrl.searchParams.get("frontdoor") ?? "")
      && requestTimestamp >= visitStartedAt
      && requestTimestamp <= editorArrivedAt
      && failure.errorText === expectedErrorText
      && failure.method === "GET"
      && failure.resourceType === "fetch"
      && !failure.rscHeader;
  } catch {
    return false;
  }
}

function isBoundedSharedLearningCancellation(failure) {
  try {
    const requestUrl = new URL(failure.url);
    const queryKeys = [...requestUrl.searchParams.keys()];
    const expectedErrorText = engineName === "webkit" ? "Load request cancelled" : "net::ERR_ABORTED";
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === "/api/ai/learning/shared-library"
      && queryKeys.length === 1
      && queryKeys[0] === "limit"
      && requestUrl.searchParams.getAll("limit").length === 1
      && requestUrl.searchParams.get("limit") === "24"
      && failure.errorText === expectedErrorText
      && failure.method === "GET"
      && failure.resourceType === "fetch"
      && !failure.rscHeader;
  } catch {
    return false;
  }
}

async function assertCleanDiagnostics(label, options = {}) {
  let unacceptedRequestFailures = requestFailures;
  const workspaceProjectId = options.allowSupersededWorkspacePrefetchesForProjectId || "";
  const readerProjectId = options.allowSupersededReaderNavigationForProjectId || "";
  const allowedTargets = [];
  if (workspaceProjectId) {
    assert.equal(new URL(page.url()).pathname, `/studio/project/${workspaceProjectId}/chat`);
    for (const testId of ["conversation-first-workspace", "rpg-inline-choices", "rpg-choice-A", "rpg-choice-B", "rpg-choice-C"]) {
      assert.equal(await page.getByTestId(testId).isVisible(), true);
    }
    allowedTargets.push(
      { pathname: "/" },
      { pathname: "/studio/create" },
      { pathname: `/studio/project/${workspaceProjectId}/write` },
      { pathname: "/professional" },
      {
        pathname: "/professional",
        search: { intent: "library", projectId: workspaceProjectId },
      },
      {
        pathname: `/studio/project/${workspaceProjectId}/chat`,
        search: { mode: "play" },
      },
    );
  }
  if (readerProjectId) {
    assert.equal(new URL(page.url()).pathname, `/studio/read/${readerProjectId}`);
    assert.equal(await page.locator(".readerShell").isVisible(), true);
    allowedTargets.push({
      pathname: `/studio/project/${readerProjectId}/chat`,
      search: { mode: "play" },
    });
    allowedTargets.push({ pathname: "/" });
    allowedTargets.push({ pathname: "/studio/create" });
    allowedTargets.push({ pathname: `/studio/read/${readerProjectId}` });
    allowedTargets.push(
      { pathname: "/professional" },
      {
        pathname: "/professional",
        search: { intent: "library", projectId: readerProjectId },
      },
    );
  }
  if (allowedTargets.length) {
    const accepted = requestFailures.filter((failure) => (
      allowedTargets.some((target) => isSupersededRscCancellation(failure, target))
    ));
    for (const target of allowedTargets) {
      const targetFailures = accepted.filter((failure) => (
        isSupersededRscCancellation(failure, target)
      ));
      assert.ok(
        targetFailures.length <= 1,
        `${label}: at most one superseded Next RSC cancellation is allowed for ${JSON.stringify(target)}: ${JSON.stringify(targetFailures)}`,
      );
    }
    assert.ok(accepted.length <= 2, `${label}: at most two superseded Next RSC prefetches are allowed`);
    unacceptedRequestFailures = requestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);
  }

  const legacyProjectId = options.allowCompletedLegacyRedirectForProjectId || "";
  if (legacyProjectId) {
    const currentUrl = new URL(page.url());
    assert.equal(currentUrl.pathname, "/professional");
    assert.equal(currentUrl.searchParams.get("intent"), "library");
    assert.equal(currentUrl.searchParams.get("projectId"), legacyProjectId);
    assert.equal(await page.getByTestId("professional-canonical-workbench").isVisible(), true);
    const accepted = unacceptedRequestFailures.filter((failure) => (
      isCompletedLegacyRedirectCancellation(failure, legacyProjectId)
    ));
    assert.ok(accepted.length <= 1, `${label}: at most one completed legacy redirect cancellation is allowed`);
    unacceptedRequestFailures = unacceptedRequestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);
  }

  const professionalLibraryProjectId = options.allowSupersededFrontdoorNavigationPrefetchesForProjectId || "";
  if (professionalLibraryProjectId) {
    const currentUrl = new URL(page.url());
    assert.equal(currentUrl.pathname, "/professional");
    assert.equal(currentUrl.searchParams.get("intent"), "library");
    assert.equal(currentUrl.searchParams.get("projectId"), professionalLibraryProjectId);
    assert.equal(currentUrl.hash, "#character-world-memory-editor");
    assert.equal(await page.getByTestId("professional-canonical-workbench").isVisible(), true);
    assert.equal(await page.getByTestId("home-canon-editor").isVisible(), true);
    const frontdoorTargets = [
      { pathname: "/" },
      { pathname: "/studio" },
      { pathname: "/studio/create" },
      { pathname: "/studio/create", search: { cloneFrom: professionalLibraryProjectId } },
      { pathname: "/professional", search: { intent: "chat" } },
      { pathname: "/professional", search: { intent: "library" } },
      {
        pathname: "/professional",
        search: { intent: "library", projectId: professionalLibraryProjectId },
      },
      {
        pathname: "/settings/local-ai",
        search: { returnTo: `/studio/project/${professionalLibraryProjectId}/chat` },
      },
      {
        pathname: `/studio/project/${professionalLibraryProjectId}/chat`,
        search: { mode: "play" },
      },
      { pathname: `/studio/read/${professionalLibraryProjectId}` },
    ];
    const accepted = unacceptedRequestFailures.filter((failure) => (
      frontdoorTargets.some((target) => isSupersededRscCancellation(failure, target))
    ));
    for (const target of frontdoorTargets) {
      const targetFailures = accepted.filter((failure) => (
        isSupersededRscCancellation(failure, target)
      ));
      assert.ok(
        targetFailures.length <= 1,
        `${label}: at most one superseded frontdoor RSC prefetch is allowed for ${JSON.stringify(target)}: ${JSON.stringify(targetFailures)}`,
      );
    }
    assert.ok(accepted.length <= 2, `${label}: at most two superseded frontdoor RSC prefetches are allowed`);
    unacceptedRequestFailures = unacceptedRequestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);

    const frontdoorVisitStartedAt = options.frontdoorVisitStartedAt ?? 0;
    const frontdoorEditorArrivedAt = options.frontdoorEditorArrivedAt ?? 0;
    assert.ok(frontdoorVisitStartedAt > 0, `${label}: frontdoor visit start time is required`);
    assert.ok(
      frontdoorEditorArrivedAt >= frontdoorVisitStartedAt,
      `${label}: Canon editor arrival time must follow the frontdoor visit start`,
    );
    const completedHealthCancellations = unacceptedRequestFailures.filter((failure) => (
      isCompletedFrontdoorHealthCancellation(failure, frontdoorVisitStartedAt, frontdoorEditorArrivedAt)
    ));
    assert.ok(
      completedHealthCancellations.length <= 1,
      `${label}: at most one completed frontdoor health cancellation is allowed: ${JSON.stringify(completedHealthCancellations)}`,
    );
    unacceptedRequestFailures = unacceptedRequestFailures.filter(
      (failure) => !completedHealthCancellations.includes(failure),
    );
    expectedNavigationCancellations.push(...completedHealthCancellations);
  }

  if (options.allowBoundedSharedLearningRequest) {
    const accepted = unacceptedRequestFailures.filter(isBoundedSharedLearningCancellation);
    assert.ok(accepted.length <= 1, `${label}: at most one bounded shared-learning request is allowed`);
    unacceptedRequestFailures = unacceptedRequestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);
  }

  if (options.allowSupersededHealthRequest) {
    const accepted = unacceptedRequestFailures.filter(isSupersededHealthCancellation);
    assert.ok(
      accepted.length <= 2,
      `${label}: at most two superseded AI health requests are allowed: ${JSON.stringify(accepted)}`,
    );
    unacceptedRequestFailures = unacceptedRequestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);
  }

  assert.deepEqual(
    unexpectedLoopbackRequests,
    [],
    label + ": public journey must not probe a machine-local Companion",
  );
  assert.deepEqual(pageErrors, [], `${label}: page errors: ${JSON.stringify(pageErrors)}`);
  assert.deepEqual(consoleErrors, [], `${label}: console errors: ${JSON.stringify(consoleErrors)}`);
  assert.deepEqual(
    unacceptedRequestFailures,
    [],
    `${label}: failed requests: ${JSON.stringify(unacceptedRequestFailures)}`,
  );
}

const results = [];
let createdProjectId = "";
let frontdoorCanonVisitStartedAt = 0;
let frontdoorCanonEditorArrivedAt = 0;
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

  await assertCleanDiagnostics("general creation validation");
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
    await assertCleanDiagnostics("RPG creation and workspace navigation", {
      allowSupersededWorkspacePrefetchesForProjectId: createdProjectId,
      allowBoundedSharedLearningRequest: true,
    });
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
      await page.getByRole("heading", { name: heading, exact: true }).waitFor({ state: "visible" });
    }
    const mobileState = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      groupColumns: getComputedStyle(document.querySelector(".professionalActionGroups")).gridTemplateColumns.split(" ").length,
      managementVisible: document.querySelector('[data-testid="professional-canonical-workbench"]')?.getBoundingClientRect().height > 0,
    }));
    assert.equal(mobileState.overflow, false);
    assert.equal(mobileState.groupColumns, 1);
    assert.equal(mobileState.managementVisible, true);

    const canonEditorLink = page.getByTestId("professional-canon-editor-link");
    const canonEditorHref = new URL(await canonEditorLink.getAttribute("href"), baseUrl);
    assert.equal(canonEditorHref.searchParams.get("projectId"), projectId);
    assert.equal(canonEditorHref.hash, "#character-world-memory-editor");
    await Promise.all([
      page.waitForURL((url) => url.hash === "#character-world-memory-editor", { timeout: 60_000 }),
      canonEditorLink.tap(),
    ]);
    await page.getByTestId("home-canon-editor").waitFor({ state: "visible" });
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="home-character-editor"]')?.hasAttribute("open")
      && document.querySelector('[data-testid="home-world-memory-editor"]')?.hasAttribute("open")
    ));
    assert.equal(await page.getByTestId("home-character-editor").getAttribute("open"), "");
    assert.equal(await page.getByTestId("home-world-memory-editor").getAttribute("open"), "");
    assert.equal(await page.getByTestId("home-character-name").isVisible(), true);
    assert.equal(await page.getByTestId("story-bible-editor").isVisible(), true);
    const editorViewport = await page.getByTestId("home-canon-editor").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight };
    });
    assert.ok(editorViewport.top >= 0 && editorViewport.top < editorViewport.viewportHeight, JSON.stringify(editorViewport));
    assert.ok(editorViewport.bottom > 0, JSON.stringify(editorViewport));
    const characterName = page.getByTestId("home-character-name");
    const originalName = (await characterName.inputValue()).trim();
    assert.ok(originalName, "the started story must retain an editable formal character");
    const editedName = `${originalName}・首頁編修`;
    await characterName.fill(editedName);
    await page.getByRole("button", { name: "儲存人物", exact: true }).click();
    try {
      await page.getByText("人物、能力值、境界與屬性配對人像已在首頁更新；故事內只會讀取並選擇這筆正式資料。", { exact: true }).waitFor({ state: "visible" });
    } catch (error) {
      throw new Error(`CHARACTER_SAVE_ACK_FAILED ${JSON.stringify({
        currentUrl: page.url(),
        inputValue: await characterName.inputValue(),
        saveDisabled: await page.getByRole("button", { name: "儲存人物", exact: true }).isDisabled(),
        statusTexts: await page.locator('[role="status"]').allTextContents(),
        consoleErrors,
        requestFailures,
        pageErrors,
      })}`, { cause: error });
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("home-character-name").waitFor({ state: "visible" });
    await page.waitForFunction((expectedName) => (
      document.querySelector('[data-testid="home-character-name"]')?.value === expectedName
    ), editedName);
    assert.equal(await page.getByTestId("home-character-name").inputValue(), editedName);
  });

  await check("real mobile reader keeps compact controls and readable width", async () => {
    const readerLink = page.getByRole("link", { name: "閱讀作品", exact: true }).first();
    try {
      await Promise.all([
        page.waitForURL(new RegExp(`/studio/read/${createdProjectId}$`, "u"), { timeout: 60_000 }),
        readerLink.tap(),
      ]);
      await page.locator(".readerShell").waitFor({ state: "visible" });
    } catch (error) {
      throw new Error(`READER_NAVIGATION_FAILED ${JSON.stringify({
        currentUrl: page.url(),
        pageTitle: await page.title(),
        bodyText: (await page.locator("body").innerText()).slice(0, 1_000),
        consoleErrors,
        requestFailures,
        pageErrors,
      })}`, { cause: error });
    }
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
    await assertCleanDiagnostics("mobile workspace, management, and reader journey", {
      allowSupersededReaderNavigationForProjectId: createdProjectId,
      allowSupersededHealthRequest: true,
      allowBoundedSharedLearningRequest: true,
    });
  });

  await check("story routes keep Canon read-only and return to the formal editor", async () => {
    const projectId = createdProjectId;
    assert.ok(projectId, "the created project identity must remain available");
    await openFreshPage(`${baseUrl}/studio/project/${encodeURIComponent(projectId)}/characters`);
    await page.getByTestId("story-stage-selection-page").waitFor({ state: "visible" });
    await page.getByTestId("story-stage-selector").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("story-stage-selection-page").getAttribute("data-canon-edit-surface"), "story-selection-only");
    assert.equal(await page.getByTestId("home-character-name").count(), 0);
    assert.equal(await page.getByRole("button", { name: "儲存人物", exact: true }).count(), 0);
    const worldCardLayout = await page.evaluate(() => {
      const strip = document.querySelector(".characterStageWorlds");
      const widths = [...document.querySelectorAll(".characterStageWorlds > button")]
        .map((element) => element.getBoundingClientRect().width);
      return {
        stripClientWidth: strip?.clientWidth ?? 0,
        stripScrollWidth: strip?.scrollWidth ?? 0,
        maxCardWidth: widths.length ? Math.max(...widths) : 0,
      };
    });
    assert.ok(worldCardLayout.maxCardWidth <= worldCardLayout.stripClientWidth + 1, JSON.stringify(worldCardLayout));
    assert.ok(worldCardLayout.stripScrollWidth <= worldCardLayout.stripClientWidth + 1, JSON.stringify(worldCardLayout));
    const returnLink = page.getByRole("link", { name: /首頁正式設定/u }).first();
    const returnTarget = new URL(await returnLink.getAttribute("href"), baseUrl);
    assert.equal(returnTarget.searchParams.get("projectId"), projectId);
    assert.equal(returnTarget.hash, "#character-world-memory-editor");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/professional" && url.hash === "#character-world-memory-editor", { timeout: 60_000 }),
      returnLink.tap(),
    ]);
    await page.getByTestId("home-character-name").waitFor({ state: "visible" });
  });

  await check("old project-home links converge on the complete management center", async () => {
    const projectId = createdProjectId;
    assert.ok(projectId, "the created project identity must remain available");
    await page.setViewportSize(mobileViewport);
    await openFreshPage(`${baseUrl}/studio?screen=home&projectId=${encodeURIComponent(projectId)}`);
    await page.getByTestId("professional-canonical-workbench").waitFor({ state: "visible" });
    assert.equal(new URL(page.url()).pathname, "/professional");
  });

  await check("frontdoor opens the selected project's editable Canon surface", async () => {
    const projectId = createdProjectId;
    assert.ok(projectId, "the created project identity must remain available");
    const competingProjectId = `${projectId}-newer`;
    await page.evaluate(async ({ activeProjectId, competingId }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("novel-intelligence-platform");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const original = await new Promise((resolve, reject) => {
        const request = database.transaction("projects", "readonly").objectStore("projects").get(activeProjectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!original) throw new Error("active project fixture must exist");
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("projects", "readwrite");
        transaction.objectStore("projects").put({
          ...original,
          id: competingId,
          title: "較新的非作用中作品",
          updatedAt: "9999-12-31T23:59:59.999Z",
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      localStorage.setItem("novel_p2_active_project_id", activeProjectId);
      localStorage.setItem("novel_p12_studio_state", JSON.stringify({
        activeProjectId: competingId,
        projects: [{ id: competingId, title: "較新的非作用中作品", updatedAt: "9999-12-31T23:59:59.999Z" }],
      }));
    }, { activeProjectId: projectId, competingId: competingProjectId });
    frontdoorCanonVisitStartedAt = Date.now();
    await openFreshPage(baseUrl);
    const canonEditorLink = page.getByTestId("frontdoor-canon-editor");
    await canonEditorLink.waitFor({ state: "visible" });
    const target = new URL(await canonEditorLink.getAttribute("href"), baseUrl);
    assert.equal(target.searchParams.get("projectId"), projectId);
    assert.equal(target.hash, "#character-world-memory-editor");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/professional" && url.hash === "#character-world-memory-editor", { timeout: 60_000 }),
      canonEditorLink.tap(),
    ]);
    await page.getByTestId("home-canon-editor").waitFor({ state: "visible" });
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="home-character-editor"]')?.hasAttribute("open")
      && document.querySelector('[data-testid="home-world-memory-editor"]')?.hasAttribute("open")
    ));
    assert.equal(await page.getByTestId("home-character-editor").getAttribute("open"), "");
    assert.equal(await page.getByTestId("home-world-memory-editor").getAttribute("open"), "");
    frontdoorCanonEditorArrivedAt = Date.now();
    const editorViewport = await page.getByTestId("home-canon-editor").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight };
    });
    assert.ok(editorViewport.top >= 0 && editorViewport.top < editorViewport.viewportHeight, JSON.stringify(editorViewport));
    assert.ok(editorViewport.bottom > 0, JSON.stringify(editorViewport));
    await page.evaluate(async ({ activeProjectId, competingId }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("novel-intelligence-platform");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("projects", "readwrite");
        transaction.objectStore("projects").delete(competingId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      localStorage.setItem("novel_p2_active_project_id", activeProjectId);
      localStorage.removeItem("novel_p12_studio_state");
    }, { activeProjectId: projectId, competingId: competingProjectId });
  });

  await check("browser console has no unexpected errors or repeated native permission probes", async () => {
    await assertCleanDiagnostics("frontdoor Canon navigation and legacy management redirect", {
      allowCompletedLegacyRedirectForProjectId: createdProjectId,
      allowSupersededFrontdoorNavigationPrefetchesForProjectId: createdProjectId,
      frontdoorVisitStartedAt: frontdoorCanonVisitStartedAt,
      frontdoorEditorArrivedAt: frontdoorCanonEditorArrivedAt,
    });
  });

  console.log(JSON.stringify({
    suite: "HUMANIZED_CREATION_BROWSER",
    engineName,
    viewport: mobileViewport,
    pass: results.length,
    fail: 0,
    expectedNavigationCancellations,
    results,
  }, null, 2));
} finally {
  await context?.close();
  await browser?.close();
}
