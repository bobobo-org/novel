import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "evals", "novel-ai-evals.jsonl");
const rows = fs
  .readFileSync(file, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const results = rows.map((row) => {
  const context = row.context || {};
  const checks = [
    Boolean(context.projectId),
    Boolean(context.protagonist?.name),
    Array.isArray(context.forbiddenChanges),
    String(context.recentText || "").length <= 5000,
    Array.isArray(row.expected) && row.expected.length > 0,
  ];
  return { id: row.id, status: checks.every(Boolean) ? "PASS" : "FAIL", checks };
});

if (rows.length < 50) {
  console.error(`FAIL eval-count expected >= 50, got ${rows.length}`);
  process.exit(1);
}

for (const result of results) {
  console.log(`${result.status} ${result.id}`);
}
const failed = results.filter((x) => x.status !== "PASS");
if (failed.length) process.exit(1);
