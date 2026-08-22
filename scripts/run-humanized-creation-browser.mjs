import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const baseUrl = String(process.argv.slice(2).find((value) => value !== "--") || "http://127.0.0.1:4174").replace(/\/$/u, "");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ locale: "zh-TW", viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

const results = [];
async function check(name, work) {
  await work();
  results.push({ name, status: "PASS" });
}

try {
  await page.goto(`${baseUrl}/studio/create`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await check("title is required before mode or creation path", async () => {
    await page.getByTestId("canonical-create-flow").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("create-play-mode-general").isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: /快速開始/ }).isDisabled(), true);
    assert.equal(await page.getByTestId("rpg-choice-A").count(), 0);

    await page.getByTestId("p2-project-title").fill("入口流程驗收作品");
    assert.equal(await page.getByTestId("create-play-mode-general").isEnabled(), true);
    await page.getByTestId("create-play-mode-general").click();
    await page.getByRole("button", { name: /引導建立/ }).click();
    await page.getByText("第 1 題／共 5 題").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("p2-project-title").inputValue(), "入口流程驗收作品");
  });

  await page.goto(`${baseUrl}/studio/create`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await check("incomplete RPG setup has no choices and cannot start", async () => {
    await page.getByTestId("p2-project-title").fill("必要設定 Gate 驗收");
    await page.getByTestId("create-play-structure-choice").click();
    await page.getByTestId("create-play-mode-rpg").click();
    await page.getByRole("button", { name: /引導建立/ }).click();
    await page.getByRole("button", { name: "繼續", exact: true }).click();
    await page.getByText(/請先回答第 1 題/u).waitFor({ state: "visible" });
    await page.locator(".p2FoundationWarning").waitFor({ state: "visible" });
    assert.equal(await page.locator(".p2StepBar").getAttribute("aria-label"), "第 1 步，共 5 步");
    assert.equal(await page.getByRole("button", { name: "建立「RPG 養成」作品" }).count(), 0);
    assert.equal(await page.getByTestId("rpg-choice-A").count(), 0);
  });

  await check("guide creates editable foundations without changing the title", async () => {
    for (let step = 1; step <= 5; step += 1) {
      await page.locator(".p2GuidedChoices button").first().click();
      if (step < 5) {
        await page.getByRole("button", { name: "繼續", exact: true }).click();
        await page.locator(".p2StepBar").waitFor({ state: "visible" });
        assert.equal(await page.locator(".p2StepBar").getAttribute("aria-label"), `第 ${step + 1} 步，共 5 步`);
      }
    }
    await page.getByText("故事起點已完整").waitFor({ state: "visible" });
    assert.equal((await page.getByTestId("p2-project-title").inputValue()).trim(), "必要設定 Gate 驗收");
    const preview = await page.locator(".p2SeedPreview").innerText();
    assert.equal(preview.includes("稍後補充"), false);
    assert.equal(await page.getByRole("button", { name: "建立「RPG 養成」作品" }).isEnabled(), true);
  });

  await check("RPG start reaches a playable first turn", async () => {
    await page.getByRole("button", { name: "建立「RPG 養成」作品" }).click();
    const playLink = page.getByRole("link", { name: "在故事工作台開始遊玩" });
    assert.match(await playLink.getAttribute("href"), /\/chat\?mode=play$/u);
    await playLink.click();
    await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 60_000 });
    assert.equal(new URL(page.url()).searchParams.get("mode"), "play");
    const composer = page.getByLabel("小說專案訊息");
    await composer.waitFor({ state: "visible" });
    await page.waitForFunction(() => (
      document.querySelector('[aria-label="小說專案訊息"]')?.value === "開始目前玩法的第一回合。"
    ));
    assert.match(await composer.inputValue(), /開始目前玩法的第一回合/u);
    await page.getByRole("button", { name: "送出", exact: true }).click();
    await page.getByTestId("rpg-inline-choices").waitFor({ state: "visible", timeout: 60_000 });
    for (const choice of ["A", "B", "C"]) {
      await page.getByTestId(`rpg-choice-${choice}`).waitFor({ state: "visible" });
    }
  });

  await check("mobile onboarding has no horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false);
  });

  await check("old project-home links converge on the complete management center", async () => {
    const projectId = new URL(page.url()).pathname.split("/")[3];
    assert.ok(projectId, "the created project identity must remain available");
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${baseUrl}/studio?screen=home&projectId=${encodeURIComponent(projectId)}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("professional-canonical-workbench").waitFor({ state: "visible" });
    assert.equal(new URL(page.url()).pathname, "/professional");
    for (const heading of ["故事與章節", "角色、世界與記憶", "任務、成就與檢查", "作品、存檔與備份", "自動協調器與學習", "研究與作者輔助"]) {
      await page.getByRole("heading", { name: heading }).waitFor({ state: "visible" });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileState = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      groupColumns: getComputedStyle(document.querySelector(".professionalActionGroups")).gridTemplateColumns.split(" ").length,
      managementVisible: document.querySelector('[data-testid="professional-canonical-workbench"]')?.getBoundingClientRect().height > 0,
    }));
    assert.equal(mobileState.overflow, false);
    assert.equal(mobileState.groupColumns, 1);
    assert.equal(mobileState.managementVisible, true);
  });

  await check("browser console has no unexpected errors or repeated native permission probes", async () => {
    const nativePermissionErrors = consoleErrors.filter((message) => (
      /Access to fetch at 'http:\/\/127\.0\.0\.1:32(?:17|27)\/health'/u.test(message)
      && message.includes("blocked by CORS policy")
      && message.includes("Permission was denied")
      && message.includes("`loopback` address space")
    ));
    const blockedResourceErrors = consoleErrors.filter(
      (message) => message === "Failed to load resource: net::ERR_FAILED",
    );
    const unexpectedErrors = consoleErrors.filter((message) => (
      !nativePermissionErrors.includes(message)
      && message !== "Failed to load resource: net::ERR_FAILED"
    ));
    assert.deepEqual(unexpectedErrors, []);
    assert.ok(nativePermissionErrors.length <= 2, "each Companion endpoint may trigger the native gate at most once");
    assert.ok(blockedResourceErrors.length <= nativePermissionErrors.length, "generic failures must correspond to a native permission gate");
  });

  console.log(JSON.stringify({
    suite: "HUMANIZED_CREATION_BROWSER",
    pass: results.length,
    fail: 0,
    results,
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
