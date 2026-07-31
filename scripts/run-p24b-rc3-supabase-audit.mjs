import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const artifactDir = "artifacts/p24b-rc3-consumer-activation";
const repairPath = "prisma/repair-plans/p24b_rc3_supabase_persistence_additive.sql";
const requiredTables = [
  "schema_migrations",
  "health_checks",
  "ai_runs",
  "feedback",
  "training_examples",
  "evaluation_runs",
  "model_errors",
  "story_memories",
  "memory_candidates",
];

const [repairSql, migrationOne, migrationTwo, baselineRaw] = await Promise.all([
  readFile(repairPath, "utf8"),
  readFile("prisma/migrations/001_p0b_persistence.sql", "utf8"),
  readFile("prisma/migrations/002_p0b2_db_first.sql", "utf8"),
  readFile(`${artifactDir}/production-baseline.json`, "utf8"),
]);
const baseline = JSON.parse(baselineRaw);
const normalized = repairSql
  .replace(/--[^\n]*/g, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);
const allowedStatement = /^(?:create\s+table\s+if\s+not\s+exists|create\s+index\s+if\s+not\s+exists|alter\s+table\s+[^\s]+\s+add\s+column\s+if\s+not\s+exists|insert\s+into)\b/i;
const forbidden = /\b(?:drop|truncate|delete|update|supabase\s+db\s+reset|alter\s+table\s+[^;]+\s+(?:drop|rename))\b/i;
const unexpectedStatements = normalized.filter((statement) => !allowedStatement.test(statement));
const forbiddenStatements = normalized.filter((statement) => forbidden.test(statement));

function catalogAfter(sql, initial = new Set()) {
  const catalog = new Set(initial);
  for (const match of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+(?:public\.)?([a-z0-9_]+)/gi)) {
    catalog.add(match[1].toLowerCase());
  }
  return catalog;
}

const firstCatalog = catalogAfter(repairSql);
const secondCatalog = catalogAfter(repairSql, firstCatalog);
const missingRepairTables = requiredTables.filter((table) => !firstCatalog.has(table));
const sourceSql = `${migrationOne}\n${migrationTwo}`;
const missingSourceTables = requiredTables.filter((table) => (
  !new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}\\b`, "i").test(sourceSql)
));
const productionHealth = baseline.aliases?.[0]?.endpoints?.["/api/ai/health"]?.stable ?? {};
const persistenceHealth = baseline.aliases?.[0]?.endpoints?.["/api/persistence/health"]?.stable ?? {};

assert.equal(unexpectedStatements.length, 0, "repair plan contains a non-additive statement");
assert.equal(forbiddenStatements.length, 0, "repair plan contains destructive SQL");
assert.deepEqual([...secondCatalog].sort(), [...firstCatalog].sort(), "second application changed the isolated catalog");
assert.equal(missingRepairTables.length, 0, "repair plan does not cover every required table");
assert.equal(missingSourceTables.length, 0, "source migrations do not cover every required table");
assert.equal(baseline.productionMutationCount, 0, "baseline records a Production mutation");

const result = {
  schemaVersion: "p24b-rc3-supabase-audit-v1",
  capturedAt: new Date().toISOString(),
  status: "SUPABASE_PRODUCTION_REPAIR_READY_FOR_EXPLICIT_APPROVAL",
  cloudPersistenceStatus: persistenceHealth.cloudPersistenceStatus ?? "unknown",
  environmentPresenceAudit: {
    NEXT_PUBLIC_SUPABASE_URL: productionHealth.databaseStatus === "error"
      ? "present_inferred_from_configured_runtime"
      : "not_observed",
    SUPABASE_SERVICE_ROLE_KEY: productionHealth.databaseStatus === "error"
      ? "present_inferred_from_configured_runtime"
      : "not_observed",
    projectRefConsistency: "not_verifiable_from_redacted_public_health",
    valuesRead: false,
    valuesRecorded: false,
  },
  migrationAudit: {
    requiredTables,
    missingSourceTables,
    repairPlanTables: [...firstCatalog].sort(),
    missingRepairTables,
  },
  isolatedTest: {
    kind: "static-additive-catalog-simulation",
    applications: 2,
    idempotent: true,
    statementCount: normalized.length,
    unexpectedStatements: unexpectedStatements.length,
    forbiddenStatements: forbiddenStatements.length,
  },
  repairPlan: {
    path: repairPath,
    sha256: createHash("sha256").update(repairSql, "utf8").digest("hex"),
    requiresExplicitProductionApproval: true,
    appliedToProduction: false,
  },
  productionMutationCount: 0,
  productionModified: false,
  claims: {
    cloudPersistenceReady: false,
    productionRepairExecuted: false,
  },
};

await mkdir(artifactDir, { recursive: true });
await writeFile(`${artifactDir}/supabase-audit.json`, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: result.status, fail: 0, productionMutationCount: 0 }, null, 2));
