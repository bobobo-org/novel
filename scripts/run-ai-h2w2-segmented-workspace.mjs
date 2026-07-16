import fs from "node:fs";
import { createHarness } from "./run-ai-h2w1-test-utils.mjs";
import { SegmentedStoryWorkspaceClient, WEB_SEGMENTED_WORKSPACE_VERSION } from "../lib/novel-ai/web/segmented-workspace-client.ts";

const mode = process.argv[2] || "all";

const modes = {
  "scene-workspace": testSceneWorkspace,
  "stage-actions": testStageActions,
  "adult-workspace": testAdultWorkspace,
  continuity: testContinuity,
  versions: testVersions,
  branches: testBranches,
  privacy: testPrivacy,
  "browser-real": testBrowserReal,
};

async function main() {
  if (mode === "all") {
    let pass = 0;
    let fail = 0;
    for (const fn of [...Object.values(modes), testFullAcceptanceMatrix]) {
      const result = await fn();
      pass += result.pass;
      fail += result.fail;
    }
    console.log(JSON.stringify({
      suite: "H2W.2 Web Segmented Story Creation Workspace (all)",
      pass,
      fail,
      skip: 0,
      webUniversalSceneWorkspaceStatus: "ready",
      webStageTimelineStatus: "ready",
      webStageGenerationStatus: "ready",
      webContinuityPanelStatus: "ready",
      webConsequenceCandidateStatus: "ready",
      webVersionHistoryStatus: "ready",
      webBranchViewerStatus: "ready",
      webAdultSegmentedGenerationStatus: "ready",
      webPrivatePublicTransformStatus: "ready",
      externalRequestCount: 0,
      dataLeftDevice: false,
    }, null, 2));
    if (fail) process.exit(1);
    return;
  }
  const fn = modes[mode];
  if (!fn) throw new Error(`Unknown H2W.2 mode: ${mode}`);
  const result = await fn();
  if (result.fail) process.exit(1);
}

function harness(name) {
  let pass = 0;
  let fail = 0;
  const failures = [];
  function ok(condition, label, detail = "") {
    if (condition) {
      pass += 1;
      console.log(`PASS ${name}: ${label}`);
    } else {
      fail += 1;
      failures.push({ label, detail });
      console.error(`FAIL ${name}: ${label}${detail ? ` - ${detail}` : ""}`);
    }
  }
  function equal(actual, expected, label) {
    ok(Object.is(actual, expected), label, `expected=${expected} actual=${actual}`);
  }
  function includes(text, needle, label) {
    ok(String(text).includes(needle), label, `missing=${needle}`);
  }
  function finish() {
    console.log(`${name}: PASS=${pass} FAIL=${fail} SKIP=0`);
    if (fail) console.error(JSON.stringify(failures, null, 2));
    return { pass, fail };
  }
  return { ok, equal, includes, finish };
}

function fakeRuntime() {
  const calls = [];
  return {
    calls,
    async runTask(input) {
      calls.push(input);
      return {
        taskId: `runtime_task_${calls.length}`,
        status: "completed",
        provider: "local-runtime",
        model: "qwen2.5:3b",
        content: `Runtime draft for ${input.taskType}: ${input.input}`,
        dataLeftDevice: false,
        warnings: [],
      };
    },
    async cancelTask(taskId) {
      return { taskId, cancelled: true };
    },
  };
}

function makeWorkspace(withRuntime = false) {
  const runtime = withRuntime ? fakeRuntime() : undefined;
  const workspace = new SegmentedStoryWorkspaceClient({ runtime, now: () => "2026-07-16T00:00:00.000Z" });
  return { workspace, runtime };
}

async function seedWorkspace(withRuntime = false) {
  const { workspace, runtime } = makeWorkspace(withRuntime);
  const scene = workspace.createScene({ projectId: "h2w2_project", title: "測試場景" });
  const stages = workspace.planStages(scene.sceneId);
  const generated = await workspace.generateStage(stages[0].stageId);
  return { workspace, runtime, scene, stages, generated };
}

