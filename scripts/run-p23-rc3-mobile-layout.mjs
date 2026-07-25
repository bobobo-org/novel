import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.P23_RC3_BASE_URL || "http://127.0.0.1:3113";
const artifactDir = process.env.P23_RC3_OUTPUT_DIR
  || path.join(process.cwd(), "artifacts", "p23-rc3");
const viewports = [
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];
const routes = [
  { id: "legacy-home", path: "/legacy/novel-system.html?screen=home", kind: "legacy", stress: false },
  { id: "legacy-workspace", path: "/legacy/novel-system.html?screen=workspace", kind: "legacy", stress: true },
  { id: "studio-home", path: "/studio", kind: "studio", stress: false },
  { id: "studio-ai", path: "/studio/create", kind: "studio-ai", stress: false },
];
const longToken = "InterdimensionalSovereignStoryContinuityValidationWithoutBreaks".repeat(6);
const longUrl = `https://example.invalid/${"long-path-segment/".repeat(18)}?proof=${"x".repeat(180)}`;
const longChinese = "這是一段用來驗證手機版長篇繁體中文內容能自然換行而不造成水平溢位的作品說明。".repeat(14);

function browserExecutable() {
  const candidates = [
    process.env.P23_CHROME_EXECUTABLE,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function stressState() {
  const projectId = "p23-rc3-mobile-stress";
  return {
    screen: "workspace",
    mode: "consumer",
    theme: "玄幻修仙",
    wizardStep: 1,
    wizard: {},
    projects: [{
      id: projectId,
      title: `${longToken} ${longUrl} ${longChinese}`,
      genre: "長篇繁體中文壓力測試",
      chapterTitle: longToken,
      text: longChinese,
      chapterCount: 999,
      wordCount: 500000,
      updatedAt: new Date(0).toISOString(),
      protagonist: `${longToken}${longChinese}`,
      archetype: longToken,
      conflict: longChinese,
      world: longUrl,
    }],
    activeProjectId: projectId,
    stats: {},
    statHistory: [],
    branches: [],
    choicePoint: null,
    adultEnabled: false,
    reducedMotion: true,
    largeText: false,
    lastSavedAt: "",
    notices: [],
  };
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const selectors = [
      ".app",
      ".main",
      "#consumerCreationCenter",
      "#p1StatusGrid",
      ".p1-card",
      "#consumerAppShell",
      ".p11-project",
      ".p11-project h3",
      ".p2StudioShell",
      ".p2ProjectShell",
    ];
    const rootCauseMetrics = selectors.flatMap((selector) => (
      [...document.querySelectorAll(selector)].slice(0, 3).map((element) => {
        const computed = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          selector,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          boundingRect: {
            left: rect.left,
            right: rect.right,
            width: rect.width,
          },
          computedWidth: computed.width,
          minWidth: computed.minWidth,
          padding: `${computed.paddingTop} ${computed.paddingRight} ${computed.paddingBottom} ${computed.paddingLeft}`,
          margin: `${computed.marginTop} ${computed.marginRight} ${computed.marginBottom} ${computed.marginLeft}`,
          transform: computed.transform,
          whiteSpace: computed.whiteSpace,
          overflowWrap: computed.overflowWrap,
        };
      })
    ));
    const clippedText = [...document.querySelectorAll("button,a,h1,h2,h3,p,small,span")]
      .filter((element) => {
        const computed = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return rect.width > 0
          && element.scrollWidth > element.clientWidth + 1
          && computed.overflowX === "hidden"
          && computed.textOverflow !== "ellipsis";
      })
      .slice(0, 20)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        className: String(element.className || ""),
        text: String(element.textContent || "").trim().slice(0, 160),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
    return {
      innerWidth: window.innerWidth,
      documentElement: {
        scrollWidth: documentElement.scrollWidth,
        clientWidth: documentElement.clientWidth,
        overflowX: getComputedStyle(documentElement).overflowX,
      },
      body: {
        scrollWidth: body.scrollWidth,
        clientWidth: body.clientWidth,
        overflowX: getComputedStyle(body).overflowX,
        className: body.className,
      },
      horizontalOverflowPx: Math.max(
        0,
        documentElement.scrollWidth - documentElement.clientWidth,
        body.scrollWidth - window.innerWidth,
      ),
      clippedText,
      rootCauseMetrics,
      observedSamples: window.__p23OverflowSamples || [],
    };
  });
}

