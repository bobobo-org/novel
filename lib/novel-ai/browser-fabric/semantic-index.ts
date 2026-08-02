import { browserFabricDigest } from "./execution-receipt";
import type { BrowserFabricContextItem, BrowserFabricTask } from "./types";

export type BrowserSemanticIndexRecord = {
  id: string;
  namespaceDigest: string;
  contentDigest: string;
  revision: number;
  visibility: BrowserFabricContextItem["visibility"];
  branchId: string;
  embeddingModelId: string;
  embeddingModelDigest: string;
  chunkingVersion: "late-chunking-v1";
  status: "ready" | "quarantined" | "rebuild_required";
};

export async function planIncrementalSemanticIndex(input: {
  task: BrowserFabricTask;
  items: BrowserFabricContextItem[];
  existing: BrowserSemanticIndexRecord[];
  embeddingModelId: string;
  embeddingModelDigest: string;
}) {
  const namespaceDigest = await browserFabricDigest(input.task.namespace);
  const existing = new Map(input.existing.map((record) => [record.id, record]));
  const upsert: BrowserSemanticIndexRecord[] = [];
  const unchanged: string[] = [];
  for (const item of input.items) {
    const contentDigest = item.digest ?? await browserFabricDigest(item.text);
    const previous = existing.get(item.id);
    const record: BrowserSemanticIndexRecord = {
      id: item.id,
      namespaceDigest,
      contentDigest,
      revision: item.revision ?? 0,
      visibility: item.visibility,
      branchId: input.task.namespace.branchId,
      embeddingModelId: input.embeddingModelId,
      embeddingModelDigest: input.embeddingModelDigest,
      chunkingVersion: "late-chunking-v1",
      status: "ready",
    };
    const matches = previous
      && previous.namespaceDigest === namespaceDigest
      && previous.contentDigest === contentDigest
      && previous.revision === record.revision
      && previous.visibility === record.visibility
      && previous.branchId === record.branchId
      && previous.embeddingModelDigest === record.embeddingModelDigest;
    if (matches) unchanged.push(item.id);
    else upsert.push(record);
  }
  const activeIds = new Set(input.items.map((item) => item.id));
  const remove = input.existing.filter((record) => !activeIds.has(record.id)).map((record) => record.id);
  const quarantined = input.existing
    .filter((record) => record.namespaceDigest !== namespaceDigest)
    .map((record) => ({ ...record, status: "quarantined" as const }));
  return { namespaceDigest, upsert, unchanged, remove, quarantined };
}
