import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import {
  ClosedAICache,
  MemoryClosedAICacheRepository,
  sha256Hex,
  stableStringify,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  ClosedAgentOS,
  IndexedDbClosedAgentStateRepository,
  MemoryClosedAgentStateRepository,
} from "../lib/novel-ai/closed-agent-os/index.ts";
import {
  ApprovalSigner,
  MemoryVerifiableLedgerRepository,
  VerifiableLedger,
} from "../lib/novel-ai/verifiable-ledger/index.ts";
import { MemoryNovelRepository } from "../lib/novel-ai/repository/index.ts";
import {
  createProjectBackup,
  validateBackupPayload,
} from "../lib/novel-ai/repository/backup.ts";
import {
  ensureStudioCanonicalProject,
  saveStudioChapter,
} from "../lib/novel-ai/repository/studio-canonical.ts";
import {
  applyWritingAidTransaction,
  commitStudioCandidateToChapter,
} from "../lib/novel-ai/web/studio-canonical-approval.ts";

const LOCAL_MODEL_DIGEST = "c".repeat(64);

class LocalBackend {
  constructor() {
    this.id = "local-ollama";
    this.calls = 0;
  }

  async snapshot() {
    return {
      id: this.id,
      label: "Local Ollama",
      status: "ready",
      runtimeTruth: {
        installed: true,
        configured: true,
        reachable: true,
        modelAvailable: true,
        runtimeVerified: true,
        generationVerified: true,
        verificationSource: "local-bridge-generation",
        verifiedAt: "2026-08-10T00:00:00.000Z",
      },
      modelId: "qwen2.5:3b",
      modelDigest: LOCAL_MODEL_DIGEST,
      local: true,
      dataBoundary: "device",
      maximumComplexity: "standard",
      capabilities: ["text"],
      supportedTaskTypes: "all",
      detailCode: "model_inference_verified",
    };
  }

  async execute(input) {
    this.calls += 1;
    const content = `第 ${this.calls} 份候選延續雨夜車站的場景。主角先確認手中的舊票根，再沿著月臺微弱燈光追查失蹤名單；每一步都保留人物動機、世界規則與下一幕可驗證的行動。`;
    return {
      backendId: this.id,
      modelId: "qwen2.5:3b",
      modelDigest: LOCAL_MODEL_DIGEST,
      content,
      candidateOnly: true,
      dataLeftDevice: false,
      externalRequest: false,
      elapsedMs: 8,
      profileId: "quick-assistant-e2e",
      firstTokenMs: 2,
      inputCharacters: input.request.objective.length,
      outputCharacters: content.length,
      generatedTokenEvents: 12,
      omittedInputCharacters: 0,
      qualityMode: "fast",
      qualityPasses: 1,
      draftDigest: null,
      criticDigest: null,
    };
  }
}

function namespace(projectId) {
  return {
    tenantId: "local-tenant",
    userId: "local-author",
    projectId,
    storyId: projectId,
    canonId: `canon:${projectId}`,
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "unrouted:runtime-managed",
    modelDigest: "unrouted:digest-runtime-managed",
    promptProfileVersion: "quick-assistant-e2e-v1",
    storyBibleRevision: "current",
    knowledgeScopeRevision: "current",
    privacyLevel: "device_only",
  };
}

function request(projectId, chapter, taskId, objective) {
  return {
    taskId,
    namespace: namespace(projectId),
    taskType: "chapter.continue",
    objective,
    context: [],
    complexity: "standard",
    qualityMode: "fast",
    preferredBackend: "local-ollama",
    allowedToolIds: [],
    permissionScopes: [
      "story:read",
      "story-bible:read",
      "candidate:write",
      "candidate:read",
      "evaluation:write",
    ],
    sourceChapterId: chapter.id,
    sourceRevision: chapter.revision,
  };
}

async function semanticHash(repository, projectId) {
  const exported = await repository.exportProject(projectId);
  return sha256Hex(stableStringify({
    project: exported.projects,
    chapters: exported.chapters,
    storyBibles: exported.storyBibles,
    storyStates: exported.storyStates,
    acceptedChoices: exported.acceptedChoices,
    storyBranches: exported.storyBranches,
  }));
}

