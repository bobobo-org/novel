import assert from "node:assert/strict";
import { chromium, webkit } from "@playwright/test";
import {
  isCompletedStudioExternalProvidersNavigationCancellation,
  isCompletedNextStaticScriptNavigationCancellation as isCompletedNextStaticScriptCancellation,
  isVerifiedExternalProvidersStatusResponse,
  isVerifiedNextStaticScriptResponse,
} from "./humanized-navigation-diagnostics.mjs";

const baseUrl = String(process.argv.slice(2).find((value) => value !== "--") || "http://127.0.0.1:4174").replace(/\/$/u, "");
const engineName = process.env.MOBILE_BROWSER_ENGINE === "webkit" ? "webkit" : "chromium";
const browserType = engineName === "webkit" ? webkit : chromium;
const viewportMatch = /^(\d{3,4})x(\d{3,4})$/u.exec(process.env.MOBILE_VIEWPORT || "390x844");
assert.ok(viewportMatch, "MOBILE_VIEWPORT must use WIDTHxHEIGHT, for example 390x844");
const mobileViewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
let browser = null;
let context = null;
const consoleErrors = [];
const requestFailures = [];
const pageErrors = [];
const unexpectedLoopbackRequests = [];
const expectedNavigationCancellations = [];
const nextStaticScriptHttpFailures = [];
const externalProviderHttpFailures = [];
const requestStartedAt = new WeakMap();
let page = null;

function attachDiagnostics(targetPage) {
  targetPage.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({
        text: message.text(),
        url: message.location().url ?? "",
      });
    }
  });
  targetPage.on("requestfailed", (request) => {
    requestFailures.push({
      url: request.url(),
      errorText: request.failure()?.errorText ?? "unknown",
      method: request.method(),
      resourceType: request.resourceType(),
      rscHeader: request.headers().rsc ?? "",
      startedAt: requestStartedAt.get(request) ?? Number.NaN,
      observedAt: Date.now(),
    });
  });
  targetPage.on("response", (response) => {
    if (response.status() < 400) return;
    const request = response.request();
    try {
      const responseUrl = new URL(response.url());
      if (
        responseUrl.origin === new URL(baseUrl).origin
        && responseUrl.pathname === "/api/ai/external/providers"
        && request.method() === "GET"
        && request.resourceType() === "fetch"
      ) {
        externalProviderHttpFailures.push({
          url: response.url(),
          status: response.status(),
        });
      }
      if (
        responseUrl.origin === new URL(baseUrl).origin
        && request.method() === "GET"
        && request.resourceType() === "script"
        && /^\/_next\/static\/chunks\/.+\.js$/u.test(responseUrl.pathname)
      ) {
        nextStaticScriptHttpFailures.push({
          url: response.url(),
          status: response.status(),
        });
      }
    } catch {
      // Malformed URLs cannot be same-origin Next static assets.
    }
  });
  targetPage.on("request", (request) => {
    requestStartedAt.set(request, Date.now());
    try {
      const url = new URL(request.url());
      if (
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        && ["3217", "3227"].includes(url.port)
      ) unexpectedLoopbackRequests.push(request.url());
    } catch {
      // Browser-internal URLs are outside the public Companion boundary.
    }
  });
  targetPage.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
}

async function openFreshPage(url) {
  if (page) await page.close();
  consoleErrors.length = 0;
  requestFailures.length = 0;
  pageErrors.length = 0;
  unexpectedLoopbackRequests.length = 0;
  nextStaticScriptHttpFailures.length = 0;
  externalProviderHttpFailures.length = 0;
  page = await context.newPage();
  attachDiagnostics(page);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

async function waitForTimelineScrollRestore(page, timeout = 10_000) {
  const timeline = page.getByTestId("conversation-message-timeline");
  await timeline.waitFor({ state: "visible", timeout });
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="conversation-message-timeline"]');
    return Boolean(element && !element.hasAttribute("data-scroll-restoring"));
  }, undefined, { timeout });
}

async function resetLocalStorageAndOpen(url) {
  if (page) {
    await page.close();
    page = null;
  }
  const storagePage = await context.newPage();
  await storagePage.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await storagePage.evaluate(() => window.localStorage.clear());
  await storagePage.close();
  await openFreshPage(url);
}

function isSupersededRscCancellation(failure, target) {
  const expectedErrorText = engineName === "webkit" ? "Load request cancelled" : "net::ERR_ABORTED";
  if (
    failure.errorText !== expectedErrorText
    || failure.method !== "GET"
    || failure.resourceType !== "fetch"
    || failure.rscHeader !== "1"
  ) return false;

  try {
    const requestUrl = new URL(failure.url);
    const rscTokens = requestUrl.searchParams.getAll("_rsc");
    const queryKeys = [...requestUrl.searchParams.keys()];
    const expectedSearch = Object.entries(target.search ?? {});
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === target.pathname
      && queryKeys.length === expectedSearch.length + 1
      && new Set(queryKeys).size === expectedSearch.length + 1
      && rscTokens.length === 1
      && /^[A-Za-z0-9_-]{1,64}$/u.test(rscTokens[0])
      && expectedSearch.every(([key, value]) => {
        const values = requestUrl.searchParams.getAll(key);
        return values.length === 1 && values[0] === value;
      });
  } catch {
    return false;
  }
}

function isCompletedLegacyRedirectCancellation(failure, projectId) {
  if (
    engineName !== "webkit"
    || failure.errorText !== "Load request cancelled"
    || failure.method !== "GET"
    || failure.resourceType !== "document"
  ) return false;

  try {
    const requestUrl = new URL(failure.url);
    const queryKeys = [...requestUrl.searchParams.keys()];
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === "/professional"
      && queryKeys.length === 2
      && new Set(queryKeys).size === 2
      && requestUrl.searchParams.getAll("intent").length === 1
      && requestUrl.searchParams.get("intent") === "library"
      && requestUrl.searchParams.getAll("projectId").length === 1
      && requestUrl.searchParams.get("projectId") === projectId;
  } catch {
    return false;
  }
}

function isCompletedNextStaticScriptNavigationCancellation(failure, currentUrl, navigationProofs) {
  return navigationProofs.some((navigationProof) => isCompletedNextStaticScriptCancellation({
    failure,
    engineName,
    baseUrl,
    currentUrl,
    navigationProof,
  }));
}

async function assertCancelledNextStaticScriptStillAvailable(label, failure) {
  const response = await context.request.get(failure.url, {
    failOnStatusCode: false,
    maxRedirects: 0,
    timeout: 60_000,
  });
  const headers = response.headers();
  const body = await response.body();
  assert.equal(
    isVerifiedNextStaticScriptResponse({
      status: response.status(),
      contentType: headers["content-type"] ?? "",
      cacheControl: headers["cache-control"] ?? "",
      bodyLength: body.byteLength,
    }),
    true,
    `${label}: cancelled Next static script must still be a direct 200 immutable JavaScript response with a non-empty body: ${failure.url}`,
  );
}

async function assertCancelledExternalProvidersStillAvailable(label, failure) {
  const response = await context.request.get(failure.url, {
    failOnStatusCode: false,
    maxRedirects: 0,
    timeout: 60_000,
  });
  const headers = response.headers();
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  assert.equal(
    isVerifiedExternalProvidersStatusResponse({
      status: response.status(),
      contentType: headers["content-type"] ?? "",
      cacheControl: headers["cache-control"] ?? "",
      body,
    }),
    true,
    `${label}: cancelled external-provider status request must still be a direct healthy non-probing JSON response: ${failure.url}`,
  );
}

function isSupersededHealthCancellation(failure) {
  try {
    const requestUrl = new URL(failure.url);
    const queryKeys = [...requestUrl.searchParams.keys()];
    const expectedErrorText = engineName === "webkit" ? "Load request cancelled" : "net::ERR_ABORTED";
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === "/api/ai/health"
      && queryKeys.length === 0
      && failure.errorText === expectedErrorText
      && failure.method === "GET"
      && failure.resourceType === "fetch"
      && !failure.rscHeader;
  } catch {
    return false;
  }
}

function isCompletedFrontdoorHealthCancellation(failure, visitStartedAt, editorArrivedAt) {
  try {
    const requestUrl = new URL(failure.url);
    const queryKeys = [...requestUrl.searchParams.keys()];
    const expectedErrorText = engineName === "webkit" ? "Load request cancelled" : "net::ERR_ABORTED";
    const requestTimestamp = Number(requestUrl.searchParams.get("frontdoor"));
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === "/api/persistence/health"
      && queryKeys.length === 1
      && queryKeys[0] === "frontdoor"
      && requestUrl.searchParams.getAll("frontdoor").length === 1
      && /^\d{13}$/u.test(requestUrl.searchParams.get("frontdoor") ?? "")
      && requestTimestamp >= visitStartedAt
      && requestTimestamp <= editorArrivedAt
      && failure.errorText === expectedErrorText
      && failure.method === "GET"
      && failure.resourceType === "fetch"
      && !failure.rscHeader;
  } catch {
    return false;
  }
}