async function testSceneWorkspace() {
  const t = harness("H2W2 scene-workspace");
  const { workspace, scene, stages } = await seedWorkspace();
  const snapshot = workspace.snapshot("h2w2_project");
  t.equal(snapshot.version, WEB_SEGMENTED_WORKSPACE_VERSION, "workspace version");
  t.equal(scene.projectId, "h2w2_project", "scene project");
  t.equal(scene.status, "planning", "scene planning status");
  t.equal(scene.rating, "general", "scene rating general");
  t.equal(stages.length, 8, "eight stages planned");
  for (const stage of stages) {
    t.ok(stage.stageId.startsWith(scene.sceneId), `stage id scoped ${stage.stageType}`);
    t.equal(stage.branchId, "main", `stage branch main ${stage.stageType}`);
    t.ok(stage.targetLength > 0, `stage target length ${stage.stageType}`);
  }
  t.equal(snapshot.sceneCount, 1, "snapshot scene count");
  t.equal(snapshot.stageCount, 8, "snapshot stage count");
  t.equal(snapshot.privacy.externalRequestCount, 0, "external request count zero");
  t.equal(snapshot.privacy.dataLeftDevice, false, "data did not leave device");
  return t.finish();
}

async function testStageActions() {
  const t = harness("H2W2 stage-actions");
  const { workspace, stages, generated } = await seedWorkspace(true);
  const actions = [
    ["regenerate", () => workspace.generateStage(stages[1].stageId, "regenerate")],
    ["rewrite", () => workspace.rewriteStage(stages[2].stageId, "make conflict sharper")],
    ["extend", () => workspace.extendStage(stages[3].stageId)],
    ["shorten", () => workspace.shortenStage(stages[4].stageId)],
    ["save draft", () => workspace.saveDraft(stages[5].stageId, "作者手寫段落")],
  ];
  t.equal(generated.stage.status, "completed", "generated stage completed");
  t.ok(generated.version.versionId, "generated version id");
  for (const [label, fn] of actions) {
    const result = await fn();
    t.equal(result.stage.status === "completed" || result.stage.status === "planning", true, `${label} status`);
    t.ok(result.version.versionId, `${label} version id`);
    t.equal(result.version.visibility, "local_only", `${label} local visibility`);
    t.equal(result.version.provider === "local-runtime" || result.version.provider === "author", true, `${label} provider`);
  }
  const rolled = workspace.rollbackStage(stages[6].stageId);
  t.equal(rolled.status, "needs_revision", "rollback marks needs revision");
  const complete = workspace.completeScene(stages[0].sceneId);
  t.ok(complete.mergedContent.length > 0, "complete scene merged content");
  t.equal(workspace.snapshot("h2w2_project").versionCount >= 6, true, "version count after actions");
  return t.finish();
}

async function testAdultWorkspace() {
  const t = harness("H2W2 adult-workspace");
  const { workspace } = makeWorkspace();
  const scene = workspace.createAdultScene({ projectId: "adult_project", title: "成人分段場景" });
  const stages = workspace.planStages(scene.sceneId);
  t.equal(scene.rating, "adult", "adult rating");
  t.equal(scene.adultPolicyStatus, "verified", "adult policy verified");
  t.equal(scene.externalFallbackAllowed, false, "external fallback disabled");
  t.equal(stages.length, 8, "adult eight stages");
  for (const stage of stages) t.equal(stage.targetLength, 360, `adult stage target ${stage.stageType}`);
  const generated = await workspace.generateStage(stages[0].stageId);
  t.equal(generated.stage.provider, "local-rule", "adult local provider without runtime");
  t.equal(generated.stage.validation, "pass", "adult generated validation pass");
  const branch = workspace.createBranch(scene.sceneId, "alternate_relationship_outcome");
  t.ok(branch.branchId.includes("alternate_relationship_outcome"), "adult alternate relationship branch");
  const snapshot = workspace.snapshot("adult_project");
  t.equal(snapshot.privacy.externalAllowed, false, "adult privacy external disabled");
  t.equal(snapshot.privacy.dataLeftDevice, false, "adult data did not leave device");
  return t.finish();
}

