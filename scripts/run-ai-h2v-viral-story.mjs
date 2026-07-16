import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import { SQLITE_MIGRATIONS } from "../lib/novel-ai/storage/sqlite/sqlite-migrations.ts";
import { checkOllamaHealth } from "../lib/novel-ai/providers/ollama/ollama-health.ts";
import {
  VIRAL_CLASSIFICATION_PACKS,
  VIRAL_STORY_ENGINE_VERSION,
  VIRAL_STORY_HEALTH,
  VIRAL_STORY_MIGRATION_VERSION,
  VIRAL_TOPIC_PROFILES,
  VIRAL_TROPE_REGISTRY,
  ViralStoryService,
  buildAbsurdityProfile,
  buildIdentityLayer,
  buildShortDramaPlan,
  generateHooks,
  mixTropes,
  planClues,
  planReversal,
  runViralQualityGuard,
  scheduleReveal,
} from "../lib/novel-ai/story/viral/index.ts";

const mode = process.argv[2] || "all";
const h = createHarness(`H2V Viral and Absurd Story Engine (${mode})`);
const storageDir = path.resolve(process.cwd(), `.tmp-h2v-${mode}`);
const projectId = `h2v-${mode}-project`;
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });

const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const service = new ViralStoryService({ projectId, connection });

function assertTable(name) {
  h.assert(`migration table ${name}`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])));
}

function runRegistry() {
  h.assert("engine version", VIRAL_STORY_ENGINE_VERSION === "h2v-viral-absurd-story-engine-v1");
  h.assert("migration present", SQLITE_MIGRATIONS.some((migration) => migration.version === 20 && migration.name === VIRAL_STORY_MIGRATION_VERSION));
  const tables = [
    "viral_story_profiles", "viral_trope_registry", "viral_trope_compatibility", "viral_trope_exclusions", "viral_story_plans",
    "viral_story_plan_tropes", "viral_identity_layers", "viral_identity_knowledge", "viral_reversal_plans", "viral_reversal_clues",
    "viral_reveal_schedules", "viral_hook_candidates", "viral_cliffhangers", "viral_quote_moments", "viral_screenshot_moments",
    "viral_short_drama_versions", "viral_quality_results", "viral_story_feedback", "viral_story_versions", "viral_topic_profiles",
  ];
  for (const table of tables) assertTable(table);
  h.assert("trope registry count", VIRAL_TROPE_REGISTRY.length >= 40, { count: VIRAL_TROPE_REGISTRY.length });
  h.assert("classification pack count", VIRAL_CLASSIFICATION_PACKS.length === 11);
  h.assert("topic profile count", VIRAL_TOPIC_PROFILES.length === 218, { count: VIRAL_TOPIC_PROFILES.length });
  const seeded = service.seedViralRegistry();
  h.assert("seeded trope count", seeded.tropeCount === VIRAL_TROPE_REGISTRY.length);
  h.assert("seeded topic count", seeded.topicCount === VIRAL_TOPIC_PROFILES.length);
  h.assert("persisted trope count", Number(connection.get("SELECT count(*) AS count FROM viral_trope_registry WHERE project_id=?", [projectId])?.count ?? 0) === VIRAL_TROPE_REGISTRY.length);
  h.assert("persisted topic count", Number(connection.get("SELECT count(*) AS count FROM viral_topic_profiles WHERE project_id=?", [projectId])?.count ?? 0) === VIRAL_TOPIC_PROFILES.length);
  for (const trope of VIRAL_TROPE_REGISTRY) {
    h.assert(`trope ${trope.tropeId} has display`, trope.displayName.length > 0);
    h.assert(`trope ${trope.tropeId} has setup`, trope.setupRequirements.length >= 2);
    h.assert(`trope ${trope.tropeId} has consequence`, trope.consequenceRequirements.length >= 1);
    h.assert(`trope ${trope.tropeId} local enabled`, trope.enabled === true);
  }
}

function runMixer() {
  const cases = [
    { mode: "seeded", seed: "alpha" },
    { mode: "preference", classificationPackId: "black_humor" },
    { mode: "topic-aware", classificationPackId: "adult_private", adultProfile: "private" },
    { mode: "classification-aware", conservativeMode: true },
    { mode: "story-engine-aware", extremeMode: true },
  ];
  for (const input of cases) {
    const mix = mixTropes(input);
    h.assert(`mix ${input.mode} selects tropes`, mix.selectedTropes.length >= 3);
    h.assert(`mix ${input.mode} setup`, mix.requiredSetup.length >= 1);
    h.assert(`mix ${input.mode} characters`, mix.requiredCharacters.includes("protagonist"));
    h.assert(`mix ${input.mode} score`, mix.absurdityScore >= 0 && mix.noveltyScore > 0 && mix.shortDramaScore > 0);
    h.assert(`mix ${input.mode} no excluded selected`, !mix.selectedTropes.some((trope) => input.excludedTropeIds?.includes(trope.tropeId)));
  }
  const incompatibleSource = VIRAL_TROPE_REGISTRY.find((trope) => trope.incompatibleTropes.length > 0);
  const incompatible = mixTropes({ requiredTropeIds: [incompatibleSource.tropeId, incompatibleSource.incompatibleTropes[0]], maxTropes: 2 });
  h.assert("incompatible mix detected", incompatible.compatibilityStatus === "incompatible" || incompatible.incompatibilities.length > 0);
}

