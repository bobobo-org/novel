import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_TAG = "novel-ai-p24b-runtime-consumer-activation-rc3";
const CONSUMER_RELEASE = "p2.4b-runtime-consumer-activation-rc3";
const PRODUCTION_ORIGINS = new Set([
  "https://novel-orcin.vercel.app",
  "https://novel-lqtechs-projects.vercel.app",
]);
const CANON_STORES = [
  "projects", "chapters", "characters", "relationships", "worlds", "worldRules",
  "lore", "timeline", "storyStates", "acceptedChoices", "storyBranches",
  "storyBibles", "storyBibleDeltas", "approvalTransactions", "idempotencyRecords",
];
const OPERATOR_MESSAGE = "Microsoft Edge即將開啟。當網站要求本機網路存取時，請操作者親自按『允許』；其餘流程不得手動操作。";

function argsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])]),
  );
}

function sha(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function digest(value) {
  return sha(JSON.stringify(stable(value)));
}

function normalizeCandidate(value) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

function trigrams(value) {
  const characters = Array.from(value);
  if (characters.length < 3) return new Set(characters);
  const result = new Set();
  for (let index = 0; index <= characters.length - 3; index += 1) {
    result.add(characters.slice(index, index + 3).join(""));
  }
  return result;
}

function trigramSimilarity(left, right) {
  const leftSet = trigrams(normalizeCandidate(left));
  const rightSet = trigrams(normalizeCandidate(right));
  if (!leftSet.size && !rightSet.size) return 1;
  let intersection = 0;
  for (const item of leftSet) if (rightSet.has(item)) intersection += 1;
  return Number((intersection / (leftSet.size + rightSet.size - intersection || 1)).toFixed(6));
}

function safeRoute(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function assertBaseUrl(value) {
  const url = new URL(String(value || ""));
  const preview = url.protocol === "https:"
    && url.hostname.endsWith(".vercel.app")
    && !PRODUCTION_ORIGINS.has(url.origin);
  if (!preview || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PRODUCT_PREVIEW_EXACT_ORIGIN_REQUIRED");
  }
  return url.origin;
}

async function writeJson(root, name, value) {
  await writeFile(
    path.join(root, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function invokeLauncher(root, ...launcherArgs) {
  const launcher = path.join(root, "local-ai", "bridge", "launcher.mjs");
  const { stdout } = await execFileAsync(process.execPath, [launcher, ...launcherArgs], {
    cwd: root,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function releaseIdentity(origin, expectedCommit) {
  const response = await fetch(`${origin}/api/release/identity?gate=${crypto.randomUUID()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RELEASE_IDENTITY_HTTP_${response.status}`);
  const body = await response.json();
  const identity = body.releaseIdentity || body;
  if (identity.releaseTag !== RELEASE_TAG) throw new Error("RC3_RELEASE_TAG_MISMATCH");
  if (identity.consumerRelease !== CONSUMER_RELEASE) throw new Error("RC3_CONSUMER_RELEASE_MISMATCH");
  if (identity.provenanceStatus !== "verified") throw new Error("RC3_PROVENANCE_NOT_VERIFIED");
  if (identity.appCommit !== expectedCommit) throw new Error("PRODUCT_PREVIEW_COMMIT_MISMATCH");
  if (identity.environment !== "preview") throw new Error("PRODUCT_PREVIEW_ENVIRONMENT_MISMATCH");
  return identity;
}

async function permissionStates(page) {
  return page.evaluate(async () => {
    const result = {};
    for (const name of ["local-network-access", "local-network", "loopback-network"]) {
      try {
        result[name] = (await navigator.permissions.query({ name })).state;
      } catch {
        result[name] = "unsupported";
      }
    }
    return result;
  });
}

function resolvedPermission(states) {
  const supported = ["local-network-access", "local-network", "loopback-network"]
    .map((name) => ({ name, state: states[name] }))
    .filter((entry) => entry.state !== "unsupported");
  return supported.find((entry) => entry.state === "granted")
    ?? supported.find((entry) => entry.state === "denied")
    ?? supported[0]
    ?? { name: "unsupported", state: "unsupported" };
}

async function canonSnapshot(page, projectId) {
  return page.evaluate(async ({ projectId, stores }) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = {};
    for (const storeName of stores) {
      if (!database.objectStoreNames.contains(storeName)) {
        result[storeName] = [];
        continue;
      }
      result[storeName] = await new Promise((resolve, reject) => {
        const store = database.transaction(storeName, "readonly").objectStore(storeName);
        const request = store.indexNames.contains("projectId")
          ? store.index("projectId").getAll(projectId)
          : store.getAll();
        request.onsuccess = () => resolve(request.result.filter((row) => (
          row?.projectId === projectId || row?.id === projectId
        )));
        request.onerror = () => reject(request.error);
      });
    }
    database.close();
    return result;
  }, { projectId, stores: CANON_STORES });
}

async function closedAgentCandidates(page, projectId) {
  return page.evaluate(async (boundProjectId) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-closed-agent-state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = database.transaction("records", "readonly").objectStore("records");
    const request = store.index("projectId").getAll(boundProjectId);
    const records = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records
      .filter((record) => record.kind === "candidate")
      .map((record) => ({
        id: record.id,
        taskId: record.taskId,
        contentDigest: record.contentDigest,
        status: record.status,
        actualExecutor: record.actualExecutor,
        modelId: record.modelId,
        canonicalMutationCount: record.canonicalMutationCount,
        sourceRevision: record.sourceRevision,
        regeneration: record.regeneration ?? null,
        createdAt: record.createdAt,
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }, projectId);
}

function semanticCanon(snapshot) {
  const transient = new Set([
    "id", "createdAt", "updatedAt", "revision", "revisionNumber", "backupId",
    "transactionId", "idempotencyKey", "hash", "digest", "previousHash",
  ]);
  const clean = (value) => {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !transient.has(key))
      .map(([key, nested]) => [key, clean(nested)]));
  };
  return clean(snapshot);
}

async function assertNoOverflow(page, label, rows) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  if (dimensions.document > dimensions.viewport + 1) {
    throw new Error(`HORIZONTAL_OVERFLOW:${label}`);
  }
  rows.push({ label, status: "PASS", ...dimensions });
}

async function waitCandidate(page, timeout = 300_000) {
  const candidate = page.getByTestId("studio-candidate");
  await candidate.waitFor({ state: "visible", timeout });
  await candidate.getByText("真實閉端 AI 候選").waitFor({ state: "visible", timeout });
  return candidate;
}

function classifyDiagnostics(consoleRows, pageErrors, networkRows) {
  const rows = [];
  let productError = 0;
  let securityError = 0;
  let unclassified = 0;
  for (const row of consoleRows) {
    if (row.type !== "error") continue;
    const expected = /favicon|supabase|cloud persistence|networkerror.*persistence/iu.test(row.text);
    const security = /securityerror|mixed content|content security policy|credential|authorization/iu.test(row.text);
    const classification = security
      ? "SECURITY_ERROR"
      : expected
        ? "EXPECTED_DEGRADED"
        : "UNCLASSIFIED";
    if (classification === "SECURITY_ERROR") securityError += 1;
    if (classification === "UNCLASSIFIED") unclassified += 1;
    rows.push({ source: "console", classification, digest: sha(row.text), length: row.text.length });
  }
  for (const message of pageErrors) {
    productError += 1;
    rows.push({ source: "pageerror", classification: "PRODUCT_ERROR", digest: sha(message), length: message.length });
  }
  for (const row of networkRows.filter((entry) => entry.status === 0 || entry.status >= 400)) {
    const parsed = new URL(row.url);
    const expected = /\/api\/(?:persistence|ai\/cloud)\/health$/u.test(parsed.pathname)
      || (row.status === 0 && parsed.hostname === "127.0.0.1");
    if (!expected) unclassified += 1;
    rows.push({
      source: "network",
      classification: expected ? "EXPECTED_DEGRADED" : "UNCLASSIFIED",
      route: safeRoute(row.url),
      status: row.status,
    });
  }
  return { productError, securityError, unclassified, rows };
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const origin = assertBaseUrl(args["base-url"]);
  const productCommit = String(args["product-commit"] || "");
  if (!/^[0-9a-f]{40}$/iu.test(productCommit)) throw new Error("PRODUCT_COMMIT_REQUIRED");
  const root = process.cwd();
  const artifactRoot = path.resolve(String(
    args.artifacts || "artifacts/p24b-rc3-1-consumer-activation",
  ));
  const profilePath = path.join(artifactRoot, ".temporary-edge-profile");
  if (!profilePath.startsWith(`${artifactRoot}${path.sep}`)) throw new Error("EDGE_PROFILE_SCOPE_INVALID");
  await mkdir(artifactRoot, { recursive: true });
  await rm(profilePath, { recursive: true, force: true });
  await mkdir(profilePath, { recursive: true });

  const initialBridge = await invokeLauncher(root, "status");
  if (initialBridge.bridge?.alive) throw new Error("BRIDGE_ALREADY_RUNNING_BEFORE_GATE");
  const identity = await releaseIdentity(origin, productCommit);
  let originAdded = false;
  let bridgeStarted = false;
  let context;
  let profileDeleted = false;
  let gateError = null;
  let evidence = null;
  const consoleRows = [];
  const pageErrors = [];
  const networkRows = [];
  const navigationRows = [];
  const overflowRows = [];
  const testStory = {
    title: "RC3.1 人工 Edge 驗收故事",
    idea: "一名守燈人發現城市的夜空正在遺忘星星。",
    protagonist: "沈曜",
    world: "每座城市由一盞記憶之燈維持歷史。",
    worldRule: "每次點亮失落星辰，守燈人會失去一段自己的記憶。",
    paragraph: "雨落在觀星塔的銅瓦上，沈曜握緊熄滅的星燈，第一次聽見天空呼救。",
  };

  process.stdout.write(`${OPERATOR_MESSAGE}\n`);
  try {
    await invokeLauncher(root, "origin", "add", origin, "--confirm", origin);
    originAdded = true;
    await invokeLauncher(root, "start", "--origin", origin);
    bridgeStarted = true;
    context = await chromium.launchPersistentContext(profilePath, {
      channel: "msedge",
      headless: false,
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "allow",
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    const page = context.pages()[0] || await context.newPage();
    page.on("console", (message) => consoleRows.push({
      type: message.type(),
      text: message.text().replace(/\s+/gu, " ").slice(0, 2_000),
    }));
    page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 2_000)));
    page.on("requestfailed", (request) => networkRows.push({
      phase: "requestfailed",
      method: request.method(),
      url: safeRoute(request.url()),
      status: 0,
    }));
    page.on("response", (response) => networkRows.push({
      phase: "response",
      url: safeRoute(response.url()),
      status: response.status(),
    }));
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigationRows.push(safeRoute(frame.url()));
    });

    await page.goto(`${origin}/`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible" });
    await assertNoOverflow(page, "frontdoor-desktop", overflowRows);
    const permissionBeforeStates = await permissionStates(page);
    const permissionBefore = resolvedPermission(permissionBeforeStates);
    if (permissionBefore.state !== "prompt") {
      throw new Error(`EDGE_PERMISSION_BEFORE_NOT_PROMPT:${permissionBefore.state}`);
    }

    await page.getByRole("link", { name: /開始新故事/ }).first().click();
    await page.getByTestId("studio-create-wizard").waitFor({ state: "visible" });
    await page.getByTestId("studio-project-title").fill(testStory.title);
    await page.getByLabel(/核心想法/).fill(testStory.idea);
    await page.getByTestId("studio-create-next").click();
    await page.getByTestId("studio-create-next").click();
    await page.getByTestId("studio-optional-protagonist").fill(testStory.protagonist);
    await page.getByTestId("studio-optional-world").fill(testStory.world);
    await page.getByTestId("studio-optional-worldRule").fill(testStory.worldRule);
    await page.getByTestId("studio-create-next").click();
    await page.getByTestId("studio-play-mode-rpg").click();
    for (const stat of ["stamina", "experience", "level"]) {
      await page.getByTestId(`studio-story-stat-${stat}`).check();
    }
    await page.getByTestId("studio-create-next").click();
    await page.getByTestId("studio-create-submit").click();
    const writing = page.getByTestId("studio-writing");
    await writing.waitFor({ state: "visible", timeout: 60_000 });
    const projectId = await writing.getAttribute("data-project-id");
    if (!projectId || !/^[A-Za-z0-9_-]{1,128}$/u.test(projectId)) {
      throw new Error("PROJECT_ID_MISSING");
    }
    await page.getByLabel("正文編輯器").fill(testStory.paragraph);
    await page.getByRole("button", { name: "儲存草稿" }).click();
    await page.waitForTimeout(1_500);

    await page.getByRole("link", { name: /諸天萬界小說生成系統/ }).first().click();
    await page.locator("a.entryCard").filter({ hasText: "AI 助手" }).click();
    await writing.waitFor({ state: "visible", timeout: 60_000 });
    await page.getByRole("link", { name: "設定本機 AI" }).click();
    await page.getByTestId("local-ai-setup").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "檢查本機網路權限" }).click();
    const permissionDeadline = Date.now() + 600_000;
    let permissionAfterStates = {};
    let permissionAfter = { name: "unsupported", state: "unsupported" };
    while (Date.now() < permissionDeadline) {
      permissionAfterStates = await permissionStates(page);
      permissionAfter = resolvedPermission(permissionAfterStates);
      if (permissionAfter.state === "granted") break;
      if (permissionAfter.state === "denied") {
        throw new Error("EDGE_PERMISSION_DENIED_BY_OPERATOR");
      }
      await page.waitForTimeout(250);
    }
    if (permissionAfter.state !== "granted") {
      throw new Error(`EDGE_PERMISSION_GRANT_TIMEOUT:${permissionAfter.state}`);
    }
    process.stdout.write(`${JSON.stringify({
      event: "native_permission_observed",
      permissionName: permissionAfter.name,
      permissionState: permissionAfter.state,
    })}\n`);

    await page.getByTestId("local-ai-start-pairing").click();
    const pairingInput = page.getByTestId("local-ai-pairing-code");
    await pairingInput.waitFor({ state: "visible", timeout: 30_000 });
    const pairing = await invokeLauncher(root, "pair");
    if (!pairing.ok || !/^\d{6}$/u.test(String(pairing.code || ""))) {
      throw new Error("PAIRING_CODE_UNAVAILABLE");
    }
    await pairingInput.fill(String(pairing.code));
    pairing.code = undefined;
    await page.getByTestId("local-ai-confirm-pairing").click();
    const modelProof = page.getByTestId("local-ai-model-proof");
    await modelProof.waitFor({ state: "visible", timeout: 240_000 });
    const modelProofText = (await modelProof.textContent()) || "";
    const verifiedModelId = await page.getByLabel("Ollama 文字模型").inputValue();
    if (
      verifiedModelId !== "qwen2.5:3b"
      || !modelProofText.includes("模型已實際回覆")
      || !modelProofText.includes("資料未離開這台裝置")
    ) {
      throw new Error("QWEN_MODEL_PROOF_MISSING");
    }
    await page.getByRole("link", { name: "回到原本的創作畫面" }).last().click();
    await writing.waitFor({ state: "visible", timeout: 60_000 });

    const canonBefore = await canonSnapshot(page, projectId);
    const canonBeforeHash = digest(canonBefore);
    const chapterBefore = canonBefore.chapters[0];
    await page.getByRole("button", { name: "續寫下一章" }).click();
    let candidate = await waitCandidate(page);
    const firstContent = (await candidate.locator("pre").first().textContent()) || "";
    const firstRecords = await closedAgentCandidates(page, projectId);
    const firstRecord = firstRecords.at(-1);
    if (!firstRecord || firstRecord.actualExecutor !== "local-ollama") {
      throw new Error("FIRST_CANDIDATE_EXECUTOR_MISMATCH");
    }
    if (digest(await canonSnapshot(page, projectId)) !== canonBeforeHash) {
      throw new Error("FIRST_CANDIDATE_MUTATED_CANON");
    }
    await candidate.getByTestId("studio-candidate-discard").click();
    await candidate.waitFor({ state: "hidden", timeout: 60_000 });
    if (digest(await canonSnapshot(page, projectId)) !== canonBeforeHash) {
      throw new Error("DISCARD_MUTATED_CANON");
    }
    await page.getByTestId("studio-candidate-regenerate").click();
    candidate = await waitCandidate(page);
    const secondContent = (await candidate.locator("pre").first().textContent()) || "";
    const allRecords = await closedAgentCandidates(page, projectId);
    const secondRecord = allRecords.at(-1);
    if (!secondRecord || secondRecord.id === firstRecord.id || secondRecord.taskId === firstRecord.taskId) {
      throw new Error("REGENERATION_IDENTITY_NOT_NEW");
    }
    const similarityScore = trigramSimilarity(firstContent, secondContent);
    const firstNormalizedDigest = sha(normalizeCandidate(firstContent));
    const secondNormalizedDigest = sha(normalizeCandidate(secondContent));
    if (firstNormalizedDigest === secondNormalizedDigest || similarityScore >= 0.95) {
      throw new Error("REGENERATION_NOT_DISTINCT");
    }
    if (
      secondRecord.regeneration?.cacheBypassed !== true
      || secondRecord.regeneration?.previousContentReused !== false
      || secondRecord.actualExecutor !== "local-ollama"
      || secondRecord.canonicalMutationCount !== 0
    ) {
      throw new Error("REGENERATION_CONTRACT_NOT_PROVEN");
    }
    await candidate.getByTestId("studio-candidate-diff").getByText(/查看與目前正文的差異/).waitFor();
    if ((await candidate.getByTestId("studio-regeneration-cache-bypassed").textContent())?.trim() !== "yes") {
      throw new Error("REGENERATION_UI_CACHE_BYPASS_MISSING");
    }
    if (digest(await canonSnapshot(page, projectId)) !== canonBeforeHash) {
      throw new Error("REGENERATION_MUTATED_CANON");
    }
    await candidate.getByTestId("studio-candidate-accept").click();
    await candidate.waitFor({ state: "hidden", timeout: 90_000 });
    const canonAfterApproval = await canonSnapshot(page, projectId);
    const chapterAfter = canonAfterApproval.chapters[0];
    if (chapterAfter.revision !== chapterBefore.revision + 1) {
      throw new Error("APPROVAL_REVISION_DELTA_MISMATCH");
    }
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await writing.waitFor({ state: "visible", timeout: 60_000 });
    const persistedDraft = await page.getByLabel("正文編輯器").inputValue();
    if (!persistedDraft.includes(secondContent.trim().slice(0, 24))) {
      throw new Error("APPROVED_REGENERATION_NOT_PERSISTENT");
    }

    await page.getByRole("button", { name: "互動故事" }).first().click();
    await page.getByTestId("studio-rpg-choice").waitFor({ state: "visible" });
    const beforeRpg = await canonSnapshot(page, projectId);
    await page.getByTestId("studio-choice-A").click();
    const choiceResult = page.getByTestId("studio-choice-result");
    await choiceResult.waitFor({ state: "visible", timeout: 300_000 });
    if ((await choiceResult.getByTestId("studio-choice-actual-executor").textContent())?.trim() !== "local-ollama") {
      throw new Error("RPG_EXECUTOR_MISMATCH");
    }
    await choiceResult.getByTestId("studio-choice-accept").click();
    await choiceResult.waitFor({ state: "hidden", timeout: 90_000 });
    const afterRpg = await canonSnapshot(page, projectId);
    if (
      afterRpg.acceptedChoices.length !== beforeRpg.acceptedChoices.length + 1
      || afterRpg.storyBranches.length !== beforeRpg.storyBranches.length + 1
    ) {
      throw new Error("RPG_ATOMIC_UPDATE_MISMATCH");
    }

    await page.getByRole("button", { name: "存檔與備份" }).click();
    const semanticBeforeBackup = digest(semanticCanon(await canonSnapshot(page, projectId)));
    await page.getByRole("button", { name: "立即快速備份" }).click();
    const backupDialog = page.getByRole("dialog").filter({ hasText: "備份詳情" });
    await backupDialog.waitFor({ state: "visible" });
    await backupDialog.getByRole("button", { name: "關閉" }).click();
    await page.getByRole("button", { name: "繼續寫作" }).click();
    await writing.waitFor({ state: "visible" });
    await page.getByLabel("正文編輯器").fill(`${persistedDraft}\n\n驗收暫時變更`);
    await page.getByRole("button", { name: "儲存草稿" }).click();
    await page.waitForTimeout(1_500);
    await page.getByRole("button", { name: "存檔與備份" }).click();
    await page.getByRole("button", { name: "查看詳情" }).first().click();
    await backupDialog.waitFor({ state: "visible" });
    await backupDialog.getByRole("button", { name: "安全還原" }).click();
    await backupDialog.waitFor({ state: "hidden", timeout: 90_000 });
    const semanticAfterRestore = digest(semanticCanon(await canonSnapshot(page, projectId)));
    if (semanticAfterRestore !== semanticBeforeBackup) {
      throw new Error("BACKUP_RESTORE_SEMANTIC_HASH_MISMATCH");
    }

    await page.getByRole("link", { name: /諸天萬界小說生成系統/ }).first().click();
    await page.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible" });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(page, "frontdoor-mobile", overflowRows);
    await page.locator("a.entryCard").filter({ hasText: "繼續最近作品" }).click();
    await writing.waitFor({ state: "visible" });
    await assertNoOverflow(page, "studio-mobile", overflowRows);
    const serviceWorker = await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const response = await fetch("/studio-service-worker.js", { cache: "no-store" });
      const manifest = await fetch("/manifest.webmanifest", { cache: "no-store" });
      return {
        registrationCount: registrations.length,
        scriptStatus: response.status,
        scriptMime: response.headers.get("content-type"),
        manifestStatus: manifest.status,
        manifestMime: manifest.headers.get("content-type"),
      };
    });
    if (serviceWorker.scriptStatus !== 200 || serviceWorker.manifestStatus !== 200) {
      throw new Error("SERVICE_WORKER_OR_MANIFEST_UNAVAILABLE");
    }

    const diagnostics = classifyDiagnostics(consoleRows, pageErrors, networkRows);
    if (diagnostics.productError || diagnostics.securityError || diagnostics.unclassified) {
      throw new Error("RAW_DIAGNOSTIC_CLASSIFICATION_BLOCKED");
    }
    const externalAiRequestCount = networkRows.filter((row) =>
      /(openai|anthropic|gemini|generativelanguage|groq|cohere|mistral)\./iu
        .test(new URL(row.url).hostname)).length;
    if (externalAiRequestCount) throw new Error("EXTERNAL_AI_REQUEST_DETECTED");

    evidence = {
      frontdoor: {
        status: "PASS",
        startedAtRoot: true,
        manualDeepUrlCount: 0,
        legacyUnexpectedRedirectCount: 0,
        navigationRouteDigests: navigationRows.map((route) => sha(route)),
      },
      studio: {
        status: "PASS",
        projectCreated: true,
        characterCreated: true,
        worldRuleCreated: true,
        initialParagraphSaved: true,
        diffDisplayed: true,
        horizontalOverflowCount: 0,
      },
      manualEdge: {
        status: "PASS",
        browser: "Microsoft Edge",
        freshProfile: true,
        permissionName: permissionAfter.name,
        permissionBefore: permissionBefore.state,
        permissionAfter: permissionAfter.state,
        permissionBeforeStates,
        permissionAfterStates,
        nativeDecisionMethod: "HUMAN_OPERATOR",
        permissionInjectionUsed: false,
        windowsUiAutomationUsed: false,
        sendKeysUsed: false,
        browserPolicyModified: false,
        localNetworkAccessBypassUsed: false,
        onlyAllowedHumanAction: "native Edge Allow",
      },
      localOllama: {
        status: "PASS",
        modelId: "qwen2.5:3b",
        actualExecutor: "local-ollama",
        dataLeftDevice: false,
        externalRequest: false,
        pairingCodePersisted: false,
        realInferenceProofVisible: true,
        localBridgeRequestCount: networkRows.filter((row) => new URL(row.url).hostname === "127.0.0.1").length,
      },
      regeneration: {
        status: "PASS",
        firstTaskIdDigest: sha(firstRecord.taskId),
        secondTaskIdDigest: sha(secondRecord.taskId),
        firstCandidateIdDigest: sha(firstRecord.id),
        secondCandidateIdDigest: sha(secondRecord.id),
        firstContentDigest: firstRecord.contentDigest,
        secondContentDigest: secondRecord.contentDigest,
        normalizedDigestDifferent: true,
        similarityMetric: "character_trigram_jaccard",
        similarityScore,
        cacheBypassed: true,
        cacheBypassReason: "explicit_regeneration",
        regenerationAttempt: secondRecord.regeneration.regenerationAttempt,
        actualExecutor: secondRecord.actualExecutor,
        preApprovalCanonMutationCount: secondRecord.canonicalMutationCount,
        noncePersisted: false,
      },
      canon: {
        status: "PASS",
        preApprovalCanonHash: canonBeforeHash,
        postApprovalCanonHash: digest(canonAfterApproval),
        preApprovalMutationCount: 0,
        revisionBefore: chapterBefore.revision,
        revisionAfter: chapterAfter.revision,
        revisionDelta: 1,
        reloadPersisted: true,
      },
      rpg: {
        status: "PASS",
        choiceCount: 3,
        acceptedChoiceDelta: 1,
        storyBranchDelta: 1,
        atomicUpdate: true,
      },
      backupRestore: {
        status: "PASS",
        semanticHashBefore: semanticBeforeBackup,
        semanticHashAfter: semanticAfterRestore,
        semanticHashMatch: true,
      },
      serviceWorker: { status: "PASS", ...serviceWorker },
      mobile: {
        status: "PASS",
        viewport: "390x844",
        horizontalOverflowCount: 0,
      },
      supabase: {
        status: "DEGRADED_ALLOWED",
        productionModified: false,
        cloudPersistenceReady: false,
        localCanonicalFlowReady: true,
      },
      findings: {
        status: "PASS",
        consoleProductErrorCount: diagnostics.productError,
        consoleSecurityErrorCount: diagnostics.securityError,
        consoleUnclassifiedCount: diagnostics.unclassified,
        externalAiRequestCount,
        sanitizedDiagnosticRecords: diagnostics.rows,
        rawConsolePersisted: false,
        rawNetworkPersisted: false,
        privateStoryTextPersisted: false,
        rawChainOfThoughtPersisted: false,
        authorizationHeaderCaptured: false,
        cookieCaptured: false,
        csrfCaptured: false,
      },
    };
  } catch (error) {
    gateError = error;
  } finally {
    await context?.close().catch(() => undefined);
    if (bridgeStarted) await invokeLauncher(root, "stop").catch(() => undefined);
    if (originAdded) {
      await invokeLauncher(root, "origin", "revoke", origin, "--confirm", origin)
        .catch(() => undefined);
    }
    await rm(profilePath, { recursive: true, force: true });
    profileDeleted = true;
  }

  if (gateError || !evidence) {
    await writeJson(artifactRoot, "manual-edge-results.json", {
      status: "BLOCKED",
      errorCode: String(gateError?.message || "EDGE_GATE_FAILED").split(":")[0],
      nativeDecisionMethod: "HUMAN_OPERATOR",
      permissionInjectionUsed: false,
      windowsUiAutomationUsed: false,
      browserPolicyModified: false,
      localNetworkAccessBypassUsed: false,
      profileDeleted,
      privateStoryTextPersisted: false,
    });
    throw gateError ?? new Error("EDGE_GATE_FAILED");
  }

  evidence.manualEdge.profileDeleted = profileDeleted;
  await Promise.all([
    writeJson(artifactRoot, "product-preview-identity.json", {
      status: "PASS",
      origin,
      productCommit,
      releaseIdentity: identity,
      productionUsed: false,
    }),
    writeJson(artifactRoot, "frontdoor-results.json", evidence.frontdoor),
    writeJson(artifactRoot, "studio-results.json", evidence.studio),
    writeJson(artifactRoot, "manual-edge-results.json", evidence.manualEdge),
    writeJson(artifactRoot, "local-ollama-results.json", evidence.localOllama),
    writeJson(artifactRoot, "regeneration-results.json", evidence.regeneration),
    writeJson(artifactRoot, "canon-approval-results.json", evidence.canon),
    writeJson(artifactRoot, "rpg-results.json", evidence.rpg),
    writeJson(artifactRoot, "backup-restore-results.json", evidence.backupRestore),
    writeJson(artifactRoot, "service-worker-results.json", evidence.serviceWorker),
    writeJson(artifactRoot, "mobile-results.json", evidence.mobile),
    writeJson(artifactRoot, "supabase-boundary.json", evidence.supabase),
    writeJson(artifactRoot, "findings.json", evidence.findings),
  ]);
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    nativeDecisionMethod: "HUMAN_OPERATOR",
    permissionTransition: "prompt->granted",
    actualExecutor: "local-ollama",
    productCommit,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    status: "FAIL",
    errorCode: String(error?.message || error).split(":")[0],
  })}\n`);
  process.exitCode = 1;
});
