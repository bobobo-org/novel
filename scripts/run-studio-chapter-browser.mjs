import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const baseArgument = process.argv.slice(2).find((value) => value !== "--");
const baseUrl = String(baseArgument || "http://127.0.0.1:4174").replace(/\/$/u, "");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ locale: "zh-TW" });
const page = await context.newPage();
const results = [];
const dialogs = [];
page.on("dialog", (dialog) => {
  dialogs.push(dialog.message());
  void dialog.dismiss();
});

async function check(name, work) {
  try {
    await work();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

try {
  await page.goto(`${baseUrl}/studio/create`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("canonical-create-flow").waitFor({ state: "visible" });
  await page.getByTestId("p2-project-title").fill("章節瀏覽器驗收");
  await page.getByTestId("create-play-mode-general").click();
  await page.getByRole("button", { name: /立即產生裝置亂數雛形/ }).click();
  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await page.getByText("故事起點已完整").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "建立「一般章節寫作」作品" }).click();
  await page.getByRole("link", { name: "進入第一章寫作" }).click();
  const writing = page.getByTestId("studio-writing");
  await writing.waitFor({ state: "visible", timeout: 60_000 });

  const editor = page.getByLabel("正文", { exact: true });
  const manager = page.getByTestId("studio-chapter-manager");

  await check("first chapter saves independently", async () => {
    await editor.fill("第一章唯一內容：紅色票根。");
    await page.getByRole("button", { name: "儲存目前內容" }).click();
    await page.getByText(/已儲存/u).first().waitFor({ state: "visible" });
  });

  await check("new chapter starts blank and becomes active", async () => {
    await manager.getByRole("button", { name: /新增/ }).click();
    await expect(page.getByLabel("章節標題")).toHaveValue("第2章", { timeout: 30_000 });
    assert.equal(await editor.inputValue(), "");
    await editor.fill("第二章唯一內容：藍色鑰匙。");
    await page.getByRole("button", { name: "儲存目前內容" }).click();
    await page.getByText(/已儲存/u).first().waitFor({ state: "visible" });
  });

  await check("switching chapters never mixes their text", async () => {
    await manager.getByRole("button", { name: /1\. 第一章/ }).click();
    await expect(page.getByLabel("章節標題")).toHaveValue("第一章");
    assert.equal(await editor.inputValue(), "第一章唯一內容：紅色票根。");
    await manager.getByRole("button", { name: /2\. 第2章/ }).click();
    await expect(page.getByLabel("章節標題")).toHaveValue("第2章");
    assert.equal(await editor.inputValue(), "第二章唯一內容：藍色鑰匙。");
  });

  await check("completing a chapter creates the next chapter instead of returning to chapter one", async () => {
    await page.getByRole("button", { name: "完成本章並建立下一章" }).click();
    await manager.getByRole("button", { name: /3\. 第3章/ }).waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await page.getByLabel("章節標題").inputValue(), "第3章");
    assert.equal(await editor.inputValue(), "");
  });

  await check("active chapter and isolated content survive reload", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("studio-writing").waitFor({ state: "visible" });
    assert.equal(await page.getByLabel("章節標題").inputValue(), "第3章");
    await page.getByTestId("studio-chapter-manager").getByRole("button", { name: /1\. 第一章/ }).click();
    await expect(page.getByLabel("正文", { exact: true })).toHaveValue("第一章唯一內容：紅色票根。");
    await page.getByTestId("studio-chapter-manager").getByRole("button", { name: /2\. 第2章/ }).click();
    await expect(page.getByLabel("正文", { exact: true })).toHaveValue("第二章唯一內容：藍色鑰匙。");
  });

  await check("chapter flow raises no blocking dialog", async () => {
    assert.deepEqual(dialogs, []);
  });
} finally {
  await context.close();
  await browser.close();
}

console.log(JSON.stringify({
  schemaVersion: "studio-chapter-browser-v1",
  status: results.every((entry) => entry.status === "PASS") ? "PASS" : "FAIL",
  results,
}, null, 2));
