export * from "./contracts";
export * from "./indexeddb/indexeddb-repository";
export * from "./memory/memory-repository";

import { IndexedDbNovelRepository } from "./indexeddb/indexeddb-repository";
import { MemoryNovelRepository } from "./memory/memory-repository";

export function createNovelRepository() { return typeof indexedDB === "undefined" ? new MemoryNovelRepository() : new IndexedDbNovelRepository(); }