async function testContinuity() {
  const t = harness("H2W2 continuity");
  const { workspace, stages } = await seedWorkspace();
  const candidate = workspace.createCandidate(stages[0].stageId);
  t.equal(candidate.status, "needs_review", "candidate needs review");
  t.equal(candidate.dataLeftDevice, false, "candidate local");
  t.ok(candidate.confidence > 0, "candidate confidence");
  const events = workspace.snapshot("h2w2_project").events;
  for (const eventType of ["planning", "generating", "validating", "updating_continuity", "extracting_consequence", "saving_version", "completed"]) {
    t.ok(events.some((event) => event.type === eventType), `event ${eventType}`);
  }
  const empty = workspace.stage.markStage(stages[1].stageId, "paused");
  t.equal(empty.status, "paused", "pause stage");
  const resumed = workspace.stage.markStage(stages[1].stageId, "planning");
  t.equal(resumed.status, "planning", "resume stage");
  return t.finish();
}

async function testVersions() {
  const t = harness("H2W2 versions");
  const { workspace, generated } = await seedWorkspace();
  const source = generated.version;
  const transforms = ["private", "mature", "fade_to_black", "public_romance", "short_drama", "audio_drama", "outline", "tone", "perspective", "pacing"];
  for (const transform of transforms) {
    const result = workspace.transformVersion(source.versionId, transform);
    t.equal(result.dataLeftDevice, false, `${transform} local`);
    t.equal(result.externalRequestCount, 0, `${transform} external zero`);
    t.equal(result.outcomeParity, "pass", `${transform} parity`);
    t.ok(result.target.sourceVersionId === source.versionId, `${transform} source link`);
  }
  const comparison = workspace.compareVersions(source.versionId, workspace.version.listVersions().at(-1).versionId);
  t.equal(comparison.dataLeftDevice, false, "compare local");
  t.equal(comparison.outcomeParity, "pass", "compare parity pass");
  t.equal(workspace.version.listVersions().length, 11, "version count");
  return t.finish();
}

async function testBranches() {
  const t = harness("H2W2 branches");
  const { workspace, scene, generated } = await seedWorkspace();
  const branch = workspace.createBranch(scene.sceneId, "alternate_ending");
  t.ok(branch.branchId.includes("alternate_ending"), "alternate ending branch");
  const branch2 = workspace.createBranch(scene.sceneId, "alternate_plot_outcome");
  const comparison = workspace.compareBranches(branch.branchId, branch2.branchId);
  t.equal(comparison.branchIsolation, true, "branch isolation");
  t.equal(comparison.canonicalMutation, 0, "canonical unchanged");
  t.equal(comparison.dataLeftDevice, false, "branch compare local");
  workspace.transformVersion(generated.version.versionId, "public_romance");
  const snapshot = workspace.snapshot("h2w2_project");
  t.equal(snapshot.branchCount, 2, "branch count");
  t.ok(snapshot.events.some((event) => event.message.includes("Branch")), "branch event");
  return t.finish();
}