function isBoundedSharedLearningCancellation(failure) {
  try {
    const requestUrl = new URL(failure.url);
    const queryKeys = [...requestUrl.searchParams.keys()];
    const expectedErrorText = engineName === "webkit" ? "Load request cancelled" : "net::ERR_ABORTED";
    return requestUrl.origin === new URL(baseUrl).origin
      && requestUrl.pathname === "/api/ai/learning/shared-library"
      && queryKeys.length === 1
      && queryKeys[0] === "limit"
      && requestUrl.searchParams.getAll("limit").length === 1
      && requestUrl.searchParams.get("limit") === "24"
      && failure.errorText === expectedErrorText
      && failure.method === "GET"
      && failure.resourceType === "fetch"
      && !failure.rscHeader;
  } catch {
    return false;
  }
}

async function assertCleanDiagnostics(label, options = {}) {
  let unacceptedRequestFailures = requestFailures;
  const workspaceProjectId = options.allowSupersededWorkspacePrefetchesForProjectId || "";
  const readerProjectId = options.allowSupersededReaderNavigationForProjectId || "";
  const allowedTargets = [];
  if (workspaceProjectId) {
    assert.equal(new URL(page.url()).pathname, `/studio/project/${workspaceProjectId}/chat`);
    for (const testId of ["conversation-first-workspace", "rpg-inline-choices", "rpg-choice-A", "rpg-choice-B", "rpg-choice-C"]) {
      const hasVisibleTarget = await page.getByTestId(testId).evaluateAll((elements) => elements.some((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden";
      }));
      assert.equal(hasVisibleTarget, true, `${testId} must expose at least one visible target`);
    }
    allowedTargets.push(
      { pathname: "/" },
      { pathname: "/studio/create" },
      { pathname: `/studio/project/${workspaceProjectId}/write` },
      { pathname: "/professional" },
      {
        pathname: "/professional",
        search: { intent: "library", projectId: workspaceProjectId },
      },
      {
        pathname: `/studio/project/${workspaceProjectId}/chat`,
        search: { mode: "play" },
      },
    );
  }
  if (readerProjectId) {
    assert.equal(new URL(page.url()).pathname, `/studio/read/${readerProjectId}`);
    assert.equal(await page.locator(".readerShell").isVisible(), true);
    allowedTargets.push({
      pathname: `/studio/project/${readerProjectId}/chat`,
      search: { mode: "play" },
    });
    allowedTargets.push({ pathname: "/" });
    allowedTargets.push({ pathname: "/studio/create" });
    allowedTargets.push({ pathname: `/studio/read/${readerProjectId}` });
    allowedTargets.push(
      { pathname: "/professional" },
      {
        pathname: "/professional",
        search: { intent: "library", projectId: readerProjectId },
      },
    );
  }
  if (allowedTargets.length) {
    const accepted = requestFailures.filter((failure) => (
      allowedTargets.some((target) => isSupersededRscCancellation(failure, target))
    ));
    for (const target of allowedTargets) {
      const targetFailures = accepted.filter((failure) => (
        isSupersededRscCancellation(failure, target)
      ));
      assert.ok(
        targetFailures.length <= 1,
        `${label}: at most one superseded Next RSC cancellation is allowed for ${JSON.stringify(target)}: ${JSON.stringify(targetFailures)}`,
      );
    }
    assert.ok(accepted.length <= 2, `${label}: at most two superseded Next RSC prefetches are allowed`);
    unacceptedRequestFailures = requestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);

    const completedStaticScriptNavigationProofs = options.completedStaticScriptNavigationProofs ?? [];
    const currentUrl = page.url();
    const completedStaticScriptCancellations = unacceptedRequestFailures.filter((failure) => (
      isCompletedNextStaticScriptNavigationCancellation(
        failure,
        currentUrl,
        completedStaticScriptNavigationProofs,
      )
    ));
    assert.ok(
      completedStaticScriptCancellations.length <= 1,
      `${label}: at most one completed Next static script navigation cancellation is allowed: ${JSON.stringify(completedStaticScriptCancellations)}`,
    );
    for (const failure of completedStaticScriptCancellations) {
      await assertCancelledNextStaticScriptStillAvailable(label, failure);
    }
    unacceptedRequestFailures = unacceptedRequestFailures.filter(
      (failure) => !completedStaticScriptCancellations.includes(failure),
    );
    expectedNavigationCancellations.push(...completedStaticScriptCancellations);

    const completedExternalProviderReloadProofs = options.completedExternalProviderReloadProofs ?? [];
    const completedExternalProviderCancellations = unacceptedRequestFailures.filter((failure) => (
      completedExternalProviderReloadProofs.some((navigationProof) => (
        isCompletedStudioExternalProvidersNavigationCancellation({
          failure,
          engineName,
          baseUrl,
          currentUrl,
          projectId: workspaceProjectId,
          navigationProof,
        })
      ))
    ));
    assert.ok(
      completedExternalProviderCancellations.length <= 1,
      `${label}: at most one completed studio external-provider navigation cancellation is allowed: ${JSON.stringify(completedExternalProviderCancellations)}`,
    );
    for (const failure of completedExternalProviderCancellations) {
      await assertCancelledExternalProvidersStillAvailable(label, failure);
    }
    unacceptedRequestFailures = unacceptedRequestFailures.filter(
      (failure) => !completedExternalProviderCancellations.includes(failure),
    );
    expectedNavigationCancellations.push(...completedExternalProviderCancellations);
  }

  const legacyProjectId = options.allowCompletedLegacyRedirectForProjectId || "";
  if (legacyProjectId) {
    const currentUrl = new URL(page.url());
    assert.equal(currentUrl.pathname, "/professional");
    assert.equal(currentUrl.searchParams.get("intent"), "library");
    assert.equal(currentUrl.searchParams.get("projectId"), legacyProjectId);
    assert.equal(await page.getByTestId("professional-canonical-workbench").isVisible(), true);
    const accepted = unacceptedRequestFailures.filter((failure) => (
      isCompletedLegacyRedirectCancellation(failure, legacyProjectId)
    ));
    assert.ok(accepted.length <= 1, `${label}: at most one completed legacy redirect cancellation is allowed`);
    unacceptedRequestFailures = unacceptedRequestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);
  }

  const globalCanonProjectId = options.allowSupersededGlobalCanonNavigationPrefetchesForProjectId || "";
  if (globalCanonProjectId) {
    const currentUrl = new URL(page.url());
    assert.equal(currentUrl.pathname, "/canon");
    assert.equal(currentUrl.searchParams.get("targetProjectId"), globalCanonProjectId);
    assert.equal(await page.getByTestId("global-canon-editor").isVisible(), true);
    assert.equal(await page.getByTestId("global-canon-target-project").inputValue(), globalCanonProjectId);
    const frontdoorTargets = [
      { pathname: "/canon", search: { targetProjectId: globalCanonProjectId } },
      { pathname: "/" },
      { pathname: "/studio" },
      { pathname: "/studio/create" },
      { pathname: "/studio/create", search: { cloneFrom: globalCanonProjectId } },
      { pathname: "/professional", search: { intent: "chat" } },
      { pathname: "/professional", search: { intent: "library" } },
      {
        pathname: "/professional",
        search: { intent: "library", projectId: globalCanonProjectId },
      },
      {
        pathname: "/settings/local-ai",
        search: { returnTo: `/studio/project/${globalCanonProjectId}/chat` },
      },
      {
        pathname: `/studio/project/${globalCanonProjectId}/chat`,
        search: { mode: "play" },
      },
      { pathname: `/studio/read/${globalCanonProjectId}` },
    ];
    const accepted = unacceptedRequestFailures.filter((failure) => (
      frontdoorTargets.some((target) => isSupersededRscCancellation(failure, target))
    ));
    for (const target of frontdoorTargets) {
      const targetFailures = accepted.filter((failure) => (
        isSupersededRscCancellation(failure, target)
      ));
      assert.ok(
        targetFailures.length <= 1,
        `${label}: at most one superseded frontdoor RSC prefetch is allowed for ${JSON.stringify(target)}: ${JSON.stringify(targetFailures)}`,
      );
    }
    assert.ok(accepted.length <= 2, `${label}: at most two superseded frontdoor RSC prefetches are allowed`);
    unacceptedRequestFailures = unacceptedRequestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);

    const frontdoorVisitStartedAt = options.frontdoorVisitStartedAt ?? 0;
    const frontdoorEditorArrivedAt = options.frontdoorEditorArrivedAt ?? 0;
    assert.ok(frontdoorVisitStartedAt > 0, `${label}: frontdoor visit start time is required`);
    assert.ok(
      frontdoorEditorArrivedAt >= frontdoorVisitStartedAt,
      `${label}: Canon editor arrival time must follow the frontdoor visit start`,
    );
    const completedHealthCancellations = unacceptedRequestFailures.filter((failure) => (
      isCompletedFrontdoorHealthCancellation(failure, frontdoorVisitStartedAt, frontdoorEditorArrivedAt)
    ));
    assert.ok(
      completedHealthCancellations.length <= 1,
      `${label}: at most one completed frontdoor health cancellation is allowed: ${JSON.stringify(completedHealthCancellations)}`,
    );
    unacceptedRequestFailures = unacceptedRequestFailures.filter(
      (failure) => !completedHealthCancellations.includes(failure),
    );
    expectedNavigationCancellations.push(...completedHealthCancellations);
  }

  if (options.allowBoundedSharedLearningRequest) {
    const accepted = unacceptedRequestFailures.filter(isBoundedSharedLearningCancellation);
    assert.ok(accepted.length <= 1, `${label}: at most one bounded shared-learning request is allowed`);
    unacceptedRequestFailures = unacceptedRequestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);
  }

  if (options.allowSupersededHealthRequest) {
    const accepted = unacceptedRequestFailures.filter(isSupersededHealthCancellation);
    assert.ok(
      accepted.length <= 2,
      `${label}: at most two superseded AI health requests are allowed: ${JSON.stringify(accepted)}`,
    );
    unacceptedRequestFailures = unacceptedRequestFailures.filter((failure) => !accepted.includes(failure));
    expectedNavigationCancellations.push(...accepted);
  }

  assert.deepEqual(
    unexpectedLoopbackRequests,
    [],
    label + ": public journey must not probe a machine-local Companion",
  );
  assert.deepEqual(pageErrors, [], `${label}: page errors: ${JSON.stringify(pageErrors)}`);
  assert.deepEqual(consoleErrors, [], `${label}: console errors: ${JSON.stringify(consoleErrors)}`);
  assert.deepEqual(
    nextStaticScriptHttpFailures,
    [],
    `${label}: Next static script HTTP failures: ${JSON.stringify(nextStaticScriptHttpFailures)}`,
  );
  assert.deepEqual(
    externalProviderHttpFailures,
    [],
    `${label}: external-provider status HTTP failures: ${JSON.stringify(externalProviderHttpFailures)}`,
  );
  assert.deepEqual(
    unacceptedRequestFailures,
    [],
    `${label}: failed requests: ${JSON.stringify(unacceptedRequestFailures)}`,
  );
}

