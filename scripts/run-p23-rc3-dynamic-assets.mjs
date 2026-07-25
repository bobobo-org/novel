import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.P23_RC3_BASE_URL || "http://127.0.0.1:3113";
const pagePath = process.env.P23_RC3_ASSET_PAGE || "/legacy/novel-system.html?screen=home";
const artifactDir = process.env.P23_RC3_OUTPUT_DIR
  || path.join(process.cwd(), "artifacts", "p23-rc3");
const outputPath = path.join(artifactDir, "dynamic-asset-results.json");

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

function parseSrcset(value) {
  if (!value || /^(?:data|blob|javascript):/i.test(value.trim())) return [];
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
}

function expectedContentTypes(urlPath) {
  const extension = path.extname(urlPath).toLowerCase();
  const byExtension = {
    ".css": ["text/css"],
    ".js": ["text/javascript", "application/javascript"],
    ".mjs": ["text/javascript", "application/javascript"],
    ".json": ["application/json", "application/manifest+json"],
    ".webmanifest": ["application/manifest+json", "application/json"],
    ".png": ["image/png"],
    ".jpg": ["image/jpeg"],
    ".jpeg": ["image/jpeg"],
    ".gif": ["image/gif"],
    ".webp": ["image/webp"],
    ".avif": ["image/avif"],
    ".svg": ["image/svg+xml"],
    ".ico": ["image/x-icon", "image/vnd.microsoft.icon"],
    ".woff": ["font/woff", "application/font-woff", "application/octet-stream"],
    ".woff2": ["font/woff2", "application/octet-stream"],
    ".ttf": ["font/ttf", "application/octet-stream"],
    ".otf": ["font/otf", "application/octet-stream"],
  };
  return byExtension[extension] || [];
}

function isHtmlFallback(contentType, urlPath) {
  return !/\.html?$/i.test(urlPath) && /^text\/html(?:;|$)/i.test(contentType || "");
}

const launchOptions = { headless: true };
const executablePath = browserExecutable();
if (executablePath) launchOptions.executablePath = executablePath;

mkdirSync(artifactDir, { recursive: true });
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ locale: "zh-TW" });
const pageUrl = new URL(pagePath, baseUrl).href;
const pageResponse = await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
await page.locator("#consumerAppShell").waitFor({ timeout: 15_000 });
await page.waitForLoadState("networkidle").catch(() => {});

const rawReferences = await page.evaluate(() => {
  const rows = [];
  const add = (element, attribute, value) => {
    if (value) rows.push({
      sourceElement: element.tagName.toLowerCase(),
      sourceAttribute: attribute,
      originalReference: value,
    });
  };
  document.querySelectorAll("script[src]").forEach((element) => add(element, "src", element.getAttribute("src")));
  document.querySelectorAll("link[href]").forEach((element) => add(element, "href", element.getAttribute("href")));
  document.querySelectorAll("img[src],source[src]").forEach((element) => add(element, "src", element.getAttribute("src")));
  document.querySelectorAll("img[srcset],source[srcset]").forEach((element) => add(element, "srcset", element.getAttribute("srcset")));
  return rows;
});

const discovered = [];
for (const row of rawReferences) {
  const references = row.sourceAttribute === "srcset"
    ? parseSrcset(row.originalReference)
    : [row.originalReference.trim()];
  for (const reference of references) {
    if (!reference || reference.startsWith("#") || /^(?:data|blob|javascript):/i.test(reference)) continue;
    const resolved = new URL(reference, page.url());
    if (resolved.origin !== new URL(page.url()).origin) continue;
    resolved.hash = "";
    discovered.push({
      ...row,
      originalReference: reference,
      normalizedPath: `${resolved.pathname}${resolved.search}`,
      resolvedUrl: resolved.href,
    });
  }
}

const grouped = new Map();
for (const asset of discovered) {
  const current = grouped.get(asset.resolvedUrl) || {
    originalReference: asset.originalReference,
    normalizedPath: asset.normalizedPath,
    resolvedUrl: asset.resolvedUrl,
    sourceElements: [],
    referenceCount: 0,
  };
  current.referenceCount += 1;
  current.sourceElements.push({
    element: asset.sourceElement,
    attribute: asset.sourceAttribute,
    reference: asset.originalReference,
  });
  grouped.set(asset.resolvedUrl, current);
}

const assets = [];
for (const asset of [...grouped.values()].sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath))) {
  const redirectChain = [];
  let currentUrl = asset.resolvedUrl;
  let response;
  for (let redirect = 0; redirect < 6; redirect += 1) {
    response = await fetch(currentUrl, {
      cache: "no-store",
      redirect: "manual",
      headers: { "user-agent": "P2.3-RC3-dynamic-asset-gate" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    redirectChain.push({ status: response.status, location });
    if (!location) break;
    currentUrl = new URL(location, currentUrl).href;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  const allowedTypes = expectedContentTypes(new URL(asset.resolvedUrl).pathname);
  const contentTypeMatches = allowedTypes.length === 0
    || allowedTypes.some((expected) => contentType.toLowerCase().startsWith(expected));
  assets.push({
    ...asset,
    httpStatus: response.status,
    contentType,
    contentLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    redirectChain,
    htmlFallback: isHtmlFallback(contentType, new URL(asset.resolvedUrl).pathname),
    contentTypeMatches,
  });
}

const failures = {
  missing: assets.filter((asset) => asset.httpStatus !== 200).length,
  unexpectedHtmlFallback: assets.filter((asset) => asset.htmlFallback).length,
  unexpectedRedirects: assets.filter((asset) => asset.redirectChain.length > 0).length,
  contentTypeMismatch: assets.filter((asset) => !asset.contentTypeMatches).length,
  hashFailure: assets.filter((asset) => !/^[0-9a-f]{64}$/.test(asset.sha256)).length,
};
const failedCount = Object.values(failures).reduce((total, value) => total + value, 0);
const passedAssets = assets.filter((asset) => (
  asset.httpStatus === 200
  && asset.redirectChain.length === 0
  && !asset.htmlFallback
  && asset.contentTypeMatches
  && /^[0-9a-f]{64}$/.test(asset.sha256)
));
const report = {
  schemaVersion: "p23-rc3-dynamic-asset-gate-v1",
  runAt: new Date().toISOString(),
  pageUrl,
  pageStatus: pageResponse?.status() ?? null,
  discoveryMethod: "runtime_dom_same_origin",
  expectedAssetCountSource: "discovered_from_reviewed_html",
  totalCanonicalLocalAssets: assets.length,
  passedCanonicalLocalAssets: passedAssets.length,
  summary: `${passedAssets.length}/${assets.length} canonical local assets PASS`,
  status: failedCount === 0 && assets.length > 0 ? "PASS" : "FAIL",
  assertions: {
    "P2.3_RC3_DYNAMIC_STATIC_ASSET_DISCOVERY_PASS": failedCount === 0 && assets.length > 0,
    "P2.3_RC3_STATIC_ASSET_CLOSURE_PASS": failedCount === 0 && assets.length > 0,
  },
  failures,
  assets,
};

await browser.close();
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (report.status !== "PASS") process.exitCode = 1;
