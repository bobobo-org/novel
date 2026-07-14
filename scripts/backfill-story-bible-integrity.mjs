const baseUrl = process.env.BASE_URL || "https://novel-orcin.vercel.app";
const adminToken = process.env.ADMIN_TOKEN || "";

function arg(name, fallback = undefined) {
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  if (!found) return fallback;
  return found.slice(prefix.length);
}

const projectId = arg("projectId", process.env.PROJECT_ID || "");
const dryRun = arg("dryRun", "true") !== "false";
const fromVersion = arg("fromVersion");
const toVersion = arg("toVersion");
const batchSize = Number(arg("batchSize", "100"));
const stopOnError = arg("stopOnError", "true") !== "false";

if (!projectId) {
  console.error("projectId is required. Use --projectId=...");
  process.exit(2);
}
if (!adminToken) {
  console.error("ADMIN_TOKEN is required.");
  process.exit(2);
}

const body = {
  projectId,
  dryRun,
  batchSize,
  stopOnError,
  ...(fromVersion ? { fromVersion: Number(fromVersion) } : {}),
  ...(toVersion ? { toVersion: Number(toVersion) } : {}),
};

const res = await fetch(`${baseUrl}/api/admin/story-bible/integrity-backfill`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-admin-token": adminToken },
  body: JSON.stringify(body),
});
const text = await res.text();
let json;
try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
console.log(JSON.stringify({ ok: res.ok, status: res.status, body: json }, null, 2));
if (!res.ok) process.exit(1);
