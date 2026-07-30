export * from "./contracts";
export * from "./indexeddb/indexeddb-repository";
export * from "./memory/memory-repository";
export * from "./unavailable/unavailable-repository";

import { IndexedDbNovelRepository } from "./indexeddb/indexeddb-repository";
import { MemoryNovelRepository } from "./memory/memory-repository";
import { UnavailableNovelRepository } from "./unavailable/unavailable-repository";

export function createNovelRepository() {
  if (typeof window === "undefined") return new MemoryNovelRepository();
  if (typeof indexedDB !== "undefined") return new IndexedDbNovelRepository();
  return new UnavailableNovelRepository();
}
