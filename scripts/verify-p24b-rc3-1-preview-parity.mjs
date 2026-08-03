import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROUTES = [
  "/",
  "/studio",
  "/settings/local-ai",
  "/studio/quick-assistant",
  "/studio-service-worker.js",
  "/manifest.webmanifest",
];
const OPTIONAL_MANIFESTS = [
  "/build-manifest.json",
  "/routes-manifest.json",
  "/_next/routes-manifest.json",
];
const PRODUCTION_ORIGINS = new Set([
  "https://novel-orcin.vercel.app",
  "https://novel-lqtechs-projects.vercel.app",
]);

function argsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return result;
}

function sha(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function previewOrigin(value) {
  const url = new URL(String(value || ""));
  if (
    url.protocol !== "https:"
    || !url.hostname.endsWith(".vercel.app")
    || PRODUCTION_ORIGINS.has(url.origin)
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("NON_PRODUCTION_PREVIEW_ORIGIN_REQUIRED");
  }
  return url.origin;
}

function mimeOf(response) {
  return (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

function textMime(mime, pathname) {
  return mime.startsWith("text/")
    || /(?:javascript|json|manifest|xml|svg)/u.test(mime)
    || /\.(?:html?|css|js|mjs|json|webmanifest|svg|txt)$/iu.test(pathname);
}

function runtimeRole(pathname, mime) {
  if (ROUTES.includes(pathname)) {
    if (pathname === "/studio-service-worker.js") return "service-worker";
    if (pathname === "/manifest.webmanifest") return "web-manifest";
    return `route-document:${pathname}`;
  }
  if (/routes-manifest/iu.test(pathname)) return "route-manifest";
  if (/buildManifest|build-manifest/iu.test(pathname)) return "build-manifest";
  if (/ssgManifest/iu.test(pathname)) return "ssg-manifest";
  if (/\.css$/iu.test(pathname) || mime === "text/css") return "application-css";
  if (/\.(?:js|mjs)$/iu.test(pathname) || /javascript/u.test(mime)) return "application-js";
  if (/\.(?:woff2?|ttf|otf)$/iu.test(pathname) || /font/u.test(mime)) return "font";
  if (/\.(?:png|jpe?g|gif|webp|avif|ico|svg)$/iu.test(pathname) || mime.startsWith("image/")) return "image";
  return pathname.startsWith("/_next/") ? "next-runtime-asset" : "consumer-asset";
}

function extractUrls(text, base) {
  const values = new Set();
  const patterns = [
    /(?:src|href)=["']([^"']+)["']/giu,
    /url\(\s*["']?([^"')\s]+)["']?\s*\)/giu,
    /["'`](\/_next\/static\/[^"'`\s)]+)/gu,
    /["'`](\/(?:manifest\.webmanifest|studio-service-worker\.js|[^"'`\s)]+\.(?:css|js|mjs|json|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|ico|svg)))["'`]/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      try {
        const url = new URL(match[1].replaceAll("&amp;", "&"), base);
        if (["http:", "https:"].includes(url.protocol)) values.add(url.href);
      } catch { /* non-URL source token */ }
    }
  }
  return [...values];
}

function identityNormalizer(input) {
  const replacements = [
    ...input.origins,
    ...input.commits,
    ...input.buildIds,
  ].filter(Boolean).sort((left, right) => right.length - left.length);
  return (value) => {
    let normalized = value;
    for (const replacement of replacements) {
      normalized = normalized.replaceAll(replacement, replacement.includes("vercel.app")
        ? "<VERCEL_PREVIEW_ORIGIN>"
        : replacement.length === 40
          ? "<APP_COMMIT>"
          : "<NEXT_BUILD_ID>");
    }
    return normalized
      .replace(
        /((?:\\?["'])(?:assetManifestDigest|commitProvenanceHash)(?:\\?["'])\s*:\s*(?:\\?["']))[0-9a-f]{64}((?:\\?["']))/giu,
        "$1<PROVENANCE_DIGEST>$2",
      )
      .replace(/dpl_[A-Za-z0-9_-]+/gu, "<DEPLOYMENT_ID>")
      .replace(/(["']buildTime["']\s*:\s*["'])[^"']+(["'])/giu, "$1<BUILD_TIME>$2")
      .replace(/([?&](?:dpl|deployment|buildId|commit)=)[^&#"']+/giu, "$1<DEPLOYMENT_ID>");
  };
}

async function fetchAsset(url) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "P2.4B-RC3.1-Runtime-Parity/1.0" },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    response,
    bytes,
    mime: mimeOf(response),
  };
}

async function crawl(origin) {
  const queue = [...ROUTES, ...OPTIONAL_MANIFESTS].map((route) => `${origin}${route}`);
  const seen = new Set();
  const raw = [];
  const buildIds = new Set();
  while (queue.length && seen.size < 600) {
    const requested = queue.shift();
    const requestedUrl = new URL(requested);
    requestedUrl.hash = "";
    const key = requestedUrl.href;
    if (seen.has(key) || requestedUrl.origin !== origin) continue;
    seen.add(key);
    let fetched;
    try {
      fetched = await fetchAsset(key);
    } catch (error) {
      raw.push({
        url: key,
        pathname: requestedUrl.pathname,
        status: 0,
        mime: "",
        bytes: Buffer.alloc(0),
        fetchError: String(error?.name || "FETCH_ERROR"),
      });
      continue;
    }
    const finalUrl = new URL(fetched.response.url);
    const item = {
      url: key,
      pathname: requestedUrl.pathname,
      finalPathname: finalUrl.pathname,
      status: fetched.response.status,
      mime: fetched.mime,
      bytes: fetched.bytes,
      fetchError: null,
    };
    raw.push(item);
    if (!textMime(item.mime, item.pathname) || !fetched.bytes.length) continue;
    const text = fetched.bytes.toString("utf8");
    for (const match of text.matchAll(/\/_next\/static\/([^/"'\s]+)\/(?:_buildManifest|_ssgManifest)\.js/gu)) {
      buildIds.add(match[1]);
    }
    if (text.includes("self.__next_f.push")) {
      for (const match of text.matchAll(/(?:\\?["'])b(?:\\?["'])\s*:\s*(?:\\?["'])([A-Za-z0-9_-]{10,128})(?:\\?["'])/gu)) {
        buildIds.add(match[1]);
      }
    }
    for (const discovered of extractUrls(text, key)) {
      const url = new URL(discovered);
      url.hash = "";
      if (url.origin === origin && !seen.has(url.href)) queue.push(url.href);
    }
  }
  for (const buildId of buildIds) {
    for (const suffix of ["_buildManifest.js", "_ssgManifest.js"]) {
      const url = `${origin}/_next/static/${buildId}/${suffix}`;
      if (!seen.has(url)) queue.push(url);
    }
  }
  while (queue.length && seen.size < 650) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const fetched = await fetchAsset(url);
      raw.push({
        url,
        pathname: new URL(url).pathname,
        finalPathname: new URL(fetched.response.url).pathname,
        status: fetched.response.status,
        mime: fetched.mime,
        bytes: fetched.bytes,
        fetchError: null,
      });
    } catch (error) {
      raw.push({
        url,
        pathname: new URL(url).pathname,
        status: 0,
        mime: "",
        bytes: Buffer.alloc(0),
        fetchError: String(error?.name || "FETCH_ERROR"),
      });
    }
  }
  return { raw, buildIds: [...buildIds].sort() };
}

function canonicalPath(pathname, buildIds) {
  let value = pathname;
  for (const buildId of buildIds) value = value.replaceAll(buildId, "<NEXT_BUILD_ID>");
  return value;
}

function inventory(crawlResult, normalize) {
  return crawlResult.raw.map((item) => {
    const rawDigest = sha(item.bytes);
    const normalizedBytes = textMime(item.mime, item.pathname)
      ? Buffer.from(normalize(item.bytes.toString("utf8")), "utf8")
      : item.bytes;
    return {
      pathname: item.pathname,
      canonicalPath: canonicalPath(item.pathname, crawlResult.buildIds),
      runtimeRole: runtimeRole(item.pathname, item.mime),
      status: item.status,
      mime: item.mime,
      bytes: item.bytes.length,
      sha256: rawDigest,
      normalizedBytes: normalizedBytes.length,
      normalizedSha256: sha(normalizedBytes),
      fetchError: item.fetchError,
    };
  }).sort((left, right) =>
    left.runtimeRole.localeCompare(right.runtimeRole)
    || left.canonicalPath.localeCompare(right.canonicalPath));
}

function compare(product, head) {
  const unmatched = new Set(head.map((_, index) => index));
  const comparisons = [];
  let blockingMismatch = 0;
  let missing = 0;
  for (const productItem of product) {
    let index = head.findIndex((headItem, candidateIndex) =>
      unmatched.has(candidateIndex)
      && headItem.runtimeRole === productItem.runtimeRole
      && headItem.canonicalPath === productItem.canonicalPath);
    if (index < 0) {
      index = head.findIndex((headItem, candidateIndex) =>
        unmatched.has(candidateIndex)
        && headItem.runtimeRole === productItem.runtimeRole
        && headItem.normalizedSha256 === productItem.normalizedSha256);
    }
    if (index < 0) {
      missing += 1;
      comparisons.push({ status: "MISSING", product: productItem, head: null });
      continue;
    }
    unmatched.delete(index);
    const headItem = head[index];
    const equal = productItem.status === headItem.status
      && productItem.mime === headItem.mime
      && productItem.normalizedBytes === headItem.normalizedBytes
      && productItem.normalizedSha256 === headItem.normalizedSha256
      && productItem.fetchError === headItem.fetchError;
    if (!equal) blockingMismatch += 1;
    comparisons.push({
      status: equal ? "MATCH" : "BLOCKING_MISMATCH",
      rawIdentityDifferenceAllowed: equal && (
        productItem.bytes !== headItem.bytes
        || productItem.sha256 !== headItem.sha256
        || productItem.pathname !== headItem.pathname
      ),
      product: productItem,
      head: headItem,
    });
  }
  const unexpectedRows = [...unmatched].map((index) => head[index]);
  return {
    blockingMismatch,
    missing,
    unexpected: unexpectedRows.length,
    comparisons,
    unexpectedRows,
  };
}

async function identity(origin) {
  const response = await fetch(`${origin}/api/release/identity?parity=${crypto.randomUUID()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RELEASE_IDENTITY_HTTP_${response.status}`);
  const body = await response.json();
  return body.releaseIdentity || body;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const productOrigin = previewOrigin(args["product-url"]);
  const headOrigin = previewOrigin(args["head-url"]);
  const productCommit = String(args["product-commit"] || "");
  const headCommit = String(args["head-commit"] || "");
  const output = path.resolve(String(
    args.output
    || "artifacts/p24b-rc3-1-consumer-activation/product-final-head-preview-parity.json",
  ));
  if (![productCommit, headCommit].every((commit) => /^[0-9a-f]{40}$/iu.test(commit))) {
    throw new Error("PRODUCT_AND_HEAD_COMMITS_REQUIRED");
  }
  const [productIdentity, headIdentity, productCrawl, headCrawl] = await Promise.all([
    identity(productOrigin),
    identity(headOrigin),
    crawl(productOrigin),
    crawl(headOrigin),
  ]);
  if (productIdentity.appCommit !== productCommit) throw new Error("PRODUCT_IDENTITY_COMMIT_MISMATCH");
  if (headIdentity.appCommit !== headCommit) throw new Error("HEAD_IDENTITY_COMMIT_MISMATCH");
  const normalize = identityNormalizer({
    origins: [productOrigin, headOrigin],
    commits: [productCommit, headCommit],
    buildIds: [...productCrawl.buildIds, ...headCrawl.buildIds],
  });
  const productInventory = inventory(productCrawl, normalize);
  const headInventory = inventory(headCrawl, normalize);
  const comparison = compare(productInventory, headInventory);
  const status = comparison.blockingMismatch === 0
    && comparison.missing === 0
    && comparison.unexpected === 0
    ? "PASS"
    : "FAIL";
  const result = {
    schemaVersion: "p24b-rc3-1-preview-parity-v1",
    status,
    product: {
      origin: productOrigin,
      appCommit: productIdentity.appCommit,
      deploymentId: productIdentity.deploymentId ?? null,
      assetCount: productInventory.length,
      buildIdDigests: productCrawl.buildIds.map(sha),
    },
    finalHead: {
      origin: headOrigin,
      appCommit: headIdentity.appCommit,
      deploymentId: headIdentity.deploymentId ?? null,
      assetCount: headInventory.length,
      buildIdDigests: headCrawl.buildIds.map(sha),
    },
    allowedIdentityDifferences: [
      "appCommit",
      "deploymentId",
      "buildTime",
      "Vercel hostname",
      "Release Identity header",
      "deployment-specific RSC/build identity",
    ],
    blockingMismatch: comparison.blockingMismatch,
    missing: comparison.missing,
    unexpected: comparison.unexpected,
    comparisons: comparison.comparisons,
    unexpectedRows: comparison.unexpectedRows,
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    status,
    blockingMismatch: result.blockingMismatch,
    missing: result.missing,
    unexpected: result.unexpected,
    productAssets: productInventory.length,
    headAssets: headInventory.length,
  })}\n`);
  if (status !== "PASS") process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", error: error.message })}\n`);
  process.exitCode = 1;
});
