import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import vm from "node:vm";

const mode = process.argv[2] || "all";
const artifactDir = "artifacts/p24b-rc3-consumer-activation/unit";
const expectedIdentity = {
  releaseTag: "novel-ai-p24b-runtime-consumer-activation-rc3",
  releaseName: "P2.4B Closed AI Runtime and Consumer Activation RC3",
  consumerRelease: "p2.4b-runtime-consumer-activation-rc3",
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
  for (const label of [
    "開始新故事", "繼續最近作品", "AI 助手", "互動故事／RPG", "角色",
    "世界／Story Bible", "我的作品", "本機 AI 設定", "進階工具",
  ]) assert.ok(frontdoor.includes(label), `missing frontdoor entry: ${label}`);
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
  assert.match(page, /<StudioClient/);
  assert.match(page, /initialProjectId/);
  assert.match(page, /initialTask/);
  assert.match(page, /initialScreen/);
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
  assert.match(frontdoor, /function isExplicitLegacyRoute/);
  assert.match(frontdoor, /isExplicitLegacyRoute\(href\) \? \(/);
  assert.match(frontdoor, /<a className="entryCard" href=\{href\}/);
  assert.match(frontdoor, /<a href="\/legacy\/novel-system\.html"/);
  assert.match(studio, /<a className="studioProfessional" href="\/professional">/);
  assert.match(frontdoor, /暫不匯入/);
  assert.match(frontdoor, /繼續使用舊版/);
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
}

async function frontdoorProjectRouting() {
  const [frontdoor, studioPage, wizard] = await Promise.all([
    source("app/frontdoor-client.tsx"),
    source("app/studio/page.tsx"),
    source("app/settings/local-ai/setup-wizard.tsx"),
  ]);
  assert.match(frontdoor, /safeProjectId/);
  assert.match(frontdoor, /projectId=\$\{encodeURIComponent\(recentId\)\}/);
  assert.match(studioPage, /\^\[A-Za-z0-9_-\]\{1,128\}\$/);
  assert.match(wizard, /value\.startsWith\("\/studio"\)/);
  assert.match(wizard, /href=\{returnTo\}/);
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
  ]));
  let networkCalls = 0;
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const rows = stores.get(name);
      return {
        async match(request) { return rows.get(requestKey(request))?.clone(); },
        async put(request, response) { rows.set(requestKey(request), response.clone()); },
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
  const hashed = await fireFetch("https://preview.example/_next/static/media/logo.abcdef123456.svg");
  assert.equal(await hashed.text(), "HASHED-CACHED");
  assert.equal(networkCalls, 1);
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
  assert.match(manifest.buildTime, /^2026-08-/);
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
  const [frontdoor, css] = await Promise.all([
    source("app/frontdoor-client.tsx"),
    source("app/globals.css"),
  ]);
  assert.match(frontdoor, /data-testid="modern-consumer-frontdoor"/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(css, /\.entryGrid\{grid-template-columns:1fr\}/);
  assert.match(css, /\.frontdoorRuntime\{grid-template-columns:1fr/);
  assert.doesNotMatch(css, /\.frontdoor[^}]*width:\s*(?:[4-9]\d\d|\d{4,})px/);
}

const runners = {
  "consumer-frontdoor-default": consumerFrontdoorDefault,
  "studio-modern-default": studioModernDefault,
  "legacy-explicit-only": legacyExplicitOnly,
  "frontdoor-ai-setup-discovery": frontdoorAISetupDiscovery,
  "frontdoor-project-routing": frontdoorProjectRouting,
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
