import type { StoryBibleStorageCapabilities } from "../types";

export const SQLITE_LOCAL_CAPABILITIES: StoryBibleStorageCapabilities = {
  transactions: "supported",
  optimisticLock: "supported",
  advisoryLock: "partial",
  fullTextSearch: "partial",
  vectorSearch: "unsupported",
  streaming: "unsupported",
  batchWrite: "supported",
  integrityChain: "supported",
  export: "supported",
  import: "partial",
  revert: "supported",
  backup: "supported",
  restore: "supported",
  offline: "supported",
  browserCompatible: "unsupported",
  maxRecommendedProjectSize: 50000,
  maxRecommendedVersionCount: 5000,
};