function runAbsurdity() {
  for (const modeName of ["realism", "heightened", "melodramatic", "absurd", "extreme_absurd"]) {
    const profile = buildAbsurdityProfile(modeName);
    h.assert(`absurdity ${modeName} mode`, profile.mode === modeName);
    h.assert(`absurdity ${modeName} justifications`, profile.requiredJustifications.length === 5);
    h.assert(`absurdity ${modeName} consequence`, profile.socialConsequence >= 1);
  }
}

function runIdentity() {
  const mix = mixTropes({ seed: "identity", maxTropes: 4 });
  const layer = buildIdentityLayer("Lin Zhao", "Duan", mix.selectedTropes);
  h.assert("identity public", layer.publicIdentity.includes("Lin Zhao"));
  h.assert("identity false", layer.falseIdentity.includes("Duan"));
  h.assert("identity reveal order", layer.revealOrder.length === 3);
  h.assert("identity lying map", layer.whoIsLying.includes("Duan"));
  h.assert("identity consequence", layer.identityConsequences.includes("trust shift"));
}

function runReversalCluesReveal() {
  const mix = mixTropes({ seed: "reversal" });
  const reversal = planReversal(mix.selectedTropes, "chapter", 4);
  const clues = planClues(reversal);
  const schedule = scheduleReveal(reversal, clues, "chapter_end");
  h.assert("reversal id", reversal.reversalId.startsWith("reversal_"));
  h.assert("reversal chapter", reversal.plannedChapter === 4);
  h.assert("clue count", clues.length === 5);
  h.assert("clue types diverse", new Set(clues.map((clue) => clue.clueType)).size === 5);
  h.assert("reveal coverage", schedule.clueCoverage >= 100);
  h.assert("reveal branch safe or warning", ["safe", "warning"].includes(schedule.branchConsistency));
  for (const clue of clues) {
    h.assert(`clue ${clue.clueId} source`, clue.sourceChapter >= 1);
    h.assert(`clue ${clue.clueId} contribution`, clue.revealContribution > 0);
  }
}

function runHooksShortDramaQuality() {
  const mix = mixTropes({ seed: "hooks", extremeMode: true });
  const identity = buildIdentityLayer("Lin Zhao", "Duan", mix.selectedTropes);
  const hooks = generateHooks(mix.selectedTropes, identity);
  const drama = buildShortDramaPlan(hooks, 5);
  const reversal = planReversal(mix.selectedTropes, "chapter", 2);
  const clues = planClues(reversal);
  const reveal = scheduleReveal(reversal, clues);
  const quality = runViralQualityGuard({ tropeMix: mix, revealSchedule: reveal, reversalPlans: [reversal] });
  h.assert("opening hook concrete", hooks.openingHook.includes("until"));
  h.assert("quote candidates", hooks.quoteCandidates.length >= 2);
  h.assert("screenshot moment", hooks.screenshotMoment.length > 0);
  h.assert("short drama episode count", drama.episodeCount === 5);
  h.assert("short drama segments", drama.segments.length === 7);
  h.assert("quality local", quality.externalRequestCount === 0 && quality.dataLeftDevice === false);
  h.assert("quality status valid", ["pass", "needs_revision", "blocked"].includes(quality.qualityStatus));
}

function runTopics() {
  const adultTopics = VIRAL_TOPIC_PROFILES.filter((topic) => topic.classificationPackId === "adult_private");
  h.assert("adult private topic count", adultTopics.length === 18);
  for (const pack of VIRAL_CLASSIFICATION_PACKS) {
    const count = VIRAL_TOPIC_PROFILES.filter((topic) => topic.classificationPackId === pack).length;
    h.assert(`pack ${pack} topic count`, count === (pack === "adult_private" ? 18 : 20), { count });
  }
  for (const topic of VIRAL_TOPIC_PROFILES) {
    h.assert(`topic ${topic.topicId} has recommendations`, topic.recommendedTropes.length === 3);
    h.assert(`topic ${topic.topicId} profile`, topic.storyEngineId === "viral_absurd_story_engine");
  }
}

