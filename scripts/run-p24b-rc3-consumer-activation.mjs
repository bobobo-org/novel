import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import vm from "node:vm";
import {
  hasVerifiedExecutedStoryOutput,
  isUsableChineseStoryOutput,
} from "../lib/novel-ai/web/story-output-quality.ts";

const mode = process.argv[2] || "all";
const artifactDir = "artifacts/p24b-rc3-consumer-activation/unit";
const expectedIdentity = {
  releaseTag: "novel-ai-p24b-conversation-first-studio-rc6.5",
  releaseRevision: "rc6.5",
  releaseName: "P2.4B Conversation-First Novel Project GPT RC6.5",
  consumerRelease: "p2.4b-conversation-first-studio-rc6.5",
  architectureStage: "P2.4B RC",
};
const cases = [];

async function source(path) {
  return readFile(path, "utf8");
}

async function check(name, work) {
  try {
    await work();
    cases.push({ name, status: "PASS" });
  } catch (error) {
    cases.push({
      name,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function consumerFrontdoorDefault() {
  const [page, frontdoor, config] = await Promise.all([
    source("app/page.tsx"),
    source("app/frontdoor-client.tsx"),
    source("next.config.ts"),
  ]);
  assert.match(page, /<FrontdoorClient/);
  assert.doesNotMatch(page, /redirect\s*\(/);
  assert.doesNotMatch(config, /source:\s*["']\/["']/);
  assert.match(frontdoor, /data-testid="modern-consumer-frontdoor"/);
  const entryBlock = frontdoor.match(/const entries = \[([\s\S]*?)\n\s*\] as const;/u)?.[1] ?? "";
  assert.equal(
    (entryBlock.match(/^\s*\[/gmu) ?? []).length,
    2,
    "the homepage must expose exactly create/select as story starting choices",
  );
  for (const label of ["建立新作品", "選擇作品", "首頁只有兩個開始方式"]) {
    assert.ok(frontdoor.includes(label), `missing unified frontdoor contract: ${label}`);
  }
  for (const obsoleteEntry of ["小說專案助手", "互動故事／RPG", "角色與世界", "進階工具"]) {
    assert.ok(!entryBlock.includes(obsoleteEntry), `obsolete story entry remains: ${obsoleteEntry}`);
  }
  assert.match(frontdoor, /\/professional\?intent=library/);
  assert.match(frontdoor, /\/settings\/local-ai\?returnTo=/);
  for (const truth of ["本機裝置", "未設定", "等待配對", "已就緒", "預設未使用"]) {
    assert.ok(frontdoor.includes(truth), `missing status truth: ${truth}`);
  }
  assert.match(frontdoor, /不會把 API online 顯示成 AI online/);
}

async function studioModernDefault() {
  const [page, config] = await Promise.all([
    source("app/studio/page.tsx"),
    source("next.config.ts"),
  ]);
  assert.doesNotMatch(page, /StudioClient/);
  assert.match(page, /redirect\(projectId \? managementHref\(projectId\) : "\/"\)/);
  assert.match(page, /professional\?intent=library/);
  assert.match(page, /chat\?mode=play/);
  assert.doesNotMatch(page, /legacy\/novel-system/);
  assert.doesNotMatch(config, /source:\s*["']\/studio["']/);
}

async function legacyExplicitOnly() {
  const [frontdoor, studio, migration, createClient, closedWorkspace, legacy, legacyConsumer] = await Promise.all([
    source("app/frontdoor-client.tsx"),
    source("app/studio/studio-client.tsx"),
    source("lib/novel-ai/repository/migration/legacy-studio-migration.ts"),
    source("app/studio/create/create-project-client.tsx"),
    source("app/studio/project/[projectId]/closed-ai/closed-ai-workspace.tsx"),
    source("public/legacy/novel-system.html"),
    source("public/legacy/consumer-app.js"),
  ]);
  assert.match(frontdoor, /legacyMigration=import/);
  assert.doesNotMatch(frontdoor, /function isExplicitLegacyRoute/);
  assert.doesNotMatch(frontdoor, /isExplicitLegacyRoute\(href\)/);
  assert.match(frontdoor, /<a className="entryCard" href=\{href\}/);
  assert.doesNotMatch(frontdoor, /href="\/legacy\/novel-system\.html"/);
  assert.match(studio, /<a className="studioProfessional" href="\/professional">/);
  assert.match(frontdoor, /暫不匯入/);
  assert.match(frontdoor, /到統一作品管理中心/);
  assert.match(frontdoor, /舊作品匯入與相容功能/);
  assert.match(studio, /overwriteExisting:\s*false/);
  assert.match(studio, /const orderedKeys = \[STORAGE_KEY\]/);
  assert.doesNotMatch(createClient, /migrateLegacyStudioProjects/);
  assert.doesNotMatch(closedWorkspace, /migrateLegacyStudioProjects/);
  assert.match(migration, /sourceKeysRetained:\s*true/);
  assert.match(legacy, /data-consumer-entry-mode="legacy-explicit-only"/);
  assert.match(legacyConsumer, /class="p11-modern-home" href="\/">返回新版首頁<\/a>/);
}

async function frontdoorAISetupDiscovery() {
  const [frontdoor, studio, wizard] = await Promise.all([
    source("app/frontdoor-client.tsx"),
    source("app/studio/studio-client.tsx"),
    source("app/settings/local-ai/setup-wizard.tsx"),
  ]);
  assert.match(frontdoor, /\/settings\/local-ai\?returnTo=/);
  assert.match(studio, /className="studioLocalAI"/);
  assert.match(studio, /\/settings\/local-ai\?returnTo=/);
  assert.equal((wizard.match(/className=\{styles\.stepNumber\}/g) ?? []).length, 5);
  for (const heading of [
    "檢查本機網路權限", "準備這台電腦的 AI 服務", "一次性安全配對",
    "選擇模型並做一次實際測試", "設定完成",
  ]) assert.ok(wizard.includes(heading), `missing setup step: ${heading}`);
  assert.match(wizard, /快速本機模式：速度較快，長篇品質有限。/);
  assert.match(wizard, /safeStudioReturnTo/);
  assert.match(
    wizard,
    /configureLocalBridgeClient\(client\);[\s\S]*?coordinator\.refresh\(/,
  );
  assert.match(wizard, /<details>/);
  assert.equal(
    (wizard.match(/href="\/studio\/settings\/ai" prefetch=\{false\}/gu) ?? []).length,
    2,
    "the setup page must not prefetch the shared AI settings chunk before navigation",
  );
}

async function frontdoorProjectRouting() {
  const [frontdoor, professional, createClient, studioPage, wizard] = await Promise.all([
    source("app/frontdoor-client.tsx"),
    source("app/professional/professional-client.tsx"),
    source("app/studio/create/create-project-client.tsx"),
    source("app/studio/page.tsx"),
    source("app/settings/local-ai/setup-wizard.tsx"),
  ]);
  assert.match(frontdoor, /safeProjectId/);
  assert.match(frontdoor, /projectCount === 1 && recentId/);
  assert.match(frontdoor, /`\/studio\/project\/\$\{encodeURIComponent\(recentId\)\}\/chat`/);
  assert.match(frontdoor, /projectCount > 0[\s\S]*?"\/professional\?intent=chat"/);
  assert.match(frontdoor, /從 \$\{projectCount\} 部正式作品中選擇；選定後直接進入該作品的故事工作台/);
  assert.doesNotMatch(frontdoor, /\/studio\/project\/[^\s"'`]+\/(?:rpg|write)/);
  assert.match(professional, /const root = `\/studio\/project\/\$\{encodeURIComponent\(projectId\)\}\/chat`/);
  assert.match(professional, /intent === "play" \? `\$\{root\}\?mode=play` : root/);
  assert.match(professional, /router\.replace\(storyWorkspaceHref\(nextId, intent\)\)/);
  assert.match(professional, /router\.push\(storyWorkspaceHref\(projectId, intent\)\)/);
  assert.match(createClient, /\/chat\$\{createdMode === "general" \? "" : "\?mode=play"\}/);
  assert.doesNotMatch(createClient, /storyPlayModeDashboardHref/);
  assert.match(createClient, /createdMode === "general" \? "進入故事工作台" : "在故事工作台開始遊玩"/);
  assert.match(createClient, /runStudioPreCreationClosedAI/);
  assert.doesNotMatch(createClient, /generateWithBrowserWebLLM|Browser AI 再深化|creation-ai-candidate/);
  assert.match(professional, /作品管理中心/u);
  for (const section of [
    "story-and-chapters",
    "world-and-characters",
    "progress-and-review",
    "data-and-safety",
    "ai-and-learning",
    "extended-creation",
    "video-production",
    "research-and-legacy-tools",
  ]) assert.ok(professional.includes(`id="${section}"`), `missing management section: ${section}`);
  assert.match(professional, /<h2>影片生成（尚未連接）<\/h2>/u);
  assert.match(professional, /\/drama#video-production/);
  assert.match(studioPage, /\^\[A-Za-z0-9_-\]\{1,128\}\$/);
  assert.doesNotMatch(studioPage, /StudioClient/);
  assert.match(studioPage, /requestedScreen === "create"/);
  assert.match(studioPage, /requestedScreen === "write"/);
  assert.match(studioPage, /chat\?mode=play/);
  assert.match(wizard, /value\.startsWith\("\/studio"\)/);
  assert.match(wizard, /href=\{returnTo\}/);
}

async function interactiveStoryOutputAcceptance() {
  assert.equal(
    isUsableChineseStoryOutput(
      "林昭推開門，冷風從走廊灌入。她握緊帳冊，知道這一步會改變所有人的選擇。",
    ),
    true,
    "punctuated Traditional Chinese prose must remain a real-model result",
  );
  assert.equal(
    isUsableChineseStoryOutput("故事太短。"),
    false,
    "short placeholder output must not be accepted as a full story result",
  );
  assert.equal(
    isUsableChineseStoryOutput("This is an English fallback without story prose."),
    false,
    "non-Chinese fallback output must not be accepted",
  );
  assert.equal(
    hasVerifiedExecutedStoryOutput({
      content: "短候選。",
      provider: "local-ollama",
      actualExecutor: "local-ollama",
      modelDigest: "sha256:model",
    }),
    true,
    "verified model provenance must be preserved even when prose is short",
  );
  assert.equal(
    hasVerifiedExecutedStoryOutput({
      content: "短候選。",
      provider: "local-ollama",
      actualExecutor: "not_executed",
      modelDigest: "sha256:model",
    }),
    false,
    "planned routing without an actual executor must not masquerade as model output",
  );
  const studio = await readFile("app/studio/studio-client.tsx", "utf8");
  const branchChoiceStart = studio.indexOf('task: "branch_choice"');
  const branchChoiceRuntime = studio.slice(branchChoiceStart, branchChoiceStart + 8_000);
  const rpgWorkspace = await readFile(
    "app/studio/project/[projectId]/rpg/rpg-workspace.tsx",
    "utf8",
  );
  const legacyRuntimeIsRevisionBound =
    /ensureStudioCanonicalProject\([\s\S]*sourceChapterId:\s*canonical\.chapter\.id[\s\S]*sourceRevision:\s*canonical\.chapter\.revision/u
      .test(branchChoiceRuntime);
  const modernRuntimeIsRevisionBound =
    /loadRpgChatSnapshot\(repository, projectId, rules, learningRepository\)/u
      .test(rpgWorkspace)
    && /snapshot\.chapter\.id\s*!==\s*data\.chapter\.id[\s\S]*snapshot\.chapter\.revision\s*!==\s*data\.chapter\.revision/u
      .test(rpgWorkspace)
    && /generateRpgChatTurnCandidate\(\{[\s\S]*snapshot,/u
      .test(rpgWorkspace);
  assert.equal(
    legacyRuntimeIsRevisionBound || modernRuntimeIsRevisionBound,
    true,
    "RPG model execution must be bound to the active canonical chapter revision",
  );
}

class StorageStub {
  #rows = new Map();
  getItem(key) { return this.#rows.has(key) ? this.#rows.get(key) : null; }
  setItem(key, value) { this.#rows.set(String(key), String(value)); }
  removeItem(key) { this.#rows.delete(String(key)); }
  clear() { this.#rows.clear(); }
}

async function legacyIndexedDbMigrationPreview() {
  globalThis.localStorage = new StorageStub();
  const { createNovelRepository } = await import("../lib/novel-ai/repository/index.ts");
  const {
    EXPLICIT_LEGACY_STUDIO_KEYS,
    migrateLegacyStudioProjects,
    previewLegacyStudioProjects,
  } = await import("../lib/novel-ai/repository/migration/legacy-studio-migration.ts");
  const repository = createNovelRepository();
  localStorage.setItem("novel_p12_studio_state", JSON.stringify({
    projects: [{ id: "shared", title: "新版正式作品", draft: "new canon" }],
  }));
  const legacyBytes = JSON.stringify({
    projects: [
      { id: "shared", title: "舊版同 ID", draft: "old duplicate" },
      { id: "legacy-only", title: "舊版保留作品", draft: "legacy body" },
    ],
  });
  localStorage.setItem(EXPLICIT_LEGACY_STUDIO_KEYS[0], legacyBytes);
  const before = previewLegacyStudioProjects(EXPLICIT_LEGACY_STUDIO_KEYS);
  assert.equal(before.pending, true);
  assert.equal(before.projectCount, 2);
  await migrateLegacyStudioProjects(repository, {
    sourceKeys: ["novel_p12_studio_state"],
    overwriteExisting: true,
  });
  const imported = await migrateLegacyStudioProjects(repository, {
    sourceKeys: EXPLICIT_LEGACY_STUDIO_KEYS,
    overwriteExisting: false,
  });
  assert.equal(imported.skippedExisting, 1);
  assert.equal(imported.migrated, 1);
  assert.equal((await repository.get("projects", "shared"))?.title, "新版正式作品");
  assert.equal((await repository.get("projects", "legacy-only"))?.title, "舊版保留作品");
  assert.equal(localStorage.getItem(EXPLICIT_LEGACY_STUDIO_KEYS[0]), legacyBytes);
  assert.equal(previewLegacyStudioProjects(EXPLICIT_LEGACY_STUDIO_KEYS).pending, false);
}

function requestKey(request) {
  return typeof request === "string" ? request : request.url;
}

async function serviceWorkerFrontdoorUpgrade() {
  const swSource = await source("public/studio-service-worker.js");
  assert.doesNotMatch(swSource, /indexedDB\.deleteDatabase/);
  const listeners = new Map();
  const stores = new Map();
  const oldCommit = "a".repeat(40);
  const oldDigest = "b".repeat(64);
  const oldCacheName = `novel-studio-offline-${oldCommit}-${oldDigest}`;
  stores.set(oldCacheName, new Map([
    ["https://preview.example/", new Response("LEGACY")],
    ["https://preview.example/_next/static/media/logo.abcdef123456.svg", new Response("HASHED-CACHED")],
    ["https://preview.example/_next/static/chunks/challenge.js", new Response("CURRENT-RELEASE-CACHED")],
    ["https://preview.example/_next/static/chunks/network-failure.js", new Response("OFFLINE-CACHED")],
    ["https://preview.example/private.js", new Response("PRIVATE-CACHED")],
  ]));
  let networkCalls = 0;
  const cachePutFailures = new Set([
    "https://preview.example/_next/static/chunks/cache-put-failure.js",
    "https://preview.example/character-portraits/cache-put-failure.png",
    "https://preview.example/runtime/cache-put-failure.js",
  ]);
  let cacheOpenFailures = 0;
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (cacheOpenFailures > 0) {
        cacheOpenFailures -= 1;
        throw new Error("simulated CacheStorage open failure");
      }
      if (!stores.has(name)) stores.set(name, new Map());
      const rows = stores.get(name);
      return {
        async match(request) { return rows.get(requestKey(request))?.clone(); },
        async put(request, response) {
          const key = requestKey(request);
          if (cachePutFailures.has(key)) throw new Error("simulated CacheStorage write failure");
          rows.set(key, response.clone());
        },
        async addAll(paths) {
          for (const path of paths) rows.set(new URL(path, "https://preview.example").href, new Response("seed"));
        },
      };
    },
  };
  const context = vm.createContext({
    URL,
    Response,
    caches,
    fetch: async (request) => {
      networkCalls += 1;
      const url = requestKey(request);
      if (url === "https://preview.example/") return new Response("MODERN");
      if (url.endsWith("/private.js")) return new Response("FORBIDDEN", { status: 403 });
      if (url.endsWith("/challenge.js")) return new Response("CHECKPOINT", { status: 403 });
      if (url.endsWith("/network-failure.js")) throw new Error("simulated network failure");
      return new Response("NETWORK");
    },
    self: {
      location: { origin: "https://preview.example" },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener(type, listener) { listeners.set(type, listener); },
    },
  });
  vm.runInContext(swSource, context, { filename: "studio-service-worker.js" });
  async function fireFetch(url, options = {}) {
    let responsePromise = null;
    listeners.get("fetch")({
      request: {
        url,
        method: "GET",
        mode: options.mode ?? "cors",
        headers: new Headers(options.headers),
      },
      respondWith(value) { responsePromise = Promise.resolve(value); },
    });
    return responsePromise ? responsePromise : null;
  }
  const home = await fireFetch("https://preview.example/", { mode: "navigate" });
  assert.equal(await home.text(), "MODERN");
  assert.equal(networkCalls, 1);
  assert.equal(await fireFetch("https://preview.example/api/ai/health"), null);
  assert.equal(await fireFetch("http://127.0.0.1:43117/health"), null);
  const callsBeforeFlightRequests = networkCalls;
  assert.equal(await fireFetch("https://preview.example/studio?_rsc=flight-token"), null);
  assert.equal(await fireFetch("https://preview.example/studio", { headers: { rsc: "1" } }), null);
  assert.equal(await fireFetch("https://preview.example/studio", {
    headers: { "next-router-prefetch": "1" },
  }), null);
  assert.equal(networkCalls, callsBeforeFlightRequests);
  const protectedNavigation = await fireFetch("https://preview.example/private.js", { mode: "navigate" });
  assert.equal(protectedNavigation.status, 403);
  assert.equal(await protectedNavigation.text(), "FORBIDDEN");
  const callsBeforeHashedAsset = networkCalls;
  const hashed = await fireFetch("https://preview.example/_next/static/media/logo.abcdef123456.svg");
  assert.equal(await hashed.text(), "HASHED-CACHED");
  assert.equal(networkCalls, callsBeforeHashedAsset);
  const chunkDespiteCacheWriteFailure = await fireFetch(
    "https://preview.example/_next/static/chunks/cache-put-failure.js",
  );
  assert.equal(chunkDespiteCacheWriteFailure.status, 200);
  assert.equal(await chunkDespiteCacheWriteFailure.text(), "NETWORK");
  const callsBeforeChunkReuse = networkCalls;
  const firstChunkLoad = await fireFetch(
    "https://preview.example/_next/static/chunks/reused.js",
  );
  const secondChunkLoad = await fireFetch(
    "https://preview.example/_next/static/chunks/reused.js",
  );
  assert.equal(await firstChunkLoad.text(), "NETWORK");
  assert.equal(await secondChunkLoad.text(), "NETWORK");
  assert.equal(networkCalls, callsBeforeChunkReuse + 1);
  cacheOpenFailures = 1;
  const chunkDespiteCacheOpenFailure = await fireFetch(
    "https://preview.example/_next/static/chunks/cache-open-failure.js",
  );
  assert.equal(chunkDespiteCacheOpenFailure.status, 200);
  assert.equal(await chunkDespiteCacheOpenFailure.text(), "NETWORK");
  const networkFirstDespiteCacheWriteFailure = await fireFetch(
    "https://preview.example/runtime/cache-put-failure.js",
  );
  assert.equal(networkFirstDespiteCacheWriteFailure.status, 200);
  assert.equal(await networkFirstDespiteCacheWriteFailure.text(), "NETWORK");
  cacheOpenFailures = 1;
  const networkFirstDespiteCacheOpenFailure = await fireFetch(
    "https://preview.example/runtime/cache-open-failure.js",
  );
  assert.equal(networkFirstDespiteCacheOpenFailure.status, 200);
  assert.equal(await networkFirstDespiteCacheOpenFailure.text(), "NETWORK");
  const imageDespiteCacheWriteFailure = await fireFetch(
    "https://preview.example/character-portraits/cache-put-failure.png",
  );
  assert.equal(imageDespiteCacheWriteFailure.status, 200);
  assert.equal(await imageDespiteCacheWriteFailure.text(), "NETWORK");
  cacheOpenFailures = 2;
  const imageDespiteCacheOpenFailure = await fireFetch(
    "https://preview.example/character-portraits/cache-open-failure.png",
  );
  assert.equal(imageDespiteCacheOpenFailure.status, 200);
  assert.equal(await imageDespiteCacheOpenFailure.text(), "NETWORK");
  const challengedChunk = await fireFetch("https://preview.example/_next/static/chunks/challenge.js");
  assert.equal(challengedChunk.status, 200);
  assert.equal(await challengedChunk.text(), "CURRENT-RELEASE-CACHED");
  const offlineChunk = await fireFetch("https://preview.example/_next/static/chunks/network-failure.js");
  assert.equal(offlineChunk.status, 200);
  assert.equal(await offlineChunk.text(), "OFFLINE-CACHED");
  let waited = null;
  listeners.get("message")({
    data: {
      type: "NOVEL_RELEASE_IDENTITY",
      appCommit: "c".repeat(40),
      assetManifestDigest: "d".repeat(64),
    },
    source: { postMessage() {} },
    waitUntil(value) { waited = Promise.resolve(value); },
  });
  await waited;
  assert.deepEqual(await caches.keys(), [`novel-studio-offline-${"c".repeat(40)}-${"d".repeat(64)}`]);
  const challengedChunkAfterReleaseSwitch = await fireFetch(
    "https://preview.example/_next/static/chunks/challenge.js",
  );
  assert.equal(challengedChunkAfterReleaseSwitch.status, 403);
  assert.equal(await challengedChunkAfterReleaseSwitch.text(), "CHECKPOINT");
}

async function rc3ReleaseIdentity() {
  execFileSync(process.execPath, ["scripts/generate-release-provenance.mjs"], { stdio: "pipe" });
  const [manifestRaw, contractRaw, provenanceRaw, identitySource, healthSource, legacy] = await Promise.all([
    source("release-manifest.json"),
    source("release-metadata-contract.json"),
    source("generated/release-provenance.json"),
    source("lib/novel-ai/runtime-truth/release-identity.ts"),
    source("app/api/ai/health/route.ts"),
    source("public/legacy/novel-system.html"),
  ]);
  const manifest = JSON.parse(manifestRaw);
  const contract = JSON.parse(contractRaw);
  const provenance = JSON.parse(provenanceRaw);
  assert.deepEqual(
    Object.fromEntries(Object.keys(expectedIdentity).map((key) => [key, manifest[key]])),
    expectedIdentity,
  );
  assert.equal(new Date(manifest.releaseEpoch).toISOString(), manifest.releaseEpoch);
  assert.equal(provenance.releaseEpoch, manifest.releaseEpoch);
  assert.match(manifest.consumerRelease, new RegExp(contract.consumerReleasePattern));
  assert.equal(provenance.releaseTag, expectedIdentity.releaseTag);
  assert.match(provenance.appCommit, /^[0-9a-f]{40}$/);
  assert.match(identitySource, /consumerRelease:\s*RELEASE_MANIFEST\.consumerRelease/);
  assert.match(healthSource, /consumerRelease:\s*RELEASE_MANIFEST\.consumerRelease/);
  assert.match(legacy, /__NOVEL_STATIC_CONSUMER_RELEASE__/);
}

async function productionRouteMatrix() {
  const target = String(process.env.RC3_TARGET_URL || "").replace(/\/$/, "");
  if (!target) {
    await consumerFrontdoorDefault();
    await studioModernDefault();
    return;
  }
  for (const path of ["/", "/studio", "/settings/local-ai", "/studio/quick-assistant"]) {
    const response = await fetch(`${target}${path}?rc3_matrix=${Date.now()}`, { redirect: "manual" });
    assert.equal(response.status, 200, `${path} returned ${response.status}`);
    assert.equal(response.headers.get("location"), null, `${path} redirected unexpectedly`);
  }
  const identity = await (await fetch(`${target}/api/release/identity?rc3_matrix=${Date.now()}`, { cache: "no-store" })).json();
  assert.equal(identity.releaseTag, expectedIdentity.releaseTag);
  assert.equal(identity.consumerRelease, expectedIdentity.consumerRelease);
  assert.equal(identity.provenanceStatus, "verified");
}

async function mobileFrontdoorUsability() {
  const [frontdoor, globals, luxury] = await Promise.all([
    source("app/frontdoor-client.tsx"),
    source("app/globals.css"),
    source("app/frontdoor-luxury.module.css"),
  ]);
  const css = `${globals}\n${luxury}`;
  assert.match(frontdoor, /data-testid="modern-consumer-frontdoor"/);
  assert.match(css, /@media\s*\(max-width:\s*430px\)/);
  assert.match(css, /\.luxury\s+:global\(\.entryGrid\)\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.mobileDock\s+a\s*\{[^}]*min-height:\s*50px/su);
  assert.match(css, /\.luxury\s+:global\(\.frontdoorRuntime\)\s*\{\s*display:\s*none/);
  assert.match(luxury, /\.luxury\s+:global\(\.frontdoorHero\)\s*\{[^}]*width:\s*calc\(100%\s*-\s*32px\)/su);
}

const runners = {
  "consumer-frontdoor-default": consumerFrontdoorDefault,
  "studio-modern-default": studioModernDefault,
  "legacy-explicit-only": legacyExplicitOnly,
  "frontdoor-ai-setup-discovery": frontdoorAISetupDiscovery,
  "frontdoor-project-routing": frontdoorProjectRouting,
  "interactive-story-output-acceptance": interactiveStoryOutputAcceptance,
  "legacy-indexeddb-migration-preview": legacyIndexedDbMigrationPreview,
  "service-worker-frontdoor-upgrade": serviceWorkerFrontdoorUpgrade,
  "rc3-release-identity": rc3ReleaseIdentity,
  "production-route-matrix": productionRouteMatrix,
  "mobile-frontdoor-usability": mobileFrontdoorUsability,
};

if (mode === "all") {
  for (const [name, runner] of Object.entries(runners)) await check(name, runner);
} else {
  assert.ok(runners[mode], `unknown RC3 test mode: ${mode}`);
  await check(mode, runners[mode]);
}

const result = {
  schemaVersion: "p24b-rc3-consumer-activation-tests-v1",
  mode,
  pass: cases.filter((item) => item.status === "PASS").length,
  fail: cases.filter((item) => item.status === "FAIL").length,
  skip: 0,
  cases,
};
await mkdir(artifactDir, { recursive: true });
await writeFile(`${artifactDir}/${mode}.json`, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (result.fail) process.exitCode = 1;
