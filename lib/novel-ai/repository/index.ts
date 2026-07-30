export * from "./contracts";
export * from "./indexeddb/indexeddb-repository";
export * from "./memory/memory-repository";

import { IndexedDbNovelRepository } from "./indexeddb/indexeddb-repository";
import { MemoryNovelRepository } from "./memory/memory-repository";

let browserMemoryFallback: MemoryNovelRepository | null = null;

export function createNovelRepository() {
  if (typeof window === "undefined") return new MemoryNovelRepository();
  if (typeof indexedDB !== "undefined") return new IndexedDbNovelRepository();
  browserMemoryFallback ??= new MemoryNovelRepository();
  return browserMemoryFallback;
}
