export const NOVEL_DOMAIN_VERSION = "novel-domain-v1" as const;

export type RecordSource = "user" | "ai_candidate" | "migration" | "system";

export type Provenance = {
  source: RecordSource;
  actor: "author" | "local-rule" | "browser-ai" | "local-ollama" | "private-ai-hub" | "migration";
  requestId?: string;
  createdAt: string;
};

export type DomainRecord = {
  schemaVersion: typeof NOVEL_DOMAIN_VERSION;
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  source: RecordSource;
  provenance: Provenance;
  deletedAt?: string | null;
  parentRevision?: number | null;
  migrationVersion?: string | null;
};

export type OptionalValueStatus =
  | "unset"
  | "not_applicable"
  | "user_defined"
  | "ai_suggested"
  | "ai_accepted"
  | "inferred"
  | "deferred";

export type OptionalValue<T> = {
  value: T | null;
  status: OptionalValueStatus;
  source: RecordSource | null;
  updatedAt: string | null;
};

export function optionalValue<T>(value: T | null = null, status: OptionalValueStatus = "unset"): OptionalValue<T> {
  return { value, status, source: value === null ? null : "user", updatedAt: value === null ? null : new Date().toISOString() };
}

export function makeRecord(projectId: string, source: RecordSource = "user"): DomainRecord {
  const now = new Date().toISOString();
  return {
    schemaVersion: NOVEL_DOMAIN_VERSION,
    id: crypto.randomUUID(),
    projectId,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    source,
    provenance: { source, actor: source === "migration" ? "migration" : source === "system" ? "local-rule" : "author", createdAt: now },
    deletedAt: null,
    parentRevision: null,
    migrationVersion: null,
  };
}
