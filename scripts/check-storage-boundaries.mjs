import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const scanRoots = ["lib/novel-ai", "app/api/story-bible", "app/api/admin/story-bible", "app/api/admin/storage", "scripts", "prisma"];

const tablePattern = /\b(story_(?:bible|fact|canonical|characters|events|items|world|foreshadowing|open|chapter|entity|field)[a-z0-9_]*)\b/g;
const directStoragePattern = /SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|\/rest\/v1|database\/query|createClient|(?<!Array)\.from\(|\.rpc\(|executeRaw|raw SQL/gi;
const supabaseNamePattern = /\bsupabase\b|SUPABASE_/gi;

function walk(dir) {
  const full = join(root, dir);
  const entries = [];
  for (const name of readdirSync(full)) {
    const path = join(full, name);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...walk(relative(root, path)));
    else if (/\.(ts|tsx|js|mjs|sql)$/.test(name)) entries.push(relative(root, path).replaceAll("\\", "/"));
  }
  return entries;
}

function ownerOf(file) {
  if (/^lib\/novel-ai\/storage\/supabase\//.test(file) || /^lib\/novel-ai\/storage\/supabase-adapter\.ts$/.test(file)) return "adapter";
  if (/^lib\/novel-ai\/storage\/(?:types|capabilities|authority|registry|index|source-identity|memory-adapter)\.ts$/.test(file)) return "storage-interface";
  if (/^app\/api\/admin\//.test(file)) return "admin";
  if (/^scripts\//.test(file)) return "test-fixture";
  if (/^prisma\//.test(file)) return "migration";
  if (/^lib\/novel-ai\/persistence\.ts$/.test(file)) return "persistence-out-of-scope";
  if (/^lib\/novel-ai\/story-bible-(?:mutations|versions|diff|integrity|export|revert)\.ts$/.test(file)) return "facade";
  if (/^app\/api\/story-bible\//.test(file)) return "api-route";
  if (/^lib\/novel-ai\/story-bible/.test(file)) return "core-service";
  return "unmanaged";
}

function lineFindings(file, text) {
  const lines = text.split(/\r?\n/);
  const findings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const tables = [...new Set([...line.matchAll(tablePattern)].map((m) => m[1]))];
    const directMarkers = [...new Set((line.match(directStoragePattern) || []).map((x) => x.toLowerCase()))];
    const nameMarkers = [...new Set((line.match(supabaseNamePattern) || []).map((x) => x.toLowerCase()))];
    if (tables.length || directMarkers.length || nameMarkers.length) {
      findings.push({
        file,
        line: i + 1,
        tables,
        directMarkers,
        nameMarkers,
        snippet: line.trim().slice(0, 220),
      });
    }
  }
  return findings;
}

const findings = [];
for (const base of scanRoots) {
  for (const file of walk(base)) {
    const text = readFileSync(join(root, file), "utf8");
    const owner = ownerOf(file);
    for (const finding of lineFindings(file, text)) findings.push({ ...finding, owner });
  }
}

function hasDirectStorage(finding) {
  return finding.directMarkers.length > 0;
}

function isCoreViolation(finding) {
  return finding.owner === "core-service" && hasDirectStorage(finding);
}

function isFacadeViolation(finding) {
  return finding.owner === "facade" && hasDirectStorage(finding);
}

function isApiRouteViolation(finding) {
  return finding.owner === "api-route" && hasDirectStorage(finding);
}

function isUnmanagedViolation(finding) {
  return finding.owner === "unmanaged" && hasDirectStorage(finding);
}

const files = (predicate) => [...new Set(findings.filter(predicate).map((x) => x.file))];
const unmanaged = findings.filter(isUnmanagedViolation);
const coreDirect = findings.filter(isCoreViolation);
const facadeDirect = findings.filter(isFacadeViolation);
const apiDirect = findings.filter(isApiRouteViolation);

const summary = {
  coreServiceDirectQueryCount: coreDirect.length,
  coreServiceDirectQueryFileCount: files(isCoreViolation).length,
  coreServiceSupabaseImportCount: coreDirect.filter((x) => x.nameMarkers.length || x.directMarkers.some((m) => m.includes("supabase"))).length,
  facadeViolationCount: facadeDirect.length,
  apiRouteDirectStorageCount: apiDirect.length,
  adapterImplementationQueryCount: findings.filter((x) => x.owner === "adapter" && (hasDirectStorage(x) || x.tables.length)).length,
  adminToolingQueryCount: findings.filter((x) => x.owner === "admin" && (hasDirectStorage(x) || x.tables.length)).length,
  testFixtureQueryCount: findings.filter((x) => x.owner === "test-fixture" && (hasDirectStorage(x) || x.tables.length)).length,
  migrationQueryCount: findings.filter((x) => x.owner === "migration" && (hasDirectStorage(x) || x.tables.length)).length,
  unmanagedCount: unmanaged.length,
  status: coreDirect.length === 0 && facadeDirect.length === 0 && apiDirect.length === 0 && unmanaged.length === 0 ? "PASS" : "FAIL",
  findings: findings.map((finding) => ({
    file: finding.file,
    line: finding.line,
    owner: finding.owner,
    tables: finding.tables,
    directMarkers: finding.directMarkers,
    classification: isCoreViolation(finding)
      ? "core-service-violation"
      : isFacadeViolation(finding)
        ? "facade-violation"
        : isApiRouteViolation(finding)
          ? "api-route-violation"
          : isUnmanagedViolation(finding)
            ? "unmanaged-violation"
            : finding.owner,
    retained: !isCoreViolation(finding) && !isFacadeViolation(finding) && !isApiRouteViolation(finding) && !isUnmanagedViolation(finding),
    snippet: finding.snippet,
  })),
};

console.log(JSON.stringify(summary, null, 2));
if (summary.status !== "PASS") process.exit(1);
