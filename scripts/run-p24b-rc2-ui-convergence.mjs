import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const baseUrl = (process.env.P24B_RC2_UI_BASE_URL || "http://127.0.0.1:3130").replace(/\/$/, "");
const evidenceDir = process.env.P24B_RC2_EVIDENCE_DIR;
if (!evidenceDir) throw new Error("P24B_RC2_EVIDENCE_DIR_REQUIRED");
fs.mkdirSync(evidenceDir, { recursive: true });

const desktopViewport = { width: 1440, height: 900 };
const mobileViewports = [
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];
const checks = [];
const consoleErrors = [];
const pageErrors = [];
const networkResults = [];
const requiredResponses = [];
let serverProcess = null;
let browser = null;

const write = (name, value) => fs.writeFileSync(
  path.join(evidenceDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  "utf8",
);
const record = (group, name, pass, details = null) => {
  const result = { group, name, status: pass ? "PASS" : "FAIL", details };
  checks.push(result);
  return result;
};
const requirePass = (group, name, pass, details = null) => {
  const result = record(group, name, pass, details);
  if (!pass) throw new Error(`${group}:${name}:${JSON.stringify(details)}`);
  return result;
};
const hash = (value) => crypto
  .createHash("sha256")
  .update(JSON.stringify(value), "utf8")
  .digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startServerIfRequested() {
  if (process.env.P24B_RC2_UI_START_SERVER !== "1") return;
  const port = new URL(baseUrl).port || "3130";
  const mode = process.env.P24B_RC2_UI_SERVER_MODE === "development" ? "dev" : "start";
  const args = [path.join(process.cwd(), "node_modules/next/dist/bin/next"), mode, "-p", port];
  if (mode === "dev" && process.env.P24B_RC2_UI_WEBPACK === "1") args.push("--webpack");
  serverProcess = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  serverProcess.stdout?.on("data", (chunk) => output.push(chunk.toString()));
  serverProcess.stderr?.on("data", (chunk) => output.push(chunk.toString()));
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`RC2_UI_SERVER_EXITED:${output.join("").slice(-6000)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/legacy/novel-system.html?mode=professional`, {
        headers: { "cache-control": "no-cache" },
      });
      if (response.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`RC2_UI_SERVER_TIMEOUT:${output.join("").slice(-6000)}`);
}

function attachPageObservers(page, scope) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ scope, url: page.url(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push({ scope, url: page.url(), message: error.message });
  });
  page.on("response", (response) => {
    networkResults.push({
      scope,
      status: response.status(),
      method: response.request().method(),
      url: response.url(),
    });
  });
  page.on("dialog", (dialog) => void dialog.accept());
}

