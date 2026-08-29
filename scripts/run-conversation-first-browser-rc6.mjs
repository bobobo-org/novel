import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Rc6TestHarness, assert } from "./rc6-test-harness.mjs";

const mode = process.argv[2] ?? "all";
const explicitBaseUrl = process.env.RC6_CONVERSATION_BASE_URL?.trim();
const baseUrl = (explicitBaseUrl || "http://127.0.0.1:3136").replace(/\/$/u, "");
const harness = new Rc6TestHarness("P2.4B RC6 conversation browser gate", mode);

let serverProcess = null;
let serverOutput = "";
let browser = null;
let desktopFixture = null;
let dashboardFixture = null;
let mobileFixture = null;
let longSessionFixture = null;
let attachmentBranchFixture = null;

function captureServerOutput(chunk) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-12_000);
}

async function waitForStudio() {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (serverProcess?.exitCode !== null && serverProcess?.exitCode !== undefined) {
      throw new Error(`RC6_CONVERSATION_SERVER_EXITED:${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/studio/create`, { redirect: "manual" });
      if (response.ok) return;
    } catch {
      // The local server has not accepted connections yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`RC6_CONVERSATION_SERVER_TIMEOUT:${serverOutput}`);
}

async function startServer() {
  if (!explicitBaseUrl && process.env.RC6_CONVERSATION_START_SERVER !== "0") {
    const workerAssetPath = path.join(process.cwd(), "public", "generated", "manual-learning-worker.js");
    let workerAssetReady = false;
    try {
      const workerSource = readFileSync(workerAssetPath, "utf8");
      workerAssetReady = workerSource.includes("manual-learning-worker-protocol-v2")
        && workerSource.includes("prepare_import_file")
        && workerSource.includes("splitManualLearningDocumentSemantically");
    } catch {
      workerAssetReady = false;
    }
    if (!workerAssetReady) {
      const workerBuild = spawnSync(
        process.execPath,
        [path.join(process.cwd(), "scripts/build-manual-learning-worker.mjs")],
        {
          cwd: process.cwd(),
          env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
          encoding: "utf8",
        },
      );
      if (workerBuild.status !== 0) {
        throw new Error(
          `RC6_CONVERSATION_WORKER_BUILD_FAILED:${workerBuild.stderr || workerBuild.stdout || workerBuild.error?.message || "UNKNOWN"}`,
        );
      }
    }
    const provenance = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "scripts/generate-release-provenance.mjs")],
      {
        cwd: process.cwd(),
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        encoding: "utf8",
      },
    );
    if (provenance.status !== 0) {
      throw new Error(
        `RC6_CONVERSATION_PROVENANCE_FAILED:${provenance.stderr || provenance.stdout || provenance.error?.message || "UNKNOWN"}`,
      );
    }
    const url = new URL(baseUrl);
    serverProcess = spawn(
      process.execPath,
      [path.join(process.cwd(), "node_modules/next/dist/bin/next"), "dev", "-p", url.port],
      {
        cwd: process.cwd(),
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    serverProcess.stdout?.on("data", captureServerOutput);
    serverProcess.stderr?.on("data", captureServerOutput);
  }
  await waitForStudio();
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    try {
      return await chromium.launch({ channel: "msedge", headless: true });
    } catch {
      throw error;
    }
  }
}

async function ensureDesktopSidebarOpen(page) {
  const sidebar = page.getByLabel("小說專案欄");
  await page.waitForTimeout(350);
  if (await sidebar.getAttribute("data-open") !== "true") {
    await page.getByTestId("conversation-sidebar-toggle").click();
  }
  await page.waitForFunction(() => document.querySelector('aside[aria-label="小說專案欄"]')?.getAttribute("data-open") === "true");
  await sidebar.waitFor({ state: "visible" });
  await page.waitForTimeout(350);
  return sidebar;
}

async function createProject(page, title) {
  await page.goto(`${baseUrl}/studio/create`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("canonical-create-flow").waitFor({ state: "visible", timeout: 90_000 });
  await page.getByTestId("p2-project-title").fill(title);
  await page.locator('[data-topic-id="classic-topic-009"]').click();

  const generalMode = page.getByTestId("create-play-mode-general");
  const choiceMode = page.getByTestId("create-play-structure-choice");
  const creationAssistant = page.locator(".p2CreationAssistant");
  const assistantButton = creationAssistant.getByTestId("create-ai-story-seed");
  const assistantStatus = creationAssistant.getByTestId("create-ai-story-seed-status");

  assert.equal(await generalMode.getAttribute("aria-pressed"), "false");
  assert.equal(await choiceMode.getAttribute("aria-pressed"), "false");
  assert.equal(await assistantButton.isEnabled(), true, "AI seed must be available before a play mode is chosen");

  await assistantButton.click();
  await assistantStatus.waitFor({ state: "visible", timeout: 10_000 });
  assert.ok(
    (await assistantStatus.innerText()).trim(),
    "AI seed progress must render beside the assistant action",
  );
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="create-ai-story-seed"]');
    const status = document.querySelector('[data-testid="create-ai-story-seed-status"]');
    return Boolean(
      button
      && !button.hasAttribute("disabled")
      && /已填入|裝置後備[^。]*填入/u.test(status?.textContent ?? ""),
    );
  }, undefined, { timeout: 90_000 });

  const completedStatus = (await assistantStatus.innerText()).trim();
  assert.match(completedStatus, /已填入|裝置後備[^。]*填入/u);
  assert.equal(await generalMode.getAttribute("aria-pressed"), "false");
  assert.equal(await choiceMode.getAttribute("aria-pressed"), "false");
  assert.equal(
    await page.getByTestId("create-three-choice-subtypes").count(),
    0,
    "AI assistance must not choose a play structure or subtype for the author",
  );

  const assistedSeedBeforeMode = {
    fields: (await page.locator(".p2SeedPreview dd").allTextContents()).map((value) => value.trim()),
    cast: (await page.locator(".p2CastPreview article").allTextContents()).map((value) => value.trim()),
  };
  assert.ok(
    assistedSeedBeforeMode.fields.length >= 6
      && assistedSeedBeforeMode.fields.every(Boolean),
    "AI or the explicit device fallback must complete the visible story seed",
  );
  assert.ok(
    assistedSeedBeforeMode.cast.length >= 5
      && assistedSeedBeforeMode.cast.every(Boolean),
    "AI or the explicit device fallback must complete the visible core cast",
  );

  await generalMode.click();
  assert.equal(await generalMode.getAttribute("aria-pressed"), "true");
  assert.equal(await choiceMode.getAttribute("aria-pressed"), "false");
  const assistedSeedAfterMode = {
    fields: (await page.locator(".p2SeedPreview dd").allTextContents()).map((value) => value.trim()),
    cast: (await page.locator(".p2CastPreview article").allTextContents()).map((value) => value.trim()),
  };
  assert.deepEqual(
    assistedSeedAfterMode,
    assistedSeedBeforeMode,
    "the author's later play-mode choice must retain the completed assisted seed and cast",
  );

  const stepBar = page.locator(".p2StepBar");
  const next = page.locator(".p2CreatePanel > footer button.gold");
  for (let expectedStep = 2; expectedStep <= 3; expectedStep += 1) {
    const previous = await stepBar.getAttribute("aria-label");
    await next.click();
    await page.waitForFunction(
      ({ selector, previous }) => document.querySelector(selector)?.getAttribute("aria-label") !== previous,
      { selector: ".p2StepBar", previous },
    );
    assert.match(await stepBar.getAttribute("aria-label") ?? "", new RegExp(String(expectedStep), "u"));
  }
  const familyCandidates = page.getByTestId("creation-stage-family-candidates");
  await familyCandidates.waitFor({ state: "visible" });
  await familyCandidates.getByRole("button", { name: /選擇這組上場群像/u }).first().click();
  await page.locator(".p2FoundationReady").waitFor({ state: "visible" });
  await next.click();
  const primary = page.locator(".p2CreateSuccess a.primaryAction");
  await primary.waitFor({ state: "visible", timeout: 90_000 });
  const href = await primary.getAttribute("href");
  assert.match(href ?? "", /^\/studio\/project\/[^/]+\/chat$/u);
  const projectId = href.split("/")[3];
  await primary.click();
  await page.getByTestId("conversation-first-workspace").waitFor({ state: "visible", timeout: 90_000 });
  await page.getByLabel("小說專案訊息").waitFor({ state: "visible" });
  await waitUntilIdle(page);
  return { projectId, href };
}