async function installOverflowObserver(page, state) {
  await page.addInitScript((injectedState) => {
    if (injectedState) {
      localStorage.setItem("novel_p11_consumer_state", JSON.stringify(injectedState));
    }
    window.__p23OverflowSamples = [];
    const sample = () => {
      const documentElement = document.documentElement;
      const body = document.body;
      if (!documentElement || !body) return;
      window.__p23OverflowSamples.push({
        at: performance.now(),
        bodyClass: body.className,
        innerWidth: window.innerWidth,
        documentClientWidth: documentElement.clientWidth,
        documentScrollWidth: documentElement.scrollWidth,
        bodyScrollWidth: body.scrollWidth,
        overflowPx: Math.max(
          0,
          documentElement.scrollWidth - documentElement.clientWidth,
          body.scrollWidth - window.innerWidth,
        ),
      });
      if (window.__p23OverflowSamples.length > 200) window.__p23OverflowSamples.shift();
    };
    addEventListener("DOMContentLoaded", () => {
      sample();
      new MutationObserver(sample).observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      let frames = 0;
      const watch = () => {
        sample();
        frames += 1;
        if (frames < 180) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    }, { once: true });
  }, state);
}

async function openStudioAi(page) {
  await page.goto(new URL("/studio/create", baseUrl).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "空白建立" }).click();
  await page.getByLabel("作品名稱（可留白）").fill(`RC3 mobile ${Date.now()}`);
  await page.getByRole("button", { name: "建立作品" }).click();
  const writingLink = page.getByRole("link", { name: "開始寫作" });
  await writingLink.waitFor({ timeout: 15_000 });
  const href = await writingLink.getAttribute("href");
  const projectId = href?.match(/\/studio\/project\/([^/]+)\//)?.[1];
  if (!projectId) throw new Error("STUDIO_PROJECT_ID_NOT_FOUND");
  await writingLink.click();
  await page.getByRole("heading", { name: "專注寫作" }).waitFor({ timeout: 15_000 });
  await page.getByLabel("章節標題").fill("第一章");
  await page.getByLabel("正文").fill("主角在雨夜抵達城門，發現守衛正在尋找一封失蹤的信。");
  await page.getByRole("button", { name: "儲存目前內容" }).click();
  await page.getByText(/^已儲存 /).waitFor({ timeout: 15_000 });
  await page.getByRole("link", { name: "AI 創作" }).click();
  await page.getByRole("heading", { name: "閉端 AI 創作" }).waitFor({ timeout: 15_000 });
  return projectId;
}

const launchOptions = {
  headless: true,
  args: ["--disable-features=OverlayScrollbar"],
};
const executablePath = browserExecutable();
if (executablePath) launchOptions.executablePath = executablePath;

mkdirSync(artifactDir, { recursive: true });
const browser = await chromium.launch(launchOptions);
const cases = [];

for (const viewport of viewports) {
  for (const route of routes) {
    const context = await browser.newContext({ viewport, locale: "zh-TW" });
    const page = await context.newPage();
    const consoleErrors = [];
    const failedResponses = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400) failedResponses.push({
        status: response.status(),
        url: response.url(),
      });
    });
    await installOverflowObserver(page, route.stress ? stressState() : null);
    let setupError = null;
    try {
      if (route.kind === "studio-ai") {
        await openStudioAi(page);
      } else {
        await page.goto(new URL(route.path, baseUrl).href, { waitUntil: "domcontentloaded" });
        if (route.kind === "legacy") {
          await page.locator("#consumerAppShell").waitFor({ timeout: 15_000 });
        } else {
          await page.locator("main").first().waitFor({ timeout: 15_000 });
        }
      }
      await page.waitForTimeout(350);
    } catch (error) {
      setupError = error instanceof Error ? error.message : String(error);
    }
    const snapshot = await layoutSnapshot(page);
    const transientOverflow = snapshot.observedSamples.reduce(
      (maximum, sample) => Math.max(maximum, sample.overflowPx || 0),
      0,
    );
    const status = !setupError
      && snapshot.documentElement.scrollWidth <= snapshot.documentElement.clientWidth
      && snapshot.body.scrollWidth <= snapshot.innerWidth
      && transientOverflow === 0
      && snapshot.clippedText.length === 0
      && consoleErrors.length === 0
      && failedResponses.length === 0
      && snapshot.documentElement.overflowX !== "hidden"
      && snapshot.body.overflowX !== "hidden"
      ? "PASS"
      : "FAIL";
    const screenshotName = `${route.id}-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({
      path: path.join(artifactDir, screenshotName),
      fullPage: true,
    });
    cases.push({
      id: `${route.id}-${viewport.width}x${viewport.height}`,
      route: page.url(),
      requestedViewport: viewport,
      stress: route.stress,
      status,
      setupError,
      transientOverflow,
      consoleErrors,
      failedResponses,
      screenshot: screenshotName,
      snapshot,
    });
    await context.close();
  }
}

const zoomContext = await browser.newContext({
  viewport: { width: 195, height: 422 },
  deviceScaleFactor: 2,
  locale: "zh-TW",
});
const zoomPage = await zoomContext.newPage();
await installOverflowObserver(zoomPage, stressState());
await zoomPage.goto(new URL("/legacy/novel-system.html?screen=home", baseUrl).href, { waitUntil: "domcontentloaded" });
await zoomPage.locator("#consumerAppShell").waitFor({ timeout: 15_000 });
await zoomPage.waitForTimeout(350);
const zoomSnapshot = await layoutSnapshot(zoomPage);
const zoomTransientOverflow = zoomSnapshot.observedSamples.reduce(
  (maximum, sample) => Math.max(maximum, sample.overflowPx || 0),
  0,
);
const zoomStatus = zoomSnapshot.documentElement.scrollWidth <= zoomSnapshot.documentElement.clientWidth
  && zoomSnapshot.body.scrollWidth <= zoomSnapshot.innerWidth
  && zoomTransientOverflow === 0
  ? "PASS"
  : "FAIL";
await zoomPage.screenshot({ path: path.join(artifactDir, "legacy-home-390x844-zoom-200.png"), fullPage: true });
cases.push({
  id: "legacy-home-390x844-zoom-200",
  route: zoomPage.url(),
  requestedViewport: { width: 390, height: 844 },
  effectiveCssViewport: { width: 195, height: 422 },
  browserZoomPercentEquivalent: 200,
  stress: true,
  status: zoomStatus,
  transientOverflow: zoomTransientOverflow,
  screenshot: "legacy-home-390x844-zoom-200.png",
  snapshot: zoomSnapshot,
});
await zoomContext.close();
await browser.close();

const pass = cases.filter((item) => item.status === "PASS").length;
const fail = cases.filter((item) => item.status === "FAIL").length;
const report = {
  schemaVersion: "p23-rc3-mobile-layout-v1",
  runAt: new Date().toISOString(),
  baseUrl,
  browserExecutable: executablePath || "playwright-managed",
  pass,
  fail,
  skip: 0,
  assertions: {
    "P2.3_RC3_LEGACY_MOBILE_OVERFLOW_REPAIR_PASS": fail === 0,
    "P2.3_RC3_MULTI_VIEWPORT_LAYOUT_REGRESSION_PASS": fail === 0,
  },
  cases,
};
const output = `${JSON.stringify(report, null, 2)}\n`;
writeFileSync(path.join(artifactDir, "mobile-overflow-results.json"), output, "utf8");
writeFileSync(
  path.join(artifactDir, "mobile-overflow-results.sha256"),
  `${createHash("sha256").update(output).digest("hex")}  mobile-overflow-results.json\n`,
  "utf8",
);
console.log(output);
if (fail) process.exitCode = 1;