async function installFirstPaintProbe(page) {
  await page.addInitScript(() => {
    const state = {
      frames: 0,
      workspaceVisibleFrames: 0,
      consumerVisibleFrames: 0,
      blackShellFrames: 0,
      consumerEverVisible: false,
      firstWorkspaceFrame: null,
    };
    Object.defineProperty(window, "__p24bRc2FirstPaint", {
      configurable: true,
      value: state,
    });
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || "1") > 0
        && rect.width > 1
        && rect.height > 1;
    };
    const sample = () => {
      state.frames += 1;
      const consumer = document.getElementById("consumerAppShell");
      if (visible(consumer)) {
        state.consumerVisibleFrames += 1;
        state.consumerEverVisible = true;
      }
      const workspace = document.querySelector('[data-testid="professional-workspace"]');
      if (visible(workspace)) {
        state.workspaceVisibleFrames += 1;
        if (state.firstWorkspaceFrame === null) state.firstWorkspaceFrame = state.frames;
        const main = document.querySelector('[data-testid="professional-main"]');
        const textLength = (main?.textContent || "").replace(/\s+/g, "").length;
        if (!visible(main) || textLength < 80) state.blackShellFrames += 1;
      }
      if (state.frames < 180) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function normalizeRedirect(source) {
  const response = await fetch(`${baseUrl}${source}`, {
    redirect: "manual",
    headers: { "cache-control": "no-cache" },
  });
  const rawLocation = response.headers.get("location");
  const location = rawLocation ? new URL(rawLocation, baseUrl) : null;
  return {
    source,
    status: response.status,
    location: location ? `${location.pathname}${location.search}` : null,
    pathname: location?.pathname ?? null,
    search: location?.search ?? null,
    parameters: location ? Object.fromEntries(location.searchParams) : {},
    repeatedTag: location?.searchParams.getAll("tag") ?? [],
  };
}

async function waitForProfessional(page) {
  await page.waitForSelector('[data-testid="professional-workspace"]', {
    state: "visible",
    timeout: 20000,
  });
  await page.waitForFunction(() =>
    document.documentElement.classList.contains("p11-professional-entry")
      && document.querySelectorAll('[data-testid="professional-menu"] button').length === 27,
  );
  await sleep(600);
}

async function captureProfessionalEntry(context, source, label) {
  const page = await context.newPage();
  attachPageObservers(page, `frontdoor:${label}`);
  await installFirstPaintProbe(page);
  const response = await page.goto(`${baseUrl}${source}`, { waitUntil: "domcontentloaded" });
  await waitForProfessional(page);
  const snapshot = await page.evaluate(() => {
    const menu = [...document.querySelectorAll('[data-testid="professional-menu"] button')]
      .map((button) => button.textContent?.trim() || "");
    const routeCards = [...document.querySelectorAll(".p24b-route-card b")]
      .map((element) => element.textContent?.trim() || "");
    const views = [...document.querySelectorAll("section.view")]
      .map((element) => element.id)
      .sort();
    const activeView = document.querySelector("section.view.active")?.id ?? null;
    const workspace = document.querySelector('[data-testid="professional-workspace"]');
    const consumer = document.getElementById("consumerAppShell");
    const compatibility = document.getElementById("legacyCompatibilityBanner");
    const returnConsumer = document.getElementById("p11ReturnConsumer");
    const dock = document.querySelector(".appDock");
    const hidden = (element) => !element || getComputedStyle(element).display === "none";
    const semantic = {
      workspaceVersion: workspace?.getAttribute("data-workspace-version"),
      menu,
      routeCards,
      views,
      activeView,
      professionalUiVersion: document.getElementById("novelStaticRelease")
        ?.getAttribute("data-professional-ui-version"),
    };
    return {
      finalPath: `${location.pathname}${location.search}`,
      redirectCount: performance.getEntriesByType("navigation")[0]?.redirectCount ?? null,
      semantic,
      hidden: {
        consumerShell: hidden(consumer),
        compatibilityBanner: hidden(compatibility),
        returnConsumer: hidden(returnConsumer),
        appDock: hidden(dock),
      },
      firstPaint: window.__p24bRc2FirstPaint,
      bodyDataset: {
        screen: document.body.dataset.frontdoorScreen || "",
        task: document.body.dataset.frontdoorTask || "",
        projectId: document.body.dataset.frontdoorProjectId || "",
      },
      mainTextLength: (document.querySelector('[data-testid="professional-main"]')?.textContent || "")
        .replace(/\s+/g, "")
        .length,
    };
  });
  return {
    label,
    source,
    responseStatus: response?.status() ?? null,
    semanticHash: hash(snapshot.semantic),
    ...snapshot,
    page,
  };
}

async function desktopLayout(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const app = document.querySelector(".app");
    const side = document.querySelector(".side");
    const main = document.querySelector('[data-testid="professional-main"]');
    const buttons = [...document.querySelectorAll('[data-testid="professional-menu"] button')];
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        x: Math.round(value.x),
        y: Math.round(value.y),
        width: Math.round(value.width),
        height: Math.round(value.height),
        right: Math.round(value.right),
        bottom: Math.round(value.bottom),
      };
    };
    const buttonMetrics = buttons.map((button) => ({
      label: button.textContent?.trim() || "",
      rect: rect(button),
      fontSize: Number.parseFloat(getComputedStyle(button).fontSize),
      whiteSpace: getComputedStyle(button).whiteSpace,
      scrollWidth: button.scrollWidth,
      clientWidth: button.clientWidth,
    }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      html: {
        clientWidth: html.clientWidth,
        scrollWidth: html.scrollWidth,
        clientHeight: html.clientHeight,
        scrollHeight: html.scrollHeight,
        overflowX: getComputedStyle(html).overflowX,
        overflowY: getComputedStyle(html).overflowY,
      },
      body: {
        clientWidth: body.clientWidth,
        scrollWidth: body.scrollWidth,
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        overflowX: getComputedStyle(body).overflowX,
        overflowY: getComputedStyle(body).overflowY,
      },
      app: rect(app),
      side: {
        ...rect(side),
        clientHeight: side.clientHeight,
        scrollHeight: side.scrollHeight,
        overflowY: getComputedStyle(side).overflowY,
      },
      main: {
        ...rect(main),
        clientHeight: main.clientHeight,
        scrollHeight: main.scrollHeight,
        overflowY: getComputedStyle(main).overflowY,
      },
      buttonMetrics,
      menuCount: buttons.length,
      firstRowY: buttonMetrics[0]?.rect.y ?? null,
      secondItemY: buttonMetrics[1]?.rect.y ?? null,
      thirdItemY: buttonMetrics[2]?.rect.y ?? null,
    };
  });
}

