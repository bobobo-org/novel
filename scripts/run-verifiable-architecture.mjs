import assert from "node:assert/strict";
import {
  closedAINamespaceDigest,
  sha256Hex,
  stableStringify,
} from "../lib/novel-ai/closed-ai-cache/index.ts";
import {
  BLOCKCHAIN_INSPIRED_VERIFIABLE_ARCHITECTURE,
  LEGACY_VERIFIABLE_LEDGER_SCHEMA_VERSION,
  MemoryVerifiableLedgerRepository,
  VerifiableLedger,
  createMerkleProof,
  merkleRoot,
  verifyMerkleProof,
} from "../lib/novel-ai/verifiable-ledger/index.ts";

const tests = [];
const results = [];
const test = (name, run) => tests.push({ name, run });
const errorCode = (code) => (error) => error?.code === code;

function namespace(overrides = {}) {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    projectId: "project-a",
    storyId: "story-a",
    canonId: "canon-a",
    branchId: "main",
    characterId: "shared",
    agentRole: "closed-agent-os",
    modelId: "runtime-selection",
    modelDigest: "runtime-digest",
    promptProfileVersion: "prompt-v1",
    storyBibleRevision: "bible-1",
    knowledgeScopeRevision: "knowledge-1",
    privacyLevel: "device_only",
    ...overrides,
  };
}

test("architecture is one Agent OS with three compute backends, not a blockchain", () => {
  const architecture = BLOCKCHAIN_INSPIRED_VERIFIABLE_ARCHITECTURE;
  assert.equal(architecture.isBlockchain, false);
  assert.equal(architecture.topology.authority, "closed-agent-os");
  assert.equal(architecture.topology.oneSharedSystem, true);
  assert.deepEqual(architecture.topology.computeBackends, [
    "browser-ai",
    "local-ollama",
    "private-ai-hub",
  ]);
  assert.equal(architecture.topology.backendNodesMaintainSharedChain, false);
  assert.deepEqual(Object.values(architecture.mechanisms), Array(9).fill(true));
  assert.deepEqual(Object.values(architecture.exclusions), Array(5).fill(false));
});

test("Merkle root inclusion proof detects a modified leaf", async () => {
  const leaves = ["candidate", "evaluation", "approval", "adoption"];
  const root = await merkleRoot(leaves);
  const { proof } = await createMerkleProof(leaves, 2);
  assert.equal(await verifyMerkleProof("approval", proof, root), true);
  assert.equal(await verifyMerkleProof("modified-approval", proof, root), false);
});

test("append-only hash chain, signed approval and scoped CAS verify together", async () => {
  const repository = new MemoryVerifiableLedgerRepository();
  const ledger = new VerifiableLedger({ repository });
  const first = await ledger.append({
    ledgerId: "ledger-main",
    namespace: namespace(),
    eventType: "candidate-generated",
    payload: { candidateId: "candidate-a", contentDigest: "a".repeat(64) },
    retainContent: true,
  });
  const approval = await ledger.append({
    ledgerId: "ledger-main",
    namespace: namespace({
      modelId: "local-ollama-model",
      modelDigest: "local-ollama-digest",
    }),
    eventType: "approval-signed",
    payload: {
      candidateId: "candidate-a",
      approvedBy: "author",
      humanApproved: true,
    },
    signApproval: true,
  });
  const verification = await ledger.verify("ledger-main");
  assert.equal(verification.valid, true);
  assert.equal(verification.blockCount, 2);
  assert.equal(verification.contentAddressCount, 1);
  assert.equal(verification.signedApprovalCount, 1);
  assert.equal(approval.previousHash, first.blockHash);
  assert.deepEqual(approval.lineage.parentBlockIds, [first.id]);

  const correct = await repository.getContent(first.contentRecordId, {
    ledgerId: first.ledgerId,
    projectId: first.namespace.projectId,
    namespaceDigest: first.namespaceDigest,
  });
  assert.equal(correct?.contentAddress, first.contentAddress);
  const crossProject = await repository.getContent(first.contentRecordId, {
    ledgerId: first.ledgerId,
    projectId: "project-b",
    namespaceDigest: first.namespaceDigest,
  });
  assert.equal(crossProject, null);
  await assert.rejects(
    () => repository.append(structuredClone(first)),
    errorCode("LEDGER_APPEND_ONLY_VIOLATION"),
  );
  await assert.rejects(
    () => ledger.append({
      ledgerId: "ledger-main",
      namespace: namespace({
        userId: "user-b",
        projectId: "project-b",
        storyId: "story-b",
        canonId: "canon-b",
      }),
      eventType: "candidate-generated",
      payload: { candidateId: "cross-project" },
    }),
    errorCode("LEDGER_NAMESPACE_SCOPE_MISMATCH"),
  );
});