const repository = new MemoryNovelRepository();
const projectId = "quick-assistant-project";
let snapshot = await ensureStudioCanonicalProject(repository, {
  id: projectId,
  title: "雨夜車站",
  chapterTitle: "第一章",
  draft: "列車停下時，月臺只剩一盞燈。",
  protagonist: "林澈",
  world: "封閉山城",
  conflict: "失蹤名單",
});
const backend = new LocalBackend();
const os = new ClosedAgentOS({
  backends: [backend],
  cache: new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
  }),
  ledger: new VerifiableLedger({
    repository: new MemoryVerifiableLedgerRepository(),
    signer: new ApprovalSigner(),
  }),
  state: new MemoryClosedAgentStateRepository(),
});

const initialHash = await semanticHash(repository, projectId);
const repeatableObjective = "產生一份可放棄或核准的續寫候選。";
const abandoned = await os.execute(request(
  projectId,
  snapshot.chapter,
  "quick-abandon",
  repeatableObjective,
));
assert.equal(abandoned.candidate.sourceChapterId, snapshot.chapter.id);
assert.equal(abandoned.candidate.sourceRevision, snapshot.chapter.revision);
assert.equal(abandoned.candidate.canonicalMutationCount, 0);
await os.rejectCandidate(abandoned.candidate.id);
assert.equal(await semanticHash(repository, projectId), initialHash);

const regenerated = await os.execute(request(
  projectId,
  snapshot.chapter,
  "quick-approve",
  repeatableObjective,
));
assert.equal(backend.calls, 2);
assert.equal(regenerated.candidate.actualExecutor, "local-ollama");
assert.notEqual(regenerated.candidate.contentDigest, abandoned.candidate.contentDigest);
let committed = null;
const approved = await os.approveCandidate({
  candidateId: regenerated.candidate.id,
  approvedBy: "local-author",
  humanApproved: true,
  canonicalCommit: async ({ candidate, idempotencyKey }) => {
    committed = await commitStudioCandidateToChapter({
      repository,
      projectId,
      chapterId: candidate.sourceChapterId,
      sourceRevision: candidate.sourceRevision,
      taskId: candidate.taskId,
      idempotencyKey,
      content: candidate.content,
      mode: "append",
    });
    return { commitId: committed.commitId };
  },
});
assert.equal(approved.canonicalMutationCount, 1);
assert.equal(committed.resultingRevision, snapshot.chapter.revision + 1);
const reloaded = await repository.get("chapters", snapshot.chapter.id);
assert.equal(reloaded.revision, committed.resultingRevision);
assert.equal(reloaded.content, committed.chapter.content);
const unchangedAfterHydration = await saveStudioChapter(repository, {
  id: projectId,
  title: snapshot.project.title,
  chapterTitle: reloaded.title,
  draft: reloaded.content,
});
assert.equal(unchangedAfterHydration.chapter.revision, reloaded.revision);
assert.equal(unchangedAfterHydration.chapter.updatedAt, reloaded.updatedAt);
await assert.rejects(
  os.approveCandidate({
    candidateId: regenerated.candidate.id,
    approvedBy: "local-author",
    humanApproved: true,
  }),
  (error) => error?.code === "CLOSED_AGENT_APPROVAL_GATE_FAILED",
);

snapshot = {
  ...snapshot,
  chapter: reloaded,
};
const stale = await os.execute(request(
  projectId,
  snapshot.chapter,
  "quick-stale",
  "產生之後將由測試改動來源版本。",
));
const intervening = await repository.put(
  "chapters",
  { ...snapshot.chapter, content: `${snapshot.chapter.content}\n\n作者先行修改。` },
  snapshot.chapter.revision,
);
await assert.rejects(
  os.approveCandidate({
    candidateId: stale.candidate.id,
    approvedBy: "local-author",
    humanApproved: true,
    canonicalCommit: async ({ candidate, idempotencyKey }) => {
      const result = await commitStudioCandidateToChapter({
        repository,
        projectId,
        chapterId: candidate.sourceChapterId,
        sourceRevision: candidate.sourceRevision,
        taskId: candidate.taskId,
        idempotencyKey,
        content: candidate.content,
        mode: "append",
      });
      return { commitId: result.commitId };
    },
  }),
  (error) => error?.code === "GENERATION_SOURCE_REVISION_STALE",
);

