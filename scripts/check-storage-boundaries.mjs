import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const scanRoots = ["lib/novel-ai", "app/api/story-bible", "app/api/admin/story-bible", "scripts"];
const allowlist = [
  { pattern: /^lib\/novel-ai\/storage\/supabase-adapter\.ts$/, owner: "storage", reason: "Supabase-specific adapter implementation.", removalStage: "kept-private" },
  { pattern: /^lib\/novel-ai\/storage\/supabase\//, owner: "storage", reason: "Supabase-specific storage extension implementation.", removalStage: "kept-private" },
  { pattern: /^lib\/novel-ai\/storage\/(?:types|capabilities|authority|registry|index)\.ts$/, owner: "storage", reason: "Storage abstraction may name storage modes without performing direct queries.", removalStage: "kept-interface" },
  { pattern: /^lib\/novel-ai\/persistence\.ts$/, owner: "persistence", reason: "Non-Story-Bible AI run persistence remains outside L0A.1 adapter scope.", removalStage: "P0-persistence-adapter" },
  { pattern: /^lib\/novel-ai\/story-bible-export-sanitizer\.ts$/, owner: "story-bible", reason: "Sanitizer only removes cloud/provider metadata from export packages.", removalStage: "kept-sanitizer" },
  { pattern: /^lib\/novel-ai\/story-bible\.ts$/, owner: "story-bible", reason: "Legacy extraction/persistence service not fully migrated in L0A.1.", removalStage: "L0A.2" },
  { pattern: /^lib\/novel-ai\/story-bible-mutations\.ts$/, owner: "story-bible", reason: "Canonical mutation transaction path remains validated C2C3 path.", removalStage: "L0A.2" },
  { pattern: /^lib\/novel-ai\/story-bible-versions\.ts$/, owner: "story-bible", reason: "Version history read path pending adapter migration.", removalStage: "L0A.2" },
  { pattern: /^lib\/novel-ai\/story-bible-diff\.ts$/, owner: "story-bible", reason: "Diff service pending adapter extension.", removalStage: "L0A.2" },
  { pattern: /^lib\/novel-ai\/story-bible-integrity\.ts$/, owner: "story-bible", reason: "Integrity verifier pending adapter extension.", removalStage: "L0A.2" },
  { pattern: /^lib\/novel-ai\/story-bible-export\.ts$/, owner: "story-bible", reason: "Export service pending adapter extension.", removalStage: "L0A.2" },
  { pattern: /^lib\/novel-ai\/story-bible-revert\.ts$/, owner: "story-bible", reason: "Safe revert service pending adapter extension.", removalStage: "L0A.2" },
  { pattern: /^scripts\//, owner: "qa", reason: "Production smoke/regression scripts may use Supabase Management SQL for verification.", removalStage: "kept-admin-tools" },
  { pattern: /^app\/api\/admin\/story-bible\//, owner: "admin", reason: "Admin fixtures and migrations remain explicit legacy boundary.", removalStage: "L0A.2" },
];

const tablePattern = /\b(story_(?:bible|fact|canonical|characters|events|items|world|foreshadowing|open|chapter|entity|field)[a-z0-9_]*)\b/g;
const supabasePattern = /supabase|SUPABASE_|createClient|\/rest\/v1|database\/query|executeRaw|raw SQL/gi;

function walk(dir) {
  const full = join(root, dir);
  const entries = [];
  for (const name of readdirSync(full)) {
    const path = join(full, name);
    const stat = statSync(path);
    if (stat.isDirectory()) entries.push(...walk(relative(root, path)));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) entries.push(relative(root, path).replaceAll("\\", "/"));
  }
  return entries;
}

function allow(file) {
  return allowlist.find((entry) => entry.pattern.test(file));
}

function isStorageFacade(file, text) {
  if (!/^lib\/novel-ai\/story-bible-(?:mutations|versions|diff|integrity|export|revert)\.ts$/.test(file)) return false;
  const nonEmptyLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return nonEmptyLines.length > 0
    && nonEmptyLines.every((line) => /^export\b/.test(line) || /^[A-Za-z0-9_,{}\s]+$/.test(line) || /^} from "\.\/storage\/supabase\/supabase-[a-z-]+-storage";$/.test(line))
    && text.includes("./storage/supabase/");
}

const findings = [];
for (const base of scanRoots) {
  for (const file of walk(base)) {
    const text = readFileSync(join(root, file), "utf8");
    if (isStorageFacade(file, text)) continue;
    const tableMatches = [...new Set([...text.matchAll(tablePattern)].map((m) => m[1]))];
    const supabaseMatches = [...new Set((text.match(supabasePattern) || []).map((x) => x.toLowerCase()))];
    if (tableMatches.length || supabaseMatches.length) {
      const allowed = allow(file);
      findings.push({
        file,
        directTableNames: tableMatches,
        directSupabaseMarkers: supabaseMatches,
        retained: Boolean(allowed),
        owner: allowed?.owner || null,
        reason: allowed?.reason || "Not allowlisted.",
        plannedRemovalStage: allowed?.removalStage || null,
        risk: allowed ? "managed" : "unmanaged",
      });
    }
  }
}

const unmanaged = findings.filter((x) => !x.retained);
const summary = {
  directQueryFileCount: findings.length,
  directQueryFunctionCount: findings.reduce((sum, x) => sum + x.directTableNames.length + x.directSupabaseMarkers.length, 0),
  directSupabaseImportCount: findings.filter((x) => x.directSupabaseMarkers.length > 0).length,
  remainingAllowlistCount: findings.filter((x) => x.retained).length,
  unmanagedCount: unmanaged.length,
  status: unmanaged.length === 0 ? "PASS" : "FAIL",
  findings,
};

console.log(JSON.stringify(summary, null, 2));
if (unmanaged.length > 0) process.exit(1);