const results = [];
let createdProjectId = "";
let frontdoorCanonVisitStartedAt = 0;
let frontdoorCanonEditorArrivedAt = 0;
const workspaceStaticScriptNavigationProofs = [];
const readerStaticScriptNavigationProofs = [];
const workspaceExternalProviderReloadProofs = [];
async function check(name, work) {
  await work();
  results.push({ name, status: "PASS" });
}

async function waitUntilIdle(targetPage) {
  await targetPage.waitForFunction(() => {
    const composer = document.querySelector('textarea[aria-label="小說專案訊息"]');
    return composer instanceof HTMLTextAreaElement && !composer.disabled;
  });
}

async function chooseExplicitRpgChoiceFallback(
  targetPage,
  previousChoiceMessageId = null,
  projectId = null,
) {
  let clickHandle;
  try {
    clickHandle = await targetPage.waitForFunction((previousMessageId) => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0
          && rect.height > 0
          && style.display !== "none"
          && style.visibility !== "hidden";
      };
      const button = [...document.querySelectorAll("button")].find((element) => (
        element.textContent?.trim() === "不等了，改用後備選項"
        && visible(element)
      ));
      if (!(button instanceof HTMLButtonElement)) return null;
      const composer = document.querySelector('[data-testid="conversation-message-composer"]');
      const choiceMessageIds = [...document.querySelectorAll('article[data-rpg-choices="true"]')]
        .map((element) => element.getAttribute("data-message-id"));
      const composerState = composer ? {
        startupState: composer.getAttribute("data-closed-ai-startup-state"),
        taskRoutable: composer.getAttribute("data-closed-ai-task-routable"),
        rulesFallbackReady: composer.getAttribute("data-closed-ai-rules-fallback-ready"),
        externalFallback: composer.getAttribute("data-closed-ai-external-fallback"),
      } : null;
      const noUnexpectedChoice = previousMessageId
        ? !choiceMessageIds.some((messageId) => messageId && messageId !== previousMessageId)
        : choiceMessageIds.length === 0;
      if (
        button.disabled
        || !noUnexpectedChoice
        || composerState?.startupState !== "action_required"
        || composerState.taskRoutable !== "false"
        || composerState.rulesFallbackReady !== "false"
        || composerState.externalFallback !== "false"
      ) {
        return {
          clicked: false,
          buttonDisabled: button.disabled,
          noUnexpectedChoice,
          composerState,
          choiceMessageIds,
        };
      }
      button.click();
      return {
        clicked: true,
        buttonDisabled: false,
        noUnexpectedChoice: true,
        composerState,
        choiceMessageIds,
      };
    }, previousChoiceMessageId, { timeout: 90_000, polling: 25 });
  } catch (error) {
    throw new Error(`RPG_EXPLICIT_FALLBACK_CONTROL_UNAVAILABLE ${JSON.stringify(
      projectId ? await readRpgRecoveryDiagnostics(targetPage, projectId) : {},
    )}`, { cause: error });
  }
  const clickResult = await clickHandle.jsonValue();
  await clickHandle.dispose();
  assert.equal(clickResult.clicked, true, JSON.stringify(clickResult));
  assert.equal(clickResult.buttonDisabled, false);
  assert.equal(clickResult.noUnexpectedChoice, true);
  assert.deepEqual(clickResult.composerState, {
    startupState: "action_required",
    taskRoutable: "false",
    rulesFallbackReady: "false",
    externalFallback: "false",
  });
  if (previousChoiceMessageId) {
    assert.equal(
      clickResult.choiceMessageIds.some((messageId) => messageId && messageId !== previousChoiceMessageId),
      false,
      "staged preview must not create a replacement A/B/C before explicit fallback",
    );
  } else {
    assert.equal(clickResult.choiceMessageIds.length, 0, "staged preview must not create A/B/C before explicit fallback");
  }
}

async function readDurableRpgSelections(targetPage, projectId, key) {
  return targetPage.evaluate(async ({ projectId: scopedProjectId, key: scopedKey }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const request = database.transaction("conversationMessages", "readonly")
        .objectStore("conversationMessages").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records.filter((message) => (
      message.projectId === scopedProjectId
      && message.role === "user"
      && (
        message.content.startsWith(`選擇 ${scopedKey}｜`)
        || message.content.trim().toUpperCase() === scopedKey
      )
    )).map((message) => ({
      id: message.id,
      sourceMessageId: message.sourceMessageId,
      status: message.status,
    }));
  }, { projectId, key });
}

async function readDurableRpgChoiceCardState(targetPage, projectId, messageId) {
  return targetPage.evaluate(async ({ projectId: scopedProjectId, messageId: scopedMessageId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(
      ["conversationMessages", "conversationToolInvocations"],
      "readonly",
    );
    const messageRequest = transaction.objectStore("conversationMessages").get(scopedMessageId);
    const invocationRequest = transaction.objectStore("conversationToolInvocations").getAll();
    const [message, invocations] = await Promise.all([
      new Promise((resolve, reject) => {
        messageRequest.onsuccess = () => resolve(messageRequest.result ?? null);
        messageRequest.onerror = () => reject(messageRequest.error);
      }),
      new Promise((resolve, reject) => {
        invocationRequest.onsuccess = () => resolve(invocationRequest.result);
        invocationRequest.onerror = () => reject(invocationRequest.error);
      }),
    ]);
    database.close();
    const staleMarkers = invocations.filter((invocation) => (
      invocation.projectId === scopedProjectId
      && invocation.messageId === scopedMessageId
      && invocation.toolId === "conversation:evidence:rpg-choice-stale"
      && invocation.taskType === "rpg.choice.stale-abandonment.v1"
    ));
    const choicePlanInvocations = invocations.filter((invocation) => (
      invocation.projectId === scopedProjectId
      && invocation.messageId === scopedMessageId
      && invocation.toolId === "closed-agent-os:rpg-choice-plan"
      && invocation.taskType === "chapter.abcChoices"
    ));
    let fallbackReason = null;
    const prefix = "[[NOVEL_RPG_CHOICES_V1]]\n";
    if (typeof message?.content === "string" && message.content.startsWith(prefix)) {
      try {
        const envelope = JSON.parse(message.content.slice(prefix.length));
        fallbackReason = typeof envelope?.plan?.executionReceipt?.fallbackReason === "string"
          ? envelope.plan.executionReceipt.fallbackReason
          : null;
      } catch {
        fallbackReason = null;
      }
    }
    return {
      message: message ? {
        id: message.id,
        projectId: message.projectId,
        role: message.role,
        status: message.status,
        contentDigest: message.contentDigest,
        toolInvocationIds: message.toolInvocationIds,
      } : null,
      staleMarkers: staleMarkers.map((marker) => ({
        id: marker.id,
        taskId: marker.taskId,
        status: marker.status,
        actualExecutor: marker.actualExecutor,
        externalRequest: marker.externalRequest,
        dataLeftDevice: marker.dataLeftDevice,
        canonicalMutationCount: marker.canonicalMutationCount,
        safeErrorCode: marker.safeErrorCode,
        safeProgress: marker.safeProgress,
        inputDigest: marker.inputDigest,
      })),
      choicePlanInvocations: choicePlanInvocations.map((invocation) => ({
        id: invocation.id,
        status: invocation.status,
        actualExecutor: invocation.actualExecutor,
        externalRequest: invocation.externalRequest,
        dataLeftDevice: invocation.dataLeftDevice,
        canonicalMutationCount: invocation.canonicalMutationCount,
      })),
      fallbackReason,
    };
  }, { projectId, messageId });
}

function assertExplicitRpgChoiceFallback(state) {
  assert.equal(state.choicePlanInvocations.length, 1, "one explicit fallback must persist one choice-plan invocation");
  const [invocation] = state.choicePlanInvocations;
  assert.equal(invocation.status, "completed");
  assert.equal(invocation.actualExecutor, "deterministic-rule-fallback");
  assert.equal(invocation.externalRequest, false);
  assert.equal(invocation.dataLeftDevice, false);
  assert.equal(invocation.canonicalMutationCount, 0);
  assert.equal(state.fallbackReason, "USER_REQUESTED_RULE_FALLBACK");
}

async function readRpgRecoveryDiagnostics(targetPage, projectId) {
  const durable = await targetPage.evaluate(async (scopedProjectId) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(
      ["conversationMessages", "conversationToolInvocations"],
      "readonly",
    );
    const readAll = (storeName) => new Promise((resolve, reject) => {
      const request = transaction.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [messages, invocations] = await Promise.all([
      readAll("conversationMessages"),
      readAll("conversationToolInvocations"),
    ]);
    database.close();
    return {
      messages: messages.filter((message) => message.projectId === scopedProjectId).map((message) => ({
        id: message.id,
        role: message.role,
        status: message.status,
        parentMessageId: message.parentMessageId,
        sourceMessageId: message.sourceMessageId,
        rpgChoices: typeof message.content === "string"
          && message.content.startsWith("[[NOVEL_RPG_CHOICES_V1]]\n"),
      })),
      invocations: invocations.filter((invocation) => invocation.projectId === scopedProjectId).map((invocation) => ({
        id: invocation.id,
        messageId: invocation.messageId,
        toolId: invocation.toolId,
        status: invocation.status,
        actualExecutor: invocation.actualExecutor,
        safeErrorCode: invocation.safeErrorCode,
        safeProgress: invocation.safeProgress,
      })),
    };
  }, projectId);
  return {
    durable,
    alerts: await targetPage.getByRole("alert").allTextContents(),
    progress: await targetPage.locator('[role="status"]').allTextContents(),
    fallbackControls: await targetPage.locator('button:visible')
      .filter({ hasText: /^不等了，改用後備選項$/u })
      .count(),
  };
}

async function waitForDurableRpgChoiceStaleMarker(targetPage, projectId, messageId) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const state = await readDurableRpgChoiceCardState(targetPage, projectId, messageId);
    const markerIds = new Set(state.staleMarkers.map((marker) => marker.id));
    const linkedMarkerIds = state.message?.toolInvocationIds ?? [];
    if (
      state.staleMarkers.length > 0
      && linkedMarkerIds.some((invocationId) => markerIds.has(invocationId))
    ) return state;
    await targetPage.waitForTimeout(100);
  }
  throw new Error(`RPG_STALE_CHOICE_MARKER_NOT_LINKED:${messageId}`);
}