const localAid = await applyWritingAidTransaction({
  repository,
  projectId,
  chapterId: intervening.id,
  sourceRevision: intervening.revision,
  taskId: "local-writing-aid-test",
  content: "作者核准的離線寫作提示內容。",
  mode: "append",
});
assert.equal(localAid.provenance.aiGenerated, false);
assert.equal(localAid.provenance.modelProof, null);

const cloudDownCandidate = await os.execute(request(
  projectId,
  localAid.chapter,
  "cloud-down-local-approval",
  "在沒有 Supabase 的本機 repository 完成生成與核准。",
));
let cloudDownCommit = null;
const cloudDownApproval = await os.approveCandidate({
  candidateId: cloudDownCandidate.candidate.id,
  approvedBy: "local-author",
  humanApproved: true,
  canonicalCommit: async ({ candidate, idempotencyKey }) => {
    cloudDownCommit = await commitStudioCandidateToChapter({
      repository,
      projectId,
      chapterId: candidate.sourceChapterId,
      sourceRevision: candidate.sourceRevision,
      taskId: candidate.taskId,
      idempotencyKey,
      content: candidate.content,
      mode: "append",
    });
    return { commitId: cloudDownCommit.commitId };
  },
});
assert.equal(cloudDownApproval.canonicalMutationCount, 1);

const recoveryRepository = new MemoryNovelRepository();
const recoveryProjectId = "quick-assistant-recovery-project";
const recoverySnapshot = await ensureStudioCanonicalProject(recoveryRepository, {
  id: recoveryProjectId,
  title: "Recovery project",
  chapterTitle: "Recovery chapter",
  draft: "Original canonical content.",
});
let injectApprovalStateFailure = false;
const recoveryState = new MemoryClosedAgentStateRepository({
  faultInjector: (point) => {
    if (injectApprovalStateFailure && point === "after:approval") {
      injectApprovalStateFailure = false;
      throw Object.assign(new Error("TEST_STATE_BATCH_FAILURE"), {
        code: "TEST_STATE_BATCH_FAILURE",
      });
    }
  },
});
const recoveryOS = new ClosedAgentOS({
  backends: [new LocalBackend()],
  cache: new ClosedAICache({
    repository: new MemoryClosedAICacheRepository(),
  }),
  ledger: new VerifiableLedger({
    repository: new MemoryVerifiableLedgerRepository(),
    signer: new ApprovalSigner(),
  }),
  state: recoveryState,
});
const recoveryCandidate = await recoveryOS.execute(request(
  recoveryProjectId,
  recoverySnapshot.chapter,
  "quick-approval-recovery",
  "Generate one recoverable canonical continuation.",
));
let recoveryCommitCalls = 0;
let recoveryReplayObserved = false;
const recoverCanonicalCommit = async ({ candidate, idempotencyKey }) => {
  recoveryCommitCalls += 1;
  const canonical = await commitStudioCandidateToChapter({
    repository: recoveryRepository,
    projectId: recoveryProjectId,
    chapterId: candidate.sourceChapterId,
    sourceRevision: candidate.sourceRevision,
    taskId: candidate.taskId,
    idempotencyKey,
    content: candidate.content,
    mode: "append",
  });
  recoveryReplayObserved ||= canonical.replayed;
  return { commitId: canonical.commitId };
};
injectApprovalStateFailure = true;
await assert.rejects(
  recoveryOS.approveCandidate({
    candidateId: recoveryCandidate.candidate.id,
    approvedBy: "local-author",
    humanApproved: true,
    canonicalCommit: recoverCanonicalCommit,
  }),
  (error) => error?.code === "CLOSED_AGENT_APPROVAL_STATE_COMMIT_FAILED_RECOVERABLE",
);
const chapterAfterInjectedFailure = await recoveryRepository.get(
  "chapters",
  recoverySnapshot.chapter.id,
);
assert.equal(
  chapterAfterInjectedFailure.revision,
  recoverySnapshot.chapter.revision + 1,
);
assert.equal(
  (await recoveryState.get(recoveryCandidate.candidate.id)).status,
  "awaiting-approval",
);
assert.equal(
  await recoveryState.get(`closed-agent-approval:${recoveryCandidate.candidate.id}`),
  null,
);
assert.equal(
  await recoveryState.get(`closed-agent-memory:${recoveryCandidate.candidate.id}`),
  null,
);
assert.equal(
  (await recoveryState.get(recoveryCandidate.candidate.taskId)).state,
  "awaiting-approval",
);
assert.equal(
  (await recoveryRepository.list("operationJournal", recoveryProjectId)).length,
  1,
);
const recoveredApproval = await recoveryOS.approveCandidate({
  candidateId: recoveryCandidate.candidate.id,
  approvedBy: "local-author",
  humanApproved: true,
  canonicalCommit: recoverCanonicalCommit,
});
assert.equal(recoveredApproval.canonicalMutationCount, 1);
assert.equal(recoveredApproval.candidate.status, "committed");
assert.equal(recoveryCommitCalls, 2);
assert.equal(recoveryReplayObserved, true);
assert.equal(
  (await recoveryRepository.get("chapters", recoverySnapshot.chapter.id)).revision,
  chapterAfterInjectedFailure.revision,
);
const recoveryLedger = await recoveryOS.ledger.verify(
  `closed-agent:${recoveryProjectId}:${recoveryCandidate.candidate.taskId}`,
);
assert.equal(recoveryLedger.valid, true);
assert.equal(recoveryLedger.signedApprovalCount, 1);

