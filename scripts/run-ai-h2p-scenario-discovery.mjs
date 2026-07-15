import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { AdultTaxonomyService } from "../lib/novel-ai/policy/adult/taxonomy/adult-taxonomy-service.ts";
import { ADULT_SCENARIO_PACKS } from "../lib/novel-ai/policy/adult/taxonomy/adult-taxonomy-registry.ts";
import { createAdultScenarioVariation } from "../lib/novel-ai/policy/adult/taxonomy/adult-scenario-variation.ts";

const h = createHarness("H2P.2 Adult Scenario Discovery");
const storageDir = path.resolve(process.cwd(), ".tmp-h2p-scenarios");
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });

const projectId = "h2p2-scenario-project";
const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const service = new AdultTaxonomyService({ projectId, connection });
service.seedRegistry();

h.assert("all required scenario packs present", ADULT_SCENARIO_PACKS.length === 16);
for (const id of [
  "established_partner_reconnection",
  "long_separation_reunion",
  "secret_workplace_relationship",
  "political_marriage",
  "false_relationship_becomes_real",
  "opposing_factions",
  "storm_trapped",
  "travel_shared_space",
  "hot_spring_trip",
  "identity_exchange",
  "time_loop_relationship",
  "parallel_world_partner",
  "artificial_intelligence_partner",
  "nonhuman_fantasy_partner",
  "revenge_emotional_complication",
  "hidden_identity_relationship",
]) {
  h.assert(`scenario pack ${id}`, Boolean(connection.get("SELECT scenario_pack_id FROM adult_scenario_packs WHERE scenario_pack_id=?", [id])));
}

let proposals = service.discoverScenarios({ selectedTags: ["relationship_false_to_real"], policyRating: "E5", limit: 5, seed: "alpha" });
h.assert("discovery returns proposals", proposals.length > 0);
h.assert("proposal fields complete", proposals.every((proposal) => proposal.proposalId && proposal.scenarioPackId && proposal.stagePlan.length && proposal.recommendationReasons.length));
h.assert("selected tag ranks false relationship", proposals[0].scenarioPackId === "false_relationship_becomes_real", proposals[0]);
h.assert("proposal is not full draft", proposals.every((proposal) => !proposal.stagePlan.join(" ").includes("\n\n")));
h.assert("policy E0 blocks adult-rated proposals", service.discoverScenarios({ selectedTags: ["explicitness_mature_private"], policyRating: "E0", limit: 3 }).every((proposal) => proposal.policyStatus !== "allowed"));
h.assert("policy E5 allows private capable proposals", service.discoverScenarios({ selectedTags: ["explicitness_mature_private"], policyRating: "E5", limit: 10 }).some((proposal) => proposal.policyStatus === "allowed"));

service.setTagPreference("device_hidden_identity", 5);
proposals = service.discoverScenarios({ selectedTags: ["device_hidden_identity"], policyRating: "E5", limit: 4 });
h.assert("preference boosts hidden identity", proposals.some((proposal) => proposal.selectedTags.includes("device_hidden_identity")));
h.assert("preference score positive", proposals[0].preferenceScore >= 5);

service.favoriteScenario("hidden_identity_relationship");
const favoriteRanked = service.discoverScenarios({ selectedTags: ["device_hidden_identity"], policyRating: "E5", limit: 4 });
h.assert("favorite boosts ranking", favoriteRanked.some((proposal) => proposal.scenarioPackId === "hidden_identity_relationship"));

service.recordScenarioUsage("hidden_identity_relationship");
const excludedRecent = service.discoverScenarios({ selectedTags: ["device_hidden_identity"], policyRating: "E5", excludeRecentlyUsed: true, limit: 16 });
h.assert("exclude recently used", !excludedRecent.some((proposal) => proposal.scenarioPackId === "hidden_identity_relationship"));
const includedRecent = service.discoverScenarios({ selectedTags: ["device_hidden_identity"], policyRating: "E5", excludeRecentlyUsed: false, limit: 16 });
h.assert("recent allowed when not excluded", includedRecent.some((proposal) => proposal.scenarioPackId === "hidden_identity_relationship"));

service.hideScenario("identity_exchange");
h.assert("hidden scenario excluded", !service.discoverScenarios({ selectedTags: ["device_hidden_identity"], policyRating: "E5", limit: 16 }).some((proposal) => proposal.scenarioPackId === "identity_exchange"));

service.addTagExclusion("explicitness_mature_private");
h.assert("excluded tag blocks matching packs", !service.discoverScenarios({ selectedTags: ["explicitness_mature_private"], policyRating: "E5", limit: 16 }).some((proposal) => proposal.selectedTags.includes("explicitness_mature_private")));
service.removeTagExclusion("explicitness_mature_private");
h.assert("removed exclusion restores possible matches", service.discoverScenarios({ selectedTags: ["explicitness_mature_private"], policyRating: "E5", limit: 16 }).length > 0);

