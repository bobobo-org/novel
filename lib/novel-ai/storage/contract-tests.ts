import { assertCloudOptional, assertExternalCanonicalWriteBlocked, assertLocalAuthority, defaultProjectStoragePolicy } from "./authority";
import { MemoryStoryBibleStorageAdapter } from "./memory-adapter";
import { getStorageAdapter, getStorageCapabilities, registerStorageAdapter, resetStorageAdapterRegistryForTests, setProjectStorageMode } from "./registry";
import type { StoryBibleStorageAdapter } from "./types";

type TestResult = { name: string; status: "PASS" | "FAIL"; details?: unknown };

function pass(name: string, details?: unknown): TestResult {
  return { name, status: "PASS", details };
}

function fail(name: string, error: unknown): TestResult {
  return { name, status: "FAIL", details: error instanceof Error ? { name: error.name, message: error.message } : error };
}

async function check(name: string, fn: () => Promise<unknown> | unknown): Promise<TestResult> {
  try {
    return pass(name, await fn());
  } catch (error) {
    return fail(name, error);
  }
}

export async function runStorageAdapterContract(adapter: StoryBibleStorageAdapter) {
  const projectId = `l0a-contract-${Date.now()}`;
  const candidateId = `cand-${Date.now()}`;
  const conflictId = `conflict-${Date.now()}`;
  const entityId = `char-${Date.now()}`;
  const sourceId = `source-${Date.now()}`;
  const versionId = `version-${Date.now()}`;
  const requestId = `request-${Date.now()}`;
  const results: TestResult[] = [];

  results.push(await check("project CRUD", async () => {
    await adapter.createProject({ id: projectId, projectId, project_id: projectId, title: "L0A Contract" });
    const project = await adapter.getProject(projectId);
    if (!project) throw new Error("project missing");
    await adapter.updateProject(projectId, { title: "L0A Contract Updated" });
    return adapter.listProjects();
  }));
  results.push(await check("candidate create/read/update", async () => {
    await adapter.createCandidate({ id: candidateId, projectId, project_id: projectId, status: "pending" });
    const candidate = await adapter.getCandidate(projectId, candidateId);
    if (!candidate) throw new Error("candidate missing");
    await adapter.updateCandidateStatus(projectId, candidateId, "needs_review");
    await adapter.lockCandidate(projectId, candidateId, "lock-l0a");
    return adapter.listCandidates(projectId);
  }));
  results.push(await check("conflict create/read", async () => {
    await adapter.createConflict({ id: conflictId, projectId, project_id: projectId, severity: "major" });
    const conflict = await adapter.getConflict(projectId, conflictId);
    if (!conflict) throw new Error("conflict missing");
    await adapter.updateConflictStatus(projectId, conflictId, "resolved");
    return adapter.listConflicts(projectId);
  }));
  results.push(await check("canonical create/update/deactivate", async () => {
    await adapter.createCanonicalEntity("character", { projectId, project_id: projectId, entityId, entity_id: entityId, canonicalName: "林昭" });
    const entity = await adapter.getCanonicalEntity(projectId, "character", entityId);
    if (!entity) throw new Error("canonical missing");
    await adapter.updateCanonicalEntity(projectId, "character", entityId, { age: 28 });
    await adapter.deactivateCanonicalEntity(projectId, "character", entityId, "contract test");
    return adapter.getCurrentCanonicalState(projectId);
  }));
  results.push(await check("source relation", async () => {
    await adapter.createSource({ id: sourceId, projectId, project_id: projectId, excerpt: "source" });
    const source = await adapter.getSource(projectId, sourceId);
    if (!source) throw new Error("source missing");
    await adapter.createCanonicalSourceRelation({ projectId, project_id: projectId, sourceId, entityId });
    return adapter.listSources(projectId);
  }));
  results.push(await check("version create/read", async () => {
    await adapter.createVersion({ id: versionId, projectId, project_id: projectId, versionNumber: 1, entityType: "character", entityId, fieldPath: "characters[].age" });
    const version = await adapter.getVersion(projectId, versionId);
    if (!version) throw new Error("version missing");
    await adapter.getCurrentVersion(projectId);
    await adapter.getVersionRange(projectId, 1, 1);
    await adapter.getEntityHistory(projectId, "character", entityId);
    return adapter.getFieldHistory(projectId, "character", entityId, "characters[].age");
  }));
  results.push(await check("integrity metadata", async () => {
    await adapter.saveIntegrityMetadata({ projectId, project_id: projectId, versionNumber: 1 });
    const verify = await adapter.verifyStoredIntegrityFields(projectId);
    if (!verify.ok) throw new Error("integrity failed");
    return adapter.getIntegrityChain(projectId);
  }));
  results.push(await check("mutation request idempotency", async () => {
    await adapter.beginMutationRequest({ requestId, request_id: requestId, projectId, project_id: projectId, status: "running" });
    const mutation = await adapter.getMutationRequest(requestId);
    if (!mutation) throw new Error("mutation missing");
    await adapter.completeMutationRequest(requestId, { ok: true });
    return adapter.getMutationRequest(requestId);
  }));
  results.push(await check("transaction commit", async () => {
    await adapter.transaction(async () => {
      await adapter.createCandidate({ id: `${candidateId}-tx`, projectId, project_id: projectId, status: "pending" });
    });
    const row = await adapter.getCandidate(projectId, `${candidateId}-tx`);
    if (!row) throw new Error("transaction did not commit");
    return row;
  }));
  results.push(await check("transaction rollback", async () => {
    try {
      await adapter.transaction(async () => {
        await adapter.createCandidate({ id: `${candidateId}-rollback`, projectId, project_id: projectId, status: "pending" });
        throw new Error("rollback");
      });
    } catch {
      // expected
    }
    const row = await adapter.getCandidate(projectId, `${candidateId}-rollback`);
    if (row) throw new Error("transaction did not rollback");
    return { rolledBack: true };
  }));
  results.push(await check("optimistic lock", async () => adapter.optimisticVersionCheck(projectId, 1)));
  results.push(await check("project isolation", async () => {
    const other = await adapter.getCandidate(`${projectId}-other`, candidateId);
    if (other) throw new Error("candidate leaked across project");
    return { isolated: true };
  }));
  results.push(await check("export audit", async () => adapter.createExportAudit({ projectId, project_id: projectId })));
  results.push(await check("revert audit", async () => adapter.createRevertAudit({ projectId, project_id: projectId })));
  results.push(await check("cleanup", async () => adapter.deleteTestProject(projectId)));

  return summarize(results);
}