async function makeFixture(viewport, title) {
  const context = await browser.newContext({
    viewport,
    locale: "zh-TW",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const created = await createProject(page, title);
  return { context, page, pageErrors, ...created };
}

async function lockFixtureToRpg(page, projectId) {
  await page.evaluate(async ({ projectId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("storyStates", "readwrite");
    const store = transaction.objectStore("storyStates");
    const states = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const state = states.find((item) => item.projectId === projectId && !item.deletedAt);
    if (!state) throw new Error("RC6_DASHBOARD_STORY_STATE_MISSING");
    store.put({
      ...state,
      worldFlags: { ...state.worldFlags, "story.playMode": "rpg" },
      revision: state.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, { projectId });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-first-workspace").waitFor();
  await waitUntilIdle(page);
}

async function getDesktopFixture() {
  desktopFixture ??= await makeFixture(
    { width: 1440, height: 900 },
    `RC6 對話工作區 ${crypto.randomUUID().slice(0, 8)}`,
  );
  return desktopFixture;
}

async function getDashboardFixture() {
  if (dashboardFixture) return dashboardFixture;
  dashboardFixture = await makeFixture(
    { width: 1440, height: 900 },
    `RC6 狀態儀表板 ${crypto.randomUUID().slice(0, 8)}`,
  );
  await lockFixtureToRpg(dashboardFixture.page, dashboardFixture.projectId);
  return dashboardFixture;
}

async function getMobileFixture() {
  mobileFixture ??= await makeFixture(
    { width: 390, height: 844 },
    `RC6 手機對話 ${crypto.randomUUID().slice(0, 8)}`,
  );
  return mobileFixture;
}

async function getLongSessionFixture() {
  longSessionFixture ??= await makeFixture(
    { width: 1440, height: 900 },
    `RC6 長對話 ${crypto.randomUUID().slice(0, 8)}`,
  );
  return longSessionFixture;
}

async function getAttachmentBranchFixture() {
  attachmentBranchFixture ??= await makeFixture(
    { width: 1440, height: 900 },
    `RC6 附件分支 ${crypto.randomUUID().slice(0, 8)}`,
  );
  return attachmentBranchFixture;
}

async function seedLongSession(page, projectId, messageCount = 1_000) {
  return page.evaluate(async ({ projectId, messageCount }) => {
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sha256 = async (value) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(value.normalize("NFKC")),
      );
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessionId = sessionStorage.getItem(`novel:conversation-active:${projectId}`);
    if (!sessionId) throw new Error("RC6_ACTIVE_SESSION_MISSING");
    const project = await requestResult(
      database.transaction("projects", "readonly").objectStore("projects").get(projectId),
    );
    const chapters = await requestResult(
      database.transaction("chapters", "readonly").objectStore("chapters").index("projectId").getAll(projectId),
    );
    const chapter = chapters.find((candidate) => candidate.id === project.activeChapterId) ?? chapters.at(-1);
    if (!chapter) throw new Error("RC6_ACTIVE_CHAPTER_MISSING");
    const candidateArtifactId = "rc6-long-candidate-artifact";
    const candidateInvocationId = "rc6-long-candidate-invocation";
    const candidateMessageId = `rc6-long-message-${String(messageCount - 1).padStart(4, "0")}`;
    const candidateContent = "RC6 長會話核准候選：城門在雨夜開啟，正式正文只應在作者採用後改版。";
    const candidateDigest = await sha256(candidateContent);
    const contextDigest = await sha256("RC6 long-session candidate context");
    const inputDigest = await sha256("RC6 long-session candidate input");
    const baseTime = Date.now() - messageCount * 1_000;
    const transaction = database.transaction(
      ["conversationMessages", "conversationArtifacts", "conversationToolInvocations"],
      "readwrite",
    );
    const messageStore = transaction.objectStore("conversationMessages");
    for (let index = 0; index < messageCount; index += 1) {
      const id = `rc6-long-message-${String(index).padStart(4, "0")}`;
      const createdAt = new Date(baseTime + index * 1_000).toISOString();
      const isCandidateMessage = index === messageCount - 1;
      const isCandidateRequest = index === messageCount - 2;
      const content = isCandidateMessage
        ? "RC6 長會話候選已完成，等待作者採用。"
        : isCandidateRequest
          ? "查看狀態"
          : `長對話壓力測試訊息 ${index}`;
      messageStore.put({
        schemaVersion: "novel-domain-v1",
        conversationSchemaVersion: "conversation-message-v1",
        id,
        projectId,
        sessionId,
        role: index % 2 ? "assistant" : "user",
        content,
        contentDigest: await sha256(content),
        status: "completed",
        parentMessageId: index ? `rc6-long-message-${String(index - 1).padStart(4, "0")}` : null,
        sourceMessageId: index > 3 && index % 97 === 0
          ? `rc6-long-message-${String(index - 3).padStart(4, "0")}`
          : null,
        candidateIds: isCandidateMessage ? [candidateArtifactId] : [],
        toolInvocationIds: isCandidateMessage ? [candidateInvocationId] : [],
        attachmentIds: [],
        completedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        revision: 1,
        source: "user",
        provenance: { source: "user", actor: "local-user", createdAt },
        deletedAt: null,
        parentRevision: null,
        migrationVersion: null,
      });
    }
    const candidateCreatedAt = new Date(baseTime + (messageCount - 1) * 1_000).toISOString();
    transaction.objectStore("conversationArtifacts").put({
      schemaVersion: "novel-domain-v1",
      conversationSchemaVersion: "conversation-artifact-v1",
      id: candidateArtifactId,
      projectId,
      sessionId,
      sourceMessageId: candidateMessageId,
      artifactType: "novel",
      targetStore: "chapters",
      targetRecordId: chapter.id,
      sourceRevision: chapter.revision,
      candidateContent,
      candidateDigest,
      status: "candidate",
      approvedAt: null,
      approvedRevision: null,
      createdAt: candidateCreatedAt,
      updatedAt: candidateCreatedAt,
      revision: 1,
      source: "ai_candidate",
      provenance: { source: "ai_candidate", actor: "rc6-browser-fixture", createdAt: candidateCreatedAt },
      deletedAt: null,
      parentRevision: null,
      migrationVersion: null,
    });
    transaction.objectStore("conversationToolInvocations").put({
      schemaVersion: "novel-domain-v1",
      conversationSchemaVersion: "conversation-tool-invocation-v1",
      id: candidateInvocationId,
      projectId,
      sessionId,
      messageId: candidateMessageId,
      taskId: "rc6-long-candidate-task",
      toolId: "conversation-agent-tool:rc6-fixture",
      taskType: "chapter.continue",
      inputDigest,
      contextDigest,
      status: "completed",
      startedAt: candidateCreatedAt,
      completedAt: candidateCreatedAt,
      actualExecutor: "browser-main-thread",
      modelId: null,
      modelDigest: null,
      executionReceipt: {
        receiptId: "rc6-long-candidate-receipt",
        modelId: null,
        modelDigest: null,
        providerRunId: null,
        contextDigest,
        outputDigest: candidateDigest,
        externalRequest: false,
        dataLeftDevice: false,
        latencyMs: 1,
      },
      externalRequest: false,
      dataLeftDevice: false,
      canonicalMutationCount: 0,
      safeProgress: { stage: "completed", percent: 100, message: "RC6 fixture completed" },
      safeErrorCode: null,
      createdAt: candidateCreatedAt,
      updatedAt: candidateCreatedAt,
      revision: 1,
      source: "ai_candidate",
      provenance: { source: "ai_candidate", actor: "rc6-browser-fixture", createdAt: candidateCreatedAt },
      deletedAt: null,
      parentRevision: null,
      migrationVersion: null,
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    return {
      sessionId,
      projectRevision: project.revision,
      chapterId: chapter.id,
      chapterRevision: chapter.revision,
      candidateArtifactId,
      candidateInvocationId,
      candidateMessageId,
    };
  }, { projectId, messageCount });
}

async function inspectLongSessionState(page, projectId, fixture) {
  return page.evaluate(async ({ projectId, fixture }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const listForProject = (store) => requestResult(
      database.transaction(store, "readonly").objectStore(store).index("projectId").getAll(projectId),
    );
    const getRecord = (store, id) => requestResult(
      database.transaction(store, "readonly").objectStore(store).get(id),
    );
    const [sessions, messages, sourceMessage, artifact, invocation, approvals, chapter, project] = await Promise.all([
      listForProject("conversationSessions"),
      listForProject("conversationMessages"),
      getRecord("conversationMessages", "rc6-long-message-0998"),
      getRecord("conversationArtifacts", fixture.candidateArtifactId),
      getRecord("conversationToolInvocations", fixture.candidateInvocationId),
      listForProject("conversationApprovalTransactions"),
      getRecord("chapters", fixture.chapterId),
      getRecord("projects", projectId),
    ]);
    database.close();
    const liveSessions = sessions.filter((session) => session.status !== "deleted" && !session.deletedAt);
    const summarizedSessions = liveSessions.map((session) => {
      const sessionMessages = messages
        .filter((message) => message.sessionId === session.id && !message.deletedAt)
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
      const first = sessionMessages.at(0) ?? null;
      const last = sessionMessages.at(-1) ?? null;
      return {
        id: session.id,
        title: session.title,
        parentSessionId: session.parentSessionId,
        branchedFromMessageId: session.branchedFromMessageId,
        messageCount: sessionMessages.length,
        firstMessageId: first?.id ?? null,
        firstSourceMessageId: first?.sourceMessageId ?? null,
        lastMessageId: last?.id ?? null,
        lastSourceMessageId: last?.sourceMessageId ?? null,
        lastContent: last?.content ?? null,
        lastCandidateIds: last?.candidateIds ?? [],
        tail: sessionMessages.slice(-3).map((message) => ({
          id: message.id,
          role: message.role,
          status: message.status,
          parentMessageId: message.parentMessageId,
          sourceMessageId: message.sourceMessageId,
          content: message.content,
        })),
      };
    });
    return {
      activeSessionId: sessionStorage.getItem(`novel:conversation-active:${projectId}`),
      sessions: summarizedSessions,
      projectRevision: project?.revision ?? null,
      chapterRevision: chapter?.revision ?? null,
      chapterContent: chapter?.content ?? null,
      sourceMessage: sourceMessage ? {
        id: sourceMessage.id,
        content: sourceMessage.content,
        candidateIds: sourceMessage.candidateIds,
      } : null,
      artifact: artifact ? {
        id: artifact.id,
        status: artifact.status,
        sourceMessageId: artifact.sourceMessageId,
        approvedRevision: artifact.approvedRevision,
        candidateDigest: artifact.candidateDigest,
      } : null,
      invocation: invocation ? {
        id: invocation.id,
        messageId: invocation.messageId,
        outputDigest: invocation.executionReceipt?.outputDigest ?? null,
      } : null,
      approvals: approvals.map((approval) => ({
        artifactId: approval.artifactId,
        sourceMessageId: approval.sourceMessageId,
        candidateDigest: approval.candidateDigest,
        sourceRevision: approval.sourceRevision,
        resultingRevision: approval.resultingRevision,
        canonicalMutationCount: approval.canonicalMutationCount,
        status: approval.status,
      })),
    };
  }, { projectId, fixture });
}

async function waitForLongSessionState(page, projectId, fixture, predicate, description) {
  const deadline = Date.now() + 60_000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await inspectLongSessionState(page, projectId, fixture);
    if (predicate(latest)) return latest;
    await page.waitForTimeout(100);
  }
  throw new Error(`${description}: ${JSON.stringify(latest)}`);
}

async function seedAttachmentBranchSource(page, projectId) {
  return page.evaluate(async ({ projectId }) => {
    const sha256 = async (value) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessionId = sessionStorage.getItem(`novel:conversation-active:${projectId}`);
    if (!sessionId) throw new Error("RC6_ATTACHMENT_BRANCH_SESSION_MISSING");
    const sourceUserId = "rc6-attachment-branch-user";
    const sourceAssistantId = "rc6-attachment-branch-assistant";
    const sourceAttachmentId = "rc6-attachment-branch-source";
    const createdAt = new Date(Date.now() + 3_000).toISOString();
    const base = {
      schemaVersion: "novel-domain-v1",
      projectId,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
      source: "user",
      provenance: { source: "user", actor: "rc6-attachment-branch-fixture", createdAt },
      deletedAt: null,
      parentRevision: null,
      migrationVersion: null,
    };
    const userContent = "請依附件調整這一幕。";
    const assistantContent = "原對話中的附件分析候選。";
    const transaction = database.transaction(
      ["conversationMessages", "conversationAttachments"],
      "readwrite",
    );
    transaction.objectStore("conversationAttachments").put({
      ...base,
      id: sourceAttachmentId,
      conversationSchemaVersion: "conversation-attachment-v1",
      sessionId,
      displayName: "owned-reference.txt",
      safeSourceAlias: "owned-reference.txt",
      format: "txt",
      byteLength: 2_048,
      contentHash: await sha256("attachment branch source content"),
      rightsBasis: "user_supplied_local_analysis",
      rightsEvidenceHash: await sha256("composer-local-analysis-only"),
      userConfirmedRights: true,
      rightsConfirmationSchemaVersion: "conversation-attachment-rights-confirmation-v1",
      localAnalysisOnly: true,
      rawContentRetained: false,
      parsingStatus: "completed",
      warnings: ["Safe fixture warning retained."],
    });
    transaction.objectStore("conversationMessages").put({
      ...base,
      id: sourceUserId,
      conversationSchemaVersion: "conversation-message-v1",
      sessionId,
      role: "user",
      content: userContent,
      contentDigest: await sha256(userContent.normalize("NFKC")),
      status: "completed",
      parentMessageId: null,
      sourceMessageId: null,
      candidateIds: [],
      toolInvocationIds: [],
      attachmentIds: [sourceAttachmentId],
      completedAt: createdAt,
    });
    transaction.objectStore("conversationMessages").put({
      ...base,
      id: sourceAssistantId,
      conversationSchemaVersion: "conversation-message-v1",
      sessionId,
      role: "assistant",
      content: assistantContent,
      contentDigest: await sha256(assistantContent.normalize("NFKC")),
      status: "completed",
      parentMessageId: sourceUserId,
      sourceMessageId: null,
      candidateIds: [],
      toolInvocationIds: [],
      attachmentIds: [],
      completedAt: createdAt,
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    return { sessionId, sourceUserId, sourceAssistantId, sourceAttachmentId, userContent };
  }, { projectId });
}

async function inspectAttachmentBranchState(page, projectId) {
  return page.evaluate(async ({ projectId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const listForProject = (store) => requestResult(
      database.transaction(store, "readonly").objectStore(store).index("projectId").getAll(projectId),
    );
    const [sessions, messages, attachments] = await Promise.all([
      listForProject("conversationSessions"),
      listForProject("conversationMessages"),
      listForProject("conversationAttachments"),
    ]);
    database.close();
    const liveSessions = sessions.filter((session) => session.status !== "deleted" && !session.deletedAt);
    return {
      activeSessionId: sessionStorage.getItem(`novel:conversation-active:${projectId}`),
      sessions: liveSessions.map((session) => ({
        id: session.id,
        parentSessionId: session.parentSessionId,
        messages: messages.filter((message) => message.sessionId === session.id && !message.deletedAt),
        attachments: attachments.filter((attachment) => attachment.sessionId === session.id && !attachment.deletedAt),
      })),
    };
  }, { projectId });
}

async function waitUntilIdle(page) {
  await page.waitForFunction(() => {
    const composer = document.querySelector('textarea[aria-label="小說專案訊息"]');
    return composer instanceof HTMLTextAreaElement && !composer.disabled;
  });
}

async function sendLocalStatusQuery(page) {
  const composer = page.getByLabel("小說專案訊息");
  await composer.fill("查看狀態");
  await composer.press("Enter");
  await page.locator('article[data-role="user"]').filter({ hasText: "查看狀態" }).last()
    .waitFor({ state: "visible" });
  const dashboard = page.getByTestId("chat-detailed-dashboard");
  await dashboard.waitFor({ state: "visible" });
  await waitUntilIdle(page);
  return dashboard;
}

async function seedRpgPresentationFixture(page, projectId) {
  await page.evaluate(async ({ projectId }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessionId = sessionStorage.getItem(`novel:conversation-active:${projectId}`);
    if (!sessionId) throw new Error("RC6_ACTIVE_SESSION_MISSING");
    const now = new Date(Date.now() + 2_000).toISOString();
    const messageId = crypto.randomUUID();
    const artifactId = crypto.randomUUID();
    const base = {
      schemaVersion: "novel-domain-v1",
      projectId,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      source: "ai_candidate",
      provenance: { source: "ai_candidate", actor: "local-rule", createdAt: now },
      deletedAt: null,
      parentRevision: null,
      migrationVersion: null,
    };
    const choices = [
      { key: "A", strategyLabel: "穩健／觀察", title: "先看清局勢", description: "壓低聲息，確認出口與敵人的真正意圖。", consequence: "風險較低，但可能錯過先機。" },
      { key: "B", strategyLabel: "資源／關係", title: "借盟友之手", description: "以既有信任換取情報與一條安全退路。", consequence: "關係加深，也會欠下一份人情。" },
      { key: "C", strategyLabel: "高風險／突破", title: "正面破局", description: "趁敵人尚未合圍，直接奪取主動權。", consequence: "可能一舉翻盤，也可能立刻受創。" },
    ];
    const envelope = {
      schemaVersion: "conversation-rpg-choices-v1",
      chapterId: "rc6-browser-fixture-chapter",
      chapterRevision: 1,
      storyStateRevision: 1,
      plan: {
        schemaVersion: "rpg-chat-turn-v1",
        choices,
        taskId: crypto.randomUUID(),
        candidateId: crypto.randomUUID(),
        contentDigest: "a".repeat(64),
        model: "fixture-local-model",
        modelDigest: "b".repeat(64),
        actualExecutor: "fixture-render-only",
        executionReceipt: null,
        contextDigest: "c".repeat(64),
        canonicalMutationCount: 0,
        dataLeftDevice: false,
        externalRequest: false,
      },
    };
    const paragraphs = Array.from({ length: 10 }, (_, index) => (
      `第${index + 1}段，夜雨敲在青瓦上，明檀循著燈影走進長廊。她聽見門後有人壓低聲音交換密令，便停下腳步，示意同伴守住退路。冷風穿過衣袖，帶來藥香與鐵鏽味；下一步若選錯，整座坊市都會驚醒。`
    ));
    const candidateContent = JSON.stringify({
      schemaVersion: "conversation-rpg-candidate-v1",
      candidate: {
        schemaVersion: "rpg-chat-turn-v1",
        story: paragraphs.join("\n\n"),
        outcomeLines: ["取得敵方暗號", "盟友警戒提升", "下一回合仍待選擇"],
      },
    });
    const transaction = database.transaction(
      ["conversationMessages", "conversationArtifacts"],
      "readwrite",
    );
    transaction.objectStore("conversationMessages").put({
      ...base,
      id: messageId,
      conversationSchemaVersion: "conversation-message-v1",
      sessionId,
      role: "assistant",
      content: `[[NOVEL_RPG_CHOICES_V1]]\n${JSON.stringify(envelope)}`,
      contentDigest: "d".repeat(64),
      status: "completed",
      parentMessageId: null,
      sourceMessageId: null,
      candidateIds: [artifactId],
      toolInvocationIds: [],
      attachmentIds: [],
      completedAt: now,
    });
    transaction.objectStore("conversationArtifacts").put({
      ...base,
      id: artifactId,
      conversationSchemaVersion: "conversation-artifact-v1",
      sessionId,
      sourceMessageId: messageId,
      artifactType: "rpg",
      targetStore: "chapters",
      targetRecordId: "rc6-browser-fixture-chapter",
      sourceRevision: 1,
      candidateContent,
      candidateDigest: "e".repeat(64),
      status: "candidate",
      approvedAt: null,
      approvedRevision: null,
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, { projectId });
}

harness.test("browser", "route and component source expose the complete conversation-first contract", () => {
  const pageSource = readFileSync("app/studio/project/[projectId]/chat/page.tsx", "utf8");
  const handoffSource = readFileSync(
    "app/studio/project/[projectId]/chat/conversation-handoff-workspace.tsx",
    "utf8",
  );
  const workspaceSource = readFileSync("app/studio/project/[projectId]/chat/conversation-workspace.tsx", "utf8");
  const componentSource = [
    "conversation-workspace-view.tsx",
    "conversation-shell.tsx",
    "session-sidebar.tsx",
    "message-timeline.tsx",
    "message-row.tsx",
    "message-composer.tsx",
    "candidate-card.tsx",
    "rpg-choice-card.tsx",
    "rpg-turn-card.tsx",
    "artifact-drawer.tsx",
  ].map((file) => readFileSync(`app/studio/project/[projectId]/chat/components/${file}`, "utf8")).join("\n");
  const hookSource = [
    "use-conversation-operation.ts",
    "use-conversation-attachments.ts",
    "use-conversation-rpg.ts",
    "use-conversation-approval.ts",
    "use-conversation-branch.ts",
    "use-conversation-session.ts",
    "use-conversation-learning-loader.ts",
  ].map((file) => readFileSync(`app/studio/project/[projectId]/chat/hooks/${file}`, "utf8")).join("\n");
  const uiSource = `${workspaceSource}\n${componentSource}`;
  const operationSource = `${workspaceSource}\n${hookSource}`;
  const attachmentWorkerSource = readFileSync("lib/novel-ai/web/manual-learning-worker-client.ts", "utf8");
  const cssSource = readFileSync("app/studio/project/[projectId]/chat/conversation.module.css", "utf8");
  const manualLearningGateSource = readFileSync("scripts/run-rc6-manual-learning.mjs", "utf8");
  const browserRunnerSource = readFileSync("scripts/run-conversation-first-browser-rc6.mjs", "utf8");
  assert.match(pageSource, /ConversationHandoffWorkspace/u);
  assert.match(handoffSource, /ConversationWorkspace/u);
  assert.match(
    browserRunnerSource,
    /scripts\/generate-release-provenance\.mjs/u,
    "a clean checkout must generate ephemeral release provenance before starting Next",
  );
  for (const contract of [
    "conversation-first-workspace",
    "＋ 新對話",
    "搜尋對話",
    "重新命名",
    "封存",
    "刪除",
    "小說專案訊息",
    "閉端 AI 自動協調器",
    "停止生成",
    "重新產生",
    "latestInvocation?.actualExecutor",
    "dataLeftDevice",
    "result.toolExecutions",
    "conversation-agent-tool:",
    "toolInvocations:",
    "rpg-inline-choices",
    "choiceOutcome",
    "rpgOutcomeSummary",
    "修改後採用",
    "查看 Diff",
    "比較候選",
  ]) assert(uiSource.includes(contract), `missing UI contract: ${contract}`);
  assert(
    workspaceSource.includes('actualExecutor: "browser-main-thread"'),
    "non-parser repository tools must preserve their real browser main-thread executor",
  );
  assert.match(operationSource, /taskType: "attachment\.parse\.batch"[\s\S]*?actualExecutor: "browser-worker"/u);
  assert.match(workspaceSource, /taskType: "learning\.import\.atomic"[\s\S]*?actualExecutor: "browser-worker"/u);
  assert.match(workspaceSource, /taskType: "learning\.import\.resume"[\s\S]*?actualExecutor: "browser-worker"/u);
  assert.match(
    attachmentWorkerSource,
    /new\s+Worker\s*\(/u,
    "browser-worker receipts require a real Worker product call site",
  );
  assert.match(
    attachmentWorkerSource,
    /\/generated\/manual-learning-worker\.js/u,
    "the parser Worker must be fetched only from the demand-loaded public asset",
  );
  assert.doesNotMatch(
    attachmentWorkerSource,
    /manual-learning\.worker\.ts["'],\s*import\.meta\.url/u,
    "the Chat route must not register the parser Worker as a Turbopack entry chunk",
  );
  assert.doesNotMatch(
    manualLearningGateSource,
    /actualExecutor:\s*"browser-worker"/u,
    "manual-learning Gate fixtures must not claim a Worker that did not execute",
  );
  assert.match(
    manualLearningGateSource,
    /actualExecutor:\s*"browser-main-thread"/u,
    "manual-learning Gate fixtures preserve the direct parser executor truth",
  );
  const importInvocationIndex = workspaceSource.indexOf('taskType: "learning.import.atomic"');
  const importStartIndex = workspaceSource.indexOf("started = await learning.start(");
  assert(importInvocationIndex >= 0 && importInvocationIndex < importStartIndex, "learning.start must run inside a persisted invocation");
  const resumeFunctionIndex = workspaceSource.indexOf("async function resumeAtomicLearningImport");
  const resumeInvocationIndex = workspaceSource.indexOf('taskType: "learning.import.resume"', resumeFunctionIndex);
  const resumeLookupIndex = workspaceSource.indexOf(
    'const importSession = await repository.get<LearningImportSession>',
    resumeFunctionIndex,
  );
  assert(
    resumeInvocationIndex >= 0 && resumeInvocationIndex < resumeLookupIndex,
    "learning Resume validation errors must terminate a persisted invocation",
  );
  for (const exactExecutorPropagation of [
    "actualExecutor: plan.actualExecutor",
    "actualExecutor: candidate.actualExecutor",
    "actualExecutor: result.candidate.actualExecutor",
  ]) {
    assert(operationSource.includes(exactExecutorPropagation), `missing exact executor propagation: ${exactExecutorPropagation}`);
  }
  assert.doesNotMatch(
    operationSource,
    /actualExecutor:\s*(?:plan|candidate)\.actualExecutor\.includes\("ollama"\)/u,
    "RPG receipts must not collapse the actual executor into a generic backend",
  );
  assert.doesNotMatch(
    operationSource,
    /actualExecutor:\s*result\.candidate\.backendId/u,
    "Closed Agent receipts must use execution truth rather than the planned backend",
  );
  assert.match(uiSource, /type="file"\s+multiple\s+accept="\.txt,\.md,\.markdown,\.html,\.htm,\.json,\.pdf,\.docx"/u);
  assert.doesNotMatch(uiSource, /ChatGPT|OpenAI/u);
  assert.doesNotMatch(uiSource, /改用 Local Ollama|連接 Private AI Hub/u);
  assert.doesNotMatch(uiSource, /\?backend=/u);
  assert.match(cssSource, /env\(safe-area-inset-bottom\)/u);
  assert.match(cssSource, /@media \(max-width: 900px\)/u);
  assert.match(cssSource, /\.artifactDrawer\s*\{[\s\S]*?position:\s*fixed/u);
  assert.match(cssSource, /\.choices\s*\{\s*grid-template-columns:\s*1fr/u);
});

harness.test("browser", "desktop creates a project and lands on a usable chat workspace", async () => {
  const { page, href, pageErrors } = await getDesktopFixture();
  assert.equal(new URL(page.url()).pathname, href);
  const sidebar = page.getByLabel("小說專案欄");
  const sidebarToggle = page.getByTestId("conversation-sidebar-toggle");
  assert.equal(await sidebar.isVisible(), false);
  assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await sidebarToggle.getAttribute("aria-controls"), "conversation-session-sidebar");
  const mainWidthBefore = await page.locator("main").evaluate((element) => element.getBoundingClientRect().width);
  await sidebarToggle.click();
  await sidebar.waitFor({ state: "visible" });
  assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "true");
  const sidebarBox = await sidebar.boundingBox();
  assert(sidebarBox && sidebarBox.width >= 300 && sidebarBox.width <= 321, JSON.stringify(sidebarBox));
  const mainWidthWhileOpen = await page.locator("main").evaluate((element) => element.getBoundingClientRect().width);
  assert.equal(mainWidthWhileOpen, mainWidthBefore, "overlay sidebar must not shrink the reading stage");
  await page.getByTestId("conversation-sidebar-close").click();
  await sidebar.waitFor({ state: "hidden" });
  assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.getByLabel("作品結果抽屜").count(), 0);
  assert.equal(await page.getByLabel("小說專案訊息").isEnabled(), true);
  const workspaceText = await page.getByTestId("conversation-first-workspace").innerText();
  assert.match(workspaceText, /閉端 AI 自動協調器/u);
  assert.doesNotMatch(workspaceText, /改用 Local Ollama|連接 Private AI Hub/u);
  assert.equal(await page.locator('a[href*="backend="]').count(), 0);
  assert.deepEqual(pageErrors, []);
});

harness.test("browser", "desktop A/B/C uses the wide luxury stage with readable type", async () => {
  const { page, projectId, href, pageErrors } = await getDesktopFixture();
  await page.goto(`${baseUrl}${href}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await seedRpgPresentationFixture(page, projectId);
  await page.reload({ waitUntil: "domcontentloaded" });
  const choices = page.getByTestId("rpg-inline-choices").locator("button");
  await choices.first().waitFor({ state: "visible" });
  assert.equal(await choices.count(), 3);
  const presentation = await page.getByTestId("rpg-inline-choices").evaluate((element) => {
    const container = element.getBoundingClientRect();
    const cards = [...element.querySelectorAll("button")].map((button) => {
      const box = button.getBoundingClientRect();
      const paragraph = button.querySelector("p");
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        width: box.width,
        height: box.height,
        bodyFontSize: paragraph ? Number.parseFloat(getComputedStyle(paragraph).fontSize) : 0,
      };
    });
    return {
      containerWidth: container.width,
      cards,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  assert.equal(presentation.overflow, false);
  assert(presentation.containerWidth >= 1_000, JSON.stringify(presentation));
  assert(presentation.cards.every((card) => card.width >= 300 && card.height >= 360 && card.bodyFontSize >= 16));
  assert(presentation.cards[1].left >= presentation.cards[0].right);
  assert(presentation.cards[2].left >= presentation.cards[1].right);
  assert(Math.abs(presentation.cards[0].top - presentation.cards[2].top) <= 1);
  assert.deepEqual(pageErrors, []);
});

harness.test("browser", "manual-learning parser is fetched as a real Worker only after interaction", async () => {
  const { page } = await getDesktopFixture();
  const workerPath = "/generated/manual-learning-worker.js";
  const workerUrl = `${workerPath}?v=manual-learning-worker-protocol-v2`;
  const workerRequests = [];
  const recordWorkerRequest = (request) => {
    if (new URL(request.url()).pathname === workerPath) workerRequests.push(request.url());
  };
  page.on("request", recordWorkerRequest);
  try {
    const result = await page.evaluate(async (path) => {
      const requestId = `rc6-public-worker:${crypto.randomUUID()}`;
      return new Promise((resolve, reject) => {
        const worker = new Worker(new URL(path, location.origin), {
          type: "module",
          name: "rc6-public-manual-learning-parser",
        });
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error("PUBLIC_MANUAL_LEARNING_WORKER_TIMEOUT"));
        }, 15_000);
        worker.addEventListener("error", (event) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(event.message || "PUBLIC_MANUAL_LEARNING_WORKER_FAILED"));
        }, { once: true });
        worker.addEventListener("message", (event) => {
          if (event.data.requestId !== requestId || event.data.type === "progress") return;
          clearTimeout(timeout);
          worker.terminate();
          if (event.data.protocolVersion !== "manual-learning-worker-protocol-v2") {
            reject(new Error("LEARNING_WORKER_PROTOCOL_MISMATCH"));
            return;
          }
          if (event.data.type !== "prepared") {
            reject(new Error(event.data.errorCode || event.data.type));
            return;
          }
          const prepared = event.data.prepared;
          resolve({
            type: event.data.type,
            hashLength: prepared?.extraction?.contentHash?.length ?? 0,
            chunkCount: prepared?.chunks?.length ?? 0,
            chunkHashLength: prepared?.chunks?.[0]?.contentHash?.length ?? 0,
            rawContentRetained: event.data.rawContentRetained,
            dataLeftDevice: event.data.dataLeftDevice,
          });
        });
        const content = "本機 Worker 附件解析驗證。".repeat(24);
        worker.postMessage({
          type: "prepare_import_file",
          protocolVersion: "manual-learning-worker-protocol-v2",
          requestId,
          file: new File([content], "worker-contract.txt", { type: "text/plain" }),
          maximumChunkCharacters: 285_000,
        });
      });
    }, workerUrl);
    assert.deepEqual(result, {
      type: "prepared",
      hashLength: 64,
      chunkCount: 1,
      chunkHashLength: 64,
      rawContentRetained: false,
      dataLeftDevice: false,
    });
    assert.equal(workerRequests.length, 1, "one interaction must fetch exactly one isolated Worker asset");
  } finally {
    page.off("request", recordWorkerRequest);
  }
});

harness.test("browser", "session create, rename, search, archive and delete stay in the project", async () => {
  const { page } = await getDesktopFixture();
  let sidebar = await ensureDesktopSidebarOpen(page);
  const rows = sidebar.locator("[data-active]");
  const originalCount = await rows.count();

  await sidebar.getByRole("button", { name: "＋ 新對話" }).click();
  await page.waitForFunction((count) => document.querySelectorAll('aside[aria-label="小說專案欄"] [data-active]').length === count + 1, originalCount);
  sidebar = await ensureDesktopSidebarOpen(page);
  page.once("dialog", (dialog) => dialog.accept("RC6 第二對話"));
  await sidebar.locator('[data-active="true"] button[title="重新命名"]').click();
  await sidebar.getByRole("button", { name: "RC6 第二對話" }).waitFor();
  await sidebar.getByLabel("搜尋對話").fill("第二對話");
  assert.equal(await rows.count(), 1);
  await sidebar.getByLabel("搜尋對話").fill("");

  sidebar = await ensureDesktopSidebarOpen(page);
  await sidebar.getByRole("button", { name: "＋ 新對話" }).click();
  sidebar = await ensureDesktopSidebarOpen(page);
  page.once("dialog", (dialog) => dialog.accept("RC6 待封存"));
  await sidebar.locator('[data-active="true"] button[title="重新命名"]').click();
  await sidebar.getByRole("button", { name: "RC6 待封存" }).waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await sidebar.locator('[data-active="true"] button[title="封存"]').click();
  sidebar = await ensureDesktopSidebarOpen(page);
  await sidebar.getByRole("button", { name: "顯示封存" }).click();
  const archivedRow = sidebar.locator("[data-active]").filter({ hasText: "RC6 待封存" });
  await archivedRow.waitFor();
  page.once("dialog", (dialog) => dialog.accept());
  await archivedRow.locator('button[title="刪除"]').click();
  await archivedRow.waitFor({ state: "detached" });
  assert.equal(await sidebar.getByText("RC6 待封存").count(), 0);
});

harness.test("browser", "natural-language status query expands the readable dashboard without raw JSON or a generic branch", async () => {
  const { page, pageErrors } = await getDashboardFixture();
  const sidebar = await ensureDesktopSidebarOpen(page);
  await sidebar.locator('[data-active="true"] .sessionButton, [data-active="true"] button').first().waitFor();
  const sessionCount = await sidebar.locator("[data-session-id]").count();
  await page.getByTestId("conversation-sidebar-close").click();
  await sidebar.waitFor({ state: "hidden" });
  const composer = page.getByLabel("小說專案訊息");
  await composer.fill("第一行");
  await composer.press("Shift+Enter");
  assert.match(await composer.inputValue(), /\n/u);
  const dashboard = await sendLocalStatusQuery(page);
  for (const section of ["mode", "mainline", "relationships", "inventory", "quests", "recent-history"]) {
    assert.equal(await dashboard.locator(`[data-dashboard-section="${section}"]`).count(), 1, `missing readable dashboard section: ${section}`);
  }
  assert.match(await dashboard.innerText(), /人物關係/u);
  assert.match(await dashboard.innerText(), /背包與可用資源/u);
  assert.match(await dashboard.innerText(), /任務與里程碑/u);
  assert.equal(await page.getByLabel("作品結果抽屜").count(), 0);
  assert.equal(await page.getByTestId("conversation-first-workspace").locator("pre").filter({ hasText: /protagonistStats|relationships|inventory/u }).count(), 0);
  assert.equal(await page.locator('[data-conversation-action="branch"]').count(), 0);
  assert.equal(await page.getByRole("button", { name: "另開支線" }).count(), 0);
  const statusMessage = page.locator('article[data-role="user"]').filter({ hasText: "查看狀態" }).last();
  assert.equal(await statusMessage.getByRole("button", { name: "修改此訊息（保留原文）" }).count(), 1);
  assert.equal(await sidebar.locator("[data-session-id]").count(), sessionCount, "a read-only status query must not create another conversation");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-first-workspace").waitFor();
  await page.locator('article[data-role="user"]').filter({ hasText: "查看狀態" }).waitFor();
  assert.equal(await page.locator('article[data-role="user"]').filter({ hasText: "查看狀態" }).count(), 1);
  assert.equal(await page.locator('[data-conversation-action="branch"]').count(), 0);
  assert.equal(await page.getByLabel("作品結果抽屜").count(), 0);
  assert.equal(await composer.inputValue(), "");
  assert.deepEqual(pageErrors, []);
});

harness.test("browser", "URL prompt executes once, clears itself, and never remains as a composer prefill", async () => {
  const { page, href, pageErrors } = await getDashboardFixture();
  const prompt = "查看目前狀態與資源。";
  await page.goto(`${baseUrl}${href}?prompt=${encodeURIComponent(prompt)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  const promptedMessage = page.locator('article[data-role="user"]').filter({ hasText: prompt });
  await promptedMessage.waitFor({ state: "visible" });
  await page.getByTestId("chat-detailed-dashboard").waitFor({ state: "visible" });
  await waitUntilIdle(page);
  assert.equal(await promptedMessage.count(), 1);
  assert.equal(new URL(page.url()).searchParams.has("prompt"), false);
  assert.equal(await page.getByLabel("小說專案訊息").inputValue(), "");
  assert.equal(await page.getByLabel("作品結果抽屜").count(), 0);
  assert.equal(await page.locator('[data-conversation-action="branch"]').count(), 0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("conversation-first-workspace").waitFor();
  await waitUntilIdle(page);
  assert.equal(await page.locator('article[data-role="user"]').filter({ hasText: prompt }).count(), 1, "reload must not execute the consumed URL prompt again");
  assert.equal(await page.getByLabel("小說專案訊息").inputValue(), "");
  assert.deepEqual(pageErrors, []);
});

harness.test("browser", "project tools preserve the selected project and active subview", async () => {
  const { page, projectId, pageErrors } = await getDesktopFixture();
  const projectPrefix = `/studio/project/${projectId}`;

  await page.goto(`${baseUrl}${projectPrefix}/author-tools`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.getByRole("heading", { name: "研究與作者輔助", level: 1 }).waitFor();
  await page.getByRole("status").filter({ hasText: /已載入/u }).waitFor({ timeout: 90_000 });
  await page.getByRole("button", { name: /續寫接力提示/u }).click();
  await page.waitForURL((url) => (
    url.pathname === `${projectPrefix}/author-tools`
    && url.searchParams.get("tool") === "relay"
  ));
  assert.equal(await page.getByRole("heading", { name: "續寫接力提示", level: 2 }).isVisible(), true);

  const projectTools = page.locator("details.p2ProjectTools");
  if (!await projectTools.evaluate((element) => element.open)) {
    await projectTools.locator("summary").click();
  }
  const activeAuthorToolsLink = page.getByRole("link", { name: /研究與作者工具/u });
  assert.match(await activeAuthorToolsLink.getAttribute("href") ?? "", /\?tool=relay$/u);
  await activeAuthorToolsLink.click();
  await page.waitForURL((url) => (
    url.pathname === `${projectPrefix}/author-tools`
    && url.searchParams.get("tool") === "relay"
  ));
  assert.equal(await page.getByRole("heading", { name: "續寫接力提示", level: 2 }).isVisible(), true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "研究與作者輔助", level: 1 }).waitFor();
  await page.getByRole("status").filter({ hasText: /已載入/u }).waitFor({ timeout: 90_000 });
  await page.waitForURL((url) => (
    url.pathname === `${projectPrefix}/author-tools`
    && url.searchParams.get("tool") === "relay"
  ));
  assert.equal(await page.getByRole("heading", { name: "續寫接力提示", level: 2 }).isVisible(), true);
  assert.equal(
    await page.getByRole("button", { name: /續寫接力提示/u }).getAttribute("aria-pressed"),
    "true",
  );
  if (!await projectTools.evaluate((element) => element.open)) {
    await projectTools.locator("summary").click();
  }
  assert.match(await activeAuthorToolsLink.getAttribute("href") ?? "", /\?tool=relay$/u);

  if (!await projectTools.evaluate((element) => element.open)) {
    await projectTools.locator("summary").click();
  }
  await page.getByRole("link", { name: /人物與世界/u }).click({ noWaitAfter: true });
  await page.waitForURL((url) => (
    url.pathname === `${projectPrefix}/people-world`
    && url.searchParams.get("view") === "characters"
  ), { timeout: 90_000, waitUntil: "domcontentloaded" });
  const contextTabs = page.getByTestId("people-world-context-tabs");
  await contextTabs.waitFor({ state: "visible" });
  assert.equal(await contextTabs.getAttribute("data-active-view"), "characters");

  const characterStage = page.getByTestId("story-stage-selector");
  await characterStage.waitFor({ state: "visible" });
  assert.equal(await characterStage.getAttribute("data-canon-edit-surface"), "story-selection-only");
  assert.match(await characterStage.getByTestId("story-stage-selection-boundary").innerText(), /不會修改正式人物/u);
  assert.equal(await page.getByTestId("social-world-library").count(), 0, "story routes must not expose library Canon approval");
  for (const forbiddenAction of ["建立人物", "儲存人物", "刪除人物", "核准角色與持有鏈"]) {
    assert.equal(await characterStage.getByRole("button", { name: forbiddenAction, exact: true }).count(), 0);
  }
  const selectableCharacter = characterStage
    .locator('[data-testid="story-stage-character"]:not([disabled])')
    .filter({ hasNotText: /主角/u })
    .first();
  await selectableCharacter.waitFor({ state: "visible" });
  const previousCharacterStage = await selectableCharacter.getAttribute("aria-pressed");
  await selectableCharacter.click();
  await page.waitForFunction(({ previous }) => {
    const candidate = [...document.querySelectorAll('[data-testid="story-stage-character"]')]
      .find((element) => !element.textContent?.includes("主角") && !element.hasAttribute("disabled"));
    return candidate?.getAttribute("aria-pressed") !== previous;
  }, { previous: previousCharacterStage });

  await contextTabs.getByRole("link", { name: /世界設定/u }).click();
  await page.waitForURL((url) => (
    url.pathname === `${projectPrefix}/people-world`
    && url.searchParams.get("view") === "world"
  ));
  const worldStage = page.getByTestId("story-stage-selector");
  await worldStage.waitFor({ state: "visible" });
  assert.equal(await worldStage.getAttribute("data-canon-edit-surface"), "story-selection-only");
  assert.equal(await worldStage.getByTestId("story-stage-world").count() > 0, true);
  for (const forbiddenAction of ["建立世界", "儲存世界", "刪除世界", "核准世界與五條規則"]) {
    assert.equal(await worldStage.getByRole("button", { name: forbiddenAction, exact: true }).count(), 0);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("story-stage-selector").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("social-world-library").count(), 0);

  const reloadedContextTabs = page.getByTestId("people-world-context-tabs");
  await reloadedContextTabs.waitFor({ state: "visible" });
  assert.equal(await reloadedContextTabs.getAttribute("data-active-view"), "world");
  await reloadedContextTabs.getByRole("link", { name: /角色資料/u }).click();
  await page.waitForURL((url) => (
    url.pathname === `${projectPrefix}/people-world`
    && url.searchParams.get("view") === "characters"
  ));
  await page.getByTestId("story-stage-selector").waitFor({ state: "visible" });
  const characterContextTabs = page.getByTestId("people-world-context-tabs");
  await characterContextTabs.waitFor({ state: "visible" });
  await characterContextTabs.getByRole("link", { name: /角色視角 AI/u }).click();
  await page.waitForURL((url) => (
    url.pathname === `${projectPrefix}/people-world`
    && url.searchParams.get("view") === "character-ai"
  ));
  assert.equal(await characterContextTabs.getAttribute("data-active-view"), "character-ai");
  assert.equal(new URL(page.url()).pathname.startsWith(projectPrefix), true);
  assert.deepEqual(pageErrors, []);
});

harness.test("long-session", "attached edit-copy is single-flight, preserves scoped proof, and never runs with an empty attachment", async () => {
  const { page, projectId, pageErrors } = await getAttachmentBranchFixture();
  const seeded = await seedAttachmentBranchSource(page, projectId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="conversation-message-timeline"]')
      ?.getAttribute("data-total-messages") === "2"
  ));
  const editAction = page.locator(`article[data-message-id="${seeded.sourceUserId}"]`)
    .getByRole("button", { name: "修改此訊息（保留原文）" });
  await editAction.evaluate((button) => {
    button.click();
    button.click();
    button.click();
  });
  const dialog = page.getByTestId("conversation-edit-copy-dialog");
  await dialog.waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("conversation-edit-copy-dialog").count(), 1);
  await dialog.getByLabel("副本中的訊息").fill("請依附件調整這一幕，並加強因果。");
  await dialog.getByRole("button", { name: "確認並在副本重試" }).click();
  await dialog.waitFor({ state: "hidden" });
  const alert = page.getByRole("alert").filter({ hasText: "附件的名稱、雜湊、權利確認與解析狀態已完整保留" });
  await alert.waitFor({ state: "visible" });
  assert.match(await alert.innerText(), /不會用空附件假裝續寫/u);
  const state = await inspectAttachmentBranchState(page, projectId);
  assert.equal(state.sessions.length, 2, "three rapid clicks must create exactly one branch");
  const sourceSession = state.sessions.find((session) => session.id === seeded.sessionId);
  const branchSession = state.sessions.find((session) => session.id === state.activeSessionId);
  assert(sourceSession);
  assert(branchSession);
  assert.notEqual(branchSession.id, sourceSession.id);
  assert.equal(branchSession.parentSessionId, sourceSession.id);
  assert.equal(sourceSession.messages.filter((message) => message.role === "user").length, 1);
  assert.equal(sourceSession.messages.filter((message) => message.role === "assistant").length, 1);
  assert.equal(branchSession.messages.length, 1);
  const editedUser = branchSession.messages[0];
  assert.equal(editedUser.role, "user");
  assert.equal(editedUser.sourceMessageId, seeded.sourceUserId);
  assert.equal(editedUser.content, "請依附件調整這一幕，並加強因果。");
  assert.equal(branchSession.messages.filter((message) => message.role === "assistant").length, 0,
    "missing transient extraction must not create a fake assistant continuation");
  assert.equal(editedUser.attachmentIds.length, 1);
  assert.equal(branchSession.attachments.length, 1);
  const copiedAttachment = branchSession.attachments[0];
  const sourceAttachment = sourceSession.attachments[0];
  assert(sourceAttachment);
  assert.notEqual(copiedAttachment.id, sourceAttachment.id);
  assert.equal(editedUser.attachmentIds[0], copiedAttachment.id);
  assert.equal(copiedAttachment.sessionId, branchSession.id);
  assert.equal(copiedAttachment.contentHash, sourceAttachment.contentHash);
  assert.equal(copiedAttachment.rightsEvidenceHash, sourceAttachment.rightsEvidenceHash);
  assert.equal(copiedAttachment.userConfirmedRights, true);
  assert.equal(copiedAttachment.parsingStatus, "completed");
  assert.equal(copiedAttachment.rawContentRetained, false);
  assert.deepEqual(pageErrors, []);
});

harness.test("long-session", "1000-message edit-copy, approval, switching, and reload preserve one canonical timeline", async () => {
  const { page, projectId, pageErrors } = await getLongSessionFixture();
  const seeded = await seedLongSession(page, projectId);
  await page.reload({ waitUntil: "domcontentloaded" });
  const timeline = page.getByTestId("conversation-message-timeline");
  await timeline.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector('[data-testid="conversation-message-timeline"]')?.getAttribute("data-total-messages") === "1000");
  await page.waitForFunction(() => document.querySelector('[data-testid="conversation-message-timeline"]')?.getAttribute("data-scroll-restoring") === "true");
  assert.equal(await timeline.getAttribute("data-rendered-messages"), "120");
  assert.equal(await timeline.locator("article[data-message-id]").count(), 120);
  const initialFirst = timeline.locator("article[data-message-id]").first();
  assert.equal(await initialFirst.getAttribute("data-message-id"), "rc6-long-message-0880");
  assert.equal(await timeline.locator("article[data-message-id]").last().getAttribute("data-message-id"), "rc6-long-message-0999");
  await timeline.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('[data-testid="conversation-message-timeline"]')?.hasAttribute("data-scroll-restoring") === false);
  await timeline.getByRole("button", { name: /載入較早訊息/u }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="conversation-message-timeline"]')?.getAttribute("data-rendered-messages") === "240");
  assert.equal(await timeline.locator("article[data-message-id]").first().getAttribute("data-message-id"), "rc6-long-message-0760");
  assert.equal(await timeline.locator("article[data-message-id]").last().getAttribute("data-lineage-root"), "rc6-long-message-0000");
  assert.equal(await timeline.locator("article[data-message-id]").last().getAttribute("data-lineage-depth"), "999");
  await timeline.evaluate((element) => {
    element.scrollTop = 640;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForFunction(({ projectId, sessionId }) => {
    const snapshot = JSON.parse(sessionStorage.getItem(`novel:conversation-scroll:${projectId}:${sessionId}`) ?? "null");
    return snapshot?.scrollTop === 640 && snapshot?.visibleCount === 240;
  }, { projectId, sessionId: seeded.sessionId });
  await page.waitForTimeout(900);
  const settledSnapshot = await page.evaluate(({ projectId, sessionId }) => (
    JSON.parse(sessionStorage.getItem(`novel:conversation-scroll:${projectId}:${sessionId}`) ?? "null")
  ), { projectId, sessionId: seeded.sessionId });
  assert.deepEqual(
    settledSnapshot,
    { scrollTop: 640, visibleCount: 240 },
    "fast user scroll must cancel the 750ms restore loop instead of being overwritten",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const restoredTimeline = page.getByTestId("conversation-message-timeline");
  await page.waitForFunction(() => document.querySelector('[data-testid="conversation-message-timeline"]')?.getAttribute("data-rendered-messages") === "240");
  await page.waitForTimeout(850);
  const restoredScroll = await restoredTimeline.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  const restoredSnapshot = await page.evaluate(({ projectId, sessionId }) => (
    sessionStorage.getItem(`novel:conversation-scroll:${projectId}:${sessionId}`)
  ), { projectId, sessionId: seeded.sessionId });
  assert(Math.abs(restoredScroll.scrollTop - 640) <= 4, `reload restored ${JSON.stringify({ restoredScroll, restoredSnapshot })}, expected scrollTop 640`);
  assert.equal(await restoredTimeline.locator("article[data-message-id]").count(), 240);

  const initialState = await inspectLongSessionState(page, projectId, seeded);
  assert.equal(initialState.sessions.length, 1);
  assert.equal(initialState.activeSessionId, seeded.sessionId);
  assert.equal(initialState.projectRevision, seeded.projectRevision);
  assert.equal(initialState.chapterRevision, seeded.chapterRevision);
  assert.equal(initialState.artifact?.status, "candidate");
  assert.equal(initialState.artifact?.sourceMessageId, seeded.candidateMessageId);
  assert.equal(initialState.invocation?.messageId, seeded.candidateMessageId);
  assert.equal(initialState.invocation?.outputDigest, initialState.artifact?.candidateDigest);

  const editSourceId = "rc6-long-message-0998";
  assert.equal(await restoredTimeline.locator('[data-conversation-action="branch"]').count(), 0, "generic branch actions must not return in long sessions");
  assert.equal(
    await restoredTimeline.locator(`article[data-message-id="${editSourceId}"]`)
      .locator('[data-conversation-action="edit-message-copy"]').count(),
    1,
    "user messages must retain the explicit edit-copy action",
  );

  const sourceCandidateMessage = page.locator(`article[data-message-id="${seeded.candidateMessageId}"]`);
  const approvalActions = sourceCandidateMessage.getByTestId("conversation-approval-actions");
  await approvalActions.waitFor({ state: "visible" });
  assert.equal(await approvalActions.getAttribute("data-artifact-id"), seeded.candidateArtifactId);
  await approvalActions.getByTestId("conversation-approve-candidate").click();
  const approvedState = await waitForLongSessionState(
    page,
    projectId,
    seeded,
    (state) => state.artifact?.status === "approved"
      && state.chapterRevision === seeded.chapterRevision + 1
      && state.approvals.length === 1,
    "long-session candidate approval did not commit exactly once",
  );
  assert.equal(approvedState.projectRevision, seeded.projectRevision);
  assert.equal(approvedState.artifact?.approvedRevision, seeded.chapterRevision + 1);
  assert.match(approvedState.chapterContent, /RC6 長會話核准候選/u);
  assert.deepEqual(approvedState.approvals[0], {
    artifactId: seeded.candidateArtifactId,
    sourceMessageId: seeded.candidateMessageId,
    candidateDigest: approvedState.artifact?.candidateDigest,
    sourceRevision: seeded.chapterRevision,
    resultingRevision: seeded.chapterRevision + 1,
    canonicalMutationCount: 1,
    status: "committed",
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-testid="conversation-message-timeline"]')?.getAttribute("data-total-messages") === "1000");
  const approvalReloadState = await inspectLongSessionState(page, projectId, seeded);
  assert.equal(approvalReloadState.activeSessionId, seeded.sessionId);
  assert.equal(approvalReloadState.chapterRevision, seeded.chapterRevision + 1);
  assert.equal(approvalReloadState.approvals.length, 1);
  assert.equal(approvalReloadState.artifact?.status, "approved");

  const editedContent = "查看狀態";
  const editAction = page.locator(`article[data-message-id="${editSourceId}"]`)
    .getByRole("button", { name: "修改此訊息（保留原文）" });
  await editAction.click();
  const cancelDialog = page.getByTestId("conversation-edit-copy-dialog");
  await cancelDialog.waitFor({ state: "visible" });
  assert.equal(await cancelDialog.getByLabel("副本中的訊息").inputValue(), editedContent);
  await cancelDialog.getByLabel("副本中的訊息").fill("查看狀態（取消測試）");
  assert.match(await cancelDialog.innerText(), /已修改內容：原文不會被覆寫/u);
  await cancelDialog.getByRole("button", { name: "取消" }).click();
  await cancelDialog.waitFor({ state: "hidden" });
  const cancelledEditState = await inspectLongSessionState(page, projectId, seeded);
  assert.equal(cancelledEditState.sessions.length, 1, "cancelling the controlled edit dialog must not create a branch");

  await editAction.click();
  const switchedDuringBuildDialog = page.getByTestId("conversation-edit-copy-dialog");
  await switchedDuringBuildDialog.waitFor({ state: "visible" });
  await page.evaluate((sourceSessionId) => {
    const confirm = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "確認並在副本重試");
    const sourceSession = document.querySelector(
      `[data-testid="conversation-session-sidebar"] [data-session-id="${sourceSessionId}"] > button`,
    );
    confirm.click();
    sourceSession.click();
  }, seeded.sessionId);
  const switchedDuringBuildState = await waitForLongSessionState(
    page,
    projectId,
    seeded,
    (state) => state.sessions.length === 2
      && state.activeSessionId === seeded.sessionId
      && state.sessions.some((session) => (
        session.id !== seeded.sessionId
        && session.messageCount === 999
        && session.tail.at(-1)?.role === "user"
        && session.tail.at(-1)?.sourceMessageId === editSourceId
      )),
    "a later session selection was not preserved while the branch was being built",
  );
  const backgroundBranch = switchedDuringBuildState.sessions.find((session) => session.id !== seeded.sessionId);
  assert(backgroundBranch, "the switched-away branch must still be committed for later use");
  assert.equal(
    backgroundBranch.tail.filter((message) => message.role === "assistant" && message.parentMessageId === backgroundBranch.tail.at(-1)?.id).length,
    0,
    "switching away during branch creation must not start a hidden assistant response",
  );

  await editAction.evaluate((button) => {
    button.click();
    button.click();
    button.click();
  });
  const editDialog = page.getByTestId("conversation-edit-copy-dialog");
  await editDialog.waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("conversation-edit-copy-dialog").count(), 1, "rapid clicks must open one controlled dialog");
  assert.equal(await editDialog.getByLabel("副本中的訊息").inputValue(), editedContent);
  assert.match(await editDialog.innerText(), /內容未變更：確認後仍會建立一個重試副本/u);
  await editDialog.getByRole("button", { name: "確認並在副本重試" }).evaluate((button) => {
    button.click();
    button.click();
    button.click();
    button.click();
  });
  const editedState = await waitForLongSessionState(
    page,
    projectId,
    seeded,
    (state) => state.sessions.length === 3
      && state.activeSessionId !== seeded.sessionId
      && state.sessions.some((session) => (
        session.id === state.activeSessionId
        && session.messageCount === 1_000
        && session.tail.at(-1)?.role === "assistant"
        && session.tail.at(-1)?.status === "completed"
      )),
    "edit copy did not commit one isolated session and one automatic continuation",
  );
  const editSession = editedState.sessions.find((session) => session.id === editedState.activeSessionId);
  assert(editSession, "edited copy must become active only with its message snapshot");
  assert.equal(editSession.parentSessionId, seeded.sessionId);
  assert.equal(editSession.branchedFromMessageId, "rc6-long-message-0997");
  assert.equal(editSession.messageCount, 1_000);
  const editedUserMessages = editSession.tail.filter((message) => (
    message.role === "user"
    && message.sourceMessageId === editSourceId
    && message.content === editedContent
  ));
  assert.equal(editedUserMessages.length, 1, "the edit copy must reuse exactly one persisted user message");
  const editedUserMessage = editedUserMessages[0];
  const automaticResponses = editSession.tail.filter((message) => (
    message.role === "assistant" && message.parentMessageId === editedUserMessage.id
  ));
  assert.equal(automaticResponses.length, 1, "the edit copy must start exactly one assistant continuation");
  assert.equal(automaticResponses[0].status, "completed");
  const visiblySelectedSession = page.getByTestId("conversation-active-session");
  assert.equal(await visiblySelectedSession.getAttribute("data-session-id"), editSession.id);
  assert.equal(await visiblySelectedSession.locator("button").first().getAttribute("aria-current"), "true");
  assert.equal(await page.getByLabel("小說專案訊息").isEnabled(), true, "a completed edit copy must remain continuable");
  const editedTailVisibility = await page.evaluate((messageId) => {
    const timelineElement = document.querySelector('[data-testid="conversation-message-timeline"]');
    const messageElement = document.querySelector(`article[data-message-id="${messageId}"]`);
    if (!timelineElement || !messageElement) return null;
    const timelineBox = timelineElement.getBoundingClientRect();
    const messageBox = messageElement.getBoundingClientRect();
    return {
      visible: messageBox.bottom > timelineBox.top && messageBox.top < timelineBox.bottom,
      distanceFromTail: timelineElement.scrollHeight - timelineElement.scrollTop - timelineElement.clientHeight,
    };
  }, automaticResponses[0].id);
  assert.equal(editedTailVisibility?.visible, true, `edited continuation was not visible: ${JSON.stringify(editedTailVisibility)}`);
  assert((editedTailVisibility?.distanceFromTail ?? Number.POSITIVE_INFINITY) < 96,
    `edited branch did not navigate to its tail: ${JSON.stringify(editedTailVisibility)}`);
  assert.equal(editedState.sourceMessage?.content, editedContent);
  assert.equal(editedState.chapterRevision, seeded.chapterRevision + 1);
  assert.equal(editedState.approvals.length, 1);
  const editSessionId = editSession.id;

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((sessionId) => {
    const active = document.querySelector('[data-testid="conversation-session-sidebar"] [data-active="true"]');
    const timeline = document.querySelector('[data-testid="conversation-message-timeline"]');
    return active?.getAttribute("data-session-id") === sessionId
      && timeline?.getAttribute("data-total-messages") === "1000";
  }, editSessionId);
  const editReloadState = await inspectLongSessionState(page, projectId, seeded);
  assert.equal(editReloadState.activeSessionId, editSessionId);
  assert.equal(editReloadState.sessions.length, 3);
  assert.equal(editReloadState.chapterRevision, seeded.chapterRevision + 1);
  assert.equal(editReloadState.approvals.length, 1);

  const switchSnapshots = await page.evaluate(({ originalSessionId, editSessionId, editSourceId }) => new Promise((resolve) => {
    const snapshots = [];
    const capture = () => {
      const active = document.querySelector('[data-testid="conversation-session-sidebar"] [data-active="true"]');
      const timeline = document.querySelector('[data-testid="conversation-message-timeline"]');
      const last = timeline?.querySelector("article[data-message-id]:last-of-type");
      const edited = timeline?.querySelector(`[data-source-message-id="${editSourceId}"]`);
      snapshots.push({
        activeSessionId: active?.getAttribute("data-session-id") ?? null,
        totalMessages: timeline?.getAttribute("data-total-messages") ?? null,
        lastMessageId: last?.getAttribute("data-message-id") ?? null,
        lastSourceMessageId: last?.getAttribute("data-source-message-id") ?? null,
        lastText: last?.textContent ?? "",
        editedText: edited?.textContent ?? "",
      });
    };
    const workspace = document.querySelector('[data-testid="conversation-first-workspace"]');
    const observer = new MutationObserver(capture);
    observer.observe(workspace, { subtree: true, childList: true, attributes: true });
    capture();
    const originalButton = document.querySelector(
      `[data-testid="conversation-session-sidebar"] [data-session-id="${originalSessionId}"] > button`,
    );
    const editButton = document.querySelector(
      `[data-testid="conversation-session-sidebar"] [data-session-id="${editSessionId}"] > button`,
    );
    originalButton.click();
    editButton.click();
    setTimeout(() => {
      observer.disconnect();
      capture();
      resolve(snapshots);
    }, 750);
  }), { originalSessionId: seeded.sessionId, editSessionId, editSourceId });
  await page.waitForFunction((sessionId) => {
    const active = document.querySelector('[data-testid="conversation-session-sidebar"] [data-active="true"]');
    return active?.getAttribute("data-session-id") === sessionId
      && document.querySelector('[data-testid="conversation-message-timeline"]')?.getAttribute("data-total-messages") === "1000";
  }, editSessionId);
  for (const snapshot of switchSnapshots) {
    if (snapshot.activeSessionId === seeded.sessionId) {
      assert.equal(snapshot.totalMessages, "1000", `original session exposed a mixed snapshot: ${JSON.stringify(snapshot)}`);
      assert.equal(snapshot.lastMessageId, seeded.candidateMessageId, `original session exposed wrong messages: ${JSON.stringify(snapshot)}`);
    } else if (snapshot.activeSessionId === editSessionId) {
      assert.equal(snapshot.totalMessages, "1000", `edit session exposed a mixed snapshot: ${JSON.stringify(snapshot)}`);
      assert.match(snapshot.editedText, /查看狀態/u, `edit session exposed wrong edited message: ${JSON.stringify(snapshot)}`);
    }
  }
  const switchedState = await inspectLongSessionState(page, projectId, seeded);
  assert.equal(switchedState.activeSessionId, editSessionId, "rapid original→edit switching must commit only the latest request");
  assert.equal(switchedState.chapterRevision, seeded.chapterRevision + 1);
  assert.equal(switchedState.approvals.length, 1);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction((sessionId) => (
    sessionStorage.getItem(`novel:conversation-active:${location.pathname.split("/")[3]}`) === sessionId
    && document.querySelector('[data-testid="conversation-message-timeline"]')?.getAttribute("data-total-messages") === "1000"
  ), editSessionId);
  const finalState = await inspectLongSessionState(page, projectId, seeded);
  assert.equal(finalState.activeSessionId, editSessionId);
  assert.equal(finalState.sessions.length, 3);
  assert.equal(finalState.projectRevision, seeded.projectRevision);
  assert.equal(finalState.chapterRevision, seeded.chapterRevision + 1);
  assert.equal(finalState.approvals.length, 1);
  assert.equal(finalState.artifact?.status, "approved");
  assert.deepEqual(pageErrors, []);
});

harness.test("mobile", "390x844 keeps the composer usable and turns side panels into drawers", async () => {
  const { page, pageErrors } = await getMobileFixture();
  const layout = await page.evaluate(() => {
    const composer = document.querySelector('textarea[aria-label="小說專案訊息"]')?.getBoundingClientRect();
    const send = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "送出")?.getBoundingClientRect();
    const sidebar = document.querySelector('aside[aria-label="小說專案欄"]')?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      composer: composer ? { left: composer.left, right: composer.right, bottom: composer.bottom } : null,
      send: send ? { left: send.left, right: send.right, bottom: send.bottom, height: send.height } : null,
      sidebarRight: sidebar?.right ?? null,
    };
  });
  assert.equal(layout.overflow, false);
  assert(layout.composer && layout.composer.left >= 0 && layout.composer.right <= 390 && layout.composer.bottom <= 844);
  assert(layout.send && layout.send.left >= 0 && layout.send.right <= 390 && layout.send.bottom <= 844 && layout.send.height >= 39);
  assert(layout.sidebarRight !== null && layout.sidebarRight <= 0);

  const sidebarToggle = page.getByTestId("conversation-mobile-sidebar-toggle");
  assert.equal(await sidebarToggle.getAttribute("aria-label"), "打開專案與對話側欄");
  assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await sidebarToggle.getAttribute("aria-controls"), "conversation-session-sidebar");
  await sidebarToggle.click();
  const sidebar = page.getByLabel("小說專案欄");
  await page.waitForFunction(() => {
    const element = document.querySelector('aside[aria-label="小說專案欄"]');
    return element?.getAttribute("data-open") === "true" && element.getBoundingClientRect().left >= -1;
  });
  assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "true");
  const openSidebar = await sidebar.boundingBox();
  assert(openSidebar && openSidebar.x >= -1 && openSidebar.x + openSidebar.width <= 391, JSON.stringify(openSidebar));
  await page.getByRole("button", { name: "關閉抽屜" }).click({ position: { x: 370, y: 400 } });
  await page.waitForFunction(() => document.querySelector('aside[aria-label="小說專案欄"]')?.getAttribute("data-open") === "false");
  assert.equal(await sidebarToggle.getAttribute("aria-expanded"), "false");
  assert.deepEqual(pageErrors, []);
});

harness.test("mobile", "requested status expands an inline readable dashboard without a nested raw-data sheet", async () => {
  const { page, projectId } = await getMobileFixture();
  await lockFixtureToRpg(page, projectId);
  assert.equal(await page.getByLabel("作品結果抽屜").count(), 0);
  const dashboard = await sendLocalStatusQuery(page);
  const box = await dashboard.boundingBox();
  assert(box && box.x >= -1 && box.x + box.width <= 391, JSON.stringify(box));
  assert.equal(await page.getByLabel("作品結果抽屜").count(), 0);
  assert.equal(await dashboard.locator("pre").count(), 0);
  assert.equal(await page.locator('[data-conversation-action="branch"]').count(), 0);
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    composerDisabled: document.querySelector('textarea[aria-label="小說專案訊息"]')?.disabled ?? true,
  }));
  assert.equal(layout.overflow, false);
  assert.equal(layout.composerDisabled, false);
});

harness.test("mobile", "inline A/B/C choices are single-column touch targets and RPG outcome is collapsed", async () => {
  const { page, projectId } = await getMobileFixture();
  await seedRpgPresentationFixture(page, projectId);
  await page.reload({ waitUntil: "domcontentloaded" });
  const choices = page.getByTestId("rpg-inline-choices").locator("button");
  await choices.first().waitFor({ state: "visible" });
  assert.equal(await choices.count(), 3);
  assert.equal(await choices.first().isEnabled(), false);
  assert.match(await choices.first().innerText(), /舊版選項僅供查看/u);
  const boxes = await choices.evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
  }));
  assert(boxes.every((box) => box.left >= 0 && box.right <= 390 && box.height >= 104));
  assert(boxes[1].top >= boxes[0].bottom && boxes[2].top >= boxes[1].bottom);
  assert.match(await choices.nth(0).innerText(), /^A/u);
  assert.match(await choices.nth(1).innerText(), /^B/u);
  assert.match(await choices.nth(2).innerText(), /^C/u);
  const outcome = page.locator("details").filter({ hasText: "行動結果與數值變化" });
  await outcome.waitFor();
  assert.equal(await outcome.evaluate((element) => element.open), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await page.getByLabel("小說專案訊息").fill("自訂行動：先熄燈，再從屋脊繞到後門。");
  assert.equal(await page.getByRole("button", { name: "送出" }).isEnabled(), true);
});

await startServer();
browser = await launchBrowser();
try {
  await harness.run();
} finally {
  await desktopFixture?.context.close();
  await dashboardFixture?.context.close();
  await mobileFixture?.context.close();
  await longSessionFixture?.context.close();
  await attachmentBranchFixture?.context.close();
  await browser.close();
  if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
}