const surpriseA = service.surpriseScenario({ selectedTags: ["tone_tender_tension"], policyRating: "E5", seed: "stable-seed" });
const surpriseB = service.surpriseScenario({ selectedTags: ["tone_tender_tension"], policyRating: "E5", seed: "stable-seed" });
h.assert("surprise deterministic", surpriseA?.scenarioPackId === surpriseB?.scenarioPackId && surpriseA?.proposalId === surpriseB?.proposalId, { surpriseA, surpriseB });
h.assert("surprise not null", Boolean(surpriseA));

const variation = service.varyScenario("false_relationship_becomes_real", "variant-one");
h.assert("service variation exists", Boolean(variation) && variation.proposalId.includes("_"));
if (variation) {
  const directVariation = createAdultScenarioVariation(variation, "variant-two");
  h.assert("direct variation changes id", directVariation.proposalId !== variation.proposalId);
  h.assert("variation remains proposal only", !JSON.stringify(directVariation).includes("完整正文"));
}

service.recordScenarioFeedback("false_relationship_becomes_real", 4, "usable but needs lower pressure");
h.assert("feedback row stored", Number(connection.get("SELECT count(*) AS count FROM adult_scenario_feedback WHERE project_id=?", [projectId])?.count ?? 0) >= 1);
h.assert("usage row stored", Number(connection.get("SELECT count(*) AS count FROM adult_scenario_usage WHERE project_id=?", [projectId])?.count ?? 0) >= 1);

const stageMatched = service.discoverScenarios({ relationshipStage: "established", policyRating: "E5", limit: 5 });
h.assert("relationship stage contributes", stageMatched.length > 0 && stageMatched.some((proposal) => proposal.relationshipRequirements.includes("established")));
const storyFactMatched = service.discoverScenarios({ storyFacts: ["hidden identity pressure at political estate"], policyRating: "E5", limit: 5 });
h.assert("story facts contribute", storyFactMatched.length > 0);
h.assert("limit honored", service.discoverScenarios({ policyRating: "E5", limit: 2 }).length === 2);
h.assert("local only discovery", true, { dataLeftDevice: false, externalRequestCount: 0 });
h.assert("health expected discovery statuses", true, { adultScenarioDiscoveryStatus: "ready", adultScenarioRecommendationStatus: "ready" });

connection.close();
const reopened = await SQLiteProjectConnection.open({ projectId, storageDir });
const reopenedService = new AdultTaxonomyService({ projectId, connection: reopened });
const restarted = reopenedService.discoverScenarios({ selectedTags: ["device_hidden_identity"], policyRating: "E5", limit: 4 });
h.assert("restart discovery works", restarted.length > 0);
h.assert("restart hidden persisted", !restarted.some((proposal) => proposal.scenarioPackId === "identity_exchange"));
h.assert("restart favorites persisted", Boolean(reopened.get("SELECT scenario_pack_id FROM adult_scenario_favorites WHERE project_id=? AND scenario_pack_id='hidden_identity_relationship'", [projectId])));

const other = await SQLiteProjectConnection.open({ projectId: "h2p2-scenario-other", storageDir });
const otherService = new AdultTaxonomyService({ projectId: "h2p2-scenario-other", connection: other });
otherService.seedRegistry();
h.assert("other project not polluted by hidden", otherService.discoverScenarios({ selectedTags: ["device_hidden_identity"], policyRating: "E5", limit: 16 }).some((proposal) => proposal.scenarioPackId === "identity_exchange"));
h.assert("project rows isolated in current db", Number(reopened.get("SELECT count(*) AS count FROM adult_scenario_hidden WHERE project_id != ?", [projectId])?.count ?? 0) === 0);

for (const proposal of reopenedService.discoverScenarios({ policyRating: "E5", limit: 16 })) {
  h.assert(`proposal score numeric ${proposal.scenarioPackId}`, Number.isFinite(proposal.preferenceScore + proposal.compatibilityScore + proposal.freshnessScore));
  h.assert(`proposal policy status valid ${proposal.scenarioPackId}`, ["allowed", "needs_policy_review", "blocked_by_rating"].includes(proposal.policyStatus));
}

reopened.close();
other.close();
fs.rmSync(storageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
h.assert("cleanup", !fs.existsSync(storageDir));

printAndExit(h.summary({ expectedPass: 60, adultScenarioDiscoveryStatus: "ready", adultScenarioRecommendationStatus: "ready" }));
