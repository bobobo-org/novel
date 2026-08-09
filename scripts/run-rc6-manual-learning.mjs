import assert from "node:assert/strict";
import {
  extractManualLearningFile,
  extractManualLearningFiles,
  orderPdfTextItems,
  splitManualLearningDocumentSemantically,
  validateManualLearningBatch,
} from "../lib/novel-ai/web/manual-learning-file.ts";
import { ManualLearningWorkerRuntime } from "../lib/novel-ai/web/manual-learning-worker.ts";
import {
  AtomicLearningImportCoordinator,
  synthesizeLearningImportStaging,
} from "../lib/novel-ai/conversation/learning-import.ts";
import { ConversationRepositoryService } from "../lib/novel-ai/conversation/repository.ts";
import { conversationCanonicalRecordDigest } from "../lib/novel-ai/conversation/approval-transaction.ts";
import { MemorySovereignLearningRepository } from "../lib/novel-ai/sovereign-learning/repository.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/memory/memory-repository.ts";
import {
  createProjectBackup,
  restoreProjectBackup,
} from "../lib/novel-ai/repository/backup.ts";
import { makeRecord } from "../lib/novel-ai/domain/common.ts";

const suite = process.argv[2] ?? "all";
const tests = [];
const results = [];
const register = (name, run) => tests.push({ name, run });

function sourceText(label, repeat = 12) {
  return `第一卷 ${label}\n\n第一章 雨夜\n\n「你確定要進去？」她壓低聲音。\n\n他望向門後的微光，知道此刻的選擇會改變兩人的關係與下一場危機。\n\n${`${label}的場景讓角色承受具體壓力，線索逐步揭露，決定立即帶來新的後果。`.repeat(repeat)}`;
}

function littleEndian(value, bytes) {
  return Array.from({ length: bytes }, (_, index) => (value >>> (index * 8)) & 0xff);
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const encoder = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = encoder.encode(name);
    const content = typeof value === "string" ? encoder.encode(value) : value;
    const checksum = crc32(content);
    const local = Uint8Array.from([
      0x50, 0x4b, 0x03, 0x04,
      20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...littleEndian(checksum, 4),
      ...littleEndian(content.length, 4),
      ...littleEndian(content.length, 4),
      ...littleEndian(nameBytes.length, 2), 0, 0,
      ...nameBytes,
      ...content,
    ]);
    locals.push(local);
    central.push(Uint8Array.from([
      0x50, 0x4b, 0x01, 0x02,
      20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...littleEndian(checksum, 4),
      ...littleEndian(content.length, 4),
      ...littleEndian(content.length, 4),
      ...littleEndian(nameBytes.length, 2),
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ...littleEndian(offset, 4),
      ...nameBytes,
    ]));
    offset += local.length;
  }
  const centralSize = central.reduce((total, item) => total + item.length, 0);
  const end = Uint8Array.from([
    0x50, 0x4b, 0x05, 0x06,
    0, 0, 0, 0,
    ...littleEndian(entries.length, 2),
    ...littleEndian(entries.length, 2),
    ...littleEndian(centralSize, 4),
    ...littleEndian(offset, 4),
    0, 0,
  ]);
  const output = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const item of [...locals, ...central, end]) {
    output.set(item, cursor);
    cursor += item.length;
  }
  return output;
}

function docxBytes({ macro = false, external = false } = {}) {
  const longText = sourceText("DOCX", 16).replace(/[<&]/gu, " ");
  const entries = [
    ["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>${longText}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`],
    ["word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${external ? `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.test/tracker.png" TargetMode="External"/>` : ""}</Relationships>`],
  ];
  if (macro) entries.push(["word/vbaProject.bin", Uint8Array.of(1, 2, 3, 4)]);
  return storedZip(entries);
}

function blankPdfBytes() {
  const encoder = new TextEncoder();
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(encoder.encode(body).length);
    body += object;
  }
  const xrefOffset = encoder.encode(body).length;
  body += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(body);
}

async function seedConversation(repository, projectId, sessionId) {
  const projectBase = makeRecord(projectId, "user");
  await repository.put("projects", {
    ...projectBase,
    id: projectId,
    title: "Atomic import test",
    creationMode: "blank",
    genrePackId: null,
    genreId: null,
    subgenreId: null,
    coreIdea: { value: null, status: "unset", source: null, updatedAt: null },
    narrativeStyle: { value: null, status: "unset", source: null, updatedAt: null },
    adultMode: false,
    activeChapterId: null,
    storyBibleId: `${projectId}:bible`,
    storyStateId: `${projectId}:state`,
  });
  const sessionBase = makeRecord(projectId, "user");
  await repository.put("conversationSessions", {
    ...sessionBase,
    id: sessionId,
    conversationSchemaVersion: "conversation-session-v1",
    title: "Import",
    status: "active",
    activeChapterId: null,
    lastMessageAt: null,
    summaryDigest: null,
    parentSessionId: null,
    branchedFromMessageId: null,
  });
}

