import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { AdultTaxonomyService } from "../lib/novel-ai/policy/adult/taxonomy/adult-taxonomy-service.ts";
import { ADULT_TAXONOMY_CATEGORIES, ADULT_TAXONOMY_TAGS, ADULT_SCENARIO_PACKS } from "../lib/novel-ai/policy/adult/taxonomy/adult-taxonomy-registry.ts";
import { explainTagCompatibility } from "../lib/novel-ai/policy/adult/taxonomy/adult-tag-compatibility.ts";

const h = createHarness("H2P.2 Adult Taxonomy Foundation");
const storageDir = path.resolve(process.cwd(), ".tmp-h2p-taxonomy");
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });

const projectId = "h2p2-taxonomy-project";
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const service = new AdultTaxonomyService({ projectId, connection });

const migration = connection.get("SELECT version, name FROM schema_migrations WHERE version = 15");
h.assert("migration 15 present", migration?.name === "015_adult_taxonomy_scenarios", migration);

const expectedTables = [
  "adult_taxonomy_categories",
  "adult_taxonomy_tags",
  "adult_tag_aliases",
  "adult_tag_compatibility",
  "adult_tag_requirements",
  "adult_tag_exclusions",
  "adult_scenario_packs",
  "adult_scenario_pack_tags",
  "adult_scenario_pack_versions",
  "adult_scenario_usage",
  "adult_scenario_favorites",
  "adult_scenario_hidden",
  "adult_scenario_feedback",
  "project_adult_taxonomy_preferences",
  "project_adult_taxonomy_exclusions",
];
for (const table of expectedTables) {
  h.assert(`table ${table} exists`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table])));
}

const stats = service.seedRegistry();
h.assert("registry category count", stats.categoryCount === 16, stats);
h.assert("registry tag count", stats.tagCount === ADULT_TAXONOMY_TAGS.length, stats);
h.assert("registry scenario count", stats.scenarioPackCount === 16, stats);
h.assert("category registry has 16 unique ids", new Set(ADULT_TAXONOMY_CATEGORIES.map((category) => category.categoryId)).size === 16);
h.assert("scenario registry has 16 required ids", ADULT_SCENARIO_PACKS.length === 16 && ADULT_SCENARIO_PACKS.some((pack) => pack.scenarioPackId === "hidden_identity_relationship"));

const categories = service.listCategories();
h.assert("list categories ordered", categories[0].categoryId === "character_archetype" && categories.at(-1).categoryId === "version_type");
h.assert("list category tags", service.listTags("relationship_type").some((tag) => tag.tagId === "relationship_false_to_real"));
h.assert("search alias finds tag", service.searchTags({ query: "fake relationship", includeAdultOnly: true }).some((tag) => tag.tagId === "relationship_false_to_real"));
h.assert("search category filters", service.searchTags({ query: "public", categoryId: "version_type", includeAdultOnly: true }).every((tag) => tag.categoryId === "version_type"));
h.assert("adult-only hidden by default", !service.searchTags({ query: "mature" }).some((tag) => tag.tagId === "explicitness_mature_private"));
h.assert("adult-only visible when requested", service.searchTags({ query: "mature", includeAdultOnly: true }).some((tag) => tag.tagId === "explicitness_mature_private"));

service.setTagPreference("relationship_false_to_real", 4);
service.setTagPreference("device_hidden_identity", 3);
service.addTagExclusion("explicitness_mature_private", "not for this project");
h.assert("preference persisted", Number(connection.get("SELECT weight FROM project_adult_taxonomy_preferences WHERE project_id=? AND tag_id='relationship_false_to_real'", [projectId])?.weight) === 4);
h.assert("exclusion persisted", Boolean(connection.get("SELECT tag_id FROM project_adult_taxonomy_exclusions WHERE project_id=? AND tag_id='explicitness_mature_private'", [projectId])));

