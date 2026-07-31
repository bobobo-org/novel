export type CanonicalRuntimeGate = {
  canonicalHydrationSucceeded: boolean;
  localCanonicalWritable: boolean;
  legacySnapshotPreserved: boolean;
};

export type CanonicalHydrationResult<T> = {
  state: T;
  gate: CanonicalRuntimeGate;
  recoverySnapshot: string;
  error: unknown | null;
};

export async function hydrateCanonicalWithNonDestructiveFallback<T>(input: {
  originalStorageBytes: string | null;
  legacyState: T;
  fallbackSnapshot: string;
  hydrate: () => Promise<T>;
}): Promise<CanonicalHydrationResult<T>> {
  const recoverySnapshot =
    input.originalStorageBytes ?? input.fallbackSnapshot;
  try {
    return {
      state: await input.hydrate(),
      gate: {
        canonicalHydrationSucceeded: true,
        localCanonicalWritable: true,
        legacySnapshotPreserved: true,
      },
      recoverySnapshot,
      error: null,
    };
  } catch (error) {
    return {
      state: input.legacyState,
      gate: {
        canonicalHydrationSucceeded: false,
        localCanonicalWritable: false,
        legacySnapshotPreserved: true,
      },
      recoverySnapshot,
      error,
    };
  }
}

export function canPersistStudioShell(gate: CanonicalRuntimeGate) {
  return gate.canonicalHydrationSucceeded && gate.localCanonicalWritable;
}

export async function runDailyBackupAndMark<T>(input: {
  createBackup: () => Promise<T | null>;
  markCompleted: () => void;
}) {
  const record = await input.createBackup();
  if (record) input.markCompleted();
  return record;
}
