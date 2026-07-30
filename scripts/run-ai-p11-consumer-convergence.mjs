import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const checks = [];
const check = (name, condition, details = null) => {
  checks.push({ name, status: condition ? "PASS" : "FAIL", details });
};

const rootPage = read("app/page.tsx");
const studioPage = read("app/studio/page.tsx");
const professionalPage = read("app/professional/page.tsx");
const adapter = read("lib/professional-frontdoor.ts");
const config = read("next.config.ts");
const legacy = read("public/legacy/novel-system.html");
const publicHealth = read("app/api/ai/health/route.ts");
const adminHealth = read("app/api/admin/persistence/route.ts");

for (const [route, source] of [
  ["/studio", studioPage],
  ["/professional", professionalPage],
]) {
  check(`${route} uses the shared Professional adapter`, source.includes("buildProfessionalFrontdoorUrl"));
  check(`${route} redirects before rendering a competing shell`, source.includes("redirect(") && !source.includes("<main"));
}

check("root redirects to the Legacy consumer frontdoor", rootPage.includes('redirect("/legacy/novel-system.html?screen=home")'));
check("adapter targets only the Legacy Professional document", adapter.includes('"/legacy/novel-system.html"'));
check("adapter forces Professional mode", adapter.includes('query.set("mode", "professional")'));
check("adapter preserves safe query values", adapter.includes("query.append(key, value)"));
check("adapter retains repeated query values", adapter.includes("Array.isArray(value)"));
check("adapter rejects unsafe query keys", adapter.includes("SAFE_QUERY_KEY"));
check("adapter bounds query value length", adapter.includes("MAX_QUERY_VALUE_LENGTH"));
check("no wildcard Studio redirect exists", !config.includes('source: "/studio/:path*"'));

const menuMarkup = legacy.match(/<div class="nav" data-testid="professional-menu">([\s\S]*?)<\/div><\/aside>/)?.[1] ?? "";
const menuCount = (menuMarkup.match(/<button\b/g) ?? []).length;
check("Professional menu has exactly 27 controls", menuCount === 27, { menuCount });
check("Professional menu is two columns on desktop", legacy.includes("grid-template-columns:repeat(2,minmax(0,1fr))"));
check("Professional menu is one column on compact viewports", legacy.includes("grid-template-columns:1fr!important"));
check("menu labels remain one line", legacy.includes("white-space:nowrap"));
check("left rail scrolls independently", legacy.includes("overflow-y:auto!important") && legacy.includes("overscroll-behavior:contain"));
check("outer document cannot scroll", legacy.includes("overflow:hidden!important"));
check("main workspace scrolls independently", legacy.includes('data-testid="professional-main"') && legacy.includes(".main{"));
check("consumer shell is hidden before first paint", legacy.includes("html.p11-professional-entry body") && legacy.includes("#consumerAppShell"));
check("compatibility banner is hidden", legacy.includes("#legacyCompatibilityBanner"));
check("return consumer control is hidden", legacy.includes("#p11ReturnConsumer"));
check("app dock is hidden", legacy.includes(".appDock"));
check("Professional workspace has a stable marker", legacy.includes('data-testid="professional-workspace"'));
check("Professional route hub has a stable marker", legacy.includes('data-testid="professional-route-hub"'));
const routeCardCount = (legacy.match(/class="p24b-route-card"/g) ?? []).length;
check("route hub exposes all fifteen formal destinations", routeCardCount === 15, { routeCardCount });
for (const route of [
  "write",
  "ai",
  "closed-ai",
  "learning",
  "characters",
  "character-ai",
  "world",
  "timeline",
  "story-bible",
  "tasks",
  "achievements",
  "drama",
  "reader",
  "backups",
]) {
  check(`route hub preserves ${route}`, legacy.includes(`data-project-route="${route}"`));
}
check("screen semantics preserve create", legacy.includes('create:"studio"'));
check("screen semantics preserve write", legacy.includes('write:"studio"'));
check("screen semantics preserve choice", legacy.includes('choice:"interactive"'));
check("screen semantics preserve inspect", legacy.includes('inspect:"miniai"'));
check("screen semantics preserve library", legacy.includes('library:"export"'));
check("task and project context remain observable", legacy.includes("frontdoorTask") && legacy.includes("frontdoorProjectId"));
for (const source of [publicHealth, adminHealth]) {
  check("health exposes unified Professional status", source.includes("unifiedProfessionalUiStatus"));
  check("health exposes deep Studio route status", source.includes("deepStudioRoutesStatus"));
  check("health exposes exact menu count", source.includes("professionalMenuItemCount: 27"));
}

const pass = checks.filter((item) => item.status === "PASS").length;
const fail = checks.length - pass;
for (const item of checks) console.log(`${item.status} ${item.name}`);
console.log(`P1.1 selective Professional convergence: ${pass} PASS / ${fail} FAIL / 0 SKIP`);
if (fail) {
  console.error(JSON.stringify(checks.filter((item) => item.status === "FAIL"), null, 2));
  process.exitCode = 1;
}