test("identical content uses one digest but isolated namespace record IDs", async () => {
  const repository = new MemoryVerifiableLedgerRepository();
  const ledger = new VerifiableLedger({ repository });
  const payload = { normalizedRule: "raise stakes before the irreversible choice" };
  const first = await ledger.append({
    ledgerId: "ledger-project-a",
    namespace: namespace(),
    eventType: "learning-candidate",
    payload,
    retainContent: true,
  });
  const second = await ledger.append({
    ledgerId: "ledger-project-b",
    namespace: namespace({
      tenantId: "tenant-b",
      userId: "user-b",
      projectId: "project-b",
      storyId: "story-b",
      canonId: "canon-b",
    }),
    eventType: "learning-candidate",
    payload,
    retainContent: true,
  });
  const third = await ledger.append({
    ledgerId: "ledger-project-a-second-task",
    namespace: namespace(),
    eventType: "learning-candidate",
    payload,
    retainContent: true,
  });
  assert.equal(first.contentAddress, second.contentAddress);
  assert.equal(first.contentAddress, third.contentAddress);
  assert.notEqual(first.contentRecordId, second.contentRecordId);
  assert.notEqual(first.contentRecordId, third.contentRecordId);
  assert.equal((await ledger.verify("ledger-project-a")).valid, true);
  assert.equal((await ledger.verify("ledger-project-b")).valid, true);
  assert.equal(
    (await ledger.verify("ledger-project-a-second-task")).valid,
    true,
  );
});

test("signed immutable evidence verifies and any change invalidates it", async () => {
  const ledger = new VerifiableLedger();
  await ledger.append({
    ledgerId: "ledger-evidence",
    namespace: namespace(),
    eventType: "task-accepted",
    payload: { taskId: "task-evidence" },
  });
  await ledger.append({
    ledgerId: "ledger-evidence",
    namespace: namespace(),
    eventType: "approval-signed",
    payload: { approvalId: "approval-evidence", humanApproved: true },
    signApproval: true,
  });
  const evidence = await ledger.exportEvidence("ledger-evidence", "project-a");
  assert.equal((await ledger.verifyEvidence(evidence)).valid, true);
  const tampered = structuredClone(evidence);
  tampered.blocks[0].payloadDigest = "0".repeat(64);
  const rejected = await ledger.verifyEvidence(tampered);
  assert.equal(rejected.valid, false);
  assert(rejected.errorCodes.includes("LEDGER_EVIDENCE_DIGEST_INVALID"));
});

test("retained content is rehashed and tampering is detected", async () => {
  const repository = new MemoryVerifiableLedgerRepository();
  const ledger = new VerifiableLedger({ repository });
  const block = await ledger.append({
    ledgerId: "ledger-content-tamper",
    namespace: namespace(),
    eventType: "candidate-generated",
    payload: { candidateId: "candidate-content", safe: true },
    retainContent: true,
  });
  const record = await repository.getContent(block.contentRecordId, {
    ledgerId: block.ledgerId,
    projectId: block.namespace.projectId,
    namespaceDigest: block.namespaceDigest,
  });
  const maliciousRepository = {
    kind: "memory",
    async append() {},
    async list() { return repository.list("ledger-content-tamper"); },
    async putContent() {},
    async getContent() {
      return { ...structuredClone(record), content: { modified: true } };
    },
  };
  const verifier = new VerifiableLedger({ repository: maliciousRepository });
  const verification = await verifier.verify("ledger-content-tamper");
  assert.equal(verification.valid, false);
  assert(verification.errorCodes.includes("LEDGER_CONTENT_RECORD_INVALID:1"));
});

test("signature key identity is bound to the public key", async () => {
  const repository = new MemoryVerifiableLedgerRepository();
  const ledger = new VerifiableLedger({ repository });
  await ledger.append({
    ledgerId: "ledger-signature",
    namespace: namespace(),
    eventType: "approval-signed",
    payload: { approvalId: "approval-signature", humanApproved: true },
    signApproval: true,
  });
  const tampered = await repository.list("ledger-signature");
  tampered[0].signature.keyId = "forged-key-id";
  const maliciousRepository = {
    kind: "memory",
    async append() {},
    async list() { return structuredClone(tampered); },
    async putContent() {},
    async getContent() { return null; },
  };
  const verifier = new VerifiableLedger({ repository: maliciousRepository });
  const result = await verifier.verify("ledger-signature");
  assert.equal(result.valid, false);
  assert(result.errorCodes.includes("LEDGER_SIGNATURE_INVALID:1"));
});

