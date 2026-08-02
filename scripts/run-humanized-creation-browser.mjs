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
  await page.goto(`${baseUrl}/studio?screen=create`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await check("blank structured start is visibly blocked", async () => {
    await page.getByTestId("studio-creation-guide").waitFor({ state: "visible" });
    for (let step = 1; step < 5; step += 1) await page.getByTestId("studio-create-next").click();
    await page.getByTestId("studio-foundation-blocked").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("studio-create-submit").isDisabled(), true);
  });

  await page.goto(`${baseUrl}/studio?screen=create`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  await check("guide creates editable character and story foundations", async () => {
    await page.getByTestId("studio-guide-autofill").click();
    assert.notEqual((await page.getByTestId("studio-project-title").inputValue()).trim(), "");
    await page.getByTestId("studio-create-next").click();
    await page.getByTestId("studio-create-next").click();
    assert.notEqual((await page.getByTestId("studio-optional-protagonist").inputValue()).trim(), "");
    assert.notEqual((await page.getByTestId("studio-optional-world").inputValue()).trim(), "");
  });

  await check("RPG start reaches a playable first turn", async () => {
    await page.getByTestId("studio-create-next").click();
    await page.getByTestId("studio-play-mode-rpg").click();
    await page.getByTestId("studio-create-next").click();
    await page.getByTestId("studio-foundation-ready").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("studio-create-submit").isEnabled(), true);
    await page.getByTestId("studio-create-submit").click();
    await page.getByTestId("studio-story-starter").waitFor({ state: "visible", timeout: 60_000 });
    await page.setViewportSize({ width: 1280, height: 720 });
    const rpgButtonHitTarget = await page.getByTestId("studio-writing-open-rpg").evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return target === button || Boolean(target && button.contains(target));
    });
    assert.equal(rpgButtonHitTarget, true, "the visible RPG action must not be covered by the assistant column");
    await page.getByTestId("studio-writing-open-rpg").click();
    await page.getByTestId("studio-task-handoff").waitFor({ state: "visible", timeout: 60_000 });
    await page.getByTestId("studio-task-handoff-continue").click();
    await page.getByTestId("rpg-initialize").waitFor({ state: "visible", timeout: 60_000 });
    await page.getByTestId("rpg-initialize").click();
    await page.getByTestId("rpg-play-guide").waitFor({ state: "visible", timeout: 60_000 });
    for (const choice of ["A", "B", "C"]) {
      await page.getByTestId(`rpg-choice-${choice}`).waitFor({ state: "visible" });
    }
  });

  await check("mobile onboarding has no horizontal overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("rpg-play-guide").waitFor({ state: "visible" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false);
  });

  await check("browser console remains clean", async () => {
    assert.deepEqual(consoleErrors, []);
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
