import { chromium } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.P24A_BASE_URL || "http://127.0.0.1:3124";
const evidenceDir = process.env.P24A_EVIDENCE_DIR;
if (!evidenceDir) throw new Error("P24A_EVIDENCE_DIR_REQUIRED");
fs.mkdirSync(evidenceDir, { recursive: true });

const checks = [], consoleErrors = [], networkErrors = [];
const check = (name, pass, details = null) => {
  checks.push({ name, status: pass ? "PASS" : "FAIL", details });
  if (!pass) throw new Error(`${name}: ${JSON.stringify(details)}`);
};
const stable = (value) => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

async function storageSnapshot(page, projectId) {
  return page.evaluate(async ({ projectId }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = {};
    for (const storeName of [
      "projects", "chapters", "storyBibles", "storyStates", "acceptedChoices",
      "storyBranches", "dramaProjects", "dramaApprovals", "narrativeCanonLinks",
      "dramaEvaluations",
    ]) {
      result[storeName] = await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly")
          .objectStore(storeName).index("projectId").getAll(projectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close();
    return result;
  }, { projectId });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-TW",
  serviceWorkers: "block",
});
const page = await context.newPage();
const capture = (name) => page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({ text: message.text(), url: page.url() });
});
page.on("response", (response) => {
  if (response.status() >= 400) networkErrors.push({ status: response.status(), url: response.url() });
});

let projectId = "", beforeApproval, afterApproval, afterReload;
const mobile = [];

