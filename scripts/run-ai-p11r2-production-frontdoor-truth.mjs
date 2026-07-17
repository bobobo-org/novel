import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const origin = (process.env.PRODUCTION_ORIGIN || "").replace(/\/$/, "");
const expectedCommit = process.env.EXPECTED_COMMIT || "";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "release-manifest.json"), "utf8"));
const checks = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const check = (name, condition, evidence = null) => checks.push({ name, pass: Boolean(condition), evidence });

const home = read("app/page.tsx");
const studioPage = read("app/studio/page.tsx");
const studio = read("app/studio/studio-client.tsx");
const config = read("next.config.ts");
const health = read("app/api/ai/health/route.ts");
const legacy = read("public/legacy/novel-system.html");
const serviceWorker = read("public/legacy/service-worker.js");
const css = read("app/globals.css");
const stamp = read("scripts/stamp-static-release.mjs");

check("release manifest is P1.1R2", manifest.releaseTag === "novel-ai-p11r2-production-frontdoor-truth", manifest);
check("home has direct consumer identity", home.includes("諸天萬界小說生成系統") && home.includes("data-consumer-release"));
check("home has no v5.9.1 marker", !home.includes("v5.9.1"));
check("studio route exists", studioPage.includes("StudioClient") && studioPage.includes("RELEASE_MANIFEST"));
check("studio is not rewritten to legacy", !config.includes('source: "/studio"') && !config.includes('destination: "/legacy/novel-system.html"'));
check("studio initial shell is server renderable", studio.includes("studioShell") && studio.includes("今天想創作什麼故事"));
check("consumer navigation is visible", ["開始創作", "繼續寫作", "我的作品", "互動故事"].every((label) => studio.includes(label)));
check("consumer default mode is general", studio.includes("一般模式") && !studio.includes("professionalMode:true"));
check("professional route is separate", fs.existsSync(path.join(root, "app/professional/page.tsx")) && studio.includes('href="/professional"'));
check("legacy is visibly compatibility-only", legacy.includes("相容／專業工具入口") && legacy.includes("前往正式創作中心"));
check("five-step wizard exists", studio.includes("第 {step} 步，共 5 步") && studio.includes("建立故事世界"));
check("creation data persists locally", studio.includes("novel_p11r2_studio_state") && studio.includes("localStorage.setItem"));
check("legacy state migration is safe", studio.includes("novel_p11_consumer_state") && studio.includes("schemaVersion:2"));
check("eight consumer tasks exist", (studio.match(/\["[a-z_]+","/g) || []).length >= 8);
check("candidate boundary is explicit", studio.includes("尚未修改正式正文") && studio.includes("採用並建立版本"));
check("discard preserves formal draft", studio.includes("discard={()=>update({candidate:null})}"));
check("accept creates a version", studio.includes("versions:[old,...p.versions]"));
check("dynamic choices use project context", studio.includes("project?.protagonist") && studio.includes("project?.conflict"));
check("choice state can be undone", studio.includes("undoBranch") && studio.includes("branches.slice(0,-1)"));
check("no external request in studio", !studio.includes('fetch("https://') && !studio.includes("fetch('https://"));
check("responsive studio CSS exists", css.includes(".studioShell") && css.includes("@media(max-width:800px)"));
check("mobile studio navigation exists", css.includes(".studioMenuButton") && css.includes(".studioRail.open"));
check("shared release manifest drives health", health.includes("RELEASE_MANIFEST.releaseTag") && health.includes("consumerRelease"));
check("health exposes truth statuses", ["productionVisualEvidenceStatus", "initialHtmlConsumerShellStatus", "legacyCompatibilityStatus"].every((key) => health.includes(key)));
check("static stamping uses release manifest", stamp.includes("release-manifest.json") && stamp.includes("releaseManifest.releaseTag"));
check("legacy cache version is migrated", serviceWorker.includes("novel-system-p11r2-20260718-1") && serviceWorker.includes("caches.delete"));

async function get(url) {
  const started = Date.now();
  const response = await fetch(url, { headers: { "cache-control": "no-cache" }, redirect: "follow" });
  return { status: response.status, headers: Object.fromEntries(response.headers), text: await response.text(), elapsedMs: Date.now() - started };
}

if (origin) {
  const nonce = Date.now();
  const [rootResponse, studioResponse, healthResponse, legacyResponse] = await Promise.all([
    get(`${origin}/?verify=${nonce}`),
    get(`${origin}/studio?verify=${nonce}`),
    get(`${origin}/api/ai/health?verify=${nonce}`),
    get(`${origin}/legacy/novel-system.html?verify=${nonce}`),
  ]);
  let healthBody = {};
  try { healthBody = JSON.parse(healthResponse.text); } catch {}
  check("production home returns 200", rootResponse.status === 200, rootResponse);
  check("production home initial HTML is consumer", rootResponse.text.includes("諸天萬界小說生成系統") && !rootResponse.text.includes("v5.9.1"));
  check("production studio returns 200", studioResponse.status === 200, studioResponse);
  check("production studio initial HTML is consumer shell", studioResponse.text.includes("今天想創作什麼故事") && studioResponse.text.includes("建立新作品"));
  check("production studio is not legacy body", !studioResponse.text.includes("novelStaticRelease") && !studioResponse.text.includes("小型閉端 AI"));
  check("production legacy remains available", legacyResponse.status === 200 && legacyResponse.text.includes("相容／專業工具入口"));
  check("production health release matches manifest", healthResponse.status === 200 && healthBody.releaseTag === manifest.releaseTag, healthBody);
  check("production health consumer release matches", healthBody.consumerRelease === manifest.consumerRelease, healthBody);
  check("production health truth statuses are ready", healthBody.productionVisualEvidenceStatus === "ready" && healthBody.initialHtmlConsumerShellStatus === "ready" && healthBody.legacyCompatibilityStatus === "ready", healthBody);
  check("production commit matches expected", !expectedCommit || healthBody.appCommit === expectedCommit, { expectedCommit, actual: healthBody.appCommit });
}

for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
const pass = checks.filter((item) => item.pass).length;
const fail = checks.length - pass;
console.log(`P1.1R2 frontdoor truth: ${pass} PASS / ${fail} FAIL / 0 SKIP`);
if (fail) {
  console.error(JSON.stringify(checks.filter((item) => !item.pass), null, 2));
  process.exit(1);
}
