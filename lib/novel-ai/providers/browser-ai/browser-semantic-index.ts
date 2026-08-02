import type { ClosedAINamespace } from "../../closed-ai-cache";
import { sha256Hex, stableStringify } from "../../closed-ai-cache";
import { BROWSER_SEMANTIC_MODEL } from "./browser-semantic-model-registry";
import { embedWithBrowserSemanticModel } from "./browser-semantic-runtime";

const INDEX_DB = "novel-browser-semantic-index-v2";
const DOCUMENT_STORE = "documents";
const MANIFEST_STORE = "manifests";
const OPFS_ROOT = "novel-browser-semantic-index-v2";

export const BROWSER_SEMANTIC_INDEX_VERSION =
  "browser-semantic-index-v2" as const;

export type BrowserSemanticIndexSourceKind =
  | "chapter"
  | "storyBible"
  | "worldRule"
  | "character"
  | "relationship"
  | "timeline"
  | "acceptedChoice"
  | "storyBranch"
  | "quest"
  | "achievement"
  | "approvedLearningRule";

export type BrowserSemanticIndexSource = {
  id: string;
  kind: BrowserSemanticIndexSourceKind;
  text: string;
  revision: string;
  visibility: "actor" | "evaluator" | "both" | "author-only";
};

type BrowserSemanticDocumentRecord = {
  key: string;
  namespaceDigest: string;
  tenantId: string;
  userId: string;
  projectId: string;
  storyId: string;
  canonId: string;
  branchId: string;
  characterId: string;
  agentRole: string;
  modelId: string;
  modelDigest: string;
  promptProfileVersion: string;
  storyBibleRevision: string;
  knowledgeScopeRevision: string;
  privacyLevel: ClosedAINamespace["privacyLevel"];
  sourceId: string;
  sourceKind: BrowserSemanticIndexSourceKind;
  revision: string;
  visibility: BrowserSemanticIndexSource["visibility"];
  contentDigest: string;
  embeddingModelDigest: string;
  vectorDigest: string;
  vectorPath: string;
  dimensions: number;
  status: "ready";
  rawTextStored: false;
  updatedAt: string;
};

type BrowserSemanticIndexManifestRecord = {
  key: string;
  schemaVersion: typeof BROWSER_SEMANTIC_INDEX_VERSION;
  namespaceDigest: string;
  projectId: string;
  storyId: string;
  canonId: string;
  branchId: string;
  embeddingModelDigest: string;
  status: "building" | "ready" | "error";
  documentCount: number;
  lastErrorCode: string | null;
  rawTextStored: false;
  canonicalMutationCount: 0;
  updatedAt: string;
};

export type BrowserSemanticIndexResult = {
  schemaVersion: typeof BROWSER_SEMANTIC_INDEX_VERSION;
  status: "ready" | "error";
  namespaceDigest: string;
  documentCount: number;
  unchanged: number;
  rebuilt: number;
  removed: number;
  quarantined: number;
  embeddingModelDigest: string;
  metadataBackend: "IndexedDB";
  vectorBackend: "OPFS";
  rawTextStored: false;
  crossProjectVectorSharing: false;
  canonicalMutationCount: 0;
  errorCode: string | null;
};

function openIndexDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(Object.assign(new Error("IndexedDB is unavailable."), {
      code: "BROWSER_SEMANTIC_INDEX_INDEXEDDB_UNAVAILABLE",
    }));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INDEX_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DOCUMENT_STORE)) {
        request.result.createObjectStore(DOCUMENT_STORE, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(MANIFEST_STORE)) {
        request.result.createObjectStore(MANIFEST_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function allDocuments() {
  const database = await openIndexDatabase();
  try {
    return await new Promise<BrowserSemanticDocumentRecord[]>((resolve, reject) => {
      const request = database
        .transaction(DOCUMENT_STORE, "readonly")
        .objectStore(DOCUMENT_STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result as BrowserSemanticDocumentRecord[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function putRecord(store: string, record: object) {
  const database = await openIndexDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(store, "readwrite");
      transaction.objectStore(store).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function deleteDocumentRecords(keys: string[]) {
  if (!keys.length) return;
  const database = await openIndexDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DOCUMENT_STORE, "readwrite");
      const store = transaction.objectStore(DOCUMENT_STORE);
      keys.forEach((key) => store.delete(key));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

type StorageNavigator = Navigator & {
  storage?: StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
};

async function opfsRoot() {
  const current = navigator as StorageNavigator;
  const root = await current.storage?.getDirectory?.();
  if (!root) {
    throw Object.assign(new Error("OPFS is unavailable."), {
      code: "BROWSER_SEMANTIC_INDEX_OPFS_UNAVAILABLE",
    });
  }
  return root.getDirectoryHandle(OPFS_ROOT, { create: true });
}

function bytesToHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function vectorBufferDigest(buffer: ArrayBuffer) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", buffer));
}

async function writeVector(path: string, vector: number[]) {
  const root = await opfsRoot();
  const handle = await root.getFileHandle(path, { create: true });
  const writable = await handle.createWritable();
  const buffer = new Float32Array(vector).buffer;
  try {
    await writable.write(buffer);
  } finally {
    await writable.close();
  }
  return vectorBufferDigest(buffer);
}

async function deleteVector(path: string) {
  const root = await opfsRoot();
  await root.removeEntry(path).catch(() => undefined);
}

async function vectorRecordIsValid(record: BrowserSemanticDocumentRecord) {
  try {
    const root = await opfsRoot();
    const handle = await root.getFileHandle(record.vectorPath);
    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength !== record.dimensions * Float32Array.BYTES_PER_ELEMENT) {
      return false;
    }
    return await vectorBufferDigest(buffer) === record.vectorDigest;
  } catch {
    return false;
  }
}

export async function browserSemanticNamespaceDigest(namespace: ClosedAINamespace) {
  return sha256Hex(stableStringify({
    tenantId: namespace.tenantId,
    userId: namespace.userId,
    projectId: namespace.projectId,
    storyId: namespace.storyId,
    canonId: namespace.canonId,
    branchId: namespace.branchId,
    characterId: namespace.characterId,
    agentRole: namespace.agentRole,
    modelId: namespace.modelId,
    modelDigest: namespace.modelDigest,
    promptProfileVersion: namespace.promptProfileVersion,
    storyBibleRevision: namespace.storyBibleRevision,
    knowledgeScopeRevision: namespace.knowledgeScopeRevision,
    privacyLevel: namespace.privacyLevel,
  }));
}

export async function planBrowserSemanticIndexUpdate(input: {
  namespace: ClosedAINamespace;
  sources: BrowserSemanticIndexSource[];
  existing: Array<Pick<
    BrowserSemanticDocumentRecord,
    | "key"
    | "sourceId"
    | "revision"
    | "contentDigest"
    | "embeddingModelDigest"
    | "vectorPath"
  >>;
}) {
  const sourceRows = await Promise.all(input.sources.map(async (source) => ({
    source,
    contentDigest: await sha256Hex(source.text.trim()),
  })));
  const incomingIds = new Set(sourceRows.map((row) => row.source.id));
  const unchanged = sourceRows.filter((row) => input.existing.some((record) => (
    record.sourceId === row.source.id
    && record.revision === row.source.revision
    && record.contentDigest === row.contentDigest
    && record.embeddingModelDigest === BROWSER_SEMANTIC_MODEL.modelDigest
  )));
  const rebuild = sourceRows.filter((row) => !unchanged.includes(row));
  const remove = input.existing.filter((record) => !incomingIds.has(record.sourceId));
  return { unchanged, rebuild, remove };
}

export async function updateBrowserSemanticIndex(input: {
  namespace: ClosedAINamespace;
  sources: BrowserSemanticIndexSource[];
  signal?: AbortSignal;
}): Promise<BrowserSemanticIndexResult> {
  const namespaceDigest = await browserSemanticNamespaceDigest(input.namespace);
  const manifestKey = `manifest:${namespaceDigest}`;
  const now = new Date().toISOString();
  await putRecord(MANIFEST_STORE, {
    key: manifestKey,
    schemaVersion: BROWSER_SEMANTIC_INDEX_VERSION,
    namespaceDigest,
    projectId: input.namespace.projectId,
    storyId: input.namespace.storyId,
    canonId: input.namespace.canonId,
    branchId: input.namespace.branchId,
    embeddingModelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
    status: "building",
    documentCount: 0,
    lastErrorCode: null,
    rawTextStored: false,
    canonicalMutationCount: 0,
    updatedAt: now,
  } satisfies BrowserSemanticIndexManifestRecord);
  let rebuilt = 0;
  let removed = 0;
  let quarantined = 0;
  try {
    const all = await allDocuments();
    const namespaceRecords = all.filter(
      (record) => record.namespaceDigest === namespaceDigest,
    );
    const existing: BrowserSemanticDocumentRecord[] = [];
    for (const record of namespaceRecords) {
      if (input.signal?.aborted) {
        throw new DOMException("操作已取消。", "AbortError");
      }
      if (await vectorRecordIsValid(record)) {
        existing.push(record);
      } else {
        await deleteVector(record.vectorPath);
        await deleteDocumentRecords([record.key]);
        quarantined += 1;
      }
    }
    const plan = await planBrowserSemanticIndexUpdate({
      namespace: input.namespace,
      sources: input.sources,
      existing,
    });
    for (const stale of plan.remove) {
      await deleteVector(stale.vectorPath);
      await deleteDocumentRecords([stale.key]);
      removed += 1;
    }
    for (let offset = 0; offset < plan.rebuild.length; offset += 24) {
      if (input.signal?.aborted) throw new DOMException("操作已取消。", "AbortError");
      const chunk = plan.rebuild.slice(offset, offset + 24);
      const embedded = await embedWithBrowserSemanticModel(
        chunk.map((row) => row.source.text),
        input.signal,
      );
      for (let index = 0; index < chunk.length; index += 1) {
        const row = chunk[index];
        const vector = embedded.vectors[index];
        if (!vector || vector.length !== embedded.dimensions) {
          quarantined += 1;
          throw Object.assign(new Error("A semantic vector was malformed."), {
            code: "BROWSER_SEMANTIC_INDEX_VECTOR_INVALID",
          });
        }
        const key = await sha256Hex(`${namespaceDigest}:${row.source.id}`);
        const vectorPath = `${key}.f32`;
        const vectorDigest = await writeVector(vectorPath, vector);
        try {
          await putRecord(DOCUMENT_STORE, {
            key,
            namespaceDigest,
            tenantId: input.namespace.tenantId,
            userId: input.namespace.userId,
            projectId: input.namespace.projectId,
            storyId: input.namespace.storyId,
            canonId: input.namespace.canonId,
            branchId: input.namespace.branchId,
            characterId: input.namespace.characterId,
            agentRole: input.namespace.agentRole,
            modelId: input.namespace.modelId,
            modelDigest: input.namespace.modelDigest,
            promptProfileVersion: input.namespace.promptProfileVersion,
            storyBibleRevision: input.namespace.storyBibleRevision,
            knowledgeScopeRevision: input.namespace.knowledgeScopeRevision,
            privacyLevel: input.namespace.privacyLevel,
            sourceId: row.source.id,
            sourceKind: row.source.kind,
            revision: row.source.revision,
            visibility: row.source.visibility,
            contentDigest: row.contentDigest,
            embeddingModelDigest: embedded.modelDigest,
            vectorDigest,
            vectorPath,
            dimensions: embedded.dimensions,
            status: "ready",
            rawTextStored: false,
            updatedAt: new Date().toISOString(),
          } satisfies BrowserSemanticDocumentRecord);
        } catch (error) {
          await deleteVector(vectorPath);
          throw error;
        }
        rebuilt += 1;
      }
    }
    const documentCount = plan.unchanged.length + rebuilt;
    await putRecord(MANIFEST_STORE, {
      key: manifestKey,
      schemaVersion: BROWSER_SEMANTIC_INDEX_VERSION,
      namespaceDigest,
      projectId: input.namespace.projectId,
      storyId: input.namespace.storyId,
      canonId: input.namespace.canonId,
      branchId: input.namespace.branchId,
      embeddingModelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
      status: "ready",
      documentCount,
      lastErrorCode: null,
      rawTextStored: false,
      canonicalMutationCount: 0,
      updatedAt: new Date().toISOString(),
    } satisfies BrowserSemanticIndexManifestRecord);
    return {
      schemaVersion: BROWSER_SEMANTIC_INDEX_VERSION,
      status: "ready",
      namespaceDigest,
      documentCount,
      unchanged: plan.unchanged.length,
      rebuilt,
      removed,
      quarantined,
      embeddingModelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
      metadataBackend: "IndexedDB",
      vectorBackend: "OPFS",
      rawTextStored: false,
      crossProjectVectorSharing: false,
      canonicalMutationCount: 0,
      errorCode: null,
    };
  } catch (error) {
    const errorCode = String((error as { code?: unknown } | null)?.code ?? "BROWSER_SEMANTIC_INDEX_FAILED");
    await putRecord(MANIFEST_STORE, {
      key: manifestKey,
      schemaVersion: BROWSER_SEMANTIC_INDEX_VERSION,
      namespaceDigest,
      projectId: input.namespace.projectId,
      storyId: input.namespace.storyId,
      canonId: input.namespace.canonId,
      branchId: input.namespace.branchId,
      embeddingModelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
      status: "error",
      documentCount: 0,
      lastErrorCode: errorCode,
      rawTextStored: false,
      canonicalMutationCount: 0,
      updatedAt: new Date().toISOString(),
    } satisfies BrowserSemanticIndexManifestRecord).catch(() => undefined);
    return {
      schemaVersion: BROWSER_SEMANTIC_INDEX_VERSION,
      status: "error",
      namespaceDigest,
      documentCount: 0,
      unchanged: 0,
      rebuilt,
      removed,
      quarantined,
      embeddingModelDigest: BROWSER_SEMANTIC_MODEL.modelDigest,
      metadataBackend: "IndexedDB",
      vectorBackend: "OPFS",
      rawTextStored: false,
      crossProjectVectorSharing: false,
      canonicalMutationCount: 0,
      errorCode,
    };
  }
}
