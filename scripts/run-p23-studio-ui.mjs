import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";

const baseUrl = process.env.P23_BASE_URL || "http://127.0.0.1:3107";
const artifactDir = path.join(process.cwd(), "artifacts", "p23", "studio-ui");
fs.mkdirSync(artifactDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-TW" });
const page = await context.newPage();
const consoleErrors = [];
const externalRequests = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("request", (request) => {
  const url = new URL(request.url());
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) externalRequests.push(request.url());
});

const assertions = [];
async function check(name, run) {
  try {
    await run();
    assertions.push({ name, status: "PASS" });
  } catch (error) {
    assertions.push({ name, status: "FAIL", error: error instanceof Error ? error.message : String(error) });
  }
}

await page.goto(`${baseUrl}/studio/create`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "空白建立" }).click();
await page.getByLabel("作品名稱（可留白）").fill("P2.3 主權 AI 測試作品");
await page.getByRole("button", { name: "建立作品" }).click();
await page.getByRole("link", { name: "開始寫作" }).waitFor();
await page.getByRole("link", { name: "開始寫作" }).click();
await page.getByLabel("正文").fill("林昭站在封閉的城門前，知道今晚的選擇會改變所有人的命運。他必須遵守死者不可復生的世界規則。");
await page.getByRole("button", { name: "儲存目前內容" }).click();
await page.getByText(/已儲存/).waitFor();
await page.getByRole("link", { name: "AI 創作" }).click();
try {
  await page.getByRole("heading", { name: "閉端 AI 創作" }).waitFor();
} catch (error) {
  await page.screenshot({ path: path.join(artifactDir, "studio-ai-navigation-failure.png"), fullPage: true });
  fs.writeFileSync(path.join(artifactDir, "studio-ai-navigation-failure.json"), JSON.stringify({
    url: page.url(),
    title: await page.title(),
    body: (await page.locator("body").innerText()).slice(0, 8000),
    consoleErrors,
  }, null, 2), "utf8");
  throw error;
}

await check("desktop AI workspace is visible", async () => {
  await page.getByRole("button", { name: "產生三份候選" }).waitFor();
  await page.getByText("只使用已配對的閉端執行者。未配對時會明確失敗，不會改用外部 AI。").waitFor();
});
await check("unpaired generation fails closed", async () => {
  await page.getByRole("button", { name: "產生三份候選" }).click();
  await page.getByText(/本機 AI 尚未就緒|選定的執行環境尚未連線/).first().waitFor({ timeout: 10_000 });
});
await check("desktop has no horizontal overflow", async () => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("desktop horizontal overflow");
});
await page.screenshot({ path: path.join(artifactDir, "studio-ai-desktop.png"), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("heading", { name: "閉端 AI 創作" }).waitFor();
await check("mobile controls remain operable", async () => {
  await page.getByLabel("這次要做什麼").selectOption("rewrite");
  await page.getByLabel("回應方式").selectOption("deep_reasoning");
  await page.getByRole("button", { name: "產生三份候選" }).waitFor();
});
await check("mobile has no horizontal overflow", async () => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error("mobile horizontal overflow");
});
await page.screenshot({ path: path.join(artifactDir, "studio-ai-mobile.png"), fullPage: true });

await check("console errors are zero", async () => {
  if (consoleErrors.length) throw new Error(consoleErrors.join("\n"));
});
await check("external requests are zero", async () => {
  if (externalRequests.length) throw new Error(externalRequests.join("\n"));
});

await browser.close();
const report = {
  schemaVersion: "p23-studio-ui-e2e-v1",
  runAt: new Date().toISOString(),
  baseUrl,
  pass: assertions.filter((row) => row.status === "PASS").length,
  fail: assertions.filter((row) => row.status === "FAIL").length,
  skip: 0,
  consoleErrors,
  externalRequests,
  assertions,
};
const output = JSON.stringify(report, null, 2);
fs.writeFileSync(path.join(artifactDir, "studio-ai-e2e.json"), output, "utf8");
fs.writeFileSync(path.join(artifactDir, "studio-ai-e2e.sha256"), `${crypto.createHash("sha256").update(output).digest("hex")}  studio-ai-e2e.json\n`, "utf8");
console.log(output);
if (report.fail) process.exitCode = 1;