async function operateMenus(page) {
  const count = await page.locator('[data-testid="professional-menu"] button').count();
  const outcomes = [];
  for (let index = 0; index < count; index += 1) {
    const button = page.locator('[data-testid="professional-menu"] button').nth(index);
    await button.scrollIntoViewIfNeeded();
    const before = await button.evaluate((element) => ({
      label: element.textContent?.trim() || "",
      view: element.getAttribute("data-view"),
      id: element.id,
      disabled: element.disabled,
      centerOwner: (() => {
        const rect = element.getBoundingClientRect();
        const owner = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return owner === element || Boolean(owner && element.contains(owner));
      })(),
    }));
    let clickError = null;
    try {
      await button.click({ timeout: 8000 });
      await sleep(35);
    } catch (error) {
      clickError = error instanceof Error ? error.message : String(error);
    }
    const activeView = await page.locator("section.view.active").getAttribute("id").catch(() => null);
    const expectedView = before.view ? `view-${before.view}` : "view-creation";
    outcomes.push({
      index,
      ...before,
      expectedView,
      activeView,
      clickError,
      operational: !before.disabled
        && before.centerOwner
        && !clickError
        && (activeView === expectedView || (before.view === "creation" && activeView === "view-creation")),
    });
  }
  return outcomes;
}

async function createProject(page) {
  const response = await page.goto(`${baseUrl}/studio/create`, { waitUntil: "domcontentloaded" });
  await page.locator(".p2CreateShell").waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("button", { name: "空白建立" }).click();
  await page.getByLabel("作品名稱（可留白）").fill("P2.4B RC2 統一專業工作台驗證");
  await page.getByRole("button", { name: "建立作品", exact: true }).click();
  const writeLink = page.getByRole("link", { name: "開始寫作", exact: true });
  await writeLink.waitFor({ state: "visible", timeout: 20000 });
  const writeHref = await writeLink.getAttribute("href");
  const projectId = writeHref?.match(/\/studio\/project\/([^/]+)\/write/)?.[1] ?? "";
  const returnHref = await page.getByRole("link", { name: "返回 Professional 工作台" })
    .getAttribute("href");
  return {
    status: response?.status() ?? null,
    projectId,
    writeHref,
    returnHref,
  };
}

async function inspectDeepRoute(page, projectId, definition) {
  const requestedPath = definition.path(projectId);
  const response = await page.goto(`${baseUrl}${requestedPath}`, { waitUntil: "domcontentloaded" });
  await page.locator(definition.marker).waitFor({ state: "visible", timeout: 20000 });
  const routeState = await page.evaluate(({ requestedPath, marker }) => {
    const returnLink = [...document.querySelectorAll('a[href^="/professional"]')]
      .map((link) => link.getAttribute("href"))
      .find(Boolean) ?? null;
    return {
      requestedPath,
      finalPath: `${location.pathname}${location.search}`,
      marker,
      markerCount: document.querySelectorAll(marker).length,
      professionalWorkspaceCount: document.querySelectorAll('[data-testid="professional-workspace"]').length,
      returnLink,
      bodyTextLength: document.body.innerText.replace(/\s+/g, "").length,
    };
  }, { requestedPath, marker: definition.marker });
  return {
    name: definition.name,
    status: response?.status() ?? null,
    redirectedFrom: response?.request().redirectedFrom()?.url() ?? null,
    ...routeState,
  };
}

