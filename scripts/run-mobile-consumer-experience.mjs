import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";

const baseUrl = String(
  process.env.MOBILE_BASE_URL
  || process.argv.slice(2).find((value) => value !== "--")
  || "http://127.0.0.1:3100",
).replace(/\/$/u, "");

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

const engineName = process.env.MOBILE_BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const browserType = engineName === "webkit" ? webkit : chromium;
const browser = await browserType.launch(
  engineName === "chromium" && process.platform === "win32"
    ? { channel: "msedge", headless: true }
    : { headless: true },
);
const results = [];

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
  for (const viewport of viewports) {
    const context = await browser.newContext({ locale: "zh-TW", viewport });
    const page = await context.newPage();
    const sizeLabel = `${viewport.width}x${viewport.height}`;
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible" });
    await page.getByRole("navigation", { name: "手機主要導覽" }).waitFor({ state: "visible" });
    await assertNoClippedControls(page, `${sizeLabel} front door`);
    await assertTouchTargets(
      page.getByRole("navigation", { name: "手機主要導覽" }).getByRole("link"),
      `${sizeLabel} mobile dock`,
    );
    await assertTouchTargets(page.locator(".brandLockup:visible"), `${sizeLabel} brand home link`);
    const forbiddenImages = await page.locator("img").evaluateAll((images) => images
      .map((image) => image.currentSrc || image.src)
      .filter((source) => /(?:file:|[CD]:\\|localhost)/iu.test(source)));
    assert.deepEqual(forbiddenImages, [], `${sizeLabel}: machine-local image URLs leaked into the public UI`);
    assert.deepEqual(pageErrors, [], `${sizeLabel}: front door page errors`);
    record(`${engineName} ${sizeLabel} public front door`);

    await page.goto(`${baseUrl}/professional?intent=library`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("professional-canonical-workbench").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "目前沒有正式作品" }).waitFor({ state: "visible" });
    await assertNoClippedControls(page, `${sizeLabel} fresh library`);
    await assertTouchTargets(page.getByRole("link", { name: "建立第一部作品" }), `${sizeLabel} fresh library CTA`);
    assert.deepEqual(pageErrors, [], `${sizeLabel}: library page errors`);
    record(`${engineName} ${sizeLabel} fresh-user library`);

    await page.goto(`${baseUrl}/studio/create`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("canonical-create-flow").waitFor({ state: "visible" });
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
    assert.deepEqual(pageErrors, [], `${sizeLabel}: create page errors`);
    record(`${engineName} ${sizeLabel} creation flow`);

    await context.close();
  }

  const response = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(response.ok, true, "manifest must be publicly reachable");
  const manifest = await response.json();
  assert.equal(manifest.start_url, "/", "installed app must open the modern front door");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  for (const asset of publicVisualAssets) {
    const assetResponse = await fetch(`${baseUrl}${asset}`);
    assert.equal(assetResponse.ok, true, `${asset} must be public`);
    assert.match(
      String(assetResponse.headers.get("content-type") || ""),
      /^image\/(?:png|svg\+xml|webp)(?:;|$)/u,
      `${asset} must return an image MIME type`,
    );
  }
  const assetContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const assetPage = await assetContext.newPage();
  await assetPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const decodedAssets = await assetPage.evaluate(async (paths) => Promise.all(paths.map((path) => new Promise((resolve) => {
    const element = new Image();
    element.onload = () => resolve({ path, width: element.naturalWidth, height: element.naturalHeight });
    element.onerror = () => resolve({ path, width: 0, height: 0 });
    element.src = path;
  }))), publicVisualAssets);
  assert.deepEqual(
    decodedAssets.filter((asset) => asset.width < 1 || asset.height < 1),
    [],
    "every public app, portrait, and item visual must decode in the browser",
  );
  await assetContext.close();
  record(`${engineName} public manifest and all optimized visual assets`);

  process.stdout.write(`${JSON.stringify({
    suite: "MOBILE_CONSUMER_EXPERIENCE",
    baseUrl,
    engineName,
    results,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