test("rollback has an explicit target and produces a queryable lineage trace", async () => {
  const ledger = new VerifiableLedger();
  const candidate = await ledger.append({
    ledgerId: "ledger-rollback",
    namespace: namespace(),
    eventType: "learning-candidate",
    payload: { candidateId: "learning-a" },
    retainContent: true,
  });
  const adopted = await ledger.append({
    ledgerId: "ledger-rollback",
    namespace: namespace(),
    eventType: "learning-adopted",
    payload: { candidateId: "learning-a", versionId: "version-2" },
    lineage: {
      sourceContentAddresses: [candidate.contentAddress],
      causationId: "ab-test-a",
    },
  });
  const rollback = await ledger.append({
    ledgerId: "ledger-rollback",
    namespace: namespace(),
    eventType: "rollback",
    payload: { versionId: "version-2", restoredVersionId: "version-1" },
    lineage: {
      rollbackTargetBlockId: adopted.id,
      causationId: "version-2",
    },
  });
  const trace = await ledger.traceLineage("ledger-rollback", rollback.id);
  assert.equal(trace.valid, true);
  assert.deepEqual(trace.blockIds, [candidate.id, adopted.id, rollback.id]);
  assert.deepEqual(trace.rollbackTargetBlockIds, [adopted.id]);
  assert(trace.sourceContentAddresses.includes(candidate.contentAddress));

  await assert.rejects(
    () => ledger.append({
      ledgerId: "ledger-rollback",
      namespace: namespace(),
      eventType: "rollback",
      payload: { versionId: "missing-target" },
    }),
    errorCode("LEDGER_ROLLBACK_TARGET_REQUIRED"),
  );
});

test("lineage rejects cross-ledger or future parent references", async () => {
  const ledger = new VerifiableLedger();
  const other = await ledger.append({
    ledgerId: "ledger-other",
    namespace: namespace(),
    eventType: "task-accepted",
    payload: { taskId: "other" },
  });
  const local = await ledger.append({
    ledgerId: "ledger-local",
    namespace: namespace(),
    eventType: "task-accepted",
    payload: { taskId: "local" },
  });
  await assert.rejects(
    () => ledger.append({
      ledgerId: "ledger-local",
      namespace: namespace(),
      eventType: "candidate-generated",
      payload: { candidateId: "candidate-local" },
      lineage: { parentBlockIds: [local.id, other.id] },
    }),
    errorCode("LEDGER_LINEAGE_PARENT_NOT_FOUND"),
  );
});

test("credentials, private keys and raw reasoning cannot enter immutable evidence", async () => {
  const ledger = new VerifiableLedger();
  for (const payload of [
    { password: "not-allowed" },
    { authorization: `Bearer ${"A".repeat(32)}` },
    { secret: "-----BEGIN PRIVATE KEY-----" },
    { field: "raw chain-of-thought" },
  ]) {
    await assert.rejects(
      () => ledger.append({
        ledgerId: "ledger-sensitive",
        namespace: namespace(),
        eventType: "security-blocked",
        payload,
      }),
      errorCode("VERIFIABLE_LEDGER_SENSITIVE_PAYLOAD_BLOCKED"),
    );
  }
});

test("legacy v1 blocks remain read-verifiable after the v2 upgrade", async () => {
  const legacyNamespace = namespace();
  const namespaceDigest = await closedAINamespaceDigest(legacyNamespace);
  const payloadDigest = await sha256Hex(stableStringify({ taskId: "legacy-task" }));
  const base = {
    schemaVersion: LEGACY_VERIFIABLE_LEDGER_SCHEMA_VERSION,
    id: "legacy-ledger:1",
    ledgerId: "legacy-ledger",
    sequence: 1,
    namespace: legacyNamespace,
    namespaceDigest,
    eventType: "task-accepted",
    previousHash: null,
    payloadDigest,
    resultDigest: null,
    contentAddress: null,
    merkleRoot: await merkleRoot([
      "genesis",
      namespaceDigest,
      "task-accepted",
      payloadDigest,
      "no-result",
      "no-content",
    ]),
    timestamp: "2026-01-01T00:00:00.000Z",
    rawChainOfThoughtStored: false,
    immutable: true,
  };
  const legacyBlock = {
    ...base,
    blockHash: await sha256Hex(stableStringify(base)),
    signature: null,
  };
  const legacyRepository = {
    kind: "memory",
    async append() {},
    async list() { return [structuredClone(legacyBlock)]; },
    async putContent() {},
    async getContent() { return null; },
  };
  const ledger = new VerifiableLedger({ repository: legacyRepository });
  assert.equal((await ledger.verify("legacy-ledger")).valid, true);
});

for (const item of tests) {
  const started = Date.now();
  try {
    await item.run();
    results.push({
      name: item.name,
      status: "PASS",
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    results.push({
      name: item.name,
      status: "FAIL",
      elapsedMs: Date.now() - started,
      error: error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
    });
  }
}

const report = {
  suite: "Blockchain-inspired verifiable architecture",
  schemaVersion: "blockchain-inspired-verifiable-architecture-test-v1",
  runAt: new Date().toISOString(),
  pass: results.filter((row) => row.status === "PASS").length,
  fail: results.filter((row) => row.status === "FAIL").length,
  architecture: BLOCKCHAIN_INSPIRED_VERIFIABLE_ARCHITECTURE,
  results,
};

console.log(JSON.stringify(report, null, 2));
if (report.fail) process.exitCode = 1;
