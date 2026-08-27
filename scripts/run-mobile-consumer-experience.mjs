import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";

const baseUrl = String(
  process.env.MOBILE_BASE_URL
  || process.argv.slice(2).find((value) => value !== "--")
  || "http://127.0.0.1:3100",
).replace(/\/$/u, "");

const defaultViewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const requestedViewportTokens = String(process.env.MOBILE_VIEWPORTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const viewports = requestedViewportTokens.length
  ? requestedViewportTokens.map((value) => {
      const match = /^(\d{3,4})x(\d{3,4})$/u.exec(value);
      assert.ok(match, `MOBILE_VIEWPORTS contains an invalid viewport: ${value}`);
      return { width: Number(match[1]), height: Number(match[2]) };
    })
  : defaultViewports;

const engineName = process.env.MOBILE_BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const browserType = engineName === "webkit" ? webkit : chromium;
const results = [];
const publicRequestTimeoutMs = 30_000;
const expectedProductCommit = String(
  process.env.EXPECTED_PRODUCT_COMMIT || process.env.PRODUCT_COMMIT || "",
).trim().toLowerCase();
if (expectedProductCommit) {
  assert.match(expectedProductCommit, /^[0-9a-f]{40}$/u, "expected Product commit must be a full SHA");
}
let browser = null;

const publicVisualAssets = [
  "/app-icon.svg",
  "/app-icon-192.png",
  "/app-icon-512.png",
  ...[
    "gothic-mystery", "historical-east-asia", "modern-mystery",
    "post-apocalypse", "scifi", "steampunk", "warm-contemporary",
    "western-fantasy", "xianxia",
  ].map((name) => `/character-portraits/atlas-${name}.webp`),
  ...[
    "armor", "artifact", "formation", "herb", "manual", "material",
    "modern-communications", "modern-credential", "modern-electronics",
    "modern-lab", "modern-medicine", "modern-tool", "modern-vehicle",
    "modern-weapon", "pill", "special-opportunity", "talisman", "weapon",
  ].map((name) => `/item-icons/${name}.webp`),
];

function record(name) {
  results.push({ name, status: "PASS" });
}

async function assertNoClippedControls(page, label) {
  const report = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const clipped = [...document.querySelectorAll("a,button,input,select,textarea,summary")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) !== 0
          && rect.width > 0
          && rect.height > 0
          && rect.bottom > 0
          && rect.top < window.innerHeight
          && (rect.left < -1 || rect.right > viewportWidth + 1);
      })
      .map((element) => ({
        text: (element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 60),
        rect: element.getBoundingClientRect().toJSON(),
      }));
    return {
      viewportWidth,
      scrollWidth: document.documentElement.scrollWidth,
      clipped,
    };
  });
  assert.ok(
    report.scrollWidth <= report.viewportWidth + 1,
    `${label}: document is ${report.scrollWidth - report.viewportWidth}px wider than its viewport`,
  );
  assert.deepEqual(report.clipped, [], `${label}: visible controls are clipped`);
}

async function assertTouchTargets(locator, label) {
  const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      text: (element.getAttribute("aria-label") || element.textContent || element.tagName).trim().slice(0, 60),
      width: rect.width,
      height: rect.height,
    };
  }));
  for (const box of boxes) {
    assert.ok(box.width >= 44 && box.height >= 44, `${label}: ${box.text} is ${box.width}x${box.height}`);
  }
}