const originalIndexedDB = globalThis.indexedDB;
globalThis.indexedDB = fakeIndexedDB;
await new Promise((resolve, reject) => {
  const deletion = fakeIndexedDB.deleteDatabase("novel-closed-agent-state");
  deletion.onsuccess = () => resolve();
  deletion.onerror = () => reject(deletion.error);
});
let injectIndexedDbApprovalFailure = true;
const indexedDbState = new IndexedDbClosedAgentStateRepository({
  faultInjector: (point) => {
    if (injectIndexedDbApprovalFailure && point === "after:approval") {
      injectIndexedDbApprovalFailure = false;
      throw Object.assign(new Error("TEST_INDEXEDDB_STATE_BATCH_FAILURE"), {
        code: "TEST_INDEXEDDB_STATE_BATCH_FAILURE",
      });
    }
  },
});
await assert.rejects(
  indexedDbState.putMany([
    recoveredApproval.approval,
    recoveredApproval.memory,
    recoveredApproval.candidate,
  ]),
  (error) => error?.code === "TEST_INDEXEDDB_STATE_BATCH_FAILURE",
);
assert.equal(await indexedDbState.get(recoveredApproval.approval.id), null);
assert.equal(await indexedDbState.get(recoveredApproval.memory.id), null);
assert.equal(await indexedDbState.get(recoveredApproval.candidate.id), null);
if (originalIndexedDB === undefined) {
  delete globalThis.indexedDB;
} else {
  globalThis.indexedDB = originalIndexedDB;
}

const backup = await createProjectBackup(
  repository,
  projectId,
  "full",
  { appCommit: "test", releaseTag: "test" },
);
const validated = await validateBackupPayload(backup.payload);
assert.equal(validated.valid, true);
const backupHash = await semanticHash(repository, projectId);
const current = await repository.get("chapters", cloudDownCommit.chapter.id);
await repository.put(
  "chapters",
  { ...current, content: "暫時改壞的內容" },
  current.revision,
);
await repository.importProject(
  validated.payload.records,
  "replace",
  projectId,
);
assert.equal(await semanticHash(repository, projectId), backupHash);

