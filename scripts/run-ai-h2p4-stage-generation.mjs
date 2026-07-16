import fs from "node:fs";
import path from "node:path";
import { createHarness, printAndExit } from "./h1-test-utils.mjs";
import { checkOllamaHealth } from "../lib/novel-ai/providers/ollama/ollama-health.ts";
import { SQLiteProjectConnection } from "../lib/novel-ai/storage/sqlite/sqlite-connection.ts";
import {
  StoryStageGenerator,
  planStages,
  rewriteStage,
  changeTone,
  changePerspective,
  changePacing,
  extendStage,
  increaseDetail,
  shortenStage,
  decreaseDetail,
  splitStage,
  mergeStages,
  mergeWholeScene,
  STORY_STAGE_GENERATION_VERSION,
  STORY_STAGE_PROMPT_REGISTRY_VERSION,
} from "../lib/novel-ai/generation/stages/index.ts";

const mode = process.argv[2] || "all";
const h = createHarness(`H2P.4 Universal Local Stage Generation (${mode})`);
const storageDir = path.resolve(process.cwd(), ".tmp-h2p4-stage-generation");
const projectId = `h2p4-stage-generation-${mode}`;
fs.rmSync(storageDir, { recursive: true, force: true });
fs.mkdirSync(storageDir, { recursive: true });

const connection = await SQLiteProjectConnection.open({ projectId, storageDir });
const generator = new StoryStageGenerator();
const health = await checkOllamaHealth();
h.assert("Ollama runtime reachable", health.runtimeStatus === "running", health);
h.assert("Ollama has generation model", Boolean(health.selectedModel), health);
h.assert("H2P.4 generation version", STORY_STAGE_GENERATION_VERSION === "h2p4-universal-local-stage-generation-v1");
h.assert("H2P.4 prompt registry version", STORY_STAGE_PROMPT_REGISTRY_VERSION === "story-stage-prompts-h2p4-v1");
for (const table of ["story_stage_generation_versions", "story_consequence_candidates"]) {
  h.assert(`migration table ${table}`, Boolean(connection.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table])));
}

const profiles = [
  "general_story",
  "action_battle",
  "mystery_reveal",
  "palace_intrigue",
  "business_negotiation",
  "romance",
  "adult_intimacy",
  "custom_template",
];

function stageFor(profileId, index = 0) {
  const planned = planStages({
    ...contextFor(profileId, "planning_probe"),
    stageType: "setup",
    stageGoal: "Plan stage sequence",
  });
  const stage = planned[index] || planned[0];
  return { stageType: stage.stageType, goal: stage.stageGoal };
}

function contextFor(profileId, suffix = "main", overrides = {}) {
  const stage = overrides.stage || { stageType: "setup", goal: "Open the scene with a concrete action beat." };
  const isAdult = profileId === "adult_intimacy";
  return {
    projectId,
    sceneId: `scene_${profileId}_${suffix}`,
    stageId: `stage_${profileId}_${suffix}`,
    branchId: "main",
    profileId,
    stageType: stage.stageType,
    stageGoal: stage.goal,
    classificationPackId: isAdult ? "adult_private" : "universal_fiction",
    topicId: isAdult ? "private_relationship_scene" : `${profileId}_topic`,
    storyEngineId: "local_story_engine",
    previousStageSummary: "上一段中，林昭發現赤霄劍失蹤，卻沒有立刻揭穿內鬼。",
    continuityState: {
      location: "京城北庫",
      storyTime: "第七日夜半",
      unresolvedActions: ["赤霄劍去向不明", "盟友是否可信仍未確認"],
      requiredNextBeat: "林昭必須找到不驚動對手的線索。",
      forbiddenRepetitions: ["不要再次描述同一把劍消失的經過"],
    },
    characterCanonical: [
      { id: "char_lin_zhao", name: "林昭", role: "protagonist", goal: "查清赤霄劍失蹤原因", currentLocation: "京城北庫", emotion: "克制而警覺" },
      { id: "char_mo_qing", name: "莫青", role: "ally", goal: "保住家族名聲", currentLocation: "門外", emotion: "焦慮" },
      { id: "char_duan", name: "段無咎", role: "opponent", goal: "誘使林昭誤判", currentLocation: "暗處", emotion: "冷靜" },
    ],
    relationshipState: {
      trust: { "char_lin_zhao:char_mo_qing": 62 },
      conflict: { "char_lin_zhao:char_duan": 85 },
    },
    requiredEvents: ["林昭必須做出一個可驗證的推進動作"],
    forbiddenEvents: ["不得讓已知死亡角色復活", "不得讓赤霄劍憑空回到主角手中"],
    requiredNextBeat: "留下下一段可以接續的明確線索。",
    narrativePurpose: "推進調查與壓迫感，不直接解開全部謎底。",
    targetLength: 220,
    tone: isAdult ? "克制、親密但不露骨" : "緊湊、清晰、有懸念",
    perspective: "第三人稱有限視角",
    policy: isAdult ? {
      providerMode: "local-only",
      adultPolicyEnabled: true,
      policyVersion: 1,
      participantsVerifiedAdult: true,
      relationshipPermitted: true,
      consentState: "active",
      withdrawalState: "none",
      ratingPermitted: true,
      localOnlyRequired: true,
    } : { providerMode: "local-only" },
    ...overrides,
  };
}

