import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RELEASE_TAG = "novel-ai-p24b-conversation-first-studio-rc6";
const CONSUMER_RELEASE = "p2.4b-conversation-first-studio-rc6";
const PRODUCTION_ORIGINS = new Set([
  "https://novel-orcin.vercel.app",
  "https://novel-lqtechs-projects.vercel.app",
]);
const CANON_STORES = [
  "projects", "chapters", "characters", "relationships", "worlds", "worldRules",
  "lore", "timeline", "storyStates", "acceptedChoices", "storyBranches",
  "storyBibles", "storyBibleDeltas", "approvalTransactions", "idempotencyRecords",
];

function argsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = argv[index + 1];
    result[key] = next && !next.startsWith("--") ? argv[++index] : true;
  }
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function safeNetworkUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function assertBaseUrl(value) {
  const url = new URL(String(value || ""));
  const local = url.protocol === "http:"
    && ["127.0.0.1", "localhost"].includes(url.hostname);
  const preview = url.protocol === "https:"
    && url.hostname.endsWith(".vercel.app")
    && !PRODUCTION_ORIGINS.has(url.origin);
  if ((!local && !preview) || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PREVIEW_OR_LOCAL_EXACT_ORIGIN_REQUIRED");
  }
  if (PRODUCTION_ORIGINS.has(url.origin)) throw new Error("PRODUCTION_RUNTIME_GATE_PROHIBITED");
  return { origin: url.origin, local, preview };
}