function registerFileContractTests() {
  register("TXT extraction validates MIME and returns privacy truth", async () => {
    const file = new File([sourceText("TXT")], "story.txt", { type: "text/plain" });
    const result = await extractManualLearningFile(file);
    assert.equal(result.documentFormat, "txt");
    assert.equal(result.rawContentRetained, false);
    assert.equal(result.dataLeftDevice, false);
    assert.match(result.contentHash, /^[a-f0-9]{64}$/u);
  });

  register("MIME and magic-byte mismatches fail closed", async () => {
    await assert.rejects(
      () => extractManualLearningFile(new File([sourceText("bad")], "bad.pdf", { type: "text/plain" })),
      (error) => error.code === "LEARNING_FILE_MIME_MISMATCH",
    );
    await assert.rejects(
      () => extractManualLearningFile(new File([sourceText("bad")], "bad.pdf", { type: "application/pdf" })),
      (error) => error.code === "LEARNING_FILE_MAGIC_MISMATCH",
    );
  });

  register("one malformed file does not block valid siblings", async () => {
    const results = await extractManualLearningFiles([
      new File([sourceText("valid")], "valid.md", { type: "text/markdown" }),
      new File(["{".repeat(180)], "broken.json", { type: "application/json" }),
    ]);
    assert.deepEqual(results.map((item) => item.status), ["completed", "failed"]);
    assert.equal(results[1].errorCode, "LEARNING_JSON_INVALID");
    assert(results.every((item) => !("file" in item)));
  });

  register("batch file-count limit is enforced before parsing", () => {
    const files = Array.from({ length: 13 }, (_, index) => new File([sourceText(String(index))], `${index}.txt`, { type: "text/plain" }));
    assert.throws(() => validateManualLearningBatch(files), (error) => error.code === "LEARNING_BATCH_FILE_COUNT_EXCEEDED");
  });

  register("DOCX raw extraction reports Mammoth safety and removes external relationships", async () => {
    const result = await extractManualLearningFile(new File(
      [docxBytes({ external: true })],
      "owned.docx",
      { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    ));
    assert.equal(result.documentFormat, "docx");
    assert(result.warnings.includes("DOCX_IMAGES_NOT_LOADED"));
    assert(result.warnings.includes("DOCX_EXTERNAL_RELATIONSHIPS_REMOVED"));
    assert(result.text.length >= 120);
  });

  register("DOCX macro payload is rejected", async () => {
    await assert.rejects(
      () => extractManualLearningFile(new File(
        [docxBytes({ macro: true })],
        "macro.docx",
        { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      )),
      (error) => error.code === "LEARNING_DOCX_MACRO_FORBIDDEN",
    );
  });

  register("blank scanned-style PDF reports OCR_REQUIRED and page progress", async () => {
    const progress = [];
    await assert.rejects(
      () => extractManualLearningFile(
        new File([blankPdfBytes()], "scan.pdf", { type: "application/pdf" }),
        { onProgress: (item) => progress.push(item) },
      ),
      (error) => error.code === "OCR_REQUIRED",
    );
    assert(progress.some((item) => item.phase === "page" && item.pageNumber === 1));
  });

  register("PDF two-column ordering reads left column before right column", () => {
    const ordered = orderPdfTextItems([
      { str: "R1", transform: [1, 0, 0, 1, 350, 700] },
      { str: "L2", transform: [1, 0, 0, 1, 40, 650] },
      { str: "L1", transform: [1, 0, 0, 1, 40, 700] },
      { str: "R2", transform: [1, 0, 0, 1, 350, 650] },
      { str: "L3", transform: [1, 0, 0, 1, 40, 600] },
      { str: "R3", transform: [1, 0, 0, 1, 350, 600] },
    ], 600);
    assert.deepEqual(ordered, ["L1", "L2", "L3", "R1", "R2", "R3"]);
  });

  register("semantic chunk hierarchy preserves source and overlap digests", async () => {
    const chunks = await splitManualLearningDocumentSemantically(sourceText("分卷", 80), 520);
    assert(chunks.length > 1);
    assert.match(chunks[0].sourceSection, /第一卷/u);
    assert.equal(chunks[0].previousOverlapDigest, null);
    assert.match(chunks[0].nextOverlapDigest, /^[a-f0-9]{64}$/u);
    assert(chunks.every((chunk, index) => chunk.chunkIndex === index && /^[a-f0-9]{64}$/u.test(chunk.contentHash)));
  });
}

function registerTransactionTests() {
  register("start rejects missing or cross-project conversation session", async () => {
    const conversations = new MemoryNovelRepository();
    const learning = new MemorySovereignLearningRepository();
    const coordinator = new AtomicLearningImportCoordinator(conversations, learning);
    await assert.rejects(
      () => coordinator.start({
        projectId: "missing",
        sessionId: "missing-session",
        files: [new File([sourceText("scope")], "scope.txt", { type: "text/plain" })],
        rightsBasis: "owned_by_user",
        userConfirmedRights: true,
      }),
      (error) => error.code === "LEARNING_IMPORT_PROJECT_NOT_FOUND",
    );
    assert.equal((await conversations.list("conversationAttachments")).length, 0);
  });

  register("atomic document keeps formal repository empty when any part fails, then resumes", async () => {
    const conversations = new MemoryNovelRepository();
    const learning = new MemorySovereignLearningRepository();
    await seedConversation(conversations, "project-atomic", "session-atomic");
    let failSecondPart = true;
    const coordinator = new AtomicLearningImportCoordinator(conversations, learning, {
      faultInjector: (point, index) => {
        if (point === "before_part_staging_commit" && index === 1 && failSecondPart) {
          failSecondPart = false;
          throw Object.assign(new Error("fault"), { code: "TEST_PART_FAULT" });
        }
      },
    });
    const files = [
      new File([sourceText("第一冊", 20)], "volume-1.txt", { type: "text/plain" }),
      new File([sourceText("第二冊", 20)], "volume-2.txt", { type: "text/plain" }),
    ];
    const started = await coordinator.start({
      projectId: "project-atomic",
      sessionId: "session-atomic",
      files,
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    const failed = await coordinator.process({
      projectId: "project-atomic",
      importSessionId: started.session.id,
      files,
      sourceKind: "personal_note",
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    assert.equal(failed.session.status, "failed");
    assert.deepEqual(failed.session.retryablePartIndexes, [1]);
    assert.equal((await learning.listSources("project-atomic")).length, 0);
    const resumed = await coordinator.retryFailedPart({
      projectId: "project-atomic",
      importSessionId: started.session.id,
      partIndex: 1,
      file: files[1],
      sourceKind: "personal_note",
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    assert.equal(resumed.session.status, "ready_to_finalize");
    const committed = await coordinator.finalize("project-atomic", started.session.id);
    assert.equal(committed.replayed, false);
    assert((await learning.listSources("project-atomic")).length > 0);
    assert.equal(await learning.getImportStaging(started.session.id), null);
    const replay = await coordinator.finalize("project-atomic", started.session.id);
    assert.equal(replay.replayed, true);
  });

  register("fault after formal commit is compensated and remains retryable", async () => {
    const conversations = new MemoryNovelRepository();
    const learning = new MemorySovereignLearningRepository();
    await seedConversation(conversations, "project-compensate", "session-compensate");
    let inject = true;
    const coordinator = new AtomicLearningImportCoordinator(conversations, learning, {
      faultInjector: (point) => {
        if (point === "after_formal_commit" && inject) {
          inject = false;
          throw Object.assign(new Error("fault after formal"), { code: "TEST_AFTER_FORMAL_FAULT" });
        }
      },
    });
    const files = [new File([sourceText("補償", 22)], "compensate.txt", { type: "text/plain" })];
    const started = await coordinator.start({
      projectId: "project-compensate",
      sessionId: "session-compensate",
      files,
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    await coordinator.process({
      projectId: "project-compensate",
      importSessionId: started.session.id,
      files,
      sourceKind: "personal_note",
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    await assert.rejects(
      () => coordinator.finalize("project-compensate", started.session.id),
      (error) => error.code === "TEST_AFTER_FORMAL_FAULT",
    );
    assert.equal((await learning.listSources("project-compensate")).length, 0);
    assert.equal((await learning.listRules("project-compensate")).length, 0);
    assert(await learning.getImportStaging(started.session.id));
    const committed = await coordinator.finalize("project-compensate", started.session.id);
    assert.equal(committed.session.status, "committed");
  });

  register("learning copy restore fails closed while same-project restore preserves resumable staging", async () => {
    const conversations = new MemoryNovelRepository();
    const learning = new MemorySovereignLearningRepository();
    const projectId = "project-learning-copy-portability";
    const sessionId = "session-learning-copy-portability";
    await seedConversation(conversations, projectId, sessionId);
    const coordinator = new AtomicLearningImportCoordinator(conversations, learning);
    const files = [
      new File([sourceText("copy-portability", 24)], "copy-portability.txt", {
        type: "text/plain",
      }),
    ];
    const started = await coordinator.start({
      projectId,
      sessionId,
      files,
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    const processed = await coordinator.process({
      projectId,
      importSessionId: started.session.id,
      files,
      sourceKind: "personal_note",
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    assert.equal(processed.session.status, "ready_to_finalize");
    assert(await learning.getImportStaging(started.session.id));

    const conversation = new ConversationRepositoryService(conversations, learning);
    const assistant = await conversation.appendMessage({
      projectId,
      sessionId,
      role: "assistant",
      content: "Learning candidate remains local and pending.",
    });
    const artifact = await conversation.saveArtifact({
      projectId,
      sessionId,
      sourceMessageId: assistant.id,
      artifactType: "learning_rule",
      targetStore: "learningImportSessions",
      targetRecordId: processed.session.id,
      sourceRevision: processed.session.revision,
      candidateContent: JSON.stringify({
        schemaVersion: "conversation-learning-import-candidate-v1",
        importSessionId: processed.session.id,
        manifestDigest: processed.session.manifestDigest,
      }),
    });
    await conversation.saveToolInvocation({
      projectId,
      sessionId,
      messageId: assistant.id,
      taskId: `learning-copy-task:${artifact.id}`,
      toolId: "closed-agent-os:manual-learning-import",
      taskType: "learning.import",
      inputDigest: artifact.candidateDigest,
      contextDigest: artifact.candidateDigest,
      status: "completed",
      actualExecutor: "browser-main-thread",
      modelId: null,
      modelDigest: null,
      executionReceipt: {
        receiptId: `learning-copy-receipt:${artifact.id}`,
        modelId: null,
        modelDigest: null,
        providerRunId: null,
        contextDigest: artifact.candidateDigest,
        outputDigest: artifact.candidateDigest,
        externalRequest: false,
        dataLeftDevice: false,
        latencyMs: 0,
      },
      externalRequest: false,
      dataLeftDevice: false,
      canonicalMutationCount: 0,
    });
    const { payload } = await createProjectBackup(conversations, projectId, "full", {
      sovereignLearningRepository: learning,
    });

    const sameProjectConversations = new MemoryNovelRepository();
    const sameProjectLearning = new MemorySovereignLearningRepository();
    await restoreProjectBackup(
      sameProjectConversations,
      payload,
      "replace",
      projectId,
      { sovereignLearningRepository: sameProjectLearning },
    );
    assert.equal(
      (await sameProjectConversations.get("conversationArtifacts", artifact.id)).status,
      "candidate",
    );
    assert.equal(
      (await sameProjectConversations.get("learningImportSessions", started.session.id)).status,
      "ready_to_finalize",
    );
    assert(await sameProjectLearning.getImportStaging(started.session.id));

    const copiedConversations = new MemoryNovelRepository();
    const copiedLearning = new MemorySovereignLearningRepository();
    const copiedProjectId = await restoreProjectBackup(
      copiedConversations,
      payload,
      "copy",
      undefined,
      { sovereignLearningRepository: copiedLearning },
    );
    const [copiedArtifact] = await copiedConversations.list(
      "conversationArtifacts",
      copiedProjectId,
    );
    const [copiedImport] = await copiedConversations.list(
      "learningImportSessions",
      copiedProjectId,
    );
    assert(copiedArtifact && copiedImport);
    assert.equal(copiedArtifact.status, "superseded");
    assert.equal(copiedImport.status, "rolled_back");
    assert.equal((await copiedLearning.listImportStaging(copiedProjectId)).length, 0);
  });

  register("conversation marker failure compensates only IDs inserted by this finalized import", async () => {
    let failConversationMarker = false;
    const conversations = new MemoryNovelRepository({
      approvalFaultInjector: (point) => {
        if (failConversationMarker && point === "after:conversationArtifacts") {
          throw new Error("TEST_CONVERSATION_MARKER_FAILURE");
        }
      },
    });
    const learning = new MemorySovereignLearningRepository();
    const projectId = "project-stable-id-compensation";
    const sessionId = "session-stable-id-compensation";
    await seedConversation(conversations, projectId, sessionId);
    const coordinator = new AtomicLearningImportCoordinator(conversations, learning);
    const files = [
      new File([sourceText("existing-stable-id", 24)], "existing.txt", { type: "text/plain" }),
      new File([sourceText("new-import-id", 26)], "new.txt", { type: "text/plain" }),
    ];
    const started = await coordinator.start({
      projectId,
      sessionId,
      files,
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    const processed = await coordinator.process({
      projectId,
      importSessionId: started.session.id,
      files,
      sourceKind: "personal_note",
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    assert.equal(processed.session.status, "ready_to_finalize");
    const stagedBeforeFinalize = await learning.getImportStaging(started.session.id);
    assert(stagedBeforeFinalize);
    assert(stagedBeforeFinalize.sources.length >= 2);
    assert(stagedBeforeFinalize.rules.length >= 2);
    assert(stagedBeforeFinalize.audit.length >= 2);

    const preexisting = {
      sources: [structuredClone(stagedBeforeFinalize.sources[0])],
      rules: [structuredClone(stagedBeforeFinalize.rules[0])],
      audit: [structuredClone(stagedBeforeFinalize.audit[0])],
    };
    await learning.commit(preexisting);

    const conversation = new ConversationRepositoryService(conversations);
    const assistant = await conversation.appendMessage({
      projectId,
      sessionId,
      role: "assistant",
      content: "Learning import candidate awaiting explicit approval.",
    });
    const artifact = await conversation.saveArtifact({
      projectId,
      sessionId,
      sourceMessageId: assistant.id,
      artifactType: "learning_rule",
      targetStore: "learningImportSessions",
      targetRecordId: processed.session.id,
      sourceRevision: processed.session.revision,
      candidateContent: JSON.stringify({
        schemaVersion: "conversation-learning-import-candidate-v1",
        importSessionId: processed.session.id,
        manifestDigest: processed.session.manifestDigest,
      }),
    });
    await conversation.saveToolInvocation({
      projectId,
      sessionId,
      messageId: assistant.id,
      taskId: `learning-import-task:${artifact.id}`,
      toolId: "closed-agent-os:manual-learning-import",
      taskType: "learning.import",
      inputDigest: artifact.candidateDigest,
      contextDigest: artifact.candidateDigest,
      status: "completed",
      actualExecutor: "browser-main-thread",
      modelId: null,
      modelDigest: null,
      executionReceipt: {
        receiptId: `learning-import-receipt:${artifact.id}`,
        modelId: null,
        modelDigest: null,
        providerRunId: null,
        contextDigest: artifact.candidateDigest,
        outputDigest: artifact.candidateDigest,
        externalRequest: false,
        dataLeftDevice: false,
        latencyMs: 0,
      },
      externalRequest: false,
      dataLeftDevice: false,
      canonicalMutationCount: 0,
    });

    const finalized = await coordinator.finalize(projectId, started.session.id, {
      retainStagingUntilApproval: true,
    });
    assert.equal(finalized.session.status, "committed");
    const approvedImport = await coordinator.approveFinalizedRules(projectId, started.session.id);
    assert(approvedImport.rules.length > 0);
    assert(approvedImport.rules.every((rule) => rule.status === "approved"));
    const [preApprovalSafetyBackup] = await conversations.list("backups", projectId);
    assert(preApprovalSafetyBackup);
    assert.equal(preApprovalSafetyBackup.kind, "safety");
    const backedUpArtifact = preApprovalSafetyBackup.snapshot.conversationArtifacts
      .find((row) => row.id === artifact.id);
    const backedUpLearningRules = preApprovalSafetyBackup.sovereignLearningSnapshot.rules
      .filter((rule) => approvedImport.rules.some((approvedRule) => approvedRule.id === rule.id));
    assert(backedUpArtifact);
    assert.equal(backedUpArtifact.status, "candidate");
    assert(backedUpLearningRules.length > 0);
    assert(backedUpLearningRules.every((rule) => rule.status === "candidate"));
    const retained = await learning.getImportStaging(started.session.id);
    assert(retained?.formalCommit);
    const preexistingIds = {
      sources: new Set(preexisting.sources.map((row) => row.id)),
      rules: new Set(preexisting.rules.map((row) => row.id)),
      audit: new Set(preexisting.audit.map((row) => row.id)),
    };
    assert(retained.formalCommit.sourceIds.every((id) => !preexistingIds.sources.has(id)));
    assert(retained.formalCommit.ruleIds.every((id) => !preexistingIds.rules.has(id)));
    assert(retained.formalCommit.auditIds.every((id) => !preexistingIds.audit.has(id)));
    assert(retained.formalCommit.sourceIds.length > 0);
    assert(retained.formalCommit.ruleIds.length > 0);
    assert(retained.formalCommit.auditIds.length > 0);

    const currentSession = await conversations.get("conversationSessions", sessionId);
    const currentMessage = await conversations.get("conversationMessages", assistant.id);
    const currentArtifact = await conversations.get("conversationArtifacts", artifact.id);
    const committedImport = await conversations.get("learningImportSessions", started.session.id);
    assert(currentSession && currentMessage && currentArtifact && committedImport);
    const markerInput = {
      operationId: `test-learning-marker:${artifact.id}`,
      idempotencyKey: `test-learning-marker:${artifact.candidateDigest}`,
      projectId,
      sessionId,
      artifactId: artifact.id,
      sourceMessageId: assistant.id,
      candidateDigest: artifact.candidateDigest,
      targetStore: "learningImportSessions",
      targetRecordId: committedImport.id,
      expectedSessionRevision: currentSession.revision,
      expectedArtifactRevision: currentArtifact.revision,
      expectedSourceMessageRevision: currentMessage.revision,
      expectedSourceRevision: processed.session.revision,
      resultingRevision: committedImport.revision,
      canonicalRecordDigest: await conversationCanonicalRecordDigest(committedImport),
      commitId: `learning-import:${committedImport.manifestDigest}`,
    };
    failConversationMarker = true;
    await assert.rejects(
      () => conversation.markArtifactApprovedFromExternalCommit(markerInput),
      /TEST_CONVERSATION_MARKER_FAILURE/u,
    );
    await coordinator.compensateFinalizedApproval(projectId, started.session.id);

    assert.deepEqual(await learning.listSources(projectId), preexisting.sources);
    assert.deepEqual(await learning.listRules(projectId), preexisting.rules);
    assert.deepEqual(await learning.listAudit(projectId), preexisting.audit);
    assert.equal((await conversations.get("conversationArtifacts", artifact.id)).status, "candidate");
    assert.equal((await conversations.list("conversationApprovalTransactions", projectId)).length, 0);
    assert.equal((await learning.getImportStaging(started.session.id)).formalCommit, null);
    const backupsAfterMarkerCompensation = await conversations.list("backups", projectId);
    assert.equal(backupsAfterMarkerCompensation.length, 1);
    assert(backupsAfterMarkerCompensation.every((backup) => {
      const artifactSnapshot = backup.snapshot.conversationArtifacts
        .find((row) => row.id === artifact.id);
      const learningSnapshot = backup.sovereignLearningSnapshot;
      const importStaging = learningSnapshot.staging
        .find((row) => row.id === started.session.id);
      const importRuleIds = new Set(importStaging?.formalCommit?.ruleIds ?? []);
      const importedRules = learningSnapshot.rules
        .filter((rule) => importRuleIds.has(rule.id));
      return artifactSnapshot?.status === "candidate"
        && importedRules.length > 0
        && importedRules.every((rule) => rule.status === "candidate");
    }));

    failConversationMarker = false;
    const retriedFinalize = await coordinator.finalize(projectId, started.session.id, {
      retainStagingUntilApproval: true,
    });
    assert.equal(retriedFinalize.replayed, false);
    const retriedApproval = await coordinator.approveFinalizedRules(projectId, started.session.id);
    assert(retriedApproval.rules.every((rule) => rule.status === "approved"));
    const approved = await conversation.markArtifactApprovedFromExternalCommit(markerInput);
    assert.equal(approved.artifact.status, "approved");
    assert.equal((await conversations.list("conversationApprovalTransactions", projectId)).length, 1);
    await coordinator.releaseFinalizedStaging(projectId, started.session.id);
    assert.equal(await learning.getImportStaging(started.session.id), null);
  });

  register("whole-document rule approval is atomic and retryable after commit failure", async () => {
    class ApprovalFaultRepository extends MemorySovereignLearningRepository {
      failApproval = true;
      async commit(input) {
        if (
          this.failApproval
          && input.staging?.length
          && input.rules?.some((rule) => rule.status === "approved")
        ) {
          this.failApproval = false;
          throw Object.assign(new Error("approval commit fault"), {
            code: "TEST_APPROVAL_COMMIT_FAULT",
          });
        }
        return super.commit(input);
      }
    }
    const conversations = new MemoryNovelRepository();
    const learning = new ApprovalFaultRepository();
    const projectId = "project-atomic-rule-approval";
    const sessionId = "session-atomic-rule-approval";
    await seedConversation(conversations, projectId, sessionId);
    const coordinator = new AtomicLearningImportCoordinator(conversations, learning);
    const files = [
      new File([sourceText("atomic-approval", 26)], "atomic-approval.txt", {
        type: "text/plain",
      }),
    ];
    const started = await coordinator.start({
      projectId,
      sessionId,
      files,
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    await coordinator.process({
      projectId,
      importSessionId: started.session.id,
      files,
      sourceKind: "personal_note",
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    await coordinator.finalize(projectId, started.session.id, {
      retainStagingUntilApproval: true,
    });
    const auditBefore = await learning.listAudit(projectId);
    const stagingBefore = await learning.getImportStaging(started.session.id);
    await assert.rejects(
      () => coordinator.approveFinalizedRules(projectId, started.session.id),
      (error) => error.code === "TEST_APPROVAL_COMMIT_FAULT",
    );
    assert((await learning.listRules(projectId)).every((rule) => rule.status === "candidate"));
    assert.deepEqual(await learning.listAudit(projectId), auditBefore);
    assert.deepEqual(await learning.getImportStaging(started.session.id), stagingBefore);
    const retried = await coordinator.approveFinalizedRules(projectId, started.session.id);
    assert(retried.rules.length > 0);
    assert(retried.rules.every((rule) => rule.status === "approved"));
  });

  for (const recoveryMode of ["resume", "retryFailedPart"]) {
    register(`cancelled import can recover through ${recoveryMode} without resurrecting raw content`, async () => {
      const conversations = new MemoryNovelRepository();
      const learning = new MemorySovereignLearningRepository();
      const projectId = `project-cancel-${recoveryMode}`;
      const sessionId = `session-cancel-${recoveryMode}`;
      await seedConversation(conversations, projectId, sessionId);
      class SlowFile extends File {
        async arrayBuffer() {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return super.arrayBuffer();
        }
      }
      const file = new SlowFile(
        [sourceText(`cancel-${recoveryMode}`, 28)],
        `${recoveryMode}.txt`,
        { type: "text/plain" },
      );
      const coordinator = new AtomicLearningImportCoordinator(conversations, learning);
      const started = await coordinator.start({
        projectId,
        sessionId,
        files: [file],
        rightsBasis: "owned_by_user",
        userConfirmedRights: true,
      });
      let validating;
      const reachedValidation = new Promise((resolve) => { validating = resolve; });
      const processing = coordinator.process({
        projectId,
        importSessionId: started.session.id,
        files: [file],
        sourceKind: "personal_note",
        rightsBasis: "owned_by_user",
        userConfirmedRights: true,
        onProgress: (progress) => {
          if (progress.phase === "validating") validating();
        },
      });
      await reachedValidation;
      await coordinator.cancel(projectId, started.session.id);
      const cancelled = await processing;
      assert.equal(cancelled.session.status, "cancelled");
      assert.deepEqual(cancelled.session.retryablePartIndexes, [0]);

      const common = {
        projectId,
        importSessionId: started.session.id,
        sourceKind: "personal_note",
        rightsBasis: "owned_by_user",
        userConfirmedRights: true,
      };
      const recovered = recoveryMode === "resume"
        ? await coordinator.resume({ ...common, files: [file] })
        : await coordinator.retryFailedPart({ ...common, partIndex: 0, file });
      assert.equal(recovered.session.status, "ready_to_finalize");
      assert.deepEqual(recovered.session.retryablePartIndexes, []);
      const staging = await learning.getImportStaging(started.session.id);
      assert(staging);
      assert.equal(staging.rawContentRetained, false);
      assert.equal(JSON.stringify(staging).includes(sourceText(`cancel-${recoveryMode}`, 28)), false);
    });
  }

  register("rollback clears abstract staging without formal mutation", async () => {
    const conversations = new MemoryNovelRepository();
    const learning = new MemorySovereignLearningRepository();
    await seedConversation(conversations, "project-rollback", "session-rollback");
    const coordinator = new AtomicLearningImportCoordinator(conversations, learning);
    const files = [new File([sourceText("回滾", 18)], "rollback.txt", { type: "text/plain" })];
    const started = await coordinator.start({
      projectId: "project-rollback",
      sessionId: "session-rollback",
      files,
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    const rolledBack = await coordinator.rollback("project-rollback", started.session.id);
    assert.equal(rolledBack.status, "rolled_back");
    assert.equal(await learning.getImportStaging(started.session.id), null);
    assert.equal((await learning.listSources("project-rollback")).length, 0);
  });

  register("rollback waits for active parsing and cannot resurrect staging", async () => {
    const conversations = new MemoryNovelRepository();
    const learning = new MemorySovereignLearningRepository();
    await seedConversation(conversations, "project-race", "session-race");
    class SlowFile extends File {
      async arrayBuffer() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return super.arrayBuffer();
      }
    }
    const file = new SlowFile([sourceText("競態", 20)], "race.txt", { type: "text/plain" });
    const coordinator = new AtomicLearningImportCoordinator(conversations, learning);
    const started = await coordinator.start({
      projectId: "project-race",
      sessionId: "session-race",
      files: [file],
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    const processing = coordinator.process({
      projectId: "project-race",
      importSessionId: started.session.id,
      files: [file],
      sourceKind: "personal_note",
      rightsBasis: "owned_by_user",
      userConfirmedRights: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const rolledBack = await coordinator.rollback("project-race", started.session.id);
    await processing;
    assert.equal(rolledBack.status, "rolled_back");
    assert.equal(await learning.getImportStaging(started.session.id), null);
    assert.equal((await learning.listSources("project-race")).length, 0);
  });
}

function registerWorkerTests() {
  register("worker reports independent per-file results and releases request state", async () => {
    const runtime = new ManualLearningWorkerRuntime();
    const responses = [];
    await runtime.handle({
      type: "extract_batch",
      requestId: "worker-batch",
      files: [
        new File([sourceText("worker")], "worker.txt", { type: "text/plain" }),
        new File(["{".repeat(180)], "worker-bad.json", { type: "application/json" }),
      ],
    }, (response) => responses.push(structuredClone(response)));
    const completed = responses.find((response) => response.type === "completed");
    assert(completed);
    assert.deepEqual(completed.items.map((item) => item.status), ["completed", "failed"]);
    assert.equal(completed.rawContentRetained, false);
    assert.equal(runtime.activeRequestCount(), 0);
  });

  register("worker cancellation is observable and cleans the controller", async () => {
    const runtime = new ManualLearningWorkerRuntime();
    const responses = [];
    const delayedFile = {
      name: "delayed.txt",
      type: "text/plain",
      size: 500,
      arrayBuffer: () => new Promise((resolve) => setTimeout(() => resolve(new TextEncoder().encode(sourceText("delay")).buffer), 20)),
    };
    const pending = runtime.handle({ type: "extract_batch", requestId: "cancel-me", files: [delayedFile] }, (response) => responses.push(structuredClone(response)));
    await runtime.handle({ type: "cancel", requestId: "cancel-me" }, (response) => responses.push(structuredClone(response)));
    await pending;
    assert(responses.some((response) => response.type === "cancelled"));
    assert.equal(runtime.activeRequestCount(), 0);
  });
}

function registerSynthesisTests() {
  register("global synthesis deduplicates volumes, detects conflicts, and rejects source overlap", () => {
    const rule = (id, statement, conflictKey, overlap = 0) => ({
      schemaVersion: "closed-ai-sovereign-learning-v1",
      id,
      projectId: "project",
      sourceId: "source",
      family: "pacing",
      dimension: "conflict_escalation",
      statement,
      tags: [],
      parameters: {},
      recipe: { when: "場景開始", operation: "逐步加壓", constraint: "保持因果", evaluate: "檢查後果" },
      confidence: 0.8,
      extractorKind: "local_closed_ai",
      extractorProvider: "local-ollama",
      extractorModel: "qwen2.5:3b",
      sourceOverlapScore: overlap,
      longestSourceMatch: 0,
      abstractionScore: 0.9,
      conflictKey,
      status: "candidate",
      conflictRuleIds: [],
      approvedAt: null,
      rejectedAt: null,
      revokedAt: null,
      supersededByRuleId: null,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
      revision: 1,
    });
    const chunk = (attachmentId, hash) => ({
      attachmentId,
      chunkIndex: 0,
      sourceSection: "第一卷 / 第一章",
      contentHash: hash,
      previousOverlapDigest: null,
      nextOverlapDigest: null,
      volumeCount: 1,
      chapterCount: 1,
      paragraphCount: 4,
      dialogueParagraphCount: 1,
      characterCount: 400,
    });
    const staged = synthesizeLearningImportStaging({
      id: "import",
      projectId: "project",
      manifestDigest: "manifest",
      completedPartIndexes: [0, 1],
      sources: [],
      rules: [
        rule("rule-a", "每一場逐步加壓。", "pacing:key"),
        rule("rule-b", "每一場先舒緩再加壓。", "pacing:key"),
        rule("rule-copy", "直接複製來源長句。", null, 0.3),
      ],
      audit: [],
      chunkManifest: [chunk("a", "same"), chunk("b", "same")],
      globalSynthesis: null,
      rawContentRetained: false,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
      revision: 1,
    });
    assert.equal(staged.globalSynthesis.uniqueChunkCount, 1);
    assert.equal(staged.globalSynthesis.duplicateChunkCount, 1);
    assert.deepEqual(staged.globalSynthesis.rejectedSourceOverlapRuleIds, ["rule-copy"]);
    assert.deepEqual(staged.globalSynthesis.conflictKeys, ["pacing:key"]);
    assert.equal(staged.globalSynthesis.narrativeDna.dialogueParagraphRatio, 0.25);
    assert.equal(staged.rules.length, 2);
  });
}

if (["file", "all"].includes(suite)) registerFileContractTests();
if (["transaction", "all"].includes(suite)) registerTransactionTests();
if (["worker", "all"].includes(suite)) registerWorkerTests();
if (["synthesis", "all"].includes(suite)) registerSynthesisTests();
if (!tests.length) throw new Error(`Unknown suite: ${suite}`);

for (const item of tests) {
  const startedAt = Date.now();
  try {
    await item.run();
    results.push({ name: item.name, status: "PASS", durationMs: Date.now() - startedAt });
    console.log(`PASS ${item.name}`);
  } catch (error) {
    results.push({ name: item.name, status: "FAIL", durationMs: Date.now() - startedAt, error: error?.stack ?? String(error) });
    console.error(`FAIL ${item.name}`);
    console.error(error?.stack ?? error);
  }
}

const passed = results.filter((result) => result.status === "PASS").length;
const failed = results.length - passed;
console.log(`RC6_MANUAL_LEARNING_${suite.toUpperCase()} ${passed} PASS ${failed} FAIL`);
if (failed) process.exitCode = 1;