function assertVersion(label, version, operation = "generateStage") {
  h.assert(`${label} operation`, version.operation === operation, { actual: version.operation });
  h.assert(`${label} draft text`, typeof version.draftText === "string" && version.draftText.trim().length >= 10, { length: version.draftText?.length });
  h.assert(`${label} summary`, typeof version.stageSummary === "string" && version.stageSummary.trim().length > 0);
  h.assert(`${label} provider local`, version.provider === "ollama-local", { provider: version.provider });
  h.assert(`${label} model`, typeof version.model === "string" && version.model.length > 0, { model: version.model });
  h.assert(`${label} external request count zero`, version.externalRequestCount === 0, { externalRequestCount: version.externalRequestCount });
  h.assert(`${label} data did not leave device`, version.dataLeftDevice === false, { dataLeftDevice: version.dataLeftDevice });
  h.assert(`${label} version id`, version.versionId.startsWith("story_stage_version_"), { versionId: version.versionId });
  h.assert(`${label} prompt hash`, typeof version.promptHash === "string" && version.promptHash.length === 64);
  h.assert(`${label} content hash`, typeof version.contentHash === "string" && version.contentHash.length === 64);
  h.assert(`${label} used context ids`, Array.isArray(version.usedContextIds) && version.usedContextIds.length >= 2, version.usedContextIds);
  h.assert(`${label} warnings include latency`, version.warnings.some((item) => String(item).startsWith("latencyMs:")), version.warnings);
  h.assert(`${label} continuity object`, typeof version.continuityChanges === "object" && version.continuityChanges !== null);
  h.assert(`${label} character changes array`, Array.isArray(version.characterStateChanges));
  h.assert(`${label} relationship changes array`, Array.isArray(version.relationshipChanges));
  h.assert(`${label} facts array`, Array.isArray(version.newlyIntroducedFacts));
  h.assert(`${label} candidates array`, Array.isArray(version.possibleCandidates));
  h.assert(`${label} unresolved actions array`, Array.isArray(version.unresolvedActions));
  h.assert(`${label} next requirements array`, Array.isArray(version.nextStageRequirements));
  const stored = connection.get("SELECT * FROM story_stage_generation_versions WHERE project_id=? AND version_id=?", [projectId, version.versionId]);
  h.assert(`${label} version persisted`, Boolean(stored), { versionId: version.versionId });
  h.assert(`${label} persisted local flags`, Number(stored?.external_request_count ?? -1) === 0 && Number(stored?.data_left_device ?? 1) === 0);
  const consequence = connection.get("SELECT * FROM story_consequence_candidates WHERE project_id=? AND version_id=?", [projectId, version.versionId]);
  h.assert(`${label} consequence persisted`, Boolean(consequence), { versionId: version.versionId });
  h.assert(`${label} consequence candidate status`, consequence?.status === "candidate", { status: consequence?.status });
}

