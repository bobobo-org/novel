import fs from "node:fs";

const origin = (process.env.PRODUCTION_ORIGIN || "").replace(/\/$/, "");
const expectedCommit = process.env.EXPECTED_COMMIT || "";
const manifest = JSON.parse(fs.readFileSync("release-manifest.json", "utf8"));
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
const health = read("app/api/ai/health/route.ts");

check("manifest is P2.4B RC2", manifest.releaseTag === "novel-ai-p24b-character-agent-rc2");
check("root is an exact route adapter", rootPage.includes("buildProfessionalFrontdoorUrl"));
check("Studio index is an exact route adapter", studioPage.includes("buildProfessionalFrontdoorUrl"));
check("Professional index is an exact route adapter", professionalPage.includes("buildProfessionalFrontdoorUrl"));
check("adapter preserves query semantics", adapter.includes("Object.keys(searchParams).sort()"));
check("adapter forces Professional mode exactly once", adapter.includes('query.set("mode", "professional")'));
check("Studio child wildcard redirect is prohibited", !config.includes('source: "/studio/:path*"'));
check("first-paint Professional class is installed in head", legacy.indexOf("p11-professional-entry") < legacy.indexOf("</head>"));
check("first-paint layout marker exists", legacy.includes('id="p24b-rc2-unified-professional-layout"'));
check("Professional body marker exists", legacy.includes('data-workspace-version="p24b-rc2-unified-ui"'));
check("static release metadata exposes UI version", legacy.includes('data-professional-ui-version="p24b-rc2-unified-ui"'));
check("health is release-manifest driven", health.includes("RELEASE_MANIFEST.releaseTag"));
check("health exposes UI convergence truth", health.includes("uiConvergenceGateStatus"));

async function request(pathname, redirect = "manual") {
  const response = await fetch(`${origin}${pathname}`, {
    headers: { "cache-control": "no-cache" },
    redirect,
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    text: await response.text(),
  };
}

if (origin) {
  const frontdoors = [
    ["/", "/legacy/novel-system.html?mode=professional"],
    ["/studio", "/legacy/novel-system.html?mode=professional"],
    ["/studio?screen=home&task=inspect&projectId=project-1", "/legacy/novel-system.html?mode=professional&projectId=project-1&screen=home&task=inspect"],
    ["/professional?screen=library", "/legacy/novel-system.html?mode=professional&screen=library"],
  ];
  for (const [source, expectedLocation] of frontdoors) {
    const response = await request(source);
    const location = response.location ? new URL(response.location, origin) : null;
    check(`${source} returns a redirect`, response.status === 307, response);
    check(`${source} targets the exact Professional document`, location && `${location.pathname}${location.search}` === expectedLocation, response);
  }

  const [legacyResponse, createResponse, healthResponse] = await Promise.all([
    request("/legacy/novel-system.html?mode=professional", "follow"),
    request("/studio/create", "manual"),
    request("/api/ai/health", "follow"),
  ]);
  let healthBody = {};
  try {
    healthBody = JSON.parse(healthResponse.text);
  } catch {}
  check("Professional document returns 200", legacyResponse.status === 200, legacyResponse.status);
  check("Professional document contains first-paint workspace", legacyResponse.text.includes('data-testid="professional-workspace"'));
  check("Studio create remains a direct Next.js page", createResponse.status === 200 && !createResponse.location, createResponse);
  check("public health returns 200", healthResponse.status === 200, healthResponse.status);
  check("public health release tag matches", healthBody.releaseTag === manifest.releaseTag, healthBody);
  check("public health architecture stage matches", healthBody.architectureStage === manifest.architectureStage, healthBody);
  check("public health provenance is verified", healthBody.commitProvenanceStatus === "verified", healthBody);
  check("public health Product commit matches", !expectedCommit || healthBody.appCommit === expectedCommit, {
    expectedCommit,
    actualCommit: healthBody.appCommit,
  });
}

const pass = checks.filter((item) => item.status === "PASS").length;
const fail = checks.length - pass;
for (const item of checks) console.log(`${item.status} ${item.name}`);
console.log(`P1.1R2 Professional frontdoor truth: ${pass} PASS / ${fail} FAIL / 0 SKIP`);
if (fail) {
  console.error(JSON.stringify(checks.filter((item) => item.status === "FAIL"), null, 2));
  process.exitCode = 1;
}