const studioSource = await readFile(
  new URL("../app/studio/studio-client.tsx", import.meta.url),
  "utf8",
);
const conversationWorkspaceSource = await readFile(
  new URL("../app/studio/project/[projectId]/chat/conversation-workspace.tsx", import.meta.url),
  "utf8",
);
const conversationClosedAgentSource = await readFile(
  new URL("../app/studio/project/[projectId]/chat/conversation-closed-agent.ts", import.meta.url),
  "utf8",
);
const conversationApprovalSource = await readFile(
  new URL("../app/studio/project/[projectId]/chat/hooks/use-conversation-approval.ts", import.meta.url),
  "utf8",
);
const globalStyles = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
assert.match(studioSource, /async function acceptCandidate/);
assert.match(studioSource, /approveStudioClosedAgentCandidate\(\{/);
assert.match(studioSource, /canonicalCommit: async/);
assert.match(studioSource, /applyWritingAidTransaction\(\{/);
assert.match(studioSource, /candidate\.sourceRevision !== pending\.sourceRevision/);
assert.match(studioSource, /approved\.canonicalMutationCount !== 1/);
assert.match(studioSource, /data-testid="studio-candidate-diff"/);
assert.match(studioSource, /contextSourceSummary: result\.contextSourceSummary/);
assert.match(studioSource, /result\.executionReceipt\?\.generatedTokenEvents/);
assert.match(studioSource, /initialProjectId/);
assert.match(conversationClosedAgentSource, /sourceChapterId: resolvedCanonicalTarget\?\.targetRecordId/);
assert.match(conversationClosedAgentSource, /sourceRevision: resolvedCanonicalTarget\?\.sourceRevision/);
assert.match(conversationWorkspaceSource, /runConversationClosedAgent\(\{/);
assert.match(conversationApprovalSource, /sourceRevision: artifact\.sourceRevision/);
assert.match(conversationApprovalSource, /approveStudioClosedAgentCandidate\(\{/);
assert.match(conversationApprovalSource, /canonicalCommit: async \(\{ candidate \}\)/);
assert.match(
  studioSource,
  /title === project\.chapterTitle && draft === project\.draft/,
);
assert.match(
  globalStyles,
  /\.studioPersistenceBanner\[data-blocked="false"\]\{pointer-events:auto\}/,
);
assert.match(studioSource, /data-testid="dismiss-cloud-degraded-notice"/);
assert.match(studioSource, /sessionStorage\.setItem\(CLOUD_NOTICE_SESSION_KEY, "1"\)/);

const quickAssistantRoute = await readFile(
  new URL("../app/studio/quick-assistant/page.tsx", import.meta.url),
  "utf8",
);
const consumerActions = await readFile(
  new URL("../public/legacy/consumer-ai-actions.js", import.meta.url),
  "utf8",
);
const consumerCenter = await readFile(
  new URL("../public/legacy/consumer-creation-center.js", import.meta.url),
  "utf8",
);
assert.match(quickAssistantRoute, /redirect\(projectId/);
assert.match(quickAssistantRoute, /studio\/project\/\$\{encodeURIComponent\(projectId\)\}\/chat/);
assert.match(quickAssistantRoute, /query\.set\("prompt", prompt\)/);
assert.match(quickAssistantRoute, /professional\?intent=chat/);
assert.doesNotMatch(quickAssistantRoute, /<StudioClient/);
assert.match(consumerActions, /data-open-quick-assistant/);
assert.match(
  consumerCenter,
  /return `\/studio\/quick-assistant\?\$\{params\.toString\(\)\}`/,
);

console.log(JSON.stringify({
  status: "PASS",
  abandonedCanonHashUnchanged: true,
  rejectedCandidateCacheInvalidated: true,
  regeneratedActualExecutor: regenerated.candidate.actualExecutor,
  approvedRevision: committed.resultingRevision,
  reloadPersistent: true,
  unchangedReloadDoesNotAdvanceRevision: true,
  cloudDegradedBannerDoesNotBlockControls: true,
  duplicateRejected: true,
  staleRejected: true,
  cloudPersistenceRequired: false,
  localCanonicalApproval: true,
  canonicalJournalReplay: true,
  approvalStateAtomicBatch: true,
  indexedDbPartialWriteAborted: true,
  injectedPostCanonStateFailureRecovered: true,
  backupRestoreSemanticHashMatch: true,
}, null, 2));