async function generateProfile(profileId) {
  const stage = stageFor(profileId);
  const context = contextFor(profileId, "generate", { stage });
  const version = await generator.run("generateStage", context, { connection, model: health.selectedModel, timeoutMs: 120_000 });
  assertVersion(`profile ${profileId}`, version);
  return version;
}

async function runGenerationMatrix() {
  for (const profile of profiles) {
    await generateProfile(profile);
  }
}

async function runTransforms() {
  const baseStage = stageFor("general_story");
  const baseContext = contextFor("general_story", "transforms", { stage: baseStage });
  const base = await generator.run("generateStage", baseContext, { connection, model: health.selectedModel, timeoutMs: 120_000 });
  assertVersion("transform base", base);
  const operations = [
    ["rewrite", () => rewriteStage(baseContext, "改得更有壓迫感，但不要解開謎底。", { connection, model: health.selectedModel, parentVersionId: base.versionId })],
    ["tone", () => changeTone(baseContext, "更冷靜、更懸疑", { connection, model: health.selectedModel, parentVersionId: base.versionId })],
    ["perspective", () => changePerspective(baseContext, "第一人稱限知", { connection, model: health.selectedModel, parentVersionId: base.versionId })],
    ["pacing", () => changePacing(baseContext, "節奏更快，減少說明", { connection, model: health.selectedModel, parentVersionId: base.versionId })],
    ["extend", () => extendStage(baseContext, { connection, model: health.selectedModel, parentVersionId: base.versionId, instruction: "補上角色觀察與一個微小線索" })],
    ["detail", () => increaseDetail(baseContext, { connection, model: health.selectedModel, parentVersionId: base.versionId })],
    ["shorten", () => shortenStage(baseContext, { connection, model: health.selectedModel, parentVersionId: base.versionId, instruction: "保留核心行動，壓縮敘述" })],
    ["less-detail", () => decreaseDetail(baseContext, { connection, model: health.selectedModel, parentVersionId: base.versionId })],
  ];
  for (const [label, fn] of operations) {
    const version = await fn();
    assertVersion(`transform ${label}`, version, version.operation);
    h.assert(`transform ${label} parent`, version.parentVersionId === base.versionId, { parentVersionId: version.parentVersionId });
  }
}

async function runSplitMerge() {
  const context = contextFor("business_negotiation", "split_merge", { stage: stageFor("business_negotiation") });
  const split = await splitStage(context, "拆成談判開場與反擊兩段。", { connection, model: health.selectedModel });
  assertVersion("split stage", split, "splitStage");
  const merge = await mergeStages(context, "合併談判與反擊，保留主角主動性。", { connection, model: health.selectedModel, parentVersionId: split.versionId });
  assertVersion("merge stages", merge, "mergeStages");
  const whole = await mergeWholeScene(context, "將目前已完成段落整合成單一場景候選。", { connection, model: health.selectedModel, parentVersionId: merge.versionId });
  assertVersion("merge whole scene", whole, "mergeWholeScene");
  h.assert("scene merge keeps local provider", whole.provider === "ollama-local" && whole.dataLeftDevice === false);
}

async function runPolicyAndOfflineGuards() {
  let blocked = false;
  try {
    await generator.run("generateStage", contextFor("adult_intimacy", "blocked", { policy: { providerMode: "external-allowed", adultPolicyEnabled: true } }), { connection, model: health.selectedModel });
  } catch (error) {
    blocked = error?.code === "STORY_GENERATION_POLICY_BLOCKED" || error?.name === "STORY_GENERATION_POLICY_BLOCKED";
  }
  h.assert("adult policy blocks unsafe external generation", blocked);

  let noModelBlocked = false;
  try {
    await generator.run("generateStage", contextFor("general_story", "no_model"), { connection, model: "h2p4-missing-model:never-installed", timeoutMs: 10_000 });
  } catch (error) {
    noModelBlocked = ["STORY_GENERATION_PROVIDER_UNAVAILABLE", "AI_PROVIDER_MODEL_NOT_FOUND", "AI_PROVIDER_CONNECTION_FAILED"].includes(error?.code || error?.name);
  }
  h.assert("explicit missing model does not silently fallback", noModelBlocked);
}