export async function runL0AContractTests() {
  resetStorageAdapterRegistryForTests();
  const memory = registerStorageAdapter(new MemoryStoryBibleStorageAdapter());
  const results: TestResult[] = [];
  results.push(await check("authority local canonical", () => {
    const policy = defaultProjectStoragePolicy({ primaryStorage: "MEMORY_TEST", fullOfflineRequired: true });
    assertLocalAuthority(policy);
    assertCloudOptional(policy);
    return policy;
  }));
  results.push(await check("external provider canonical write blocked", () => {
    try {
      assertExternalCanonicalWriteBlocked("gemini", "canonical");
    } catch (error) {
      if ((error as Error).name === "EXTERNAL_DIRECT_CANONICAL_WRITE_BLOCKED") return { blocked: true };
      throw error;
    }
    throw new Error("external canonical write was not blocked");
  }));
  results.push(await check("adapter registry", () => {
    const adapter = getStorageAdapter("MEMORY_TEST");
    setProjectStorageMode("l0a-project", "MEMORY_TEST");
    return { adapter: adapter.id, capabilities: getStorageCapabilities("MEMORY_TEST") };
  }));
  const contract = await runStorageAdapterContract(memory);
  results.push(...contract.results);
  return summarize(results);
}

function summarize(results: TestResult[]) {
  return {
    pass: results.filter((x) => x.status === "PASS").length,
    fail: results.filter((x) => x.status === "FAIL").length,
    skip: 0,
    results,
  };
}
