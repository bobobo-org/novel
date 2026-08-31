import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const MISSING_PUBLIC_ID = "novel_runtimeabsent001";
const FIXTURE_PUBLIC_ID = "novel_runtimefixture001";
const DEFAULT_TIMEOUT_MS = 20_000;

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function parseOrigins() {
  const values = String(process.env.PUBLIC_LOUNGE_BROWSER_ORIGINS || process.env.PUBLIC_LOUNGE_RUNTIME_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error("PUBLIC_LOUNGE_BROWSER_ORIGIN_MISSING");
  const allowLoopbackHttp = process.env.PUBLIC_LOUNGE_BROWSER_ALLOW_LOOPBACK_HTTP === "true";
  return [...new Set(values.map((value) => {
    const url = new URL(value);
    const loopbackHttp = allowLoopbackHttp
      && url.protocol === "http:"
      && ["127.0.0.1", "localhost"].includes(url.hostname);
    if ((!loopbackHttp && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/") {
      throw new Error("PUBLIC_LOUNGE_BROWSER_ORIGIN_INVALID");
    }
    return url.origin;
  }))];
}

async function waitForListResult(page) {
  await page.getByRole("button", { name: "搜尋", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? "";
    return text.includes("尚無作者公開作品")
      || text.includes("找不到符合條件的作品")
      || text.includes("閱讀作品與評分")
      || text.includes("目前無法讀取公開書庫")
      || text.includes("讀取次數暫時過多");
  });
  const visible = await page.locator("body").innerText();
  assert(!visible.includes("目前無法讀取公開書庫"), "PUBLIC_LOUNGE_BROWSER_BACKEND_UNAVAILABLE");
  assert(!visible.includes("讀取次數暫時過多"), "PUBLIC_LOUNGE_BROWSER_RATE_LIMITED");
  return visible;
}

function matchesListQuery(response, expected) {
  if (response.request().method() !== "GET") return false;
  const url = new URL(response.url());
  if (url.pathname !== "/api/lounge") return false;
  return ["q", "shelf", "completed", "cursor", "limit"].every((key) => (
    url.searchParams.get(key) === (expected[key] ?? null)
  ));
}

async function listAction(page, expected, action) {
  const responsePromise = page.waitForResponse((response) => {
    return matchesListQuery(response, expected);
  });
  await action();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `PUBLIC_LOUNGE_BROWSER_LIST_HTTP_${response.status()}`);
  await waitForListResult(page);
  const payload = await response.json();
  assert.equal(payload?.connected, true, "PUBLIC_LOUNGE_BROWSER_LIST_NOT_CONNECTED");
  assert(Array.isArray(payload?.items), "PUBLIC_LOUNGE_BROWSER_LIST_ITEMS_INVALID");
  assert(Array.isArray(payload?.shelves), "PUBLIC_LOUNGE_BROWSER_LIST_SHELVES_INVALID");
  return payload;
}

async function detailAction(page, origin, publicId, expectedStatus) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/lounge/${publicId}` && response.request().method() === "GET";
  });
  const navigation = await page.goto(`${origin}/lounge/${encodeURIComponent(publicId)}?browser-gate=${Date.now()}`, {
    waitUntil: "domcontentloaded",
  });
  assert.equal(navigation?.status(), 200, "PUBLIC_LOUNGE_BROWSER_DETAIL_SHELL_NOT_200");
  const response = await responsePromise;
  assert.equal(response.status(), expectedStatus, `PUBLIC_LOUNGE_BROWSER_DETAIL_HTTP_${response.status()}`);
  return response;
}

function fixtureQuality() {
  const values = [
    ["plot_coherence", "情節與因果連貫", 20],
    ["character_arcs", "角色弧線", 15],
    ["world_canon_consistency", "世界與 Canon 一致性", 15],
    ["pacing", "節奏與篇章配置", 15],
    ["prose_dialogue", "敘事文字與對話", 15],
    ["foreshadowing_payoff", "伏筆與回收", 10],
    ["ending", "結局完成度", 10],
  ];
  return {
    totalScore: 82,
    threshold: 80,
    breakdown: values.map(([key, label, weight]) => ({
      key,
      label,
      weight,
      score: 82,
      weightedPoints: Number((82 * Number(weight) / 100).toFixed(1)),
    })),
  };
}

function clientFixture(shelves) {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const shelfId = shelves.find((shelf) => shelf.shelfId === "group-7")?.shelfId
    ?? shelves[0]?.shelfId
    ?? "group-7";
  const summary = {
    schemaVersion: "public-lounge-index-entry-v3",
    publicId: FIXTURE_PUBLIC_ID,
    title: "部署介面驗收作品",
    authorByline: "自動驗收署名",
    authorBylineStatus: "self_entered_unverified",
    storyLibrarySchemaVersion: "story-library-v1",
    shelfId,
    primaryTopicId: "classic-topic-001",
    topicIds: ["classic-topic-001"],
    completionStatus: "completed",
    chapterCount: 3,
    wordCount: 8_200,
    completedAt: timestamp,
    publishedAt: timestamp,
    versionId: "version_runtimefixture001",
    versionNumber: 1,
    versionPublishedAt: timestamp,
    quality: fixtureQuality(),
    qualityAssurance: "private_ai_hub_verified",
    synopsisExcerpt: "只存在於部署瀏覽器記憶體內的介面驗收資料。",
    publicChapterCount: 3,
  };
  return {
    list: {
      connected: true,
      count: 1,
      totalCount: 1,
      items: [summary],
      shelves,
      nextCursor: null,
    },
    post: {
      ...summary,
      schemaVersion: "public-lounge-post-v3",
      fullSynopsis: "此資料僅驗證已部署的客戶端清單、詳細頁與互動邊界，不會寫入公開後端。",
      publicChapters: [1, 2, 3].map((chapterNumber) => ({
        chapterNumber,
        title: `驗收章節 ${chapterNumber}`,
        body: "部署瀏覽器介面驗收正文。".repeat(80),
        official: true,
      })),
    },
  };
}

function isInteractionReadRequest(request, publicId) {
  if (request.method() !== "GET") return false;
  const url = new URL(request.url());
  return url.pathname === `/api/lounge/interactions/${publicId}`;
}

function isInteractionReadResponse(response, publicId) {
  return isInteractionReadRequest(response.request(), publicId);
}

function authoritativeMetricSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== "public-lounge-interactions-api-v1"
    || typeof value.authenticated !== "boolean"
    || typeof value.selected !== "boolean"
    || !Number.isSafeInteger(value.voteCount)
    || value.voteCount < 0
    || !Number.isSafeInteger(value.commentCount)
    || value.commentCount < 0) {
    return null;
  }
  return {
    authenticated: value.authenticated,
    selected: value.selected,
    voteCount: value.voteCount,
    commentCount: value.commentCount,
  };
}

function captureInteractionReads(page, publicId) {
  const captures = [];
  const idleWaiters = new Set();
  let pending = 0;
  const onRequest = (request) => {
    if (isInteractionReadRequest(request, publicId)) pending += 1;
  };
  const onResponse = (response) => {
    if (!isInteractionReadResponse(response, publicId)) return;
    captures.push((async () => {
      const payload = await response.json().catch(() => null);
      return {
        status: response.status(),
        snapshot: authoritativeMetricSnapshot(payload?.snapshot),
      };
    })());
  };
  const onRequestSettled = (request) => {
    if (!isInteractionReadRequest(request, publicId)) return;
    pending = Math.max(0, pending - 1);
    if (pending === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfinished", onRequestSettled);
  page.on("requestfailed", onRequestSettled);
  return {
    async all() {
      return Promise.all([...captures]);
    },
    async settle() {
      while (pending > 0) {
        await new Promise((resolve) => {
          idleWaiters.add(resolve);
        });
      }
    },
    stop() {
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onRequestSettled);
      page.off("requestfailed", onRequestSettled);
    },
  };
}

async function waitForInteractionState(page) {
  const selector = '[aria-labelledby="reader-interactions-heading"][data-interaction-state]';
  const interaction = page.locator(selector);
  await interaction.waitFor();
  await page.waitForFunction((target) => {
    const state = document.querySelector(target)?.getAttribute("data-interaction-state");
    return state === "ready" || state === "unavailable";
  }, selector);
  const state = await interaction.getAttribute("data-interaction-state");
  assert(state === "ready" || state === "unavailable", "PUBLIC_LOUNGE_BROWSER_INTERACTION_STATE_INVALID");
  return { interaction, state };
}

async function assertLocalBookmarkUsable(interaction) {
  const bookmark = interaction.getByRole("button", { name: /^(?:收藏到本機|已收藏在本機)$/u });
  assert.equal(await bookmark.count(), 1, "PUBLIC_LOUNGE_BROWSER_LOCAL_BOOKMARK_MISSING");
  assert.equal(await bookmark.isDisabled(), false, "PUBLIC_LOUNGE_BROWSER_LOCAL_BOOKMARK_DISABLED");
  const before = await bookmark.getAttribute("aria-pressed");
  await bookmark.click();
  assert.notEqual(await bookmark.getAttribute("aria-pressed"), before, "PUBLIC_LOUNGE_BROWSER_LOCAL_BOOKMARK_NOT_TOGGLED");
  await bookmark.click();
  assert.equal(await bookmark.getAttribute("aria-pressed"), before, "PUBLIC_LOUNGE_BROWSER_LOCAL_BOOKMARK_NOT_RESTORED");
}

async function assertNoPublicInteractionMetrics(interaction) {
  const text = await interaction.innerText();
  assert(
    !/(?:推薦(?:作品)?|取消推薦|公開留言|人氣)\s*(?:數|次|：|:|｜|\|)?\s*[0-9]/u.test(text),
    "PUBLIC_LOUNGE_BROWSER_PUBLIC_METRIC_INVENTED",
  );
  assert.equal(
    await interaction.locator("[data-public-count], [data-like-count], [data-comment-count]").count(),
    0,
    "PUBLIC_LOUNGE_BROWSER_PUBLIC_METRIC_MARKER_INVENTED",
  );
}

async function assertUnavailableInteractions(interaction) {
  await assertNoPublicInteractionMetrics(interaction);
  const status = (await interaction.getByRole("status").innerText()).trim();
  assert(
    /(?:無法使用|無法完成|已失效|太頻繁|已撤回|沒有寫入假資料)/u.test(status),
    "PUBLIC_LOUNGE_BROWSER_UNAVAILABLE_STATUS_MISSING",
  );
  assert(!status.includes("互動資料已由伺服器確認"), "PUBLIC_LOUNGE_BROWSER_UNAVAILABLE_STATUS_FALSE_READY");
  for (const name of [
    "推薦｜等待登入服務",
    "留言｜等待登入服務",
    "檢舉｜等待審核服務",
  ]) {
    const fallback = interaction.getByRole("button", { name, exact: true });
    assert.equal(await fallback.count(), 1, `PUBLIC_LOUNGE_BROWSER_FALLBACK_MISSING:${name}`);
    assert.equal(await fallback.isDisabled(), true, `PUBLIC_LOUNGE_BROWSER_FALLBACK_ENABLED:${name}`);
  }
  const magicLink = interaction.getByRole("button", { name: "寄送登入連結", exact: true });
  const magicLinkCount = await magicLink.count();
  assert(magicLinkCount === 0 || await magicLink.isDisabled(), "PUBLIC_LOUNGE_BROWSER_MAGIC_LINK_AVAILABLE_WITHOUT_SERVICE");
  assert.equal(
    await interaction.getByRole("button", {
      name: /^(?:推薦作品|取消推薦|檢舉作品|送出留言|送出檢舉)$/u,
    }).count(),
    0,
    "PUBLIC_LOUNGE_BROWSER_UNAVAILABLE_WRITE_CONTROL_VISIBLE",
  );
  await assertLocalBookmarkUsable(interaction);
}

async function assertReadyInteractions(interaction, captures) {
  const vote = interaction.locator("button[data-like-count]");
  const comments = interaction.locator("[data-comment-count]");
  assert.equal(await vote.count(), 1, "PUBLIC_LOUNGE_BROWSER_READY_VOTE_COUNT_MISSING");
  assert.equal(await comments.count(), 1, "PUBLIC_LOUNGE_BROWSER_READY_COMMENT_COUNT_MISSING");

  const renderedVoteCount = Number(await vote.getAttribute("data-like-count"));
  const renderedCommentCount = Number(await comments.getAttribute("data-comment-count"));
  const renderedSelectedValue = await vote.getAttribute("aria-pressed");
  assert(Number.isSafeInteger(renderedVoteCount) && renderedVoteCount >= 0, "PUBLIC_LOUNGE_BROWSER_READY_VOTE_COUNT_INVALID");
  assert(Number.isSafeInteger(renderedCommentCount) && renderedCommentCount >= 0, "PUBLIC_LOUNGE_BROWSER_READY_COMMENT_COUNT_INVALID");
  assert(
    renderedSelectedValue === "true" || renderedSelectedValue === "false",
    "PUBLIC_LOUNGE_BROWSER_READY_VOTE_SELECTION_INVALID",
  );
  const renderedSelected = renderedSelectedValue === "true";

  const matching = captures.find((capture) => (
    capture.status === 200
    && capture.snapshot
    && capture.snapshot.voteCount === renderedVoteCount
    && capture.snapshot.commentCount === renderedCommentCount
    && capture.snapshot.selected === renderedSelected
    && capture.snapshot.authenticated === false
  ));
  assert(matching?.snapshot, "PUBLIC_LOUNGE_BROWSER_READY_METRICS_NOT_AUTHORITATIVE");
  const snapshot = matching.snapshot;
  assert.equal(snapshot.authenticated, false, "PUBLIC_LOUNGE_BROWSER_FRESH_CONTEXT_AUTHENTICATED");
  assert.equal(snapshot.selected, false, "PUBLIC_LOUNGE_BROWSER_ANONYMOUS_VOTE_SELECTED");
  const voteLabel = `${snapshot.selected ? "取消推薦" : "推薦作品"}｜${snapshot.voteCount.toLocaleString("zh-TW")}`;
  const commentLabel = `公開留言｜${snapshot.commentCount.toLocaleString("zh-TW")}`;
  assert.equal((await vote.innerText()).trim(), voteLabel, "PUBLIC_LOUNGE_BROWSER_READY_VOTE_LABEL_MISMATCH");
  assert.equal((await comments.innerText()).trim(), commentLabel, "PUBLIC_LOUNGE_BROWSER_READY_COMMENT_LABEL_MISMATCH");
  assert.equal(await vote.getAttribute("aria-pressed"), String(snapshot.selected), "PUBLIC_LOUNGE_BROWSER_READY_VOTE_SELECTION_MISMATCH");

  const magicLink = interaction.getByRole("button", { name: "寄送登入連結", exact: true });
  assert.equal(await magicLink.count(), 1, "PUBLIC_LOUNGE_BROWSER_READY_LOGIN_MISSING");
  assert.equal(await magicLink.isDisabled(), false, "PUBLIC_LOUNGE_BROWSER_READY_LOGIN_DISABLED");
  assert.equal(await vote.isDisabled(), true, "PUBLIC_LOUNGE_BROWSER_READY_ANONYMOUS_VOTE_ENABLED");
  assert.equal(await interaction.getByRole("button", { name: "檢舉作品", exact: true }).count(), 0);
  assert.equal(await interaction.getByRole("heading", { name: "留下已登入留言", exact: true }).count(), 0);
  assert.equal(await interaction.getByRole("button", { name: "送出留言", exact: true }).count(), 0);
  assert.equal(await interaction.getByRole("button", { name: "送出檢舉", exact: true }).count(), 0);
  assert.equal(await interaction.getByRole("button", { name: "登出", exact: true }).count(), 0);
  for (const fallbackName of [
    "推薦｜等待登入服務",
    "留言｜等待登入服務",
    "檢舉｜等待審核服務",
  ]) {
    assert.equal(await interaction.getByRole("button", { name: fallbackName, exact: true }).count(), 0);
  }
  await assertLocalBookmarkUsable(interaction);
}

async function verifyReaderInteractions(page, capture) {
  await waitForInteractionState(page);
  await capture.settle();
  await page.evaluate(() => new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve(undefined));
  }));
  const { interaction, state } = await waitForInteractionState(page);
  const captures = await capture.all();
  if (state === "ready") {
    await assertReadyInteractions(interaction, captures);
    return { state, authoritativeMetricsVerified: true };
  }
  await assertUnavailableInteractions(interaction);
  return { state, authoritativeMetricsVerified: false };
}

async function verifyDeployedClientFixture(browser, origin, shelves) {
  const context = await browser.newContext({
    locale: "zh-TW",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const interactionCapture = captureInteractionReads(page, FIXTURE_PUBLIC_ID);
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  const fixture = clientFixture(shelves);
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 240));
  });
  page.on("pageerror", (error) => pageErrors.push(String(error?.message || error).slice(0, 240)));
  await page.route("**/api/lounge**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") return route.abort();
    if (url.pathname === `/api/lounge/interactions/${FIXTURE_PUBLIC_ID}`) {
      return route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: "{",
        headers: { "Cache-Control": "no-store" },
      });
    }
    const body = url.pathname === "/api/lounge"
      ? fixture.list
      : url.pathname === `/api/lounge/${FIXTURE_PUBLIC_ID}`
        ? { connected: true, post: fixture.post }
        : null;
    if (!body) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(body),
      headers: { "Cache-Control": "no-store" },
    });
  });
  try {
    await page.goto(`${origin}/lounge?browser-client-fixture=1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "部署介面驗收作品" }).click();
    await page.waitForURL(new RegExp(`/lounge/${FIXTURE_PUBLIC_ID}`));
    await page.getByText("Private AI Hub 已簽章驗證", { exact: true }).first().waitFor();
    await page.getByRole("heading", { name: "作者選擇公開的正式章節" }).waitFor();
    const interactionVerification = await verifyReaderInteractions(page, interactionCapture);
    assert.equal(
      interactionVerification.state,
      "unavailable",
      "PUBLIC_LOUNGE_BROWSER_FIXTURE_INTERACTIONS_NOT_FAIL_CLOSED",
    );
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    assert(overflow <= 1, `PUBLIC_LOUNGE_BROWSER_FIXTURE_MOBILE_OVERFLOW_${overflow}`);
    assert.equal(pageErrors.length, 0, `PUBLIC_LOUNGE_BROWSER_FIXTURE_PAGE_ERRORS:${pageErrors.join("|")}`);
    assert.equal(consoleErrors.length, 0, `PUBLIC_LOUNGE_BROWSER_FIXTURE_CONSOLE_ERRORS:${consoleErrors.join("|")}`);
    return true;
  } finally {
    interactionCapture.stop();
    await context.close();
  }
}