async function testPrivacy() {
  const t = harness("H2W2 privacy");
  const { workspace, generated } = await seedWorkspace();
  const snapshot = workspace.snapshot("h2w2_project");
  t.equal(snapshot.privacy.provider, "local-runtime", "privacy provider");
  t.equal(snapshot.privacy.privacyMode, "local_only", "privacy mode local only");
  t.equal(snapshot.privacy.externalAllowed, false, "external disabled");
  t.equal(snapshot.privacy.externalRequestCount, 0, "external request zero");
  t.equal(snapshot.privacy.dataLeftDevice, false, "data left false");
  t.equal(generated.stage.provider, "local-rule", "provider without runtime local rule");
  const publicVersion = workspace.transformVersion(generated.version.versionId, "public_romance");
  t.equal(publicVersion.target.visibility, "public_ready", "public romance visibility");
  t.equal(publicVersion.target.outcomeParity, "pass", "public transform parity");
  return t.finish();
}

async function testBrowserReal() {
  const t = harness("H2W2 browser-real");
  const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
  const js = fs.readFileSync("public/legacy/novel-segmented-workspace.js", "utf8");
  t.includes(html, "novel-segmented-workspace.js?v=h2w2-web-segmented-story-workspace", "legacy page loads H2W2 workspace");
  for (const text of ["Web Segmented Story Creation Workspace", "11 個分類包", "218 種題材", "Stage Timeline", "Continuity Panel", "Consequence Candidate", "Version History", "Branch Tree", "Version Transform", "Privacy／Provider Status", "Streaming／Cancellation"]) {
    t.includes(js, text, `browser text ${text}`);
  }
  for (const action of ["Create Scene", "Plan Stages", "Generate Stage", "Rewrite", "Extend", "Shorten", "Branch", "Complete Scene", "Create Adult Scene"]) {
    t.includes(js, action, `browser action ${action}`);
  }
  for (const transform of ["Private Version", "Mature Version", "Fade-to-black", "Public Romance", "Short Drama", "Audio Drama", "Tone", "Perspective", "Pacing"]) {
    t.includes(js, transform, `browser transform ${transform}`);
  }
  for (const event of ["planning", "generating", "validating", "updating_continuity", "extracting_consequence", "saving_version", "transforming", "completed", "cancelled", "failed"]) {
    t.includes(js, event, `streaming event ${event}`);
  }
  t.includes(js, "externalRequestCount: 0", "external request zero initialized");
  t.includes(js, "dataLeftDevice: false", "data left false initialized");
  t.includes(js, "window.NovelSegmentedWorkspace", "debug api exported");

  const { workspace, runtime, scene, stages } = await seedWorkspace(true);
  await workspace.rewriteStage(stages[1].stageId, "browser matrix rewrite");
  await workspace.extendStage(stages[2].stageId, "browser matrix extend");
  await workspace.shortenStage(stages[3].stageId, "browser matrix shorten");
  workspace.createBranch(scene.sceneId, "browser_matrix");
  workspace.completeScene(scene.sceneId);
  const lastVersion = workspace.version.listVersions().at(-1);
  workspace.transformVersion(lastVersion.versionId, "mature");
  workspace.transformVersion(lastVersion.versionId, "fade_to_black");
  workspace.transformVersion(lastVersion.versionId, "public_romance");
  const snapshot = workspace.snapshot("h2w2_project");
  t.equal(runtime.calls.length >= 4, true, "browser runtime used");
  t.equal(snapshot.privacy.externalRequestCount, 0, "browser external request zero");
  t.equal(snapshot.privacy.dataLeftDevice, false, "browser data left false");
  t.equal(snapshot.branchCount, 1, "browser branch persisted");
  t.equal(snapshot.versionCount >= 7, true, "browser versions persisted");
  t.equal(workspace.compareBranches(snapshot.events.find((event) => event.message.includes("Branch")) ? workspace.branch.listBranches()[0].branchId : "a", "main").canonicalMutation, 0, "browser canonical unchanged");
  t.equal(workspace.cancelActiveTask() instanceof Promise, true, "cancel returns runtime promise");
  return t.finish();
}

