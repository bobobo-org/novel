import { INDEXEDDB_SCHEMA_CAPABILITIES, MEMORY_CAPABILITIES, SQLITE_PROTOTYPE_CAPABILITIES, SUPABASE_CAPABILITIES } from "./capabilities";
import { MemoryStoryBibleStorageAdapter } from "./memory-adapter";
import { SupabaseStoryBibleStorageAdapter } from "./supabase-adapter";
import type { StorageMode, StoryBibleStorageAdapter, StoryBibleStorageCapabilities } from "./types";

const adapters = new Map<StorageMode, StoryBibleStorageAdapter>();
const projectModes = new Map<string, StorageMode>();

export function registerStorageAdapter(adapter: StoryBibleStorageAdapter) {
  if (adapters.has(adapter.mode)) {
    throw Object.assign(new Error(`Storage adapter already registered: ${adapter.mode}`), {
      name: "STORAGE_ADAPTER_ALREADY_REGISTERED",
      code: "STORAGE_ADAPTER_ALREADY_REGISTERED",
    });
  }
  adapters.set(adapter.mode, adapter);
  return adapter;
}

export function ensureDefaultStorageAdapters() {
  if (!adapters.has("SUPABASE_CLOUD")) adapters.set("SUPABASE_CLOUD", new SupabaseStoryBibleStorageAdapter());
  if (!adapters.has("MEMORY_TEST")) adapters.set("MEMORY_TEST", new MemoryStoryBibleStorageAdapter());
}

export function resetStorageAdapterRegistryForTests() {
  adapters.clear();
  projectModes.clear();
}

export function getStorageAdapter(mode: StorageMode): StoryBibleStorageAdapter {
  ensureDefaultStorageAdapters();
  const adapter = adapters.get(mode);
  if (!adapter) {
    throw Object.assign(new Error(`Storage adapter not found: ${mode}`), {
      name: "STORAGE_ADAPTER_NOT_FOUND",
      code: "STORAGE_ADAPTER_NOT_FOUND",
    });
  }
  return adapter;
}

export function listRegisteredStorageAdapters() {
  ensureDefaultStorageAdapters();
  return Array.from(adapters.values()).map((adapter) => ({
    id: adapter.id,
    mode: adapter.mode,
    label: adapter.label,
    capabilities: adapter.capabilities,
  }));
}

export function getStorageCapabilities(mode: StorageMode): StoryBibleStorageCapabilities {
  ensureDefaultStorageAdapters();
  const adapter = adapters.get(mode);
  if (adapter) return adapter.capabilities;
  if (mode === "SUPABASE_CLOUD") return SUPABASE_CAPABILITIES;
  if (mode === "SQLITE_LOCAL") return SQLITE_PROTOTYPE_CAPABILITIES;
  if (mode === "INDEXEDDB_BROWSER") return INDEXEDDB_SCHEMA_CAPABILITIES;
  return MEMORY_CAPABILITIES;
}

export function setProjectStorageMode(projectId: string, mode: StorageMode) {
  validateStorageMode(mode);
  projectModes.set(projectId, mode);
}

export function getProjectStorageMode(projectId: string): StorageMode {
  return projectModes.get(projectId) || "SUPABASE_CLOUD";
}

export function getStorageAdapterForProject(projectId: string): StoryBibleStorageAdapter {
  return getStorageAdapter(getProjectStorageMode(projectId));
}

export function validateStorageMode(mode: string): asserts mode is StorageMode {
  if (!["SUPABASE_CLOUD", "SQLITE_LOCAL", "INDEXEDDB_BROWSER", "MEMORY_TEST"].includes(mode)) {
    throw Object.assign(new Error(`Invalid storage mode: ${mode}`), {
      name: "STORAGE_SCHEMA_INCOMPATIBLE",
      code: "STORAGE_SCHEMA_INCOMPATIBLE",
    });
  }
}

export function assertStorageAllowed(projectId: string, mode: StorageMode) {
  validateStorageMode(mode);
  const selected = getProjectStorageMode(projectId);
  if (selected !== mode && selected !== "SUPABASE_CLOUD") {
    throw Object.assign(new Error(`Project ${projectId} is configured for ${selected}, not ${mode}.`), {
      name: "STORAGE_PROJECT_ISOLATION_FAILED",
      code: "STORAGE_PROJECT_ISOLATION_FAILED",
    });
  }
}