async function inspectMobile(viewport, projectId) {
  const context = await browser.newContext({
    viewport,
    locale: "zh-TW",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  attachPageObservers(page, `mobile:${viewport.width}x${viewport.height}`);
  await installFirstPaintProbe(page);
  await page.goto(`${baseUrl}/professional?projectId=${encodeURIComponent(projectId)}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForProfessional(page);
  const metricsBefore = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const app = document.querySelector(".app");
    const side = document.querySelector(".side");
    const main = document.querySelector('[data-testid="professional-main"]');
    const buttons = [...document.querySelectorAll('[data-testid="professional-menu"] button')];
    return {
      viewport: { width: innerWidth, height: innerHeight },
      html: {
        clientWidth: html.clientWidth,
        scrollWidth: html.scrollWidth,
        clientHeight: html.clientHeight,
        scrollHeight: html.scrollHeight,
        overflowX: getComputedStyle(html).overflowX,
        overflowY: getComputedStyle(html).overflowY,
      },
      body: {
        clientWidth: body.clientWidth,
        scrollWidth: body.scrollWidth,
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
      },
      app: {
        clientHeight: app.clientHeight,
        scrollHeight: app.scrollHeight,
      },
      side: {
        clientWidth: side.clientWidth,
        scrollWidth: side.scrollWidth,
        clientHeight: side.clientHeight,
        scrollHeight: side.scrollHeight,
        overflowY: getComputedStyle(side).overflowY,
      },
      main: {
        clientWidth: main.clientWidth,
        scrollWidth: main.scrollWidth,
        clientHeight: main.clientHeight,
        scrollHeight: main.scrollHeight,
        overflowY: getComputedStyle(main).overflowY,
      },
      menuCount: buttons.length,
      oneColumn: buttons.length > 1
        && Math.abs(buttons[0].getBoundingClientRect().x - buttons[1].getBoundingClientRect().x) <= 2,
      minFontSize: Math.min(...buttons.map((button) => Number.parseFloat(getComputedStyle(button).fontSize))),
      allOneLine: buttons.every((button) => getComputedStyle(button).whiteSpace === "nowrap"),
      firstPaint: window.__p24bRc2FirstPaint,
    };
  });
  const lastButton = page.locator('[data-testid="professional-menu"] button').last();
  await lastButton.scrollIntoViewIfNeeded();
  const lastButtonHit = await lastButton.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const owner = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      label: element.textContent?.trim() || "",
      ownerIsButton: owner === element || Boolean(owner && element.contains(owner)),
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
      },
    };
  });
  await lastButton.click();
  const activeAfterLastClick = await page.locator("section.view.active").getAttribute("id");
  const scrollIsolation = await page.evaluate(() => {
    const side = document.querySelector(".side");
    const main = document.querySelector('[data-testid="professional-main"]');
    side.scrollTop = Math.max(0, side.scrollHeight - side.clientHeight);
    main.scrollTop = Math.min(160, Math.max(0, main.scrollHeight - main.clientHeight));
    return {
      windowScrollY: window.scrollY,
      sideScrollTop: side.scrollTop,
      mainScrollTop: main.scrollTop,
    };
  });
  const result = {
    viewport: `${viewport.width}x${viewport.height}`,
    metrics: metricsBefore,
    lastButtonHit,
    activeAfterLastClick,
    scrollIsolation,
    checks: {
      outerHorizontalScrollZero: metricsBefore.html.scrollWidth === metricsBefore.html.clientWidth
        && metricsBefore.body.scrollWidth === metricsBefore.body.clientWidth,
      outerVerticalScrollZero: metricsBefore.html.scrollHeight === metricsBefore.html.clientHeight
        && metricsBefore.body.scrollHeight === metricsBefore.body.clientHeight,
      internalAppFitsViewport: metricsBefore.app.scrollHeight === metricsBefore.app.clientHeight,
      menuCountExact: metricsBefore.menuCount === 27,
      menuOneColumn: metricsBefore.oneColumn,
      menuInternallyScrollable: metricsBefore.side.scrollHeight > metricsBefore.side.clientHeight
        && metricsBefore.side.overflowY === "auto",
      menuNoHorizontalScroll: metricsBefore.side.scrollWidth === metricsBefore.side.clientWidth,
      labelsOneLine: metricsBefore.allOneLine,
      fontReadable: metricsBefore.minFontSize >= 14,
      lastMenuOperable: lastButtonHit.ownerIsButton && activeAfterLastClick === "view-export",
      windowScrollLocked: scrollIsolation.windowScrollY === 0,
      noConsumerFlash: metricsBefore.firstPaint?.consumerVisibleFrames === 0,
      noBlackShell: metricsBefore.firstPaint?.blackShellFrames === 0,
    },
  };
  await context.close();
  return result;
}

const frontdoorResults = [];
const firstPaintResults = [];
const semanticEntries = [];
const deepRouteResults = [];
const mobileResults = [];
let menuLayoutResults = null;
let scrollIsolationResults = null;
let projectId = "";

try {
  await startServerIfRequested();

  const redirectCases = [
    ["/", {}],
    ["/studio", {}],
    ["/studio?screen=home", { screen: "home" }],
    ["/professional", {}],
    [
      "/studio?mode=consumer&screen=create&task=rewrite_scene&projectId=project-1&tag=one&tag=two&unsafe%5Bkey%5D=x",
      {
        screen: "create",
        task: "rewrite_scene",
        projectId: "project-1",
        tag: ["one", "two"],
      },
    ],
  ];
  for (const [source, expected] of redirectCases) {
    const result = await normalizeRedirect(source);
    frontdoorResults.push(result);
    record("frontdoor", `${source} returns HTTP 307`, result.status === 307, result);
    record(
      "frontdoor",
      `${source} targets exact Professional document`,
      result.pathname === "/legacy/novel-system.html"
        && result.parameters.mode === "professional",
      result,
    );
    for (const [key, value] of Object.entries(expected)) {
      const actual = key === "tag" ? result.repeatedTag : result.parameters[key];
      record(
        "frontdoor",
        `${source} preserves ${key}`,
        JSON.stringify(actual) === JSON.stringify(value),
        { expected: value, actual },
      );
    }
    if (source.includes("unsafe")) {
      record(
        "frontdoor",
        "unsafe query key is not forwarded",
        !result.search?.includes("unsafe"),
        result,
      );
    }
  }

  const childResponse = await fetch(`${baseUrl}/studio/create`, {
    redirect: "manual",
    headers: { "cache-control": "no-cache" },
  });
  record(
    "frontdoor",
    "/studio/create remains a direct Next.js route",
    childResponse.status === 200 && !childResponse.headers.get("location"),
    {
      status: childResponse.status,
      location: childResponse.headers.get("location"),
    },
  );

  browser = await chromium.launch({ headless: true });
  const desktopContext = await browser.newContext({
    viewport: desktopViewport,
    locale: "zh-TW",
    serviceWorkers: "block",
  });

  const entryCases = [
    ["/", "root"],
    ["/studio", "studio"],
    ["/studio?screen=home", "studio-home"],
    ["/professional", "professional"],
  ];
  for (const [source, label] of entryCases) {
    const entry = await captureProfessionalEntry(desktopContext, source, label);
    semanticEntries.push(entry);
    firstPaintResults.push({
      label,
      source,
      finalPath: entry.finalPath,
      responseStatus: entry.responseStatus,
      firstPaint: entry.firstPaint,
      hidden: entry.hidden,
      mainTextLength: entry.mainTextLength,
      semanticHash: entry.semanticHash,
    });
    record("first-paint", `${label} final response is Professional content`, entry.responseStatus === 200, entry);
    record("first-paint", `${label} has visible content on first document`, entry.mainTextLength > 500, entry);
    record("first-paint", `${label} has no black shell frame`, entry.firstPaint.blackShellFrames === 0, entry.firstPaint);
    record("first-paint", `${label} has no Consumer shell flash`, entry.firstPaint.consumerVisibleFrames === 0, entry.firstPaint);
    record(
      "first-paint",
      `${label} hides all competing shell controls`,
      Object.values(entry.hidden).every(Boolean),
      entry.hidden,
    );
  }
  const semanticHashes = [...new Set(semanticEntries.map((entry) => entry.semanticHash))];
  record(
    "frontdoor",
    "four frontdoors have one semantic workspace hash",
    semanticHashes.length === 1,
    semanticEntries.map(({ label, semanticHash }) => ({ label, semanticHash })),
  );

  const desktopPage = semanticEntries.find((entry) => entry.label === "professional").page;
  for (const entry of semanticEntries) {
    if (entry.page !== desktopPage) await entry.page.close();
  }
  menuLayoutResults = await desktopLayout(desktopPage);
  record("menu", "desktop viewport is 1440x900", menuLayoutResults.viewport.width === 1440 && menuLayoutResults.viewport.height === 900, menuLayoutResults.viewport);
  record("menu", "menu count is exactly 27", menuLayoutResults.menuCount === 27, menuLayoutResults.menuCount);
  record("menu", "desktop menu uses two columns", menuLayoutResults.firstRowY === menuLayoutResults.secondItemY && menuLayoutResults.thirdItemY > menuLayoutResults.firstRowY, {
    firstRowY: menuLayoutResults.firstRowY,
    secondItemY: menuLayoutResults.secondItemY,
    thirdItemY: menuLayoutResults.thirdItemY,
  });
  record("menu", "desktop menu labels remain one line", menuLayoutResults.buttonMetrics.every((item) => item.whiteSpace === "nowrap"), menuLayoutResults.buttonMetrics);
  record("menu", "desktop menu font remains readable", menuLayoutResults.buttonMetrics.every((item) => item.fontSize >= 14), menuLayoutResults.buttonMetrics);
  record("menu", "desktop menu controls have usable height", menuLayoutResults.buttonMetrics.every((item) => item.rect.height >= 32), menuLayoutResults.buttonMetrics);
  record("menu", "left rail and main are separate columns", menuLayoutResults.side.right <= menuLayoutResults.main.x + 1 && menuLayoutResults.main.width > menuLayoutResults.side.width, {
    side: menuLayoutResults.side,
    main: menuLayoutResults.main,
  });

  const menuOperations = await operateMenus(desktopPage);
  record("menu", "all 27 menu controls are operational", menuOperations.length === 27 && menuOperations.every((item) => item.operational), menuOperations);
  menuLayoutResults.menuOperations = menuOperations;

  await desktopPage.evaluate(() => window.showView("creation"));
  scrollIsolationResults = await desktopPage.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const side = document.querySelector(".side");
    const main = document.querySelector('[data-testid="professional-main"]');
    const before = {
      windowScrollY: window.scrollY,
      sideScrollTop: side.scrollTop,
      mainScrollTop: main.scrollTop,
    };
    main.scrollTop = Math.min(240, Math.max(0, main.scrollHeight - main.clientHeight));
    const afterMain = {
      windowScrollY: window.scrollY,
      sideScrollTop: side.scrollTop,
      mainScrollTop: main.scrollTop,
    };
    side.scrollTop = Math.max(0, side.scrollHeight - side.clientHeight);
    const afterSide = {
      windowScrollY: window.scrollY,
      sideScrollTop: side.scrollTop,
      mainScrollTop: main.scrollTop,
    };
    return {
      html: {
        clientWidth: html.clientWidth,
        scrollWidth: html.scrollWidth,
        clientHeight: html.clientHeight,
        scrollHeight: html.scrollHeight,
        overflowX: getComputedStyle(html).overflowX,
        overflowY: getComputedStyle(html).overflowY,
      },
      body: {
        clientWidth: body.clientWidth,
        scrollWidth: body.scrollWidth,
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        overflowX: getComputedStyle(body).overflowX,
        overflowY: getComputedStyle(body).overflowY,
      },
      side: {
        clientHeight: side.clientHeight,
        scrollHeight: side.scrollHeight,
        overflowY: getComputedStyle(side).overflowY,
      },
      main: {
        clientHeight: main.clientHeight,
        scrollHeight: main.scrollHeight,
        overflowY: getComputedStyle(main).overflowY,
      },
      before,
      afterMain,
      afterSide,
    };
  });
  record("scroll", "html has no horizontal scroll", scrollIsolationResults.html.scrollWidth === scrollIsolationResults.html.clientWidth, scrollIsolationResults.html);
  record("scroll", "html has no vertical scroll", scrollIsolationResults.html.scrollHeight === scrollIsolationResults.html.clientHeight, scrollIsolationResults.html);
  record("scroll", "body has no horizontal scroll", scrollIsolationResults.body.scrollWidth === scrollIsolationResults.body.clientWidth, scrollIsolationResults.body);
  record("scroll", "body has no vertical scroll", scrollIsolationResults.body.scrollHeight === scrollIsolationResults.body.clientHeight, scrollIsolationResults.body);
  record("scroll", "main is independently scrollable", scrollIsolationResults.main.scrollHeight > scrollIsolationResults.main.clientHeight && scrollIsolationResults.afterMain.mainScrollTop > 0, scrollIsolationResults.main);
  record("scroll", "main scroll leaves window position fixed", scrollIsolationResults.afterMain.windowScrollY === scrollIsolationResults.before.windowScrollY, scrollIsolationResults);
  record("scroll", "side activity leaves main position unchanged", scrollIsolationResults.afterSide.mainScrollTop === scrollIsolationResults.afterMain.mainScrollTop, scrollIsolationResults);

  const created = await createProject(desktopPage);
  projectId = created.projectId;
  requirePass("deep-route", "project creation succeeds through UI", created.status === 200 && Boolean(projectId), created);
  record("deep-route", "create success has explicit Professional return", created.returnHref === `/professional?projectId=${encodeURIComponent(projectId)}`, created);

  await desktopPage.goto(`${baseUrl}/professional?projectId=${encodeURIComponent(projectId)}&screen=create&task=verify-ui`, {
    waitUntil: "domcontentloaded",
  });
  await waitForProfessional(desktopPage);
  const projectFrontdoor = await desktopPage.evaluate(() => ({
    screen: document.body.dataset.frontdoorScreen,
    task: document.body.dataset.frontdoorTask,
    projectId: document.body.dataset.frontdoorProjectId,
    activeView: document.querySelector("section.view.active")?.id,
    links: Object.fromEntries(
      [...document.querySelectorAll("[data-project-route]")]
        .map((link) => [link.getAttribute("data-project-route"), link.getAttribute("href")]),
    ),
  }));
  record("frontdoor", "screen=create selects the formal route hub", projectFrontdoor.activeView === "view-studio", projectFrontdoor);
  record("frontdoor", "task query is preserved", projectFrontdoor.task === "verify-ui", projectFrontdoor);
  record("frontdoor", "projectId query is preserved", projectFrontdoor.projectId === projectId, projectFrontdoor);
  for (const [route, expectedPath] of Object.entries({
    write: `/studio/project/${projectId}/write`,
    characters: `/studio/project/${projectId}/characters`,
    world: `/studio/project/${projectId}/world`,
    "story-bible": `/studio/project/${projectId}/story-bible`,
    "character-ai": `/studio/project/${projectId}/character-ai`,
    reader: `/studio/read/${projectId}`,
    backups: `/studio/project/${projectId}/backups`,
  })) {
    record("deep-route", `Professional links directly to ${route}`, projectFrontdoor.links[route] === expectedPath, {
      expectedPath,
      actualPath: projectFrontdoor.links[route],
    });
  }

  const deepRoutes = [
    { name: "create", path: () => "/studio/create", marker: ".p2CreateShell" },
    { name: "write", path: (id) => `/studio/project/${id}/write`, marker: ".p2WritingWorkspace" },
    { name: "characters", path: (id) => `/studio/project/${id}/characters`, marker: "#character-editor-heading" },
    { name: "world", path: (id) => `/studio/project/${id}/world`, marker: "#world-rule-editor-heading" },
    { name: "story-bible", path: (id) => `/studio/project/${id}/story-bible`, marker: "#story-bible-editor-heading" },
    { name: "character-ai", path: (id) => `/studio/project/${id}/character-ai`, marker: '[data-testid="character-agent-workspace"]' },
    { name: "reader", path: (id) => `/studio/read/${id}`, marker: ".readerShell" },
    { name: "backups", path: (id) => `/studio/project/${id}/backups`, marker: ".p2BackupCenter" },
  ];
  for (const definition of deepRoutes) {
    const result = await inspectDeepRoute(desktopPage, projectId, definition);
    deepRouteResults.push(result);
    requiredResponses.push({
      route: result.requestedPath,
      status: result.status,
      redirectedFrom: result.redirectedFrom,
    });
    record("deep-route", `${definition.name} returns HTTP 200`, result.status === 200, result);
    record("deep-route", `${definition.name} is not redirected to Legacy`, !result.redirectedFrom && result.finalPath === result.requestedPath, result);
    record("deep-route", `${definition.name} renders its Next.js marker`, result.markerCount > 0 && result.professionalWorkspaceCount === 0, result);
    record("deep-route", `${definition.name} has an explicit Professional return`, Boolean(result.returnLink), result);
  }

  for (const viewport of mobileViewports) {
    const result = await inspectMobile(viewport, projectId);
    mobileResults.push(result);
    for (const [name, pass] of Object.entries(result.checks)) {
      record("mobile", `${result.viewport} ${name}`, pass, result);
    }
  }

  await desktopContext.close();

  const baseOrigin = new URL(baseUrl).origin;
  const unexpectedHttpErrors = networkResults.filter(({ status, url }) =>
    status >= 400 && !/favicon(?:\.ico)?(?:\?|$)/i.test(url));
  const externalRequests = networkResults.filter(({ url }) => {
    if (/^(?:data|blob):/.test(url)) return false;
    try {
      return new URL(url).origin !== baseOrigin;
    } catch {
      return true;
    }
  });
  record("browser", "console error count is zero", consoleErrors.length === 0, consoleErrors);
  record("browser", "page error count is zero", pageErrors.length === 0, pageErrors);
  record("browser", "required route 4xx/5xx count is zero", unexpectedHttpErrors.length === 0, unexpectedHttpErrors);
  record("browser", "external request count is zero", externalRequests.length === 0, externalRequests);
  record("browser", "UI convergence gate has at least 30 checks", checks.length >= 30, { checkCount: checks.length });

  const pass = checks.filter((item) => item.status === "PASS").length;
  const fail = checks.filter((item) => item.status === "FAIL").length;
  const generatedAt = new Date().toISOString();
  const common = {
    generatedAt,
    baseUrl,
    projectId,
    pass,
    fail,
    skip: 0,
    checkCount: checks.length,
    status: fail === 0 ? "PASS" : "FAIL",
  };
  write("frontdoor-routes.json", {
    schemaVersion: "p24b-rc2-frontdoor-routes-v1",
    ...common,
    redirects: frontdoorResults,
    semanticEntries: semanticEntries.map((entry) => Object.fromEntries(
      Object.entries(entry).filter(([key]) => key !== "page"),
    )),
    semanticHashCount: semanticHashes.length,
    projectFrontdoor,
    checks: checks.filter((item) => item.group === "frontdoor"),
  });
  write("first-paint-results.json", {
    schemaVersion: "p24b-rc2-first-paint-results-v1",
    ...common,
    entries: firstPaintResults,
    consumerVisibleFrames: firstPaintResults.reduce(
      (sum, item) => sum + (item.firstPaint?.consumerVisibleFrames ?? 0),
      0,
    ),
    blackShellFrames: firstPaintResults.reduce(
      (sum, item) => sum + (item.firstPaint?.blackShellFrames ?? 0),
      0,
    ),
    checks: checks.filter((item) => item.group === "first-paint"),
  });
  write("menu-layout-results.json", {
    schemaVersion: "p24b-rc2-menu-layout-results-v1",
    ...common,
    desktopViewport: "1440x900",
    metrics: menuLayoutResults,
    checks: checks.filter((item) => item.group === "menu"),
  });
  write("scroll-isolation-results.json", {
    schemaVersion: "p24b-rc2-scroll-isolation-results-v1",
    ...common,
    desktopViewport: "1440x900",
    metrics: scrollIsolationResults,
    checks: checks.filter((item) => item.group === "scroll"),
  });
  write("deep-route-preservation.json", {
    schemaVersion: "p24b-rc2-deep-route-preservation-v1",
    ...common,
    requiredRouteCount: deepRoutes.length,
    results: deepRouteResults,
    requiredResponses,
    checks: checks.filter((item) => item.group === "deep-route"),
  });
  write("mobile-results.json", {
    schemaVersion: "p24b-rc2-mobile-results-v1",
    ...common,
    requiredViewports: mobileViewports.map(({ width, height }) => `${width}x${height}`),
    results: mobileResults,
    checks: checks.filter((item) => item.group === "mobile"),
  });
  if (fail) {
    console.error(JSON.stringify(checks.filter((item) => item.status === "FAIL"), null, 2));
    process.exitCode = 1;
  }
  console.log(JSON.stringify({
    status: common.status,
    pass,
    fail,
    skip: 0,
    checkCount: checks.length,
    projectId,
    mobileViewports: mobileResults.length,
    deepRoutes: deepRouteResults.length,
    externalRequests: externalRequests.length,
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
  }));
} catch (error) {
  const generatedAt = new Date().toISOString();
  const failure = {
    schemaVersion: "p24b-rc2-ui-convergence-failure-v1",
    generatedAt,
    baseUrl,
    projectId,
    status: "FAIL",
    error: {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    },
    checks,
    consoleErrors,
    pageErrors,
    networkResults,
  };
  write("first-paint-results.json", failure);
  write("menu-layout-results.json", failure);
  write("scroll-isolation-results.json", failure);
  write("mobile-results.json", failure);
  write("frontdoor-routes.json", failure);
  write("deep-route-preservation.json", failure);
  throw error;
} finally {
  await browser?.close();
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
}