async function verifyOrigin(browser, origin) {
  const context = await browser.newContext({
    locale: "zh-TW",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);
  const consoleErrors = [];
  const pageErrors = [];
  let currentStage = "initial-list";
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push({ stage: currentStage, text: message.text().slice(0, 240) });
  });
  page.on("pageerror", (error) => pageErrors.push({ stage: currentStage, text: String(error?.message || error).slice(0, 240) }));

  try {
    const initialPayload = await listAction(page, { limit: "24" }, async () => {
      const response = await page.goto(`${origin}/lounge?browser-gate=${Date.now()}`, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(response?.status(), 200, "PUBLIC_LOUNGE_BROWSER_PAGE_NOT_200");
    });
    await page.getByRole("heading", { name: "公開完本書庫" }).waitFor();
    await page.getByRole("searchbox", { name: "搜尋公開作品" }).waitFor();

    const shelfButtons = page.locator('[aria-label="八大小說書架"] button');
    assert.equal(await shelfButtons.count(), 9, "PUBLIC_LOUNGE_BROWSER_SHELF_COUNT_INVALID");

    const cardLinks = await page.locator('a[href^="/lounge/novel_"]').evaluateAll((links) => (
      [...new Set(links.map((link) => link.getAttribute("href")).filter(Boolean))]
    ));
    const firstPublicHref = cardLinks[0] ?? null;

    currentStage = "search-no-match";
    const searchTerm = `runtime-no-match-${Date.now()}`;
    await page.getByRole("searchbox", { name: "搜尋公開作品" }).fill(searchTerm);
    await listAction(page, { q: searchTerm, limit: "24" }, () => page.getByRole("button", { name: "搜尋", exact: true }).click());
    assert((await page.locator("body").innerText()).includes("找不到符合條件的作品"), "PUBLIC_LOUNGE_BROWSER_SEARCH_NOT_APPLIED");

    currentStage = "search-reset";
    await page.getByRole("searchbox", { name: "搜尋公開作品" }).fill("");
    await listAction(page, { limit: "24" }, () => page.getByRole("button", { name: "搜尋", exact: true }).click());

    currentStage = "shelf-filter";
    const firstShelfId = initialPayload.shelves[0]?.shelfId;
    assert.equal(typeof firstShelfId, "string", "PUBLIC_LOUNGE_BROWSER_FIRST_SHELF_MISSING");
    const shelfPayload = await listAction(page, { shelf: firstShelfId, limit: "24" }, () => shelfButtons.nth(1).click());
    assert.equal(await shelfButtons.nth(1).getAttribute("aria-pressed"), "true", "PUBLIC_LOUNGE_BROWSER_SHELF_NOT_SELECTED");
    assert(shelfPayload.items.every((item) => item.shelfId === firstShelfId), "PUBLIC_LOUNGE_BROWSER_SHELF_RESULT_MISMATCH");

    currentStage = "mobile-layout";
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    assert(overflow <= 1, `PUBLIC_LOUNGE_BROWSER_MOBILE_OVERFLOW_${overflow}`);

    let positiveDetailVerified = false;
    let deployedClientFixtureVerified = false;
    let publicIdDigest = null;
    let interactionState = null;
    let authoritativeInteractionMetricsVerified = false;
    if (firstPublicHref) {
      currentStage = "live-positive-detail";
      const publicId = decodeURIComponent(firstPublicHref.split("/").pop() ?? "");
      assert(/^novel_[a-z0-9_-]{12,80}$/u.test(publicId), "PUBLIC_LOUNGE_BROWSER_PUBLIC_ID_INVALID");
      const interactionCapture = captureInteractionReads(page, publicId);
      try {
        const detailResponse = await detailAction(page, origin, publicId, 200);
        const detailPayload = await detailResponse.json();
        const assurance = detailPayload?.post?.qualityAssurance;
        assert(
          assurance === "private_ai_hub_verified" || assurance === "author_device_closed_ai_unverified",
          "PUBLIC_LOUNGE_BROWSER_ASSURANCE_INVALID",
        );
        const assuranceLabel = assurance === "private_ai_hub_verified"
          ? "Private AI Hub 已簽章驗證"
          : "作者裝置閉端 AI 評分，平台未簽章驗證";
        await page.getByText(assuranceLabel, { exact: true }).first().waitFor();
        await page.getByRole("heading", { name: "作者選擇公開的正式章節" }).waitFor();
        const visible = await page.locator("body").innerText();
        if (assurance === "author_device_closed_ai_unverified") {
          assert(!visible.includes("Private AI Hub 已簽章驗證"), "PUBLIC_LOUNGE_BROWSER_ASSURANCE_MISLABELED");
        }
        const interactionVerification = await verifyReaderInteractions(page, interactionCapture);
        interactionState = interactionVerification.state;
        authoritativeInteractionMetricsVerified = interactionVerification.authoritativeMetricsVerified;
      } finally {
        interactionCapture.stop();
      }
      positiveDetailVerified = true;
      publicIdDigest = sha256(publicId);
    } else {
      currentStage = "deployed-client-fixture";
      deployedClientFixtureVerified = await verifyDeployedClientFixture(browser, origin, initialPayload.shelves);
      interactionState = "unavailable";
    }

    currentStage = "missing-detail";
    await detailAction(page, origin, MISSING_PUBLIC_ID, 404);
    await page.getByText("找不到這個公開作品", { exact: true }).waitFor();
    assert((await page.locator("body").innerText()).includes("PUBLIC_LOUNGE_NOT_FOUND"));

    assert.equal(pageErrors.length, 0, `PUBLIC_LOUNGE_BROWSER_PAGE_ERRORS:${pageErrors.map((entry) => `${entry.stage}:${entry.text}`).join("|")}`);
    const materialConsoleErrors = consoleErrors.filter((entry) => (
      !/favicon/iu.test(entry.text)
      && !(entry.stage === "missing-detail" && /Failed to load resource.*(?:404|Not Found)|404 \(Not Found\)/iu.test(entry.text))
    ));
    assert.equal(materialConsoleErrors.length, 0, `PUBLIC_LOUNGE_BROWSER_CONSOLE_ERRORS:${materialConsoleErrors.map((entry) => `${entry.stage}:${entry.text}`).join("|")}`);

    return {
      origin,
      status: "PASS",
      initialListStatus: 200,
      shelfCount: 8,
      searchVerified: true,
      mobileOverflowPixels: overflow,
      missingDetailHydrated404: true,
      positiveDetailVerified,
      deployedClientFixtureVerified,
      positiveDetailProof: positiveDetailVerified ? "live-publication" : "ephemeral-client-fixture",
      interactionState,
      authoritativeInteractionMetricsVerified,
      publicIdDigest,
      rawPublicTextStored: false,
      screenshotsStored: false,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const origins = parseOrigins();
  const browser = await chromium.launch({ headless: true });
  try {
    const results = [];
    const clientFixtureOnly = process.env.PUBLIC_LOUNGE_BROWSER_CLIENT_FIXTURE_ONLY === "true";
    const fixtureShelves = Array.from({ length: 8 }, (_, index) => ({
      shelfId: `group-${index + 1}`,
      name: `驗收書架 ${index + 1}`,
      description: "只用於部署客戶端瀏覽器驗收。",
      order: index + 1,
    }));
    for (const origin of origins) {
      if (clientFixtureOnly) {
        results.push({
          origin,
          status: "PASS",
          liveRuntimeVerified: false,
          positiveDetailVerified: false,
          deployedClientFixtureVerified: await verifyDeployedClientFixture(browser, origin, fixtureShelves),
          positiveDetailProof: "ephemeral-client-fixture",
          interactionState: "unavailable",
          authoritativeInteractionMetricsVerified: false,
          rawPublicTextStored: false,
          screenshotsStored: false,
        });
      } else {
        results.push(await verifyOrigin(browser, origin));
      }
    }
    const report = {
      schemaVersion: "public-lounge-browser-runtime-gate-v1",
      status: "PASS",
      phase: process.env.PUBLIC_LOUNGE_RUNTIME_PHASE || "unspecified",
      checkedAt: new Date().toISOString(),
      results,
      responseBodiesStored: false,
      privatePayloadStored: false,
    };
    const reportPath = process.env.PUBLIC_LOUNGE_BROWSER_REPORT_PATH?.trim();
    if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch(async (error) => {
  const failure = {
    schemaVersion: "public-lounge-browser-runtime-gate-v1",
    status: "FAIL",
    phase: process.env.PUBLIC_LOUNGE_RUNTIME_PHASE || "unspecified",
    checkedAt: new Date().toISOString(),
    code: String(error?.code || error?.message || "PUBLIC_LOUNGE_BROWSER_GATE_FAILED")
      .replace(/[^A-Za-z0-9_:.-]+/gu, "_")
      .slice(0, 240),
    responseBodiesStored: false,
    privatePayloadStored: false,
  };
  const reportPath = process.env.PUBLIC_LOUNGE_BROWSER_REPORT_PATH?.trim();
  if (reportPath) {
    try {
      await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    } catch (reportError) {
      failure.reportWrite = String(reportError?.code || "FAILED").slice(0, 40);
    }
  }
  process.stderr.write(`${JSON.stringify(failure)}\n`);
  process.exit(1);
});
