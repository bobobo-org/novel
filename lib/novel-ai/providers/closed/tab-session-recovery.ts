export const TAB_SESSION_SCHEMA_VERSION =
  "closed-ai-tab-session-v1" as const;

export type ClosedAITabSessionBackend =
  | "local-ollama"
  | "private-ai-hub";

export type ClosedAITabSessionRecord = {
  schemaVersion: typeof TAB_SESSION_SCHEMA_VERSION;
  backend: ClosedAITabSessionBackend;
  protocolVersion: string;
  origin: string;
  endpoint: string;
  instanceId: string;
  expiresAt: string;
  session: {
    token: string;
    csrf: string;
  };
  modelId: string | null;
  modelDigest: string | null;
  savedAt: string;
};

const KEYS: Record<ClosedAITabSessionBackend, string> = {
  "local-ollama": "novel.closed-ai.local-ollama.tab-session.v1",
  "private-ai-hub": "novel.closed-ai.private-ai-hub.tab-session.v1",
};

function availableSessionStorage(explicit?: Storage | null) {
  if (explicit !== undefined) return explicit;
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function validRecord(
  value: unknown,
  expected: {
    backend: ClosedAITabSessionBackend;
    protocolVersion: string;
    origin: string;
    endpoint: string;
  },
): value is ClosedAITabSessionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ClosedAITabSessionRecord>;
  return record.schemaVersion === TAB_SESSION_SCHEMA_VERSION
    && record.backend === expected.backend
    && record.protocolVersion === expected.protocolVersion
    && record.origin === expected.origin
    && record.endpoint === expected.endpoint
    && typeof record.instanceId === "string"
    && Boolean(record.instanceId)
    && typeof record.expiresAt === "string"
    && Date.parse(record.expiresAt) > Date.now()
    && typeof record.session?.token === "string"
    && Boolean(record.session.token)
    && typeof record.session?.csrf === "string"
    && Boolean(record.session.csrf)
    && (record.modelId === null || typeof record.modelId === "string")
    && (record.modelDigest === null || typeof record.modelDigest === "string");
}

export function saveClosedAITabSession(
  record: ClosedAITabSessionRecord,
  storage?: Storage | null,
) {
  const target = availableSessionStorage(storage);
  if (!target) return false;
  target.setItem(KEYS[record.backend], JSON.stringify(record));
  return true;
}

export function readClosedAITabSession(
  expected: {
    backend: ClosedAITabSessionBackend;
    protocolVersion: string;
    origin: string;
    endpoint: string;
  },
  storage?: Storage | null,
) {
  const target = availableSessionStorage(storage);
  if (!target) return null;
  const key = KEYS[expected.backend];
  try {
    const raw = target.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!validRecord(parsed, expected)) {
      target.removeItem(key);
      return null;
    }
    return structuredClone(parsed);
  } catch {
    target.removeItem(key);
    return null;
  }
}

export function clearClosedAITabSession(
  backend: ClosedAITabSessionBackend,
  storage?: Storage | null,
) {
  availableSessionStorage(storage)?.removeItem(KEYS[backend]);
}

export function closedAITabSessionStorageKey(
  backend: ClosedAITabSessionBackend,
) {
  return KEYS[backend];
}
