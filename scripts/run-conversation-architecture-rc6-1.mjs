import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  CONVERSATION_TIMELINE_INITIAL_WINDOW,
  conversationTimelineStartIndex,
  nextConversationTimelineVisibleCount,
  restoredScrollTopAfterPrepend,
} from "../app/studio/project/[projectId]/chat/hooks/use-conversation-timeline-window.ts";

const root = process.cwd();
const chatRoot = path.join(root, "app", "studio", "project", "[projectId]", "chat");
const mode = process.argv[2] ?? "all";
const results = [];

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

async function fileSize(relativePath) {
  return (await fs.stat(path.join(root, relativePath))).size;
}

function runtimeImportStatements(source) {
  return [...source.matchAll(/^import[\s\S]*?;\s*$/gmu)]
    .map(([statement]) => statement.trim())
    .filter((statement) => !statement.startsWith("import type "));
}

async function reachableClientChunkSource(initialChunkPaths) {
  const chunkDirectory = path.join(root, ".next", "static", "chunks");
  const knownNames = new Set(
    (await fs.readdir(chunkDirectory)).filter((name) => name.endsWith(".js")),
  );
  const pending = initialChunkPaths.map((chunk) => path.basename(chunk));
  const visited = new Set();
  const sources = [];
  while (pending.length) {
    const name = pending.pop();
    if (!name || visited.has(name) || !knownNames.has(name)) continue;
    visited.add(name);
    const source = await fs.readFile(path.join(chunkDirectory, name), "utf8");
    sources.push(source);
    for (const [, referencedName] of source.matchAll(/static\/chunks\/([a-zA-Z0-9._-]+\.js)/gu)) {
      if (!visited.has(referencedName)) pending.push(referencedName);
    }
  }
  return { names: visited, source: sources.join("\n") };
}

async function test(name, action) {
  const started = performance.now();
  try {
    await action();
    results.push({ name, status: "PASS" });
    console.log(`PASS [${mode}] ${name} (${(performance.now() - started).toFixed(2)} ms)`);
  } catch (error) {
    results.push({ name, status: "FAIL" });
    console.error(`FAIL [${mode}] ${name}`);
    console.error(error);
  }
}

const componentFiles = [
  "conversation-shell.tsx",
  "session-sidebar.tsx",
  "message-timeline.tsx",
  "message-row.tsx",
  "message-composer.tsx",
  "attachment-tray.tsx",
  "attachment-card.tsx",
  "attachment-preview.tsx",
  "candidate-card.tsx",
  "approval-card.tsx",
  "tool-progress-card.tsx",
  "rpg-turn-card.tsx",
  "rpg-choice-card.tsx",
  "rpg-advanced-status.tsx",
  "artifact-drawer.tsx",
  "mobile-project-drawer.tsx",
];

const hookFiles = [
  "use-conversation-session.ts",
  "use-conversation-composer.ts",
  "use-conversation-branch.ts",
  "use-conversation-approval.ts",
  "use-conversation-attachments.ts",
  "use-conversation-rpg.ts",
  "use-conversation-operation.ts",
  "use-conversation-learning-loader.ts",
];