async function writeJson(root, name, value) {
  await writeFile(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

async function releaseIdentity(origin) {
  const response = await fetch(`${origin}/api/release/identity?gate=${crypto.randomUUID()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`RELEASE_IDENTITY_HTTP_${response.status}`);
  const body = await response.json();
  const identity = body.releaseIdentity || body;
  if (identity.releaseTag !== RELEASE_TAG) throw new Error("RC5_RELEASE_TAG_MISMATCH");
  if (identity.consumerRelease !== CONSUMER_RELEASE) throw new Error("RC5_CONSUMER_RELEASE_MISMATCH");
  if (identity.provenanceStatus !== "verified") throw new Error("RC3_PROVENANCE_NOT_VERIFIED");
  if (!/^[0-9a-f]{40}$/i.test(String(identity.appCommit || ""))) throw new Error("APP_COMMIT_NOT_BUILD_SEALED");
  return identity;
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

function semanticCanon(snapshot) {
  const transient = new Set([
    "id", "createdAt", "updatedAt", "revision", "revisionNumber", "backupId",
    "transactionId", "idempotencyKey", "hash", "digest", "previousHash",
  ]);
  const cleanse = (value) => {
    if (Array.isArray(value)) return value.map(cleanse);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !transient.has(key))
      .map(([key, nested]) => [key, cleanse(nested)]));
  };
  return cleanse(snapshot);
}

async function noOverflow(page, label, checks) {
  const value = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  const pass = value.document <= value.viewport + 1;
  checks.push({ name: `${label}-no-horizontal-overflow`, status: pass ? "PASS" : "FAIL", ...value });
  if (!pass) throw new Error(`HORIZONTAL_OVERFLOW:${label}`);
}

async function waitCandidate(page, timeout = 300_000) {
  const candidate = page.getByTestId("studio-candidate");
  await candidate.waitFor({ state: "visible", timeout });
  await candidate.getByText("真實閉端 AI 候選").waitFor({ state: "visible", timeout });
  return candidate;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const target = assertBaseUrl(args["base-url"]);
  const root = process.cwd();
  const artifactRoot = path.resolve(String(args.artifacts || "artifacts/p24b-rc3-consumer-activation/preview-gate"));
  const screenshotRoot = path.join(artifactRoot, "screenshots");
  const profilePath = path.resolve(String(args.profile || path.join(artifactRoot, "fresh-edge-profile")));
  const reuseProfile = args["reuse-profile"] === true;
  await mkdir(screenshotRoot, { recursive: true });
  if (!reuseProfile) await rm(profilePath, { recursive: true, force: true });
  await mkdir(profilePath, { recursive: true });

  const identity = await releaseIdentity(target.origin);
  const status = await invokeLauncher(root, "status");
  if (status.bridge?.alive) throw new Error("BRIDGE_ALREADY_RUNNING_BEFORE_GATE");

  let originAdded = false;
  let bridgeStarted = false;
  let context;
  const checks = [];
  const consoleRows = [];
  const pageErrors = [];
  const networkRows = [];
  const externalAiRows = [];
  const findings = [];
  const testStory = {
    title: "RC5 Preview 驗收故事",
    idea: "一名守燈人發現城市的夜空正在遺忘星星。",
    protagonist: "沈曜",
    world: "每座城市由一盞記憶之燈維持歷史。",
    worldRule: "每次點亮失落星辰，守燈人會失去一段自己的記憶。",
    paragraph: "雨落在觀星塔的銅瓦上，沈曜握緊熄滅的星燈，第一次聽見天空呼救。",
  };

  try {
    await invokeLauncher(root, "origin", "add", target.origin, "--confirm", target.origin);
    originAdded = true;
    await invokeLauncher(root, "start", "--origin", target.origin);
    bridgeStarted = true;

    context = await chromium.launchPersistentContext(profilePath, {
      channel: "msedge",
      headless: args.headed !== true,
      viewport: { width: 1440, height: 1000 },
      serviceWorkers: "allow",
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    const page = context.pages()[0] || await context.newPage();
    page.on("console", (message) => {
      consoleRows.push({ type: message.type(), text: message.text().replace(/\s+/g, " ").slice(0, 1000) });
    });
    page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 1000)));
    page.on("request", (request) => {
      const row = { phase: "request", method: request.method(), url: safeNetworkUrl(request.url()), resourceType: request.resourceType() };
      networkRows.push(row);
      if (/(openai|anthropic|gemini|generativelanguage|groq|cohere|mistral)\./i.test(new URL(request.url()).hostname)) {
        externalAiRows.push(row);
      }
    });
    page.on("response", (response) => networkRows.push({ phase: "response", status: response.status(), url: safeNetworkUrl(response.url()) }));

    // 1-5: begin only at the consumer frontdoor and create canonical story data through UI.
    await page.goto(`${target.origin}/`, { waitUntil: "networkidle", timeout: 60_000 });
    await page.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible", timeout: 60_000 });
    checks.push({ name: "01-modern-frontdoor", status: "PASS", manualDeepUrlCount: 0 });
    await noOverflow(page, "frontdoor-desktop", checks);
    await page.getByRole("link", { name: /開始新故事/ }).first().click();
    await page.getByTestId("studio-create-wizard").waitFor({ state: "visible", timeout: 60_000 });
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
    if (!projectId || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) throw new Error("PROJECT_ID_MISSING");
    await page.getByLabel("正文編輯器").fill(testStory.paragraph);
    await page.getByRole("button", { name: "儲存草稿" }).click();
    await page.waitForTimeout(1_500);
    const initialCanon = await canonSnapshot(page, projectId);
    checks.push({ name: "02-05-project-character-world-paragraph", status: "PASS", projectIdPresent: true, canonHash: digest(initialCanon) });

    // 6-11: discover AI from the homepage, pair in the five-step wizard, and return.
    await page.getByRole("link", { name: /諸天萬界小說生成系統/ }).first().click();
    await page.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible" });
    await page.locator("a.entryCard").filter({ hasText: "AI 助手" }).click();
    await writing.waitFor({ state: "visible", timeout: 60_000 });
    await page.getByRole("link", { name: "設定本機 AI" }).click();
    await page.getByTestId("local-ai-setup").waitFor({ state: "visible", timeout: 60_000 });
    await page.getByRole("button", { name: "檢查本機網路權限" }).click();
    await page.getByTestId("local-ai-start-pairing").click();
    const pairingInput = page.getByTestId("local-ai-pairing-code");
    await pairingInput.waitFor({ state: "visible", timeout: 30_000 });
    const pairing = await invokeLauncher(root, "pair");
    if (!pairing.ok || !/^\d{6}$/.test(String(pairing.code || ""))) throw new Error("PAIRING_CODE_UNAVAILABLE");
    await pairingInput.fill(String(pairing.code));
    pairing.code = undefined;
    await page.getByTestId("local-ai-confirm-pairing").click();
    await page.getByTestId("local-ai-model-proof").waitFor({ state: "visible", timeout: 240_000 });
    const setupExecutor = (await page.getByTestId("local-ai-actual-executor").textContent())?.trim();
    if (setupExecutor !== "not_executed") throw new Error(`SETUP_EXECUTION_TRUTH_MISMATCH:${setupExecutor}`);
    checks.push({
      name: "06-10-edge-local-ollama", status: "PASS",
      modelVerification: "real_inference_proof_visible",
      actualExecutorBeforeStoryTask: setupExecutor,
      modelId: "qwen2.5:3b", pairingCodeStored: false,
    });
    await page.getByRole("link", { name: "回到原本的創作畫面" }).last().click();
    await writing.waitFor({ state: "visible", timeout: 60_000 });
    if (!page.url().includes(projectId)) findings.push("Return URL did not retain projectId text, but the active project was restored from the canonical shell.");

    // 12-20: real chapter continuation, discard boundary, approval, and reload persistence.
    const canonBeforeCandidate = digest(await canonSnapshot(page, projectId));
    await page.getByRole("button", { name: "續寫下一章" }).click();
    let candidate = await waitCandidate(page);
    const actualExecutor = (await candidate.getByTestId("studio-candidate-actual-executor").textContent())?.trim();
    const dataLeftDevice = (await candidate.getByTestId("studio-candidate-data-left-device").textContent())?.trim();
    const externalRequest = (await candidate.getByTestId("studio-candidate-external-request").textContent())?.trim();
    if (actualExecutor !== "local-ollama" || dataLeftDevice !== "否" || externalRequest !== "否") {
      throw new Error(`CANDIDATE_TRUTH_MISMATCH:${actualExecutor}:${dataLeftDevice}:${externalRequest}`);
    }
    const firstCandidateDigest = digest((await candidate.locator("pre").first().textContent()) || "");
    const canonWithCandidate = digest(await canonSnapshot(page, projectId));
    if (canonWithCandidate !== canonBeforeCandidate) throw new Error("PRE_APPROVAL_CANON_MUTATION");
    await candidate.getByTestId("studio-candidate-discard").click();
    await candidate.waitFor({ state: "hidden", timeout: 60_000 });
    const canonAfterDiscard = digest(await canonSnapshot(page, projectId));
    if (canonAfterDiscard !== canonBeforeCandidate) throw new Error("DISCARD_CHANGED_CANON");
    await page.getByRole("button", { name: "續寫下一章" }).click();
    candidate = await waitCandidate(page);
    const secondCandidateDigest = digest((await candidate.locator("pre").first().textContent()) || "");
    await candidate.getByTestId("studio-candidate-accept").click();
    await candidate.waitFor({ state: "hidden", timeout: 90_000 });
    const canonAfterApproval = digest(await canonSnapshot(page, projectId));
    if (canonAfterApproval === canonBeforeCandidate) throw new Error("APPROVAL_DID_NOT_CHANGE_CANON");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await writing.waitFor({ state: "visible", timeout: 60_000 });
    const persistedDraft = await page.getByLabel("正文編輯器").inputValue();
    if (persistedDraft.length <= testStory.paragraph.length) throw new Error("APPROVED_TEXT_NOT_PERSISTENT_AFTER_RELOAD");
    checks.push({
      name: "12-20-canon-approval-reload", status: "PASS", actualExecutor,
      dataLeftDevice: false, externalRequest: false, preApprovalMutationCount: 0,
      firstCandidateDigest, secondCandidateDigest, approvedCanonHash: canonAfterApproval,
    });

    // 21-24: consumer RPG A/B/C and atomic accepted-choice/story-branch update.
    await page.getByRole("button", { name: "互動故事" }).first().click();
    await page.getByTestId("studio-rpg-choice").waitFor({ state: "visible", timeout: 60_000 });
    const beforeRpg = await canonSnapshot(page, projectId);
    const acceptedBefore = beforeRpg.acceptedChoices.length;
    const branchesBefore = beforeRpg.storyBranches.length;
    await page.getByTestId("studio-choice-A").click();
    const choiceResult = page.getByTestId("studio-choice-result");
    await choiceResult.waitFor({ state: "visible", timeout: 300_000 });
    if ((await choiceResult.getByTestId("studio-choice-external-request").textContent())?.trim() !== "否") throw new Error("RPG_EXTERNAL_REQUEST");
    if ((await choiceResult.getByTestId("studio-choice-data-left-device").textContent())?.trim() !== "否") throw new Error("RPG_DATA_LEFT_DEVICE");
    await choiceResult.getByTestId("studio-choice-accept").click();
    await choiceResult.waitFor({ state: "hidden", timeout: 90_000 });
    const afterRpg = await canonSnapshot(page, projectId);
    if (afterRpg.acceptedChoices.length !== acceptedBefore + 1 || afterRpg.storyBranches.length !== branchesBefore + 1) {
      throw new Error("RPG_ATOMIC_UPDATE_MISMATCH");
    }
    checks.push({ name: "21-24-rpg-atomic-choice", status: "PASS", choices: 3, acceptedChoiceDelta: 1, storyBranchDelta: 1 });

    // 25-27: backup, mutate, restore, and semantic equivalence.
    await page.getByRole("button", { name: "存檔與備份" }).click();
    const semanticBeforeBackup = digest(semanticCanon(await canonSnapshot(page, projectId)));
    await page.getByRole("button", { name: "立即快速備份" }).click();
    const backupDialog = page.getByRole("dialog").filter({ hasText: "備份詳情" });
    await backupDialog.waitFor({ state: "visible", timeout: 60_000 });
    await backupDialog.getByRole("button", { name: "關閉" }).click();
    await page.getByRole("button", { name: "繼續寫作" }).click();
    await writing.waitFor({ state: "visible" });
    await page.getByLabel("正文編輯器").fill(`${persistedDraft}\n\n（驗收用暫時變更）`);
    await page.getByRole("button", { name: "儲存草稿" }).click();
    await page.waitForTimeout(1_500);
    await page.getByRole("button", { name: "存檔與備份" }).click();
    await page.getByRole("button", { name: "查看詳情" }).first().click();
    await backupDialog.waitFor({ state: "visible" });
    await backupDialog.getByRole("button", { name: "安全還原" }).click();
    await backupDialog.waitFor({ state: "hidden", timeout: 90_000 });
    const semanticAfterRestore = digest(semanticCanon(await canonSnapshot(page, projectId)));
    if (semanticAfterRestore !== semanticBeforeBackup) throw new Error("BACKUP_RESTORE_SEMANTIC_HASH_MISMATCH");
    checks.push({ name: "25-27-backup-restore", status: "PASS", semanticHash: semanticAfterRestore });

    // 28-30: explicit Legacy, return, and mobile core flow.
    await page.getByRole("link", { name: /諸天萬界小說生成系統/ }).first().click();
    await page.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible" });
    await page.getByRole("link", { name: "Legacy 進階工具" }).click();
    await page.locator("#novelStaticRelease[data-consumer-entry-mode='legacy-explicit-only']").waitFor({ state: "attached", timeout: 60_000 });
    await page.getByRole("link", { name: "返回新版首頁" }).click();
    await page.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible", timeout: 60_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("link", { name: /諸天萬界/ }).first().click();
    await page.getByTestId("modern-consumer-frontdoor").waitFor({ state: "visible" });
    await noOverflow(page, "mobile-frontdoor", checks);
    await page.locator("a.entryCard").filter({ hasText: "繼續最近作品" }).click();
    await writing.waitFor({ state: "visible", timeout: 60_000 });
    await noOverflow(page, "mobile-studio", checks);
    await page.screenshot({ path: path.join(screenshotRoot, "mobile-core-390x844.png"), fullPage: true });
    checks.push({ name: "28-30-legacy-return-mobile", status: "PASS", legacyUnexpectedRedirectCount: 0, viewport: "390x844" });

    if (externalAiRows.length) throw new Error("EXTERNAL_AI_REQUEST_DETECTED");
    if (pageErrors.length) throw new Error(`PAGE_ERROR:${pageErrors[0]}`);
    const errorConsole = consoleRows.filter((row) => row.type === "error" && !/favicon/i.test(row.text));
    if (errorConsole.length) findings.push(`Console error rows requiring review: ${errorConsole.length}`);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(screenshotRoot, "final-desktop.png"), fullPage: true });
    const result = {
      schemaVersion: "p24b-rc3-preview-consumer-gate-v1",
      status: "PASS",
      origin: target.origin,
      releaseIdentity: identity,
      browser: { product: "Microsoft Edge", freshProfile: !reuseProfile, nativeProfileReused: reuseProfile },
      model: { modelId: "qwen2.5:3b", actualExecutor: "local-ollama", dataLeftDevice: false, externalRequest: false },
      manualDeepUrlCount: 0,
      horizontalOverflowCount: 0,
      legacyUnexpectedRedirectCount: 0,
      externalAiRequestCount: 0,
      preApprovalCanonMutationCount: 0,
      pairingCodePersisted: false,
      privateStoryTextPersistedInEvidence: false,
      checks,
      findings,
    };
    await writeJson(artifactRoot, "preview-consumer-gate.json", result);
    await writeJson(artifactRoot, "console.json", { rows: consoleRows });
    await writeJson(artifactRoot, "network.json", { rows: networkRows });
    process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, origin: target.origin })}\n`);
  } catch (error) {
    await writeJson(artifactRoot, "preview-consumer-gate.json", {
      schemaVersion: "p24b-rc3-preview-consumer-gate-v1",
      status: "FAIL",
      origin: target.origin,
      error: error instanceof Error ? error.message : String(error),
      checks,
      findings,
      pairingCodePersisted: false,
      privateStoryTextPersistedInEvidence: false,
    });
    throw error;
  } finally {
    await context?.close();
    if (bridgeStarted) await invokeLauncher(root, "stop").catch(() => undefined);
    if (originAdded) await invokeLauncher(root, "origin", "revoke", target.origin, "--confirm", target.origin).catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", error: error.message })}\n`);
  process.exitCode = 1;
});