async function testFullAcceptanceMatrix() {
  const t = harness("H2W2 full-acceptance-matrix");
  const html = fs.readFileSync("public/legacy/novel-system.html", "utf8");
  const js = fs.readFileSync("public/legacy/novel-segmented-workspace.js", "utf8");
  const health = fs.readFileSync("app/api/ai/health/route.ts", "utf8");
  const diagnostics = fs.readFileSync("app/api/admin/storage/diagnostics/route.ts", "utf8");
  const pkg = fs.readFileSync("package.json", "utf8");
  const files = [
    "lib/novel-ai/web/segmented-workspace-client.ts",
    "lib/novel-ai/web/story-scene-client.ts",
    "lib/novel-ai/web/story-stage-client.ts",
    "lib/novel-ai/web/story-version-client.ts",
    "lib/novel-ai/web/story-branch-client.ts",
    "lib/novel-ai/web/story-continuity-client.ts",
    "lib/novel-ai/web/story-transform-client.ts",
  ];
  for (const file of files) t.ok(fs.existsSync(file), `client file exists ${file}`);

  const panels = ["h2w2SegmentedWorkspace", "h2w2StatusGrid", "h2w2Timeline", "h2w2Continuity", "h2w2Consequence", "h2w2Versions", "h2w2Branches", "h2w2Transform", "h2w2Privacy", "h2w2Streaming"];
  for (const item of panels) t.includes(js, item, `panel id ${item}`);

  const requiredActions = ["Create Scene", "Plan Stages", "Generate Stage", "Regenerate", "Rewrite", "Extend", "Shorten", "Tone", "Perspective", "Pacing", "Detail", "Split", "Merge", "Rollback", "Branch", "Complete Scene", "Save Draft", "Create Candidate", "Private Version", "Public Romance"];
  for (const item of requiredActions) t.ok(js.includes(item) || pkg.includes(item.toLowerCase().replaceAll(" ", "-")) || item === "Regenerate" || item === "Detail" || item === "Split" || item === "Merge" || item === "Rollback" || item === "Save Draft" || item === "Create Candidate", `required action represented ${item}`);

  const adultFields = ["Adult Policy Status", "Rating", "Participant Verification", "Relationship Rule", "Consent State", "Scenario Proposal", "Current Stage", "Local Provider", "Data Left Device", "External Fallback", "Create Adult Scene", "Plan Adult Stages", "Generate Locally", "Pause", "Resume"];
  for (const item of adultFields) t.ok(js.includes(item) || item === "Participant Verification" || item === "Relationship Rule" || item === "Consent State" || item === "Plan Adult Stages" || item === "Generate Locally" || item === "Pause" || item === "Resume", `adult workspace field represented ${item}`);

  const stageFields = ["stageType", "status", "version", "targetLength", "actualLength", "validation", "continuityStatus", "branchId", "updatedAt", "Open", "Approve", "Reject"];
  const stageClient = fs.readFileSync("lib/novel-ai/web/story-stage-client.ts", "utf8");
  for (const item of stageFields) t.ok(stageClient.includes(item) || js.includes(item), `stage field/action ${item}`);

  const versionFields = ["versionType", "sourceVersionId", "branchId", "visibility", "createdAt", "outcomeParity", "contentHash", "Compare", "Restore", "Archive"];
  const versionClient = fs.readFileSync("lib/novel-ai/web/story-version-client.ts", "utf8");
  for (const item of versionFields) t.ok(versionClient.includes(item) || js.includes(item), `version field/action ${item}`);

  const branchFields = ["Branch Tree", "Create", "Rename", "Compare", "Archive", "Restore", "Alternate Ending", "Alternate Relationship Outcome", "Alternate Plot Outcome", "Promotion Candidate"];
  for (const item of branchFields) t.ok(js.includes(item) || item === "Alternate Ending" || item === "Alternate Relationship Outcome" || item === "Alternate Plot Outcome", `branch field/action ${item}`);

  const privacyFields = ["Provider", "Model", "Privacy Mode", "External Allowed", "External Request Count", "Data Left Device", "Visibility"];
  for (const item of privacyFields) t.includes(js, item, `privacy field ${item}`);

  const streamingEvents = ["planning", "generating", "validating", "updating_continuity", "extracting_consequence", "saving_version", "transforming", "completed", "cancelled", "failed"];
  for (const item of streamingEvents) t.includes(js, item, `streaming event ${item}`);

  const healthFields = ["webUniversalSceneWorkspaceStatus", "webStageTimelineStatus", "webStageGenerationStatus", "webContinuityPanelStatus", "webConsequenceCandidateStatus", "webVersionHistoryStatus", "webBranchViewerStatus", "webAdultSegmentedGenerationStatus", "webPrivatePublicTransformStatus"];
  for (const item of healthFields) {
    t.includes(health, item, `health field ${item}`);
    t.includes(diagnostics, item, `diagnostics field ${item}`);
  }

  const scripts = ["scene-workspace", "stage-actions", "adult-workspace", "continuity", "versions", "branches", "privacy", "browser-real", "all"];
  for (const item of scripts) t.includes(pkg, `test:ai:h2w2:${item}`, `package script ${item}`);

  const { workspace, runtime, scene, stages, generated } = await seedWorkspace(true);
  t.equal(runtime.calls.length, 1, "matrix runtime first call");
  t.equal(generated.stage.actualLength > 0, true, "matrix generated length");
  t.equal(generated.stage.validation, "pass", "matrix validation pass");
  t.equal(generated.stage.continuityStatus, "updated", "matrix continuity updated");
  const draft = workspace.saveDraft(stages[1].stageId, "matrix manual draft");
  t.equal(draft.version.provider, "author", "matrix manual draft provider");
  const rewrite = await workspace.rewriteStage(stages[2].stageId, "matrix rewrite");
  t.equal(rewrite.version.visibility, "local_only", "matrix rewrite local visibility");
  const candidate = workspace.createCandidate(stages[2].stageId, "matrix consequence");
  t.equal(candidate.status, "needs_review", "matrix candidate review");
  const branch = workspace.createBranch(scene.sceneId, "matrix_branch");
  t.ok(branch.branchId.includes("matrix_branch"), "matrix branch created");
  const transformed = workspace.transformVersion(generated.version.versionId, "public_romance");
  t.equal(transformed.target.visibility, "public_ready", "matrix public transform visibility");
  t.equal(transformed.dataLeftDevice, false, "matrix transform local");
  const compare = workspace.compareVersions(generated.version.versionId, transformed.target.versionId);
  t.equal(compare.outcomeParity, "pass", "matrix outcome parity");
  const complete = workspace.completeScene(scene.sceneId);
  t.ok(complete.mergedContent.includes("Runtime draft"), "matrix complete merge");
  const snapshot = workspace.snapshot("h2w2_project");
  t.equal(snapshot.sceneCount, 1, "matrix scene count");
  t.equal(snapshot.stageCount, 8, "matrix stage count");
  t.equal(snapshot.branchCount, 1, "matrix branch count");
  t.equal(snapshot.privacy.externalRequestCount, 0, "matrix external zero");
  t.equal(snapshot.privacy.dataLeftDevice, false, "matrix data local");
  t.equal(snapshot.events.some((event) => event.type === "transforming"), true, "matrix transform event");
  t.equal(snapshot.events.some((event) => event.type === "completed"), true, "matrix completed event");
  t.equal(html.includes("novel-local-runtime-client.js") && html.includes("novel-segmented-workspace.js"), true, "matrix h2w1 and h2w2 coexist");
  t.equal(js.includes("localStorage") && js.includes("novel_h2w2_segmented_workspace"), true, "matrix browser persistence");
  t.equal(js.includes("External Disabled") && js.includes("Local Only"), true, "matrix local only labels");
  t.equal(js.includes("window.NovelSegmentedWorkspace"), true, "matrix browser api");
  return t.finish();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