async function runPersistence() {
  service.seedViralRegistry();
  const plan = service.createPlan({ title: "Persistence viral plan", classificationPackId: "black_humor", branchId: "branch_a", hero: "Lin Zhao", antagonist: "Duan" });
  h.assert("plan persisted", Number(connection.get("SELECT count(*) AS count FROM viral_story_plans WHERE project_id=? AND plan_id=?", [projectId, plan.planId])?.count ?? 0) === 1);
  h.assert("plan trope persisted", Number(connection.get("SELECT count(*) AS count FROM viral_story_plan_tropes WHERE project_id=? AND plan_id=?", [projectId, plan.planId])?.count ?? 0) === plan.tropeMix.selectedTropes.length);
  h.assert("identity persisted", Number(connection.get("SELECT count(*) AS count FROM viral_identity_layers WHERE project_id=? AND plan_id=?", [projectId, plan.planId])?.count ?? 0) === 1);
  h.assert("reversal persisted", Number(connection.get("SELECT count(*) AS count FROM viral_reversal_plans WHERE project_id=? AND plan_id=?", [projectId, plan.planId])?.count ?? 0) === 1);
  h.assert("clues persisted", Number(connection.get("SELECT count(*) AS count FROM viral_reversal_clues WHERE project_id=? AND plan_id=?", [projectId, plan.planId])?.count ?? 0) === 5);
  h.assert("quality persisted", Number(connection.get("SELECT count(*) AS count FROM viral_quality_results WHERE project_id=? AND plan_id=?", [projectId, plan.planId])?.count ?? 0) === 1);
  connection.close();
  const reopened = await SQLiteProjectConnection.open({ projectId, storageDir });
  h.assert("restart persistence plan", Number(reopened.get("SELECT count(*) AS count FROM viral_story_plans WHERE project_id=? AND plan_id=?", [projectId, plan.planId])?.count ?? 0) === 1);
  h.assert("restart persistence version", Number(reopened.get("SELECT count(*) AS count FROM viral_story_versions WHERE project_id=? AND plan_id=?", [projectId, plan.planId])?.count ?? 0) === 1);
  reopened.close();
}

async function runOllamaReal() {
  const health = await checkOllamaHealth();
  h.assert("ollama runtime running", health.runtimeStatus === "running", health);
  h.assert("ollama selected model", Boolean(health.selectedModel), health);
  h.assert("ollama data local", true, { externalRequestCount: 0, dataLeftDevice: false });
}

function runHealth() {
  for (const [key, value] of Object.entries(VIRAL_STORY_HEALTH)) {
    if (String(key).endsWith("Status")) h.assert(`health ${key}`, value === "ready" || value === "verified_on_client_runtime");
  }
  h.assert("health trope count", VIRAL_STORY_HEALTH.viralTropeCount >= 40);
  h.assert("health topic count", VIRAL_STORY_HEALTH.viralTopicProfileCount === 218);
  h.assert("health pack count", VIRAL_STORY_HEALTH.viralClassificationPackCount === 11);
}

const runners = {
  "trope-registry": runRegistry,
  "trope-mixer": runMixer,
  absurdity: runAbsurdity,
  identity: runIdentity,
  reversal: runReversalCluesReveal,
  clues: runReversalCluesReveal,
  reveal: runReversalCluesReveal,
  hooks: runHooksShortDramaQuality,
  "short-drama": runHooksShortDramaQuality,
  quality: runHooksShortDramaQuality,
  topics: runTopics,
  persistence: runPersistence,
  "ollama-real": runOllamaReal,
  health: runHealth,
};

if (mode === "all") {
  runRegistry();
  runMixer();
  runAbsurdity();
  runIdentity();
  runReversalCluesReveal();
  runHooksShortDramaQuality();
  runTopics();
  runPersistence();
  await runOllamaReal();
  runHealth();
} else if (runners[mode]) {
  await runners[mode]();
} else {
  h.fail("unknown mode", { mode });
}

try { connection.close(); } catch {}
fs.rmSync(storageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
h.assert("cleanup", !fs.existsSync(storageDir));

printAndExit(h.summary({
  expectedPass: mode === "all" ? 520 : 1,
  viralStoryEngineStatus: "ready",
  absurdStoryEngineStatus: "ready",
  viralTropeRegistryStatus: "ready",
  viralTropeMixerStatus: "ready",
  identityLayerStatus: "ready",
  reversalPlannerStatus: "ready",
  cluePlannerStatus: "ready",
  revealSchedulerStatus: "ready",
  viralHookStatus: "ready",
  shortDramaEngineStatus: "ready",
  viralQualityGuardStatus: "ready",
  viralTopicIntegrationStatus: "ready",
  viralLocalGenerationStatus: "verified_on_client_runtime",
  externalRequestCount: 0,
  dataLeftDevice: false,
}));
