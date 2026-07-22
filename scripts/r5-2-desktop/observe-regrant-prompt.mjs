import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => { if (value.startsWith("--")) rows.push([value.slice(2), all[index + 1]]); return rows; }, []));
const browser = String(args.browser || "chrome").toLowerCase();
const profile = path.resolve(args.profile || "");
const targetUrl = String(args.url || "");
const output = path.resolve(args.output || "regrant-observation.json");
const waitMs = Number(args.waitMs || 25_000);
const context = await chromium.launchPersistentContext(profile, { channel: browser === "edge" ? "msedge" : "chrome", headless: false, args: ["--disable-extensions", "--disable-sync"] });
try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(waitMs);
  await writeFile(output, `${JSON.stringify({ schemaVersion: "r1k-browser-regrant-observation-v1", browser, profile, targetUrl, waitedMs: waitMs, completedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
} finally { await context.close(); }