try {
  browser = await browserType.launch({ headless: true });
  for (const viewport of viewports) {
    const context = await browser.newContext({
      locale: "zh-TW",
      viewport,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      serviceWorkers: "allow",
    });
    const sizeLabel = `${viewport.width}x${viewport.height}`;
    const page = await context.newPage();
    const pageErrors = [];
    const unexpectedLoopbackRequests = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      try {
        const url = new URL(request.url());
        if (
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
          && ["3217", "3227"].includes(url.port)
        ) unexpectedLoopbackRequests.push(request.url());
      } catch {
        // Playwright can surface browser-internal URLs that are not parseable
        // as HTTP URLs; they are outside this public Companion regression gate.
      }
    });

    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible" });
    const mobileNavigation = page.getByRole("navigation", { name: "手機主要導覽" });
    await mobileNavigation.waitFor({ state: "visible" });
    await assertNoClippedControls(page, `${sizeLabel} front door`);
    await assertTouchTargets(
      mobileNavigation.getByRole("link"),
      `${sizeLabel} mobile dock`,
    );
    await assertTouchTargets(page.locator(".brandLockup:visible"), `${sizeLabel} brand home link`);
    const forbiddenImages = await page.locator("img").evaluateAll((images) => images
      .map((image) => image.currentSrc || image.src)
      .filter((source) => /(?:file:|[CD]:\\|localhost)/iu.test(source)));
    assert.deepEqual(forbiddenImages, [], `${sizeLabel}: machine-local image URLs leaked into the public UI`);
    assert.deepEqual(unexpectedLoopbackRequests, [], `${sizeLabel}: public front door must not probe a machine-local Companion`);
    assert.deepEqual(pageErrors, [], `${sizeLabel}: front door page errors`);
    record(`${engineName} ${sizeLabel} public front door`);

    await Promise.all([
      page.waitForURL(/\/professional\?intent=library$/u, { timeout: 60_000 }),
      mobileNavigation.getByRole("link", { name: "作品", exact: true }).tap(),
    ]);
    await page.getByTestId("professional-canonical-workbench").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "目前沒有正式作品" }).waitFor({ state: "visible" });
    await assertNoClippedControls(page, `${sizeLabel} fresh library`);
    await assertTouchTargets(page.getByRole("link", { name: "建立第一部作品" }), `${sizeLabel} fresh library CTA`);
    assert.deepEqual(unexpectedLoopbackRequests, [], `${sizeLabel}: public library journey must not inherit a machine-local Companion probe`);
    assert.deepEqual(pageErrors, [], `${sizeLabel}: library page errors`);
    record(`${engineName} ${sizeLabel} fresh-user library`);

    await Promise.all([
      page.waitForURL(/\/studio\/create$/u, { timeout: 60_000 }),
      page.getByRole("link", { name: "建立第一部作品" }).tap(),
    ]);
    await page.getByTestId("canonical-create-flow").waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await assertNoClippedControls(page, `${sizeLabel} create flow`);
    await assertTouchTargets(page.getByTestId("p2-project-title"), `${sizeLabel} title input`);
    await assertTouchTargets(page.locator(".p2CreateExitActions a:visible, .p2CreateExitActions button:visible"), `${sizeLabel} create exit controls`);
    await assertTouchTargets(page.locator(".p2CreatePanel > footer button:visible"), `${sizeLabel} fixed creation actions`);
    const actionBar = await page.locator(".p2CreatePanel > footer").evaluate((footer) => {
      const rect = footer.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
    });
    assert.ok(actionBar.top >= 0 && actionBar.bottom <= actionBar.viewportHeight + 1, `${sizeLabel}: creation actions must stay visible`);
    assert.equal(
      await page.locator("details.p2SeedPreview").getAttribute("open"),
      null,
      `${sizeLabel}: the long preview must start collapsed on mobile`,
    );
    assert.deepEqual(unexpectedLoopbackRequests, [], `${sizeLabel}: public creation journey must not probe a machine-local Companion`);
    assert.deepEqual(pageErrors, [], `${sizeLabel}: create page errors`);
    record(`${engineName} ${sizeLabel} creation flow`);

    await context.close();
  }

  const releaseIdentityResponse = await fetch(`${baseUrl}/api/release/identity`, {
    signal: AbortSignal.timeout(publicRequestTimeoutMs),
  });
  const releaseIdentityBody = await releaseIdentityResponse.text();
  assert.equal(releaseIdentityResponse.ok, true, "release identity must be publicly reachable");
  const releaseIdentity = JSON.parse(releaseIdentityBody);
  assert.match(releaseIdentity.appCommit, /^[0-9a-f]{40}$/u, "release identity must contain a full app commit");
  assert.match(releaseIdentity.assetManifestDigest, /^[0-9a-f]{64}$/u, "release identity must contain the exact public asset digest");
  if (expectedProductCommit) {
    assert.equal(releaseIdentity.appCommit, expectedProductCommit, "staged app identity must match the Product commit");
    assert.equal(releaseIdentity.releaseProductCommit, expectedProductCommit, "staged Product identity must match the Product commit");
  }
  const response = await fetch(`${baseUrl}/manifest.webmanifest`, {
    signal: AbortSignal.timeout(publicRequestTimeoutMs),
  });
  const manifestBody = await response.text();
  assert.equal(response.ok, true, "manifest must be publicly reachable");
  const manifest = JSON.parse(manifestBody);
  assert.equal(manifest.start_url, "/", "installed app must open the modern front door");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  const workerResponse = await fetch(`${baseUrl}/studio-service-worker.js`, {
    signal: AbortSignal.timeout(publicRequestTimeoutMs),
  });
  const workerSource = await workerResponse.text();
  assert.equal(workerResponse.ok, true, "offline worker must be publicly reachable");
  assert.equal(workerResponse.redirected, false, "offline worker must not redirect");
  const workerUrl = new URL(workerResponse.url);
  assert.equal(workerUrl.origin, new URL(baseUrl).origin, "offline worker must stay on the application origin");
  assert.equal(workerUrl.pathname, "/studio-service-worker.js", "offline worker must keep its exact public path");
  assert.match(
    String(workerResponse.headers.get("content-type") || ""),
    /^(?:application|text)\/javascript(?:;|$)/u,
    "offline worker must return a JavaScript MIME type",
  );
  assert.match(
    workerSource,
    /NOVEL_RELEASE_IDENTITY/u,
    "offline worker must retain the release-identity handshake",
  );
  for (const asset of publicVisualAssets) {
    const assetResponse = await fetch(`${baseUrl}${asset}`, {
      signal: AbortSignal.timeout(publicRequestTimeoutMs),
    });
    const assetBytes = await assetResponse.arrayBuffer();
    assert.equal(assetResponse.ok, true, `${asset} must be public`);
    assert.match(
      String(assetResponse.headers.get("content-type") || ""),
      /^image\/(?:png|svg\+xml|webp)(?:;|$)/u,
      `${asset} must return an image MIME type`,
    );
    assert.ok(assetBytes.byteLength > 0, `${asset} must not be empty`);
  }
  const assetContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    serviceWorkers: "allow",
  });
  await assetContext.addInitScript(() => {
    window.__novelServiceWorkerMessages = [];
    navigator.serviceWorker?.addEventListener("message", (event) => {
      window.__novelServiceWorkerMessages.push(event.data);
    });
  });
  const assetPage = await assetContext.newPage();
  await assetPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const decodedAssets = await assetPage.evaluate(async (paths) => Promise.all(paths.map((path) => new Promise((resolve) => {
    const element = new Image();
    const finish = (dimensions) => {
      window.clearTimeout(timer);
      resolve({ path, ...dimensions });
    };
    const timer = window.setTimeout(() => finish({ width: 0, height: 0, status: "timeout" }), 15_000);
    element.onload = () => finish({ width: element.naturalWidth, height: element.naturalHeight, status: "loaded" });
    element.onerror = () => finish({ width: 0, height: 0, status: "error" });
    element.src = path;
  }))), publicVisualAssets);
  assert.deepEqual(
    decodedAssets.filter((asset) => asset.width < 1 || asset.height < 1),
    [],
    "every public app, portrait, and item visual must decode in the browser",
  );
  const workerRegistration = await assetPage.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("SERVICE_WORKER_READY_TIMEOUT")),
        15_000,
      )),
    ]);
    const activeWorker = registration.active;
    if (!activeWorker) throw new Error("SERVICE_WORKER_ACTIVE_MISSING");
    if (activeWorker.state !== "activated") {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          activeWorker.removeEventListener("statechange", handleStateChange);
          reject(new Error("SERVICE_WORKER_ACTIVATION_TIMEOUT"));
        }, 10_000);
        const handleStateChange = () => {
          if (activeWorker.state !== "activated") return;
          window.clearTimeout(timer);
          activeWorker.removeEventListener("statechange", handleStateChange);
          resolve();
        };
        activeWorker.addEventListener("statechange", handleStateChange);
      });
    }
    return {
      scope: registration.scope,
      activeState: activeWorker.state,
      scriptUrl: activeWorker.scriptURL,
    };
  });
  assert.equal(workerRegistration.scope, `${new URL(baseUrl).origin}/`);
  assert.equal(workerRegistration.activeState, "activated");
  const registeredWorkerUrl = new URL(workerRegistration.scriptUrl);
  assert.equal(registeredWorkerUrl.origin, new URL(baseUrl).origin);
  assert.equal(registeredWorkerUrl.pathname, "/studio-service-worker.js");
  const acceptedIdentityHandle = await assetPage.waitForFunction(
    () => window.__novelServiceWorkerMessages.find((message) => (
      message?.type === "NOVEL_RELEASE_IDENTITY_ACCEPTED"
      && /^[0-9a-f]{40}$/u.test(message.appCommit || "")
      && /^[0-9a-f]{64}$/u.test(message.assetManifestDigest || "")
    )) || false,
    undefined,
    { timeout: 20_000 },
  );
  const acceptedIdentity = await acceptedIdentityHandle.jsonValue();
  await acceptedIdentityHandle.dispose();
  assert.equal(acceptedIdentity.appCommit, releaseIdentity.appCommit);
  assert.equal(acceptedIdentity.assetManifestDigest, releaseIdentity.assetManifestDigest);
  await assetPage.waitForFunction(
    () => Boolean(navigator.serviceWorker.controller),
    undefined,
    { timeout: 10_000 },
  );
  const offlineStatus = await assetPage.evaluate(() => new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("SW_STATUS_TIMEOUT")), 5_000);
    const handler = (event) => {
      if (event.data?.type !== "NOVEL_OFFLINE_STATUS") return;
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", handler);
      resolve(event.data);
    };
    navigator.serviceWorker.addEventListener("message", handler);
    navigator.serviceWorker.controller?.postMessage({ type: "NOVEL_OFFLINE_STATUS" });
  }));
  assert.equal(offlineStatus.controlled, true);
  assert.equal(offlineStatus.appCommit, acceptedIdentity.appCommit);
  assert.equal(offlineStatus.assetManifestDigest, acceptedIdentity.assetManifestDigest);
  await assetContext.close();
  record(`${engineName} public manifest and all optimized visual assets`);

  process.stdout.write(`${JSON.stringify({
    suite: "MOBILE_CONSUMER_EXPERIENCE",
    baseUrl,
    engineName,
    results,
  }, null, 2)}\n`);
} finally {
  await browser?.close();
}
