import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => { if (value.startsWith("--")) rows.push([value.slice(2), all[index + 1]]); return rows; }, []));
const browser = String(args.browser || "chrome").toLowerCase();
const profile = path.resolve(args.profile || "");
const targetUrl = String(args.url || "");
const output = path.resolve(args.output || "revoke-restart-verification.json");
if (!new Set(["chrome", "edge"]).has(browser) || !profile || !targetUrl) throw new Error("--browser, --profile, --url, and --output are required.");
await mkdir(path.dirname(output), { recursive: true });
const network = [];
const context = await chromium.launchPersistentContext(profile, { channel: browser === "edge" ? "msedge" : "chrome", headless: false, args: ["--disable-extensions", "--disable-sync"] });
try {
  const page = context.pages()[0] || await context.newPage();
  page.on("request", (request) => network.push({ phase: "request", url: request.url() }));
  page.on("response", (response) => network.push({ phase: "response", url: response.url(), status: response.status() }));
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(5_000);
  const beforeReload = await permissions(page);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(5_000);
  const afterReload = await permissions(page);
  await page.screenshot({ path: output.replace(/\.json$/i, ".png"), fullPage: true });
  const loopback = network.filter((row) => /(?:127\.0\.0\.1|localhost|\[::1\]):3217/.test(row.url));
  const result = { schemaVersion: "r1k-browser-revoke-restart-verification-v1", capturedAt: new Date().toISOString(), browser, profile, targetUrl, beforeReload, afterReload, permission: isPrompt(beforeReload) && isPrompt(afterReload) ? "REVOKED" : "NOT_REVOKED", loopbackRequests: loopback.filter((row) => row.phase === "request").length, loopbackResponses: loopback.filter((row) => row.phase === "response").length, externalAiCalls: network.filter((row) => /(?:api\.openai\.com|generativelanguage\.googleapis\.com|api\.x\.ai)/i.test(row.url)).length, status: isPrompt(beforeReload) && isPrompt(afterReload) && !loopback.some((row) => row.phase === "response") ? "PASS" : "FAIL" };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result));
} finally { await context.close(); }
async function permissions(page) { return page.evaluate(async () => { const out = {}; for (const name of ["loopback-network", "local-network-access"]) { try { out[name] = (await navigator.permissions.query({ name })).state; } catch { out[name] = "unsupported"; } } return out; }); }
function isPrompt(value) { return [value["loopback-network"], value["local-network-access"]].filter((state) => state !== "unsupported").every((state) => state === "prompt"); }