async function componentContract() {
  await test("workspace delegates substantial UI to named component contracts", async () => {
    const workspace = await fs.readFile(path.join(chatRoot, "conversation-workspace.tsx"), "utf8");
    const messageRow = await read("app/studio/project/[projectId]/chat/components/message-row.tsx");
    const messageTimeline = await read("app/studio/project/[projectId]/chat/components/message-timeline.tsx");
    const conversationTypes = await read("app/studio/project/[projectId]/chat/components/conversation-types.ts");
    const editController = await read("app/studio/project/[projectId]/chat/hooks/use-conversation-branch.ts");
    const editDialog = await read("app/studio/project/[projectId]/chat/components/edit-message-copy-dialog.tsx");
    const conversationRepository = await read("lib/novel-ai/conversation/repository.ts");
    for (const file of componentFiles) {
      const absolute = path.join(chatRoot, "components", file);
      const source = await fs.readFile(absolute, "utf8");
      assert.ok(source.length >= 350, `${file} must be a substantial contract, not an empty wrapper`);
    }
    for (const file of hookFiles) {
      const absolute = path.join(chatRoot, "hooks", file);
      const source = await fs.readFile(absolute, "utf8");
      assert.ok(source.length >= 450, `${file} must own meaningful derived state or behavior`);
    }
    for (const name of ["ConversationShell", "SessionSidebar", "MessageTimeline", "MessageComposer"]) {
      assert.match(workspace, new RegExp(`<${name}\\b`), `${name} must be used by workspace`);
    }
    assert.doesNotMatch(workspace, /messages\.map\s*\(/u, "message rows belong to MessageTimeline");
    assert.doesNotMatch(workspace, /<aside className=\{styles\.artifactDrawer\}/u, "drawer rendering must not remain in the orchestrator");
    for (const operation of ["editMessage", "approveArtifact", "rejectArtifact", "chooseRpgOption", "executeRpgChoice", "prepareLocalAttachments"]) {
      assert.doesNotMatch(workspace, new RegExp(`(?:async\\s+)?function\\s+${operation}\\b`, "u"), `${operation} belongs to a controller hook`);
    }
    assert.doesNotMatch(conversationTypes, /createBranch\s*:/u, "the public message-action contract must not expose a generic branch command");
    assert.doesNotMatch(messageRow, /data-conversation-action=["']branch["']|另開支線|actions\.createBranch/u);
    assert.match(messageRow, /data-conversation-action="edit-message-copy"/u);
    assert.match(messageRow, /修改此訊息（保留原文）/u);
    assert.match(editController, /conversation\.editMessageWithBranch\(/u);
    assert.doesNotMatch(editController, /window\.prompt\(/u, "editing must use the controlled copy dialog instead of a native prompt");
    assert.match(editController, /sourceContent:\s*message\.content/u, "editing must seed the controlled dialog with the original message");
    assert.match(workspace, /<EditMessageCopyDialog/u);
    assert.match(editDialog, /role="dialog"[\s\S]*?aria-modal="true"/u);
    assert.match(editDialog, /確認並在副本重試/u);
    assert.doesNotMatch(editController, /conversation\.branchSession\(/u, "the controller must not retain a generic branch-only path");
    assert.match(conversationRepository, /private async copyMessageAttachments\(/u);
    assert.match(
      conversationRepository,
      /\.\.\.source,[\s\S]*?id:\s*copyId,[\s\S]*?sessionId:\s*input\.targetSessionId/u,
      "branch attachment records must receive new IDs and the target session scope while retaining source proof",
    );
    assert.match(
      conversationRepository,
      /sourceMessageId:\s*source\.id,[\s\S]*?attachmentIds,/u,
      "copied branch messages must reference the copied attachment IDs",
    );
    assert.match(workspace, /existingUserMessage\?\.attachmentIds\.length/u);
    assert.match(workspace, /CONVERSATION_EDIT_COPY_ATTACHMENTS_RESELECT_REQUIRED/u);
    assert.match(workspace, /原始內容依隱私設計不會落盤/u);
    assert.match(workspace, /系統不會用空附件假裝續寫/u);
    assert.match(workspace, /setDashboardOpenRequest\(\(request\) => request \+ 1\)/u);
    assert.doesNotMatch(
      workspace,
      /setDrawer\(\{\s*kind:\s*["']status["'][\s\S]{0,800}?protagonistStats/u,
      "a status query must not serialize StoryState into the raw artifact drawer",
    );
    assert.match(messageTimeline, /data-testid="chat-detailed-dashboard"/u);
    assert.match(messageTimeline, /openRequest/u);
    for (const section of ["mode", "mainline", "relationships", "inventory", "quests", "recent-history"]) {
      assert.match(messageTimeline, new RegExp(`data-dashboard-section="${section}"`, "u"));
    }
    assert.match(workspace, /url\.searchParams\.delete\("prompt"\)/u);
    assert.match(workspace, /window\.history\.replaceState\(/u);
    assert.match(workspace, /initialPromptSenderRef\.current = sendRequest/u);
    assert.match(
      workspace,
      /void initialPromptSenderRef\.current\(initialPrompt, \(\) => \{[\s\S]*?url\.searchParams\.delete\("prompt"\)[\s\S]*?window\.history\.replaceState\(/u,
      "a URL prompt must be removed only from the sender acceptance callback",
    );
    assert.match(workspace, /onAccepted\?\.\(\);/u, "the URL cleanup callback runs only after the user message is enqueued");
    assert.doesNotMatch(
      workspace,
      /initialPromptUsed\.current = true;\s*const url = new URL/u,
      "the URL must remain intact when the prompt is rejected by a busy or locked sender",
    );
    assert.doesNotMatch(workspace, /setDraft\(initialPrompt\)/u, "a URL prompt must execute once instead of remaining as a draft");
    assert.match(await read("app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts"), /conversation\.approveChapterArtifact\(/u);
    const rpgController = await read("app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts");
    assert.match(rpgController, /plan = await planRpgChatChoices\(\{/u);
    assert.match(rpgController, /fallbackReason: "USER_REQUESTED_RULE_FALLBACK"/u);
    assert.match(rpgController, /requestRpgChoiceFallback/u);
    assert.doesNotMatch(rpgController, /RPG_CHOICE_RULE_PLAN_IMMEDIATE/u);
    assert.match(rpgController, /generateRpgChatTurnCandidate\(/u);
    assert.match(await read("app/studio/project/[projectId]/chat/hooks/use-conversation-attachments.ts"), /extractManualLearningFileInWorker\(/u);
  });
}

async function bundleBudget() {
  await test("conversation orchestrator and production first-load stay inside RC6 budgets", async () => {
    const bytes = await fileSize("app/studio/project/[projectId]/chat/conversation-workspace.tsx");
    assert.ok(bytes <= 78_000, `conversation-workspace.tsx is ${bytes} bytes; budget is 78000`);
    const workspace = await read("app/studio/project/[projectId]/chat/conversation-workspace.tsx");
    const attachments = await read("app/studio/project/[projectId]/chat/hooks/use-conversation-attachments.ts");
    const learningLoader = await read("app/studio/project/[projectId]/chat/hooks/use-conversation-learning-loader.ts");
    const workerClient = await read("lib/novel-ai/web/manual-learning-worker-client.ts");
    const workerRuntime = await read("lib/novel-ai/web/manual-learning-worker.ts");
    const learningImport = await read("lib/novel-ai/conversation/learning-import.ts");
    const preparationContract = await read("lib/novel-ai/web/manual-learning-import-preparation.ts");
    const conversationTypes = await read("app/studio/project/[projectId]/chat/components/conversation-types.ts");
    const attachmentRecords = await read("lib/novel-ai/conversation/attachments.ts");
    assert.doesNotMatch(workspace, /from\s+["'](?:pdfjs-dist|mammoth)/u);
    assert.doesNotMatch(
      `${workspace}\n${attachments}\n${conversationTypes}`,
      /from\s+["']@\/lib\/novel-ai\/web\/manual-learning-file["']/u,
      "Chat source graph must use the pure preparation contract, including type-only edges",
    );
    assert.equal(runtimeImportStatements(workspace).some((statement) => (
      statement.includes("conversation/learning-import") || statement.includes("manual-learning-worker-client")
    )), false, "workspace must not runtime-import learning coordinator/parser code");
    assert.equal(runtimeImportStatements(attachments).some((statement) => (
      statement.includes("manual-learning-file") || statement.includes("manual-learning-worker-client")
    )), false, "attachment controller must not runtime-import parser code before interaction");
    assert.match(attachments, /await import\(\s*["']@\/lib\/novel-ai\/web\/manual-learning-file-validation["']\s*\)/u);
    assert.match(attachments, /await import\(\s*["']@\/lib\/novel-ai\/web\/manual-learning-worker-client["']\s*\)/u);
    assert.match(attachmentRecords, /from "\.\.\/web\/manual-learning-file-validation"/u);
    assert.doesNotMatch(attachmentRecords, /from "\.\.\/web\/manual-learning-file"/u);
    assert.match(learningLoader, /import\(["']@\/lib\/novel-ai\/conversation\/learning-import["']\)/u);
    assert.match(learningLoader, /import\(["']@\/lib\/novel-ai\/web\/manual-learning-worker-client["']\)/u);
    assert.match(learningLoader, /prepareFile: prepareManualLearningFileInWorker/u);
    assert.equal(runtimeImportStatements(learningImport).some((statement) => (
      /from\s+["']\.\.\/web\/manual-learning-file["']/u.test(statement)
    )), false, "Chat-reachable coordinator must not runtime-import the direct parser");
    assert.doesNotMatch(
      learningImport,
      /(?:extractManualLearningFile|splitManualLearningDocumentSemantically)\s*\(/u,
      "coordinator must not call the direct extraction or semantic-splitting parser",
    );
    assert.match(learningImport, /prepareFile: ManualLearningFilePreparer/u);
    assert.equal(runtimeImportStatements(workerClient).some((statement) => (
      statement.includes("manual-learning-worker")
    )), false, "demand client must not import the heavy Worker runtime into Chat");
    assert.doesNotMatch(
      preparationContract,
      /from\s+["']\.\/manual-learning-file["']/u,
      "the preparation protocol contract must not type-link the heavy parser",
    );
    assert.match(workerRuntime, /message\.type === "prepare_import_file"/u);
    assert.match(workerRuntime, /splitManualLearningDocumentSemantically/u);
    assert.match(workerClient, /\/generated\/manual-learning-worker\.js\?v=manual-learning-worker-protocol-v2/u);
    assert.match(workerClient, /prepareManualLearningFileInWorker/u);
    assert.doesNotMatch(workerClient, /new URL\("\.\/manual-learning\.worker\.ts", import\.meta\.url\)/u);

    const workerAssetPath = path.join(root, "public", "generated", "manual-learning-worker.js");
    const workerAsset = await fs.readFile(workerAssetPath, "utf8");
    const workerAssetBytes = Buffer.byteLength(workerAsset);
    assert.ok(workerAssetBytes <= 3_500_000, `isolated manual-learning worker is ${workerAssetBytes} bytes`);
    assert.match(workerAsset, /LEARNING_FILE_MAGIC_MISMATCH/u, "the demand-loaded worker must retain the real parser");
    assert.match(workerAsset, /splitManualLearningDocumentSemantically/u, "the isolated worker must own semantic chunking");
    assert.match(workerAsset, /LEARNING_WORKER_DUPLICATE_REQUEST/u, "the demand-loaded worker must retain lifecycle safety");
    assert.match(workerAsset, /prepare_import_file/u, "the isolated worker must implement import preparation");
    assert.match(workerAsset, /manual-learning-worker-protocol-v2/u, "the isolated worker must fail closed on protocol drift");
    assert.doesNotMatch(workerAsset, /sourceMappingURL=/u, "the generated public worker must not expose sources");

    const statsPath = path.join(root, ".next", "diagnostics", "route-bundle-stats.json");
    const sourcePaths = [
      path.join(chatRoot, "conversation-workspace.tsx"),
      path.join(chatRoot, "hooks", "use-conversation-attachments.ts"),
      path.join(chatRoot, "hooks", "use-conversation-learning-loader.ts"),
      path.join(root, "lib", "novel-ai", "web", "manual-learning-worker-client.ts"),
      path.join(root, "lib", "novel-ai", "web", "manual-learning-worker.ts"),
      path.join(root, "lib", "novel-ai", "web", "manual-learning-file-validation.ts"),
      path.join(root, "lib", "novel-ai", "web", "manual-learning-import-preparation.ts"),
      path.join(root, "lib", "novel-ai", "conversation", "attachments.ts"),
      path.join(root, "lib", "novel-ai", "conversation", "learning-import.ts"),
    ];
    const stats = await fs.stat(statsPath).catch(() => null);
    const newestSource = Math.max(...await Promise.all(sourcePaths.map(async (file) => (await fs.stat(file)).mtimeMs)));
    const requireFreshProductionBundle = mode === "bundle-budget" || process.env.RC6_REQUIRE_FRESH_BUNDLE === "1";
    if (!stats || stats.mtimeMs < newestSource) {
      assert.equal(
        requireFreshProductionBundle,
        false,
        "production route stats are missing/stale; run npm run build before the bundle-budget gate",
      );
      return;
    }
    const routeStats = JSON.parse(await fs.readFile(statsPath, "utf8"));
    const chat = routeStats.find((row) => row.route === "/studio/project/[projectId]/chat");
    assert(chat, "production route stats must include the Conversation Chat route");
    assert.ok(
      chat.firstLoadUncompressedJsBytes <= 2_550_000,
      `Chat first-load is ${chat.firstLoadUncompressedJsBytes} bytes; budget is 2550000 (RC6 baseline 2584010)`,
    );
    const firstLoadSources = await Promise.all(chat.firstLoadChunkPaths.map((chunk) => fs.readFile(path.join(root, chunk), "utf8")));
    const firstLoadSource = firstLoadSources.join("\n");
    for (const heavyMarker of [
      "LEARNING_FILE_MAGIC_MISMATCH",
      "splitManualLearningDocumentSemantically",
      "manual-learning-worker-lifecycle-v1",
    ]) {
      assert.equal(firstLoadSource.includes(heavyMarker), false, `Chat first-load must exclude ${heavyMarker}`);
    }
    assert.match(firstLoadSource, /conversation-message-composer/u, "baseline Chat composer must remain interaction-ready");
    const reachableChunks = await reachableClientChunkSource(chat.firstLoadChunkPaths);
    for (const parserMarker of [
      "LEARNING_FILE_MAGIC_MISMATCH",
      "splitManualLearningDocumentSemantically",
    ]) {
      assert.equal(
        reachableChunks.source.includes(parserMarker),
        false,
        `Chat-reachable chunks must leave ${parserMarker} inside the isolated public Worker only`,
      );
    }
    const chunkDirectory = path.join(root, ".next", "static", "chunks");
    const allChunkNames = (await fs.readdir(chunkDirectory)).filter((name) => name.endsWith(".js"));
    const firstLoadNames = new Set(chat.firstLoadChunkPaths.map((chunk) => path.basename(chunk)));
    const deferredSources = await Promise.all(allChunkNames
      .filter((name) => !firstLoadNames.has(name))
      .map((name) => fs.readFile(path.join(chunkDirectory, name), "utf8")));
    const deferredSource = deferredSources.join("\n");
    for (const parserMarker of [
      "LEARNING_FILE_MAGIC_MISMATCH",
      "splitManualLearningDocumentSemantically",
    ]) {
      assert.equal(
        deferredSource.includes(parserMarker),
        false,
        `all Next deferred chunks must leave ${parserMarker} inside the isolated public Worker only`,
      );
    }
    assert.match(deferredSource, /manual-learning-worker-lifecycle-v1/u, "Worker client must remain available after interaction");
  });
}

async function lazyTools() {
  await test("artifact and technical panels are demand-loaded while playable choice facts stay visible", async () => {
    const workspace = await read("app/studio/project/[projectId]/chat/conversation-workspace.tsx");
    const drawer = await read("app/studio/project/[projectId]/chat/components/artifact-drawer.tsx");
    const messageRow = await read("app/studio/project/[projectId]/chat/components/message-row.tsx");
    const attachmentCard = await read("app/studio/project/[projectId]/chat/components/attachment-card.tsx");
    const rpgChoiceCard = await read("app/studio/project/[projectId]/chat/components/rpg-choice-card.tsx");
    const rpgAdvancedStatus = await read("app/studio/project/[projectId]/chat/components/rpg-advanced-status.tsx");
    const attachments = await read("app/studio/project/[projectId]/chat/hooks/use-conversation-attachments.ts");
    const learningLoader = await read("app/studio/project/[projectId]/chat/hooks/use-conversation-learning-loader.ts");
    const parser = await read("lib/novel-ai/web/manual-learning-file.ts");
    assert.match(workspace, /const ArtifactDrawer = dynamic\(\(\) => import\("\.\/components\/artifact-drawer"\)/u);
    assert.doesNotMatch(workspace, /import ArtifactDrawer from/u);
    assert.match(drawer, /const TechnicalEvidencePanel = dynamic\(\(\) => import\("\.\/technical-evidence-panel"\)/u);
    assert.match(attachmentCard, /const AttachmentPreview = dynamic\(\(\) => import\("\.\/attachment-preview"\)/u);
    assert.match(attachmentCard, /previewOpen \? <AttachmentPreview/u);
    assert.doesNotMatch(attachmentCard, /import \{?\s*AttachmentPreview/u);
    assert.match(messageRow, /<AttachmentCard\b/u);
    assert.doesNotMatch(messageRow, /attachment\.warnings\.map/u);
    assert.match(rpgChoiceCard, /const RpgAdvancedStatus = dynamic\(\(\) => import\("\.\/rpg-advanced-status"\)/u);
    assert.match(rpgChoiceCard, /advancedOpen \? <RpgAdvancedStatus/u);
    assert.doesNotMatch(rpgChoiceCard, /import \{?\s*RpgAdvancedStatus/u);
    assert.match(rpgChoiceCard, /data-kind="benefit"/u);
    assert.match(rpgChoiceCard, /data-kind="cost"[\s\S]*?choice\.knownCosts\.map/u);
    assert.match(rpgChoiceCard, /data-kind="risk"/u);
    assert.doesNotMatch(rpgChoiceCard, /choice\.irreversibleWarning/u);
    assert.match(rpgAdvancedStatus, /choice\.irreversibleWarning/u);
    assert.match(parser, /await import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/u);
    assert.match(parser, /await import\("mammoth"\)/u);
    assert.match(attachments, /await import\(\s*["']@\/lib\/novel-ai\/web\/manual-learning-worker-client["']\s*\)/u);
    assert.match(learningLoader, /conversation\/learning-import/u);
    assert.match(workspace, /actualExecutor: "browser-worker"/u);
  });
}

function longSessionFixture(size) {
  return Array.from({ length: size }, (_, index) => ({
    id: `message-${index}`,
    parentMessageId: index ? `message-${index - 1}` : null,
    sourceMessageId: index > 3 && index % 17 === 0 ? `message-${index - 3}` : null,
    candidateIds: index % 11 === 0 ? [`candidate-${index}`] : [],
    revision: index + 1,
    content: `內容 ${index}`,
  }));
}

async function longSession() {
  await test("100/500/1000-message windows preserve IDs, edit-copy and candidate lineage", async () => {
    for (const size of [100, 500, 1000]) {
      const messages = longSessionFixture(size);
      const immutableSnapshot = structuredClone(messages);
      let visibleCount = CONVERSATION_TIMELINE_INITIAL_WINDOW;
      let visible = messages.slice(conversationTimelineStartIndex(messages.length, visibleCount));
      assert.equal(new Set(visible.map((message) => message.id)).size, visible.length);
      assert.ok(visible.length <= CONVERSATION_TIMELINE_INITIAL_WINDOW);
      while (visible.length < messages.length) {
        visibleCount = nextConversationTimelineVisibleCount(messages.length, visibleCount);
        visible = messages.slice(conversationTimelineStartIndex(messages.length, visibleCount));
        assert.equal(new Set(visible.map((message) => message.id)).size, visible.length);
      }
      assert.deepEqual(visible, immutableSnapshot);
      assert.deepEqual(messages, immutableSnapshot, "windowing must never mutate canonical message records");
    }
  });
}

async function scrollRestoration() {
  await test("prepend compensation and per-session scroll restoration remain deterministic", async () => {
    assert.equal(restoredScrollTopAfterPrepend(320, 2_000, 3_250), 1_570);
    assert.equal(restoredScrollTopAfterPrepend(0, 800, 800), 0);
    assert.equal(restoredScrollTopAfterPrepend(12, 900, 700), 12);
    const hook = await read("app/studio/project/[projectId]/chat/hooks/use-conversation-timeline-window.ts");
    const row = await read("app/studio/project/[projectId]/chat/components/message-row.tsx");
    assert.match(hook, /novel:conversation-scroll:/u);
    assert.match(hook, /visibleCount/u);
    assert.match(hook, /scrollHeight/u);
    assert.match(row, /data-message-id=\{message\.id\}/u);
    assert.match(row, /data-parent-message-id=\{message\.parentMessageId/u);
    assert.match(row, /data-source-message-id=\{message\.sourceMessageId/u);
    assert.match(row, /data-lineage-root=\{lineage\.rootId\}/u);
    assert.match(row, /data-lineage-depth=\{lineage\.depth\}/u);
  });
}

const suites = {
  "component-contract": componentContract,
  "bundle-budget": bundleBudget,
  "lazy-tools": lazyTools,
  "long-session": longSession,
  "scroll-restoration": scrollRestoration,
};

if (mode === "all") {
  for (const suite of Object.values(suites)) await suite();
} else if (suites[mode]) {
  await suites[mode]();
} else {
  throw new Error(`Unknown conversation architecture mode: ${mode}`);
}

const failed = results.filter((result) => result.status === "FAIL").length;
console.log(`P2.4B RC6.1 conversation architecture gate: ${results.length - failed} PASS / ${failed} FAIL / ${results.length} TOTAL`);
if (failed) process.exitCode = 1;