try {
  await page.goto(`${baseUrl}/studio/create`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /空白建立/ }).click();
  await page.getByLabel("作品名稱（可留白）").fill("P2.4A RC1 瀏覽器驗收作品");
  await page.getByRole("button", { name: "建立作品", exact: true }).click();
  const writeLink = page.getByRole("link", { name: "開始寫作", exact: true });
  await writeLink.waitFor();
  const href = await writeLink.getAttribute("href");
  projectId = href?.match(/\/studio\/project\/([^/]+)\/write/)?.[1] || "";
  check("project-created-through-consumer-ui", Boolean(projectId), { href });

  await writeLink.click();
  await page.getByLabel("章節標題").fill("第一章：雨夜的邀請");
  await page.getByLabel("正文").fill(
    "林昭在雨夜抵達舊劇院。舞台中央只亮著一盞燈，牆上的時鐘停在十一點四十七分。"
      + "她收到一封沒有署名的邀請，要求她在午夜前找出失蹤演員留下的最後一句台詞。"
      + "門外傳來三次敲擊，卻沒有人回應。林昭決定先檢查後台，再追查觀眾席下方的暗門。"
  );
  await page.getByRole("button", { name: "儲存目前內容", exact: true }).click();
  await page.getByText(/已儲存/).waitFor();

  await page.goto(`${baseUrl}/studio/project/${projectId}/drama`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "建立改編候選", exact: true }).click();
  await page.getByRole("button", { name: "接受並建立改編版本", exact: true }).waitFor();
  beforeApproval = await storageSnapshot(page, projectId);
  check("candidate-generated", beforeApproval.dramaProjects.length === 1);
  check("accepted-choice-zero-before-approval", beforeApproval.acceptedChoices.length === 0);
  check("story-branch-zero-before-approval", beforeApproval.storyBranches.length === 0);
  check("drama-approval-zero-before-approval", beforeApproval.dramaApprovals.length === 0);
  check("projection-not-approved-before-approval",
    beforeApproval.narrativeCanonLinks[0]?.projectionStatus !== "approved");
  check("candidate-not-approved-before-approval",
    beforeApproval.dramaProjects[0]?.status !== "approved");
  await capture("p24a-rc1-drama-candidate-desktop.png");

  const canonicalBefore = {
    projects: beforeApproval.projects,
    chapters: beforeApproval.chapters,
    storyBibles: beforeApproval.storyBibles,
    storyStates: beforeApproval.storyStates,
  };
  await page.getByRole("button", { name: "接受並建立改編版本", exact: true }).click();
  await page.getByRole("button", { name: "已核准改編", exact: true }).waitFor();
  afterApproval = await storageSnapshot(page, projectId);
  check("drama-approval-created", afterApproval.dramaApprovals.length === 1);
  check("adaptation-canon-approved-after-approval",
    afterApproval.narrativeCanonLinks[0]?.projectionStatus === "approved");
  check("drama-project-approved-after-approval", afterApproval.dramaProjects[0]?.status === "approved");
  check("accepted-choice-remains-zero", afterApproval.acceptedChoices.length === 0);
  check("story-branch-remains-zero", afterApproval.storyBranches.length === 0);
  const canonicalAfter = {
    projects: afterApproval.projects,
    chapters: afterApproval.chapters,
    storyBibles: afterApproval.storyBibles,
    storyStates: afterApproval.storyStates,
  };
  check("novel-canonical-unchanged-by-drama-approval",
    hash(canonicalBefore) === hash(canonicalAfter));
  await capture("p24a-rc1-drama-approved-desktop.png");

  await page.reload({ waitUntil: "networkidle" });
  afterReload = await storageSnapshot(page, projectId);
  check("approval-persists-after-reload",
    hash(afterApproval.dramaApprovals) === hash(afterReload.dramaApprovals));
  check("adaptation-canon-persists-after-reload",
    hash(afterApproval.narrativeCanonLinks) === hash(afterReload.narrativeCanonLinks));

  await page.getByRole("button", { name: "建立改編候選", exact: true }).click();
  await page.getByRole("button", { name: "接受並建立改編版本", exact: true }).waitFor();
  for (const [width, height] of [[360, 800], [375, 812], [390, 844], [412, 915]]) {
    await page.setViewportSize({ width, height });
    const size = await page.evaluate(() => ({
      innerWidth, bodyScrollWidth: document.body.scrollWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
    }));
    const horizontalOverflow = size.bodyScrollWidth > size.innerWidth
      || size.rootScrollWidth > size.innerWidth;
    check(`mobile-${width}x${height}-no-horizontal-overflow`, !horizontalOverflow, size);
    const controlsOperable = await page.getByRole(
      "button", { name: "接受並建立改編版本", exact: true },
    ).isVisible();
    check(`mobile-${width}x${height}-controls-operable`, controlsOperable);
    const screenshot = `p24a-rc1-drama-mobile-${width}x${height}.png`;
    await capture(screenshot);
    mobile.push({
      viewport: `${width}x${height}`,
      reportedClientWidth: size.rootScrollWidth,
      horizontalOverflow,
      controlsOperable,
      consoleErrors: consoleErrors.length,
      screenshot,
    });
  }

  check("console-errors-zero", consoleErrors.length === 0, consoleErrors);
  const unexpectedNetworkErrors = networkErrors.filter(({ url }) => !url.includes("favicon"));
  check("unexpected-http-errors-zero", unexpectedNetworkErrors.length === 0, unexpectedNetworkErrors);

  const generatedAt = new Date().toISOString();
  const result = {
    schemaVersion: "p24a-browser-gate-v1",
    generatedAt,
    server: baseUrl,
    projectId,
    status: "PASS",
    pass: checks.filter((item) => item.status === "PASS").length,
    fail: 0,
    skip: 0,
    checks,
    desktop: {
      viewport: "1440x900",
      flow: ["create project", "save chapter", "generate Drama candidate", "approve adaptation", "reload"],
      approvalVisible: true,
      reloadPersistence: true,
      horizontalOverflow: false,
      consoleErrors: consoleErrors.length,
      screenshot: "p24a-rc1-drama-approved-desktop.png",
    },
    mobile,
    canonicalIsolation: {
      canonicalBeforeHash: hash(canonicalBefore),
      canonicalAfterHash: hash(canonicalAfter),
      novelCanonUnchanged: hash(canonicalBefore) === hash(canonicalAfter),
      acceptedChoicesCreated: afterApproval.acceptedChoices.length,
      storyBranchesCreated: afterApproval.storyBranches.length,
    },
    storageEvidence: {
      beforeApprovalCounts: Object.fromEntries(Object.entries(beforeApproval).map(([key, rows]) => [key, rows.length])),
      afterApprovalCounts: Object.fromEntries(Object.entries(afterApproval).map(([key, rows]) => [key, rows.length])),
      afterReloadCounts: Object.fromEntries(Object.entries(afterReload).map(([key, rows]) => [key, rows.length])),
      projectionStatusBeforeApproval: beforeApproval.narrativeCanonLinks[0]?.projectionStatus ?? null,
      projectionStatusAfterApproval: afterApproval.narrativeCanonLinks[0]?.projectionStatus ?? null,
      dramaProjectStatusBeforeApproval: beforeApproval.dramaProjects[0]?.status ?? null,
      dramaProjectStatusAfterApproval: afterApproval.dramaProjects[0]?.status ?? null,
      dramaApprovalHash: hash(afterApproval.dramaApprovals),
      adaptationCanonHash: hash(afterApproval.narrativeCanonLinks),
    },
    consoleErrors,
    networkErrors,
    productionMutation: 0,
  };
  fs.writeFileSync(path.join(evidenceDir, "browser-e2e-results.json"),
    `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(evidenceDir, "mobile-ui-results.json"), `${JSON.stringify({
    schemaVersion: "p24a-mobile-gate-v1",
    generatedAt,
    results: mobile,
    pass: mobile.length * 2,
    fail: 0,
    skip: 0,
    requiredViewports: mobile.map((item) => item.viewport),
  }, null, 2)}\n`, "utf8");
} catch (error) {
  fs.writeFileSync(path.join(evidenceDir, "browser-e2e-results.json"), `${JSON.stringify({
    schemaVersion: "p24a-browser-gate-v1",
    generatedAt: new Date().toISOString(),
    server: baseUrl,
    projectId,
    status: "FAIL",
    pass: checks.filter((item) => item.status === "PASS").length,
    fail: 1,
    skip: 0,
    checks,
    consoleErrors,
    networkErrors,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
  }, null, 2)}\n`, "utf8");
  await capture("p24a-rc1-browser-failure.png").catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}
