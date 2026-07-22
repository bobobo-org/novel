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
if (!profile || !targetUrl) throw new Error("--profile, --url, and --output are required.");

await mkdir(path.dirname(output), { recursive: true });
const network = [];
const context = await chromium.launchPersistentContext(profile, {
  channel: "chrome",
  headless: false,
  args: ["--disable-extensions", "--disable-sync"],
});
try {
  const page = context.pages()[0] || await context.newPage();
  page.on("request", (request) => network.push({ phase: "request", url: request.url(), at: new Date().toISOString() }));
  page.on("response", (response) => network.push({ phase: "response", url: response.url(), status: response.status(), at: new Date().toISOString() }));
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(4_000);
  const permission = await page.evaluate(async () => {
    const result = {};
    for (const name of ["loopback-network", "local-network-access"]) {
      try { result[name] = (await navigator.permissions.query({ name })).state; }
      catch { result[name] = "unsupported"; }
    }
    return result;
  });
  const bodyText = await page.locator("body").innerText();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3_000);
  const permissionAfterReload = await page.evaluate(async () => ({
    "loopback-network": (await navigator.permissions.query({ name: "loopback-network" })).state,
    "local-network-access": (await navigator.permissions.query({ name: "local-network-access" })).state,
  }));
  const bodyTextAfterReload = await page.locator("body").innerText();
  await page.screenshot({ path: output.replace(/\.json$/i, ".png"), fullPage: true });
  const loopbackRows = network.filter((row) => /(?:127\.0\.0\.1|localhost):3217/.test(row.url));
  const result = {
    schemaVersion: "r1k-chrome-grant-restart-verification-v1",
    capturedAt: new Date().toISOString(),
    profile,
    targetUrl,
    permission,
    permissionPersisted: permission["loopback-network"] === "granted" || permission["local-network-access"] === "granted",
    permissionAfterReload,
    reloadPermissionPersisted: permissionAfterReload["loopback-network"] === "granted" && permissionAfterReload["local-network-access"] === "granted",
    bridgeReachableVisible: bodyText.includes("本機橋接服務已啟動"),
    originAuthorizedVisible: bodyText.includes("目前網站已授權"),
    stalePairingReused: bodyText.includes("已配對"),
    stalePairingReusedAfterReload: bodyTextAfterReload.includes("已配對"),
    pairingContract: "BRIDGE_RESTART_REQUIRES_NEW_PRODUCT_UI_PAIRING",
    loopbackRequestCount: loopbackRows.filter((row) => row.phase === "request").length,
    loopbackResponseCount: loopbackRows.filter((row) => row.phase === "response").length,
    status: permission["loopback-network"] === "granted"
      && permissionAfterReload["loopback-network"] === "granted"
      && loopbackRows.some((row) => row.phase === "response") ? "PASS" : "FAIL",
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result));
} finally {
  await context.close();
}