async function mutateFirstCharacterRevision(targetPage, projectId) {
  return targetPage.evaluate((scopedProjectId) => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open("novel-intelligence-platform");
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction("characters", "readwrite");
      const store = transaction.objectStore("characters");
      let original = null;
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        if (!original) reject(new Error("RPG_COLD_LOAD_CHARACTER_FIXTURE_MISSING"));
        else resolve(original);
      };
      const getRequest = store.getAll();
      getRequest.onerror = () => reject(getRequest.error);
      getRequest.onsuccess = () => {
        original = getRequest.result.find((record) => record.projectId === scopedProjectId) ?? null;
        if (!original) return;
        store.put({
          ...original,
          revision: Number(original.revision ?? 0) + 1,
          updatedAt: new Date(Date.now() + 1_000).toISOString(),
        });
      };
    };
  }), projectId);
}

async function restoreCharacterRecord(targetPage, record) {
  await targetPage.evaluate((original) => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open("novel-intelligence-platform");
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction("characters", "readwrite");
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.objectStore("characters").put(original);
    };
  }), record);
}

try {
  browser = await browserType.launch({ headless: true });
  context = await browser.newContext({
    locale: "zh-TW",
    viewport: mobileViewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    serviceWorkers: "allow",
  });
  await resetLocalStorageAndOpen(`${baseUrl}/studio/create`);

  await check("title is required before mode or creation path", async () => {
    await page.getByTestId("canonical-create-flow").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("create-play-mode-general").isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: /快速開始/ }).isDisabled(), true);
    assert.equal(await page.getByTestId("rpg-choice-A").count(), 0);

    await page.getByTestId("p2-project-title").fill("入口流程驗收作品");
    assert.equal(await page.getByTestId("create-play-mode-general").isEnabled(), true);
    await page.getByTestId("create-play-mode-general").click();
    await page.getByRole("button", { name: /引導建立/ }).click();
    await page.locator(".p2TopicGrid button").first().click();
    await page.getByTestId("creation-primary-next").click();
    await page.getByText("第 1 題／共 5 題").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("p2-project-title").inputValue(), "入口流程驗收作品");
  });

  await assertCleanDiagnostics("general creation validation");
  await resetLocalStorageAndOpen(`${baseUrl}/studio/create`);

  await check("incomplete RPG setup has no choices and cannot start", async () => {
    await page.getByTestId("p2-project-title").fill("必要設定 Gate 驗收");
    await page.getByTestId("create-play-structure-choice").click();
    await page.getByTestId("create-play-mode-rpg").click();
    await page.getByRole("button", { name: /引導建立/ }).click();
    await page.locator(".p2TopicGrid button").first().click();
    await page.getByTestId("creation-primary-next").click();
    await page.getByTestId("creation-primary-next").click();
    await page.getByText(/請先回答第 1 題/u).waitFor({ state: "visible" });
    await page.locator(".p2FoundationWarning").waitFor({ state: "visible" });
    assert.equal(await page.locator(".p2StepBar").getAttribute("aria-label"), "第 2 步，共 6 步");
    assert.equal(await page.getByRole("button", { name: "建立「RPG 養成」作品" }).count(), 0);
    assert.equal(await page.getByTestId("rpg-choice-A").count(), 0);
  });

  await check("guide creates editable foundations without changing the title", async () => {
    for (let step = 1; step <= 5; step += 1) {
      await page.locator(".p2GuidedChoices button").first().click();
      if (step < 5) {
        await page.getByTestId("creation-primary-next").click();
        await page.locator(".p2StepBar").waitFor({ state: "visible" });
        assert.equal(await page.locator(".p2StepBar").getAttribute("aria-label"), `第 ${step + 2} 步，共 6 步`);
      }
    }
    await page.getByRole("button", { name: "選擇這組上場群像", exact: true }).first().click();
    await page.getByText("故事起點已完整").waitFor({ state: "visible" });
    assert.equal((await page.getByTestId("p2-project-title").inputValue()).trim(), "必要設定 Gate 驗收");
    const preview = await page.locator(".p2SeedPreview").innerText();
    assert.equal(preview.includes("稍後補充"), false);
    assert.equal(await page.getByRole("button", { name: "建立「RPG 養成」作品" }).isEnabled(), true);
    const finalMobile = await page.evaluate(() => {
      const footer = document.querySelector(".p2CreatePanel > footer")?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight,
        footerVisible: Boolean(footer && footer.top >= 0 && footer.bottom <= innerHeight + 1),
        expandedLongPanels: document.querySelectorAll(".p2FoundationSetup details[open]").length,
      };
    });
    assert.equal(finalMobile.overflow, false);
    assert.equal(finalMobile.footerVisible, true);
    assert.equal(finalMobile.expandedLongPanels, 0);
    assert.ok(finalMobile.height < 7_500, `mobile final setup is still ${finalMobile.height}px tall`);
  });

  await check("RPG start reaches a playable first turn", async () => {
    await page.getByRole("button", { name: "建立「RPG 養成」作品" }).click();
    const playLink = page.getByRole("link", { name: "在故事工作台開始遊玩" });
    const playHref = await playLink.getAttribute("href");
    assert.match(playHref, /\/chat\?mode=play$/u);
    const navigationStartedAt = Date.now();
    try {
      await Promise.all([
        page.waitForURL(/\/studio\/project\/[^/]+\/chat\?mode=play$/u, { timeout: 60_000 }),
        playLink.click(),
      ]);
      await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 60_000 });
      workspaceStaticScriptNavigationProofs.push({
        startedAt: navigationStartedAt,
        arrivedAt: Date.now(),
        destinationUrl: page.url(),
        landed: true,
      });
    } catch (error) {
      throw new Error(
        `PLAY_WORKSPACE_NAVIGATION_FAILED ${JSON.stringify({
          currentUrl: page.url(),
          expectedHref: playHref,
          consoleErrors,
          requestFailures,
          pageErrors,
        })}`,
        { cause: error },
      );
    }
    assert.match(new URL(page.url()).pathname, /\/studio\/project\/[^/]+\/chat$/u);
    createdProjectId = new URL(page.url()).pathname.split("/")[3] || "";
    assert.ok(createdProjectId);
    await page.getByText("開始目前玩法的第一回合。", { exact: true }).waitFor({ state: "visible", timeout: 60_000 });
    await chooseExplicitRpgChoiceFallback(page, null, createdProjectId);
    await page.getByTestId("rpg-inline-choices").waitFor({ state: "visible", timeout: 90_000 });
    for (const choice of ["A", "B", "C"]) {
      await page.getByTestId(`rpg-choice-${choice}`).waitFor({ state: "visible" });
    }
  });

  await check("stale completed A/B/C is durably abandoned and rebuilt before B can continue", async () => {
    const reloadSourceUrl = page.url();
    const reloadStartedAt = Date.now();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 60_000 });
    await page.getByTestId("rpg-inline-choices").waitFor({ state: "visible", timeout: 60_000 });
    await waitForTimelineScrollRestore(page);
    const reloadArrivedAt = Date.now();
    workspaceStaticScriptNavigationProofs.push({
      startedAt: reloadStartedAt,
      arrivedAt: reloadArrivedAt,
      destinationUrl: page.url(),
      landed: true,
    });
    workspaceExternalProviderReloadProofs.push({
      kind: "workspace-reload",
      sourceUrl: reloadSourceUrl,
      startedAt: reloadStartedAt,
      arrivedAt: reloadArrivedAt,
      destinationUrl: page.url(),
      landed: true,
    });
    const originalChoiceCard = page.locator('article[data-rpg-choices="true"]').last();
    const originalChoiceMessageId = await originalChoiceCard.getAttribute("data-message-id");
    assert.ok(originalChoiceMessageId, "the completed A/B/C card must expose its durable message identity");
    const originalCardState = await readDurableRpgChoiceCardState(
      page,
      createdProjectId,
      originalChoiceMessageId,
    );
    assert.equal(originalCardState.message?.role, "assistant");
    assert.equal(originalCardState.message?.status, "completed", "the stale fixture must begin as a completed A/B/C card");
    assertExplicitRpgChoiceFallback(originalCardState);
    for (const choice of ["A", "B", "C"]) {
      assert.equal(await originalChoiceCard.getByTestId(`rpg-choice-${choice}`).isEnabled(), true);
    }
    const actionableChoiceGeometry = await originalChoiceCard.evaluate((card) => {
      const timeline = document.querySelector('[data-testid="conversation-message-timeline"]');
      const composer = document.querySelector('[data-testid="conversation-message-composer"]');
      const sourceControls = document.querySelector('[data-testid="conversation-ai-source-controls"]');
      const setupCard = document.querySelector('[data-testid="closed-ai-setup-card"]');
      return {
        timelineHeight: timeline?.getBoundingClientRect().height ?? 0,
        composerHeight: composer?.getBoundingClientRect().height ?? 0,
        composerMaxHeight: Math.min(innerHeight * 0.44, 360),
        choiceContentVisibility: getComputedStyle(card).contentVisibility,
        sourceControlsVisible: Boolean(sourceControls && getComputedStyle(sourceControls).display !== "none"),
        setupCardVisible: Boolean(setupCard && getComputedStyle(setupCard).display !== "none"),
      };
    });
    assert.ok(actionableChoiceGeometry.timelineHeight >= 96, JSON.stringify(actionableChoiceGeometry));
    assert.ok(actionableChoiceGeometry.composerHeight <= actionableChoiceGeometry.composerMaxHeight + 1, JSON.stringify(actionableChoiceGeometry));
    assert.equal(actionableChoiceGeometry.choiceContentVisibility, "visible");
    assert.equal(actionableChoiceGeometry.sourceControlsVisible, false);
    assert.equal(actionableChoiceGeometry.setupCardVisible, false);

    let originalCharacterRecord = null;
    try {
      await originalChoiceCard.getByTestId("rpg-choice-A").click({ trial: true });
      await originalChoiceCard.getByTestId("rpg-choice-A").click();
      let durableASelections = [];
      for (let attempt = 0; attempt < 120; attempt += 1) {
        durableASelections = await readDurableRpgSelections(page, createdProjectId, "A");
        if (durableASelections.length === 1 && durableASelections[0].status === "completed") break;
        await page.waitForTimeout(100);
      }
      assert.equal(durableASelections.length, 1, "one A click must persist exactly one auditable user turn");
      assert.equal(durableASelections[0].status, "completed", "the selected A turn must finish durable persistence");
      assert.equal(durableASelections[0].sourceMessageId, originalChoiceMessageId);
      const selectedTurn = page.locator(`article[data-message-id="${durableASelections[0].id}"]`);
      await selectedTurn.waitFor({ state: "visible", timeout: 10_000 });

      const stopBeforeStale = page.getByRole("button", { name: "停止", exact: true });
      await stopBeforeStale.waitFor({ state: "visible", timeout: 10_000 });
      await stopBeforeStale.click();
      await waitUntilIdle(page);

      const preStaleState = await readDurableRpgChoiceCardState(
        page,
        createdProjectId,
        originalChoiceMessageId,
      );
      assert.equal(preStaleState.staleMarkers.length, 0, "stopping the first attempt must not forge stale evidence");
      assert.equal(
        (await readDurableRpgSelections(page, createdProjectId, "A")).length,
        1,
        "stopping the first attempt must not duplicate the A turn",
      );

      originalCharacterRecord = await mutateFirstCharacterRevision(page, createdProjectId);
      const composer = page.getByLabel("小說專案訊息");
      await composer.fill("A");
      await page.getByRole("button", { name: "送出", exact: true }).click();

      durableASelections = await readDurableRpgSelections(page, createdProjectId, "A");
      assert.equal(durableASelections.length, 1, "typed stale A must reuse the existing auditable A turn");
      assert.equal(
        durableASelections[0].status,
        "completed",
        "typed A must stay completed while its stale envelope is abandoned",
      );
      assert.equal(durableASelections[0].sourceMessageId, originalChoiceMessageId);
      try {
        await selectedTurn.waitFor({ state: "visible", timeout: 10_000 });
      } catch (error) {
        throw new Error(`RPG_STALE_CHOICE_TURN_NOT_VISIBLE ${JSON.stringify({
          url: page.url(),
          typedChoice: "A",
          userMessages: await page.locator('article[data-role="user"]').allTextContents(),
          alerts: await page.getByRole("alert").allTextContents(),
          workspaceTail: (await page.getByTestId("conversation-first-workspace").innerText()).slice(-4_000),
        })}`, { cause: error });
      }
      assert.equal(await selectedTurn.count(), 1, "one stale click must create exactly one RPG user turn");

      const durableStaleState = await waitForDurableRpgChoiceStaleMarker(
        page,
        createdProjectId,
        originalChoiceMessageId,
      );
      await waitUntilIdle(page);
      assert.equal(durableStaleState.message?.status, "completed", "stale evidence must bind to the completed choice card");
      assert.equal(durableStaleState.staleMarkers.length, 1, "one stale card must have exactly one durable marker");
      const [staleMarker] = durableStaleState.staleMarkers;
      assert.equal(staleMarker.id, staleMarker.taskId);
      assert.equal(staleMarker.status, "failed");
      assert.equal(staleMarker.actualExecutor, null);
      assert.equal(staleMarker.externalRequest, false);
      assert.equal(staleMarker.dataLeftDevice, false);
      assert.equal(staleMarker.canonicalMutationCount, 0);
      assert.equal(staleMarker.safeErrorCode, "RPG_CHAT_CHOICES_STALE");
      assert.equal(staleMarker.safeProgress?.stage, "rpg-choice-stale-abandonment-v1");
      assert.equal(staleMarker.inputDigest, durableStaleState.message?.contentDigest);
      assert.equal(durableStaleState.message?.toolInvocationIds.includes(staleMarker.id), true);

      const liveOldCard = page.locator(`article[data-message-id="${originalChoiceMessageId}"]`);
      await liveOldCard.getByText("作品版本已變更；這張舊選擇卡已封存，請重新建立三選一。")
        .waitFor({ state: "visible", timeout: 10_000 });
      for (const choice of ["A", "B", "C"]) {
        assert.equal(
          await liveOldCard.getByTestId(`rpg-choice-${choice}`).isDisabled(),
          true,
          `stale choice ${choice} must disable immediately without a reload`,
        );
      }
      await page.getByTestId("rpg-next-choice-recovery").waitFor({ state: "visible", timeout: 10_000 });

      const staleReloadSourceUrl = page.url();
      const staleReloadStartedAt = Date.now();
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 60_000 });
      await waitForTimelineScrollRestore(page);
      workspaceExternalProviderReloadProofs.push({
        kind: "workspace-reload",
        sourceUrl: staleReloadSourceUrl,
        startedAt: staleReloadStartedAt,
        arrivedAt: Date.now(),
        destinationUrl: page.url(),
        landed: true,
      });
      const reloadedOldCard = page.locator(`article[data-message-id="${originalChoiceMessageId}"]`);
      await reloadedOldCard.waitFor({ state: "visible", timeout: 60_000 });
      await reloadedOldCard.getByText("作品版本已變更；這張舊選擇卡已封存，請重新建立三選一。").waitFor({ state: "visible" });
      for (const choice of ["A", "B", "C"]) {
        assert.equal(
          await reloadedOldCard.getByTestId(`rpg-choice-${choice}`).isDisabled(),
          true,
          `reloaded stale choice ${choice} must remain disabled`,
        );
      }
      const reloadedDurableState = await readDurableRpgChoiceCardState(
        page,
        createdProjectId,
        originalChoiceMessageId,
      );
      assert.equal(reloadedDurableState.staleMarkers.length, 1, "reload must retain exactly one stale marker");

      const recovery = page.getByTestId("rpg-next-choice-recovery");
      await recovery.waitFor({ state: "visible", timeout: 60_000 });
      await recovery.getByRole("button", { name: "繼續下一輪／重新建立三選一" }).click();
      await chooseExplicitRpgChoiceFallback(page, originalChoiceMessageId, createdProjectId);
      try {
        await page.waitForFunction((oldMessageId) => (
          [...document.querySelectorAll('article[data-rpg-choices="true"]')]
            .some((element) => element.getAttribute("data-message-id") !== oldMessageId)
        ), originalChoiceMessageId, { timeout: 90_000 });
      } catch (error) {
        throw new Error(`RPG_EXPLICIT_FALLBACK_RECOVERY_TIMEOUT ${JSON.stringify(
          await readRpgRecoveryDiagnostics(page, createdProjectId),
        )}`, { cause: error });
      }
      await waitUntilIdle(page);

      const rebuiltChoiceCard = page.locator('article[data-rpg-choices="true"]').last();
      const rebuiltChoiceMessageId = await rebuiltChoiceCard.getAttribute("data-message-id");
      assert.ok(rebuiltChoiceMessageId);
      assert.notEqual(rebuiltChoiceMessageId, originalChoiceMessageId, "recovery must create a new choice-card message");
      assertExplicitRpgChoiceFallback(await readDurableRpgChoiceCardState(
        page,
        createdProjectId,
        rebuiltChoiceMessageId,
      ));
      for (const choice of ["A", "B", "C"]) {
        assert.equal(
          await rebuiltChoiceCard.getByTestId(`rpg-choice-${choice}`).isEnabled(),
          true,
          `rebuilt choice ${choice} must be actionable`,
        );
      }

      await rebuiltChoiceCard.getByTestId("rpg-choice-B").click();
      const selectedBTurn = page.locator('article[data-role="user"]').filter({ hasText: /選擇 B｜/u });
      await selectedBTurn.waitFor({ state: "visible", timeout: 5_000 });
      const durableBSelections = await readDurableRpgSelections(page, createdProjectId, "B");
      assert.equal(durableBSelections.length, 1, "one rebuilt-card B click must persist exactly one durable B turn");
      assert.equal(durableBSelections[0].sourceMessageId, rebuiltChoiceMessageId);

      const stop = page.getByRole("button", { name: "停止", exact: true });
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (await stop.isVisible()) {
          await stop.click();
          break;
        }
        if (await composer.isEnabled()) break;
        await page.waitForTimeout(100);
      }
      await waitUntilIdle(page);
      assert.equal(await selectedBTurn.count(), 1, "B continuation must not replay the selected turn");
      assert.equal(
        (await readDurableRpgSelections(page, createdProjectId, "B")).length,
        1,
        "cancellation or completion must leave exactly one durable B turn",
      );

      await mutateFirstCharacterRevision(page, createdProjectId);
      assert.equal(
        await rebuiltChoiceCard.getByTestId("rpg-choice-B").isEnabled(),
        true,
        "a cancelled durable B attempt must remain directly recoverable before context drift is detected",
      );
      await rebuiltChoiceCard.getByTestId("rpg-choice-B").click();
      const directClickStaleState = await waitForDurableRpgChoiceStaleMarker(
        page,
        createdProjectId,
        rebuiltChoiceMessageId,
      );
      await waitUntilIdle(page);
      assert.equal(directClickStaleState.staleMarkers.length, 1);
      assert.equal(
        (await readDurableRpgSelections(page, createdProjectId, "B")).length,
        1,
        "direct stale B retry must reuse the completed user turn instead of duplicating it",
      );
      await rebuiltChoiceCard.getByText("作品版本已變更；這張舊選擇卡已封存，請重新建立三選一。")
        .waitFor({ state: "visible", timeout: 10_000 });
      for (const choice of ["A", "B", "C"]) {
        assert.equal(
          await rebuiltChoiceCard.getByTestId(`rpg-choice-${choice}`).isDisabled(),
          true,
          `direct-click stale choice ${choice} must disable immediately without a reload`,
        );
      }
      await page.getByTestId("rpg-next-choice-recovery").waitFor({ state: "visible", timeout: 10_000 });
    } finally {
      if (originalCharacterRecord) {
        await restoreCharacterRecord(page, originalCharacterRecord);
      }
    }
  });

  await check("mobile onboarding has no horizontal overflow", async () => {
    const chatUrl = page.url();
    await assertCleanDiagnostics("RPG creation and workspace navigation", {
      allowSupersededWorkspacePrefetchesForProjectId: createdProjectId,
      allowBoundedSharedLearningRequest: true,
      completedStaticScriptNavigationProofs: workspaceStaticScriptNavigationProofs,
      completedExternalProviderReloadProofs: workspaceExternalProviderReloadProofs,
    });
    await openFreshPage(chatUrl);
    await page.setViewportSize(mobileViewport);
    await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false);
    assert.equal(await page.locator("header a:visible").filter({ hasText: /系統首頁|作品管理中心/u }).count(), 0);
    await page.getByTestId("conversation-mobile-sidebar-toggle").click();
    await page.getByTestId("conversation-session-sidebar").waitFor({ state: "visible" });
    await page.getByTestId("conversation-active-session").waitFor({ state: "visible" });
    const sessionActionTargetsHandle = await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll(
        '[data-testid="conversation-active-session"] span button',
      )];
      const targets = buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          label: button.getAttribute("aria-label") || "",
          width: rect.width,
          height: rect.height,
          hasIcon: Boolean(button.querySelector("svg")),
        };
      });
      return targets.length === 3
        && targets.every((target) => (
          target.label
          && target.hasIcon
          && target.width >= 44
          && target.height >= 44
        ))
        ? targets
        : false;
    }, undefined, { timeout: 10_000 });
    const sessionActionTargets = await sessionActionTargetsHandle.jsonValue();
    await sessionActionTargetsHandle.dispose();
    assert.equal(sessionActionTargets.length, 3);
    assert.ok(
      sessionActionTargets.every((target) => (
        target.label
        && target.hasIcon
        && target.width >= 44
        && target.height >= 44
      )),
      JSON.stringify(sessionActionTargets),
    );
    await page.getByTestId("conversation-sidebar-close").click();
    const composer = page.getByLabel("小說專案訊息");
    await composer.focus();
    const keyboardViewport = {
      width: mobileViewport.width,
      height: Math.max(360, Math.min(560, mobileViewport.height - 208)),
    };
    await page.setViewportSize(keyboardViewport);
    await page.waitForFunction(() => {
      const shell = document.querySelector('[data-testid="conversation-first-workspace"]');
      const visualHeight = window.visualViewport?.height ?? window.innerHeight;
      return shell?.getAttribute("data-visual-viewport") === "bound"
        && getComputedStyle(shell).getPropertyValue("--conversation-visual-height").trim() === `${Math.round(visualHeight)}px`;
    });
    await page.waitForTimeout(350);
    const keyboardState = await page.evaluate(() => {
      const visualViewport = window.visualViewport;
      const visualTop = visualViewport?.offsetTop ?? 0;
      const visualBottom = visualTop + (visualViewport?.height ?? window.innerHeight);
      const input = document.querySelector('[aria-label="小說專案訊息"]')?.getBoundingClientRect();
      const send = [...document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "送出")
        ?.getBoundingClientRect();
      const workspace = document.querySelector('[data-testid="conversation-first-workspace"] > div')?.getBoundingClientRect();
      const main = document.querySelector('[data-testid="conversation-first-workspace"] section')?.getBoundingClientRect();
      const shell = document.querySelector('[data-testid="conversation-first-workspace"]');
      const mainElement = document.querySelector('[data-testid="conversation-first-workspace"] section');
      const maxTouchPoints = navigator.maxTouchPoints;
      const coarsePointer = matchMedia("(pointer: coarse)").matches;
      return {
        inputVisible: Boolean(input && input.top >= visualTop - 1 && input.bottom <= visualBottom + 1),
        sendVisible: Boolean(send && send.top >= visualTop - 1 && send.bottom <= visualBottom + 1),
        visualViewportBound: document.querySelector('[data-testid="conversation-first-workspace"]')?.getAttribute("data-visual-viewport") === "bound",
        touchCapable: maxTouchPoints > 0 || coarsePointer,
        maxTouchPoints,
        coarsePointer,
        visualTop,
        visualBottom,
        inputTop: input?.top ?? null,
        inputBottom: input?.bottom ?? null,
        sendTop: send?.top ?? null,
        sendBottom: send?.bottom ?? null,
        workspaceTop: workspace?.top ?? null,
        workspaceBottom: workspace?.bottom ?? null,
        mainTop: main?.top ?? null,
        mainBottom: main?.bottom ?? null,
        shellTop: shell?.getBoundingClientRect().top ?? null,
        shellPosition: shell ? getComputedStyle(shell).position : null,
        scrollY: window.scrollY,
        visualPageTop: visualViewport?.pageTop ?? null,
        bodyHeight: document.body.scrollHeight,
        mainGridRows: mainElement ? getComputedStyle(mainElement).gridTemplateRows : null,
        mainChildren: mainElement ? [...mainElement.children].map((child) => {
          const rect = child.getBoundingClientRect();
          return { className: String(child.className), top: rect.top, bottom: rect.bottom, height: rect.height };
        }) : [],
      };
    });
    const keyboardDiagnostic = JSON.stringify(keyboardState);
    assert.equal(keyboardState.visualViewportBound, true, keyboardDiagnostic);
    assert.equal(keyboardState.touchCapable, true, keyboardDiagnostic);
    assert.equal(keyboardState.inputVisible, true, keyboardDiagnostic);
    assert.equal(keyboardState.sendVisible, true, keyboardDiagnostic);
    await page.setViewportSize(mobileViewport);
  });

  await check("mobile project drawer opens the complete management center", async () => {
    const projectId = createdProjectId;
    assert.ok(projectId, "the created project identity must remain available");
    await page.setViewportSize(mobileViewport);
    await page.getByTestId("conversation-mobile-sidebar-toggle").tap();
    const managementLink = page.getByRole("link", { name: /作品管理中心/u }).first();
    await Promise.all([
      page.waitForURL(/\/professional\?intent=library&projectId=/u, { timeout: 60_000 }),
      managementLink.tap(),
    ]);
    await page.getByTestId("professional-canonical-workbench").waitFor({ state: "visible" });
    for (const heading of ["故事與章節", "角色、世界與記憶", "任務、成就與檢查", "作品、存檔與備份", "自動協調器與學習", "研究與作者輔助"]) {
      await page.getByRole("heading", { name: heading, exact: true }).waitFor({ state: "visible" });
    }
    const mobileState = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      groupColumns: getComputedStyle(document.querySelector(".professionalActionGroups")).gridTemplateColumns.split(" ").length,
      managementVisible: document.querySelector('[data-testid="professional-canonical-workbench"]')?.getBoundingClientRect().height > 0,
    }));
    assert.equal(mobileState.overflow, false);
    assert.equal(mobileState.groupColumns, 1);
    assert.equal(mobileState.managementVisible, true);

    const canonEditorLink = page.getByTestId("professional-canon-editor-link");
    const canonEditorHref = new URL(await canonEditorLink.getAttribute("href"), baseUrl);
    assert.equal(canonEditorHref.pathname, "/canon");
    assert.equal(canonEditorHref.searchParams.get("targetProjectId"), projectId);
    const managementCanonVisitStartedAt = Date.now();
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/canon" && url.searchParams.get("targetProjectId") === projectId, { timeout: 60_000 }),
      canonEditorLink.tap(),
    ]);
    await page.getByTestId("global-canon-editor").waitFor({ state: "visible" });
    await page.getByTestId("global-canon-characters").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("global-canon-target-project").inputValue(), projectId);
    const canonTabs = ["十萬人物與總庫", "關係網", "組織與祖譜", "寶物圖鑑", "十萬世界與世界規則", "記憶與資料", "Story Bible 防矛盾總綱", "事件時間線與模板"];
    assert.equal(await page.getByRole("tab").count(), canonTabs.length);
    for (const tabName of canonTabs) {
      assert.equal(await page.getByRole("tab", { name: tabName, exact: true }).isVisible(), true);
    }
    assert.ok(await page.getByRole("button", { name: /玄門劍修/u }).count() > 0, "the global character editor must render real portrait choices");
    const editorViewport = await page.getByTestId("global-canon-editor").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: innerHeight,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        shortTargets: [...element.querySelectorAll("button,a,select,input")]
          .filter((target) => {
            const targetRect = target.getBoundingClientRect();
            return targetRect.width > 0 && targetRect.height > 0 && targetRect.height < 44;
          }).length,
      };
    });
    assert.ok(editorViewport.top >= 0 && editorViewport.top < editorViewport.viewportHeight, JSON.stringify(editorViewport));
    assert.ok(editorViewport.bottom > 0, JSON.stringify(editorViewport));
    assert.equal(editorViewport.overflow, false, JSON.stringify(editorViewport));
    assert.equal(editorViewport.shortTargets, 0, JSON.stringify(editorViewport));
    const managementCanonEditorArrivedAt = Date.now();
    await assertCleanDiagnostics("mobile workspace and management Canon journey", {
      allowSupersededGlobalCanonNavigationPrefetchesForProjectId: createdProjectId,
      allowSupersededHealthRequest: true,
      allowBoundedSharedLearningRequest: true,
      frontdoorVisitStartedAt: managementCanonVisitStartedAt,
      frontdoorEditorArrivedAt: managementCanonEditorArrivedAt,
    });
  });

  await check("world 2 organization and genealogy people open portrait-backed details", async () => {
    await page.setViewportSize(mobileViewport);
    await openFreshPage(`${baseUrl}/canon?world=2`);
    await page.getByTestId("global-canon-editor").waitFor({ state: "visible" });
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-testid="global-character-candidate"] [data-portrait-resource]').length === 24
    ));
    const catalogPortraits = await page
      .locator('[data-testid="global-character-candidate"] [data-portrait-resource]')
      .evaluateAll((elements) => elements.map((element) => ({
        resource: element.getAttribute("data-portrait-resource"),
        cell: element.getAttribute("data-portrait-atlas-cell"),
      })));
    const catalogBaseKeys = catalogPortraits.map((portrait) => `${portrait.resource}|${portrait.cell}`);
    assert.equal(new Set(catalogBaseKeys).size, 24, "world 2 first page must show 24 genuinely different atlas faces");
    assert.equal(Math.max(...[...new Set(catalogBaseKeys)].map((key) => catalogBaseKeys.filter((candidate) => candidate === key).length)), 1);
    await page.getByRole("tab", { name: "組織與祖譜", exact: true }).tap();
    await page.getByTestId("global-canon-organizations").waitFor({ state: "visible" });

    async function verifyPersonCard(surface, view) {
      const card = surface
        .locator(`[data-testid="global-organization-member-card"][data-member-view="${view}"]`)
        .first();
      await card.scrollIntoViewIfNeeded();
      const characterId = await card.getAttribute("data-character-id");
      assert.ok(characterId, `${view} card must expose a stable character id`);
      const name = String(await card.getAttribute("data-member-name") || "").trim();
      const rank = String(await card.getAttribute("data-member-rank") || "").trim();
      const unit = String(await card.getAttribute("data-member-unit") || "").trim();
      const faction = String(await card.getAttribute("data-member-faction") || "").trim();
      assert.ok(name, `${view} card must expose the character name`);
      assert.ok(rank && unit && faction, `${view} card must expose organization identity`);
      const accessibleName = await card.getAttribute("aria-label") ?? "";
      for (const expected of [name, rank, unit]) assert.ok(accessibleName.includes(expected), `${view} accessible name missing ${expected}`);

      const portrait = card.locator("[data-portrait-resource]").first();
      await portrait.waitFor({ state: "visible" });
      const cardPortrait = await portrait.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          resource: element.getAttribute("data-portrait-resource"),
          cell: element.getAttribute("data-portrait-atlas-cell"),
          filter: getComputedStyle(element).filter,
          width: rect.width,
          height: rect.height,
        };
      });
      assert.match(cardPortrait.resource ?? "", /^\/character-portraits\/atlas-.+\.webp$/u);
      assert.ok(cardPortrait.cell, `${view} card must use a real portrait atlas cell`);
      assert.ok(cardPortrait.width >= 44 && cardPortrait.height >= 44, JSON.stringify(cardPortrait));
      const portraitAsset = await context.request.get(new URL(cardPortrait.resource, baseUrl).href);
      assert.equal(portraitAsset.ok(), true);
      assert.match(portraitAsset.headers()["content-type"] ?? "", /^image\/webp/u);

      await card.tap();
      const detail = page.getByTestId("global-organization-member-detail");
      await detail.waitFor({ state: "visible" });
      assert.equal(await detail.getAttribute("data-character-id"), characterId);
      assert.equal(await detail.getByRole("heading", { name, exact: true }).count(), 1);
      const detailText = await detail.innerText();
      for (const expected of [rank, unit, faction]) assert.ok(detailText.includes(expected), `${view} detail missing ${expected}`);
      const detailPortrait = detail.locator("[data-portrait-resource]").first();
      assert.equal(await detailPortrait.getAttribute("data-portrait-resource"), cardPortrait.resource);
      assert.equal(await detailPortrait.getAttribute("data-portrait-atlas-cell"), cardPortrait.cell);
      assert.equal(await detailPortrait.evaluate((element) => getComputedStyle(element).filter), cardPortrait.filter);
      assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
      assert.equal(await detail.evaluate((element) => element.contains(document.activeElement)), true);
      await page.keyboard.press("Shift+Tab");
      assert.equal(await detail.evaluate((element) => element.contains(document.activeElement)), true);
      await page.keyboard.press("Tab");
      assert.equal(await detail.evaluate((element) => element.contains(document.activeElement)), true);
      const detailViewport = await detail.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          viewportWidth: document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      assert.ok(detailViewport.left >= -1 && detailViewport.right <= detailViewport.viewportWidth + 1, JSON.stringify(detailViewport));
      assert.equal(detailViewport.overflow, false, JSON.stringify(detailViewport));

      await page.keyboard.press("Escape");
      await detail.waitFor({ state: "detached" });
      await page.waitForFunction((id) => document.activeElement?.getAttribute("data-character-id") === id, characterId);
      await page.waitForFunction(() => document.body.style.overflow !== "hidden");

      await card.tap();
      await page.getByTestId("global-organization-member-detail")
        .getByRole("button", { name: "關閉人物詳情", exact: true })
        .tap();
      await detail.waitFor({ state: "detached" });
      await page.waitForFunction((id) => document.activeElement?.getAttribute("data-character-id") === id, characterId);
      await page.waitForFunction(() => document.body.style.overflow !== "hidden");
    }

    const organizationOptions = page.getByTestId("global-organization-option");
    assert.ok(await organizationOptions.count() >= 30, "the world must expose at least 30 organizations");
    await page.locator('[data-testid="global-organization-option"]:not([data-organization-archetype="family"])').first().tap();
    await page.getByTestId("global-organization-roster").waitFor({ state: "visible" });
    await verifyPersonCard(page.getByTestId("global-organization-roster"), "roster");

    await page.locator('[data-testid="global-organization-option"][data-organization-archetype="family"]').first().tap();
    await page.getByTestId("global-family-genealogy").waitFor({ state: "visible" });
    await verifyPersonCard(page.getByTestId("global-family-genealogy"), "genealogy");
    await assertCleanDiagnostics("world 2 organization member details");
  });

  await check("real mobile reader keeps compact controls and readable width", async () => {
    await openFreshPage(`${baseUrl}/professional?intent=library&projectId=${encodeURIComponent(createdProjectId)}`);
    await page.getByTestId("professional-canonical-workbench").waitFor({ state: "visible" });
    const readerLink = page.getByRole("link", { name: "閱讀作品", exact: true }).first();
    const readerNavigationStartedAt = Date.now();
    try {
      await Promise.all([
        page.waitForURL(new RegExp(`/studio/read/${createdProjectId}$`, "u"), { timeout: 60_000 }),
        readerLink.tap(),
      ]);
      await page.locator(".readerShell").waitFor({ state: "visible" });
      readerStaticScriptNavigationProofs.push({
        startedAt: readerNavigationStartedAt,
        arrivedAt: Date.now(),
        destinationUrl: page.url(),
        landed: true,
      });
    } catch (error) {
      throw new Error(`READER_NAVIGATION_FAILED ${JSON.stringify({
        currentUrl: page.url(),
        pageTitle: await page.title(),
        bodyText: (await page.locator("body").innerText()).slice(0, 1_000),
        consoleErrors,
        requestFailures,
        pageErrors,
      })}`, { cause: error });
    }
    assert.equal(await page.locator("#reader-controls").count(), 0);
    await page.getByRole("button", { name: "閱讀設定" }).click();
    await page.locator("#reader-controls").waitFor({ state: "visible" });
    const readerState = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      articleRight: document.querySelector(".readerArticle")?.getBoundingClientRect().right ?? 0,
      viewport: document.documentElement.clientWidth,
      shortTargets: [...document.querySelectorAll(".readerTop a,.readerTop button,.readerControls select")]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.height < 44;
        }).length,
    }));
    assert.equal(readerState.overflow, false);
    assert.ok(readerState.articleRight <= readerState.viewport + 1);
    assert.equal(readerState.shortTargets, 0);
    await assertCleanDiagnostics("mobile reader journey", {
      allowSupersededReaderNavigationForProjectId: createdProjectId,
      allowSupersededHealthRequest: true,
      allowBoundedSharedLearningRequest: true,
      completedStaticScriptNavigationProofs: readerStaticScriptNavigationProofs,
    });
  });

  await check("story routes keep Canon read-only and return to the formal editor", async () => {
    const projectId = createdProjectId;
    assert.ok(projectId, "the created project identity must remain available");
    await openFreshPage(`${baseUrl}/studio/project/${encodeURIComponent(projectId)}/characters`);
    await page.getByTestId("story-stage-selection-page").waitFor({ state: "visible" });
    await page.getByTestId("story-stage-selector").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("story-stage-selection-page").getAttribute("data-canon-edit-surface"), "story-selection-only");
    assert.equal(await page.getByTestId("home-character-name").count(), 0);
    assert.equal(await page.getByRole("button", { name: "儲存人物", exact: true }).count(), 0);
    const worldCardLayout = await page.evaluate(() => {
      const strip = document.querySelector(".characterStageWorlds");
      const widths = [...document.querySelectorAll(".characterStageWorlds > button")]
        .map((element) => element.getBoundingClientRect().width);
      return {
        stripClientWidth: strip?.clientWidth ?? 0,
        stripScrollWidth: strip?.scrollWidth ?? 0,
        maxCardWidth: widths.length ? Math.max(...widths) : 0,
      };
    });
    assert.ok(worldCardLayout.maxCardWidth <= worldCardLayout.stripClientWidth + 1, JSON.stringify(worldCardLayout));
    assert.ok(worldCardLayout.stripScrollWidth <= worldCardLayout.stripClientWidth + 1, JSON.stringify(worldCardLayout));
    const returnLink = page.getByRole("link", { name: /全域角色、世界與記憶總編輯/u }).first();
    const returnTarget = new URL(await returnLink.getAttribute("href"), baseUrl);
    assert.equal(returnTarget.pathname, "/canon");
    assert.equal(returnTarget.searchParams.get("targetProjectId"), projectId);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/canon" && url.searchParams.get("targetProjectId") === projectId, { timeout: 60_000 }),
      returnLink.tap(),
    ]);
    await page.getByTestId("global-canon-editor").waitFor({ state: "visible" });
    await page.getByTestId("global-canon-characters").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("global-canon-target-project").inputValue(), projectId);
  });

  await check("old project-home links converge on the complete management center", async () => {
    const projectId = createdProjectId;
    assert.ok(projectId, "the created project identity must remain available");
    await page.setViewportSize(mobileViewport);
    await openFreshPage(`${baseUrl}/studio?screen=home&projectId=${encodeURIComponent(projectId)}`);
    await page.getByTestId("professional-canonical-workbench").waitFor({ state: "visible" });
    assert.equal(new URL(page.url()).pathname, "/professional");
    await assertCleanDiagnostics("legacy project-home management redirect", {
      allowCompletedLegacyRedirectForProjectId: projectId,
    });
  });

  await check("frontdoor opens the cross-project Canon editor with the selected copy target", async () => {
    const projectId = createdProjectId;
    assert.ok(projectId, "the created project identity must remain available");
    const competingProjectId = `${projectId}-newer`;
    await page.evaluate(async ({ activeProjectId, competingId }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("novel-intelligence-platform");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const original = await new Promise((resolve, reject) => {
        const request = database.transaction("projects", "readonly").objectStore("projects").get(activeProjectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!original) throw new Error("active project fixture must exist");
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("projects", "readwrite");
        transaction.objectStore("projects").put({
          ...original,
          id: competingId,
          title: "較新的非作用中作品",
          updatedAt: "9999-12-31T23:59:59.999Z",
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      localStorage.setItem("novel_p2_active_project_id", activeProjectId);
      localStorage.setItem("novel_p12_studio_state", JSON.stringify({
        activeProjectId: competingId,
        projects: [{ id: competingId, title: "較新的非作用中作品", updatedAt: "9999-12-31T23:59:59.999Z" }],
      }));
    }, { activeProjectId: projectId, competingId: competingProjectId });
    frontdoorCanonVisitStartedAt = Date.now();
    await openFreshPage(baseUrl);
    const canonEditorLink = page.getByTestId("frontdoor-canon-editor");
    await canonEditorLink.waitFor({ state: "visible" });
    await page.waitForFunction((expectedProjectId) => {
      const link = document.querySelector('[data-testid="frontdoor-canon-editor"]');
      return link instanceof HTMLAnchorElement
        && new URL(link.href).searchParams.get("targetProjectId") === expectedProjectId;
    }, projectId, { timeout: 60_000 });
    const target = new URL(await canonEditorLink.getAttribute("href"), baseUrl);
    assert.equal(target.pathname, "/canon");
    assert.equal(target.searchParams.get("targetProjectId"), projectId);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/canon" && url.searchParams.get("targetProjectId") === projectId, { timeout: 60_000 }),
      canonEditorLink.tap(),
    ]);
    await page.getByTestId("global-canon-editor").waitFor({ state: "visible" });
    await page.getByTestId("global-canon-characters").waitFor({ state: "visible" });
    assert.equal(await page.getByTestId("global-canon-target-project").inputValue(), projectId);
    frontdoorCanonEditorArrivedAt = Date.now();
    const editorViewport = await page.getByTestId("global-canon-editor").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight };
    });
    assert.ok(editorViewport.top >= 0 && editorViewport.top < editorViewport.viewportHeight, JSON.stringify(editorViewport));
    assert.ok(editorViewport.bottom > 0, JSON.stringify(editorViewport));
    await page.evaluate(async ({ activeProjectId, competingId }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("novel-intelligence-platform");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction("projects", "readwrite");
        transaction.objectStore("projects").delete(competingId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
      localStorage.setItem("novel_p2_active_project_id", activeProjectId);
      localStorage.removeItem("novel_p12_studio_state");
    }, { activeProjectId: projectId, competingId: competingProjectId });
  });

  await check("browser console has no unexpected errors or repeated native permission probes", async () => {
    await assertCleanDiagnostics("frontdoor Canon navigation", {
      allowSupersededGlobalCanonNavigationPrefetchesForProjectId: createdProjectId,
      frontdoorVisitStartedAt: frontdoorCanonVisitStartedAt,
      frontdoorEditorArrivedAt: frontdoorCanonEditorArrivedAt,
    });
  });

  console.log(JSON.stringify({
    suite: "HUMANIZED_CREATION_BROWSER",
    engineName,
    viewport: mobileViewport,
    pass: results.length,
    fail: 0,
    expectedNavigationCancellations,
    results,
  }, null, 2));
} finally {
  await context?.close();
  await browser?.close();
}
