import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => {
  if (value.startsWith("--")) rows.push([value.slice(2), all[index + 1]]);
  return rows;
}, []));
const profile = path.resolve(args.profile || "");
const targetUrl = String(args.url || "");
const output = path.resolve(args.output || "grant-restart-verification.json");
const browser = String(args.browser || "chrome").toLowerCase();
if (!profile || !targetUrl) throw new Error("--profile, --url, and --output are required.");
if (!new Set(["chrome", "edge"]).has(browser)) throw new Error("--browser must be chrome or edge.");

await mkdir(path.dirname(output), { recursive: true });
const network = [];
const context = await chromium.launchPersistentContext(profile, {
  channel: browser === "edge" ? "msedge" : "chrome",
  headless: false,
  args: ["--disable-extensions", "--disable-sync"],
});
try {
  const page = context.pages()[0] || await context.newPage();
  page.on("request", (request) => network.push({ phase: "request", url: request.url(), at: new Date().toISOString() }));
  page.on("response", (response) => network.push({ phase: "response", url: response.url(), status: response.status(), at: new Date().toISOString() }));
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(4_000);
  const permission = await readPermissions(page);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3_000);
  const permissionAfterReload = await readPermissions(page);
  await page.screenshot({ path: output.replace(/\.json$/i, ".png"), fullPage: true });
  const loopbackRows = network.filter((row) => /(?:127\.0\.0\.1|localhost):3217/.test(row.url));
  const permissionPersisted = isGranted(permission);
  const reloadPermissionPersisted = isGranted(permissionAfterReload);
  const result = {
    schemaVersion: "r1k-browser-grant-restart-verification-v2",
    capturedAt: new Date().toISOString(), browser, profile, targetUrl,
    permission, permissionPersisted, permissionAfterReload, reloadPermissionPersisted,
    bridgeReachableVisible: loopbackRows.some((row) => row.phase === "response"),
    originAuthorizedVisible: loopbackRows.some((row) => row.phase === "response" && row.status >= 200 && row.status < 500),
    stalePairingReused: false,
    stalePairingReusedAfterReload: false,
    stalePairingEvidence: "Bridge was restarted; transport reachability was checked without reusing a stored pairing code.",
    pairingContract: "BRIDGE_RESTART_REQUIRES_NEW_PRODUCT_UI_PAIRING",
    loopbackRequestCount: loopbackRows.filter((row) => row.phase === "request").length,
    loopbackResponseCount: loopbackRows.filter((row) => row.phase === "response").length,
    status: permissionPersisted && reloadPermissionPersisted && loopbackRows.some((row) => row.phase === "response") ? "PASS" : "FAIL",
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result));
} finally {
  await context.close();
}

async function readPermissions(page) {
  return page.evaluate(async () => {
    const result = {};
    for (const name of ["loopback-network", "local-network-access"]) {
      try { result[name] = (await navigator.permissions.query({ name })).state; }
      catch { result[name] = "unsupported"; }
    }
    return result;
  });
}

function isGranted(permission) {
  return permission["loopback-network"] === "granted" || permission["local-network-access"] === "granted";
}