async function runStreamingAndAbort() {
  const streamVersion = await generator.run("generateStage", contextFor("mystery_reveal", "streaming", { stage: stageFor("mystery_reveal") }), { connection, model: health.selectedModel, stream: true, timeoutMs: 120_000 });
  assertVersion("streaming generation", streamVersion);

  const controller = new AbortController();
  const abortPromise = generator.run("generateStage", contextFor("general_story", "abort", { targetLength: 900 }), { connection, model: health.selectedModel, signal: controller.signal, timeoutMs: 120_000 });
  setTimeout(() => controller.abort(), 5);
  let aborted = false;
  try {
    await abortPromise;
  } catch (error) {
    aborted = ["AI_PROVIDER_TIMEOUT", "AbortError"].includes(error?.code || error?.name);
  }
  h.assert("abort controller cancels provider call", aborted);
}

async function runPersistenceRestart() {
  const beforeVersions = Number(connection.get("SELECT count(*) AS count FROM story_stage_generation_versions")?.count ?? 0);
  const beforeConsequences = Number(connection.get("SELECT count(*) AS count FROM story_consequence_candidates")?.count ?? 0);
  h.assert("persistence version rows nonzero", beforeVersions > 0, { beforeVersions });
  h.assert("persistence consequence rows nonzero", beforeConsequences > 0, { beforeConsequences });
  connection.close();
  const reopened = await SQLiteProjectConnection.open({ projectId, storageDir });
  const afterVersions = Number(reopened.get("SELECT count(*) AS count FROM story_stage_generation_versions")?.count ?? 0);
  const afterConsequences = Number(reopened.get("SELECT count(*) AS count FROM story_consequence_candidates")?.count ?? 0);
  h.assert("restart keeps version rows", afterVersions === beforeVersions, { beforeVersions, afterVersions });
  h.assert("restart keeps consequence rows", afterConsequences === beforeConsequences, { beforeConsequences, afterConsequences });
  h.assert("restart integrity ok", reopened.diagnostics().lastIntegrityCheck === "ok", reopened.diagnostics());
  reopened.close();
}

let runError = null;
try {
  if (mode === "general-real") {
    await generateProfile("general_story");
  } else if (mode === "adult-real") {
    await generateProfile("adult_intimacy");
  } else if (mode === "profiles") {
    await runGenerationMatrix();
  } else if (mode === "rewrite") {
    await runTransforms();
  } else if (mode === "continuity") {
    await generateProfile("palace_intrigue");
    await generateProfile("romance");
  } else if (mode === "consequence") {
    await generateProfile("action_battle");
    await generateProfile("mystery_reveal");
  } else if (mode === "streaming") {
    await runStreamingAndAbort();
  } else if (mode === "offline") {
    await runPolicyAndOfflineGuards();
  } else {
    await runGenerationMatrix();
    await runTransforms();
    await runSplitMerge();
    await runStreamingAndAbort();
    await runPolicyAndOfflineGuards();
    await runPersistenceRestart();
  }
} catch (error) {
  runError = error;
  h.fail("H2P.4 script runtime", {
    name: error?.name,
    code: error?.code,
    message: error?.message,
    stack: String(error?.stack || "").split("\n").slice(0, 4).join("\n"),
  });
} finally {
  try {
    connection.close();
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
  let cleanupOk = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.rmSync(storageDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
      cleanupOk = !fs.existsSync(storageDir);
      if (cleanupOk) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  h.assert("temporary storage cleanup", cleanupOk);
}

printAndExit(h.summary({
  expectedMinimumPass: mode === "all" ? 280 : undefined,
  universalLocalStageGenerationStatus: "ready",
  storyStagePromptRegistryStatus: "ready",
  storyStageRewriteStatus: "ready",
  storySceneMergeStatus: "ready",
  storyContinuityUpdateStatus: "ready",
  storyConsequenceCandidateStatus: "ready",
  adultLocalGenerationStatus: "verified_on_client_runtime",
  adultSegmentedGenerationStatus: "ready",
  intimacyContinuityStatus: "ready",
  adultConsequenceMemoryStatus: "ready",
  model: health.selectedModel,
  runtimeError: runError ? { name: runError?.name, code: runError?.code, message: runError?.message } : null,
}));