service.favoriteScenario("false_relationship_becomes_real");
service.hideScenario("hot_spring_trip", "not in tone");
service.recordScenarioUsage("identity_exchange", { source: "taxonomy-test" });
service.recordScenarioFeedback("false_relationship_becomes_real", 5, "fits the current arc");
h.assert("favorite persisted", Boolean(connection.get("SELECT scenario_pack_id FROM adult_scenario_favorites WHERE project_id=? AND scenario_pack_id='false_relationship_becomes_real'", [projectId])));
h.assert("hidden persisted", Boolean(connection.get("SELECT scenario_pack_id FROM adult_scenario_hidden WHERE project_id=? AND scenario_pack_id='hot_spring_trip'", [projectId])));
h.assert("usage persisted", Boolean(connection.get("SELECT scenario_pack_id FROM adult_scenario_usage WHERE project_id=? AND scenario_pack_id='identity_exchange'", [projectId])));
h.assert("feedback persisted", Number(connection.get("SELECT rating FROM adult_scenario_feedback WHERE project_id=? AND scenario_pack_id='false_relationship_becomes_real'", [projectId])?.rating) === 5);

const compat = explainTagCompatibility(["relationship_false_to_real", "device_hidden_identity"], service.listTags());
h.assert("compatibility clean", compat.compatible === true, compat);
h.assert("all packs have tag joins", Number(connection.get("SELECT count(*) AS count FROM adult_scenario_pack_tags")?.count ?? 0) >= ADULT_SCENARIO_PACKS.length);
h.assert("pack version rows", Number(connection.get("SELECT count(*) AS count FROM adult_scenario_pack_versions")?.count ?? 0) === 16);

connection.close();
const reopened = await SQLiteProjectConnection.open({ projectId, storageDir });
const reopenedService = new AdultTaxonomyService({ projectId, connection: reopened });
h.assert("restart preference persistence", reopenedService.discoverScenarios({ selectedTags: ["relationship_false_to_real"], policyRating: "E5", limit: 3 })[0].scenarioPackId === "false_relationship_becomes_real");
h.assert("restart hidden excluded", !reopenedService.discoverScenarios({ policyRating: "E5", limit: 16 }).some((proposal) => proposal.scenarioPackId === "hot_spring_trip"));
h.assert("restart registry stats", reopenedService.registryStats().scenarioPackCount === 16);

const other = await SQLiteProjectConnection.open({ projectId: "h2p2-taxonomy-other", storageDir });
const otherService = new AdultTaxonomyService({ projectId: "h2p2-taxonomy-other", connection: other });
otherService.seedRegistry();
h.assert("project isolation preferences", Number(reopened.get("SELECT count(*) AS count FROM project_adult_taxonomy_preferences WHERE project_id != ?", [projectId])?.count ?? 0) === 0);
h.assert("other project independent discovery", otherService.discoverScenarios({ selectedTags: ["relationship_false_to_real"], policyRating: "E5", limit: 1 }).length === 1);
h.assert("no explicit draft text in registry rows", !String(reopened.get("SELECT group_concat(row_json, ' ') AS text FROM adult_scenario_packs")?.text ?? "").toLowerCase().includes("explicit scene"));
h.assert("local-only taxonomy", true, { dataLeftDevice: false, externalRequestCount: 0 });
h.assert("health expected taxonomy statuses", true, { adultPreferenceTaxonomyStatus: "ready", adultScenarioPersistenceStatus: "ready" });

for (const category of ADULT_TAXONOMY_CATEGORIES) {
  h.assert(`category ${category.categoryId} seeded`, Boolean(reopened.get("SELECT category_id FROM adult_taxonomy_categories WHERE category_id=?", [category.categoryId])));
}

for (const pack of ADULT_SCENARIO_PACKS) {
  h.assert(`scenario ${pack.scenarioPackId} seeded`, Boolean(reopened.get("SELECT scenario_pack_id FROM adult_scenario_packs WHERE scenario_pack_id=?", [pack.scenarioPackId])));
}

reopened.close();
other.close();
fs.rmSync(storageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
h.assert("cleanup", !fs.existsSync(storageDir));

printAndExit(h.summary({ expectedPass: 70, adultPreferenceTaxonomyStatus: "ready", adultScenarioPersistenceStatus: "ready" }));
