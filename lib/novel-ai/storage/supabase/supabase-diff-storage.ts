import crypto from "crypto";
import { z } from "zod";
import {
  asArray,
  asRecord,
  JsonRecord,
  ReconstructedField,
  reconstructStateFromVersions,
  stableValueKey,
} from "../../story-bible-change-sets";
import { verifyVersionChain } from "../../story-bible-integrity";

const EntityTypeSchema = z.enum(["character", "event", "item", "world_rule", "foreshadowing", "open_thread"]);
const VersionRefSchema = z.string().min(1).max(180);

export const VersionDiffQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
  fromVersion: VersionRefSchema,
  toVersion: VersionRefSchema,
  entityType: EntityTypeSchema.optional(),
  entityId: z.string().max(160).optional(),
  fieldPath: z.string().max(300).optional(),
  includeUnchanged: z.coerce.boolean().default(false),
  includeSources: z.coerce.boolean().default(true),
  allowUnsafeRead: z.coerce.boolean().default(false),
});

export const CurrentDiffQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
  entityType: EntityTypeSchema.optional(),
  entityId: z.string().max(160).optional(),
  includeSources: z.coerce.boolean().default(true),
});

type DiffQuery = z.infer<typeof VersionDiffQuerySchema>;

export class StoryBibleDiffError extends Error {
  constructor(
    public errorCode: string,
    message: string,
    public status = 400,
    public details: JsonRecord = {},
  ) {
    super(message);
    this.name = "StoryBibleDiffError";
  }
}

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url: url.replace(/\/$/, ""), key };
}

async function rest<T>(table: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const cfg = supabaseConfig();
  if (!cfg.url || !cfg.key) throw new StoryBibleDiffError("STORY_BIBLE_PERSISTENCE_NOT_CONFIGURED", "Story Bible persistence is not configured.", 503);
  const query = init.query ? `?${init.query}` : "";
  const response = await fetch(`${cfg.url}/rest/v1/${table}${query}`, {
    ...init,
    headers: {
      apikey: cfg.key,
      authorization: `Bearer ${cfg.key}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new StoryBibleDiffError("STORY_BIBLE_DIFF_DB_ERROR", `Story Bible database error: ${response.status}`, 500, {
      technicalMessage: text.slice(0, 300),
      retryable: true,
    });
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function queryValue(value: string) {
  return encodeURIComponent(value);
}

function hashProject(projectId: string) {
  return crypto.createHash("sha256").update(projectId).digest("hex").slice(0, 12);
}

async function readVersions(projectId: string) {
  return rest<JsonRecord[]>("story_bible_versions", {
    query: `project_id=eq.${queryValue(projectId)}&select=*&order=version_number.asc&limit=5000`,
  });
}

async function readSources(projectId: string) {
  return rest<JsonRecord[]>("story_canonical_sources", {
    query: `project_id=eq.${queryValue(projectId)}&select=*&order=created_at.asc&limit=5000`,
  });
}

function versionNumber(value: JsonRecord) {
  return Number(value.version_number || 0);
}

function versionSummary(value: JsonRecord) {
  return {
    versionId: value.id,
    versionNumber: versionNumber(value),
    operationType: value.operation_type || null,
    createdAt: value.created_at || null,
    summary: value.summary || null,
  };
}

function resolveVersion(versions: JsonRecord[], ref: string, label: "fromVersion" | "toVersion" | "targetVersion") {
  const byNumber = /^\d+$/.test(ref) ? versions.find((version) => versionNumber(version) === Number(ref)) : undefined;
  const byId = versions.find((version) => String(version.id || "") === ref);
  const found = byNumber || byId;
  if (!found) {
    throw new StoryBibleDiffError("VERSION_NOT_FOUND", `${label} was not found for this project.`, 404, { [label]: ref, retryable: false });
  }
  return found;
}

function valuesEqual(a: unknown, b: unknown) {
  return stableValueKey(a) === stableValueKey(b);
}

function fieldPassesFilters(field: ReconstructedField, query: Pick<DiffQuery, "entityType" | "entityId" | "fieldPath">) {
  if (query.entityType && field.entityType !== query.entityType) return false;
  if (query.entityId && field.entityId !== query.entityId) return false;
  if (query.fieldPath && field.fieldPath !== query.fieldPath) return false;
  return true;
}

function arrayDiff(fromValue: unknown, toValue: unknown) {
  const from = asArray(fromValue);
  const to = asArray(toValue);
  const fromKeys = new Set(from.map(stableValueKey));
  const toKeys = new Set(to.map(stableValueKey));
  return {
    addedValues: to.filter((item) => !fromKeys.has(stableValueKey(item))),
    removedValues: from.filter((item) => !toKeys.has(stableValueKey(item))),
    retainedValues: to.filter((item) => fromKeys.has(stableValueKey(item))),
  };
}

function operationFor(fromField: ReconstructedField | undefined, toField: ReconstructedField | undefined) {
  if (!fromField && toField) return "created";
  if (fromField && !toField) return "deleted";
  if (!fromField || !toField) return "unchanged";
  if (Array.isArray(fromField.value) || Array.isArray(toField.value)) {
    const diff = arrayDiff(fromField.value, toField.value);
    if (diff.addedValues.length > 0 && diff.removedValues.length === 0) return "appended";
    if (diff.addedValues.length === 0 && diff.removedValues.length > 0) return "removed";
  }
  return valuesEqual(fromField.value, toField.value) ? "unchanged" : "updated";
}

function makeFieldDiff(input: {
  key: string;
  fromField?: ReconstructedField;
  toField?: ReconstructedField;
  includeSources: boolean;
}) {
  const field = input.toField || input.fromField;
  if (!field) return null;
  const operation = operationFor(input.fromField, input.toField);
  const lastChange = input.toField?.lastChange || input.fromField?.lastChange;
  const arrayChange = (Array.isArray(input.fromField?.value) || Array.isArray(input.toField?.value))
    ? arrayDiff(input.fromField?.value, input.toField?.value)
    : undefined;
  return {
    changeId: lastChange?.changeId || `diff_${crypto.createHash("sha256").update(input.key).digest("hex").slice(0, 16)}`,
    entityType: field.entityType,
    entityId: field.entityId,
    entityDisplayName: field.entityDisplayName,
    fieldPath: field.fieldPath,
    operation,
    fromValue: input.fromField?.value ?? null,
    toValue: input.toField?.value ?? null,
    addedValues: arrayChange?.addedValues || [],
    removedValues: arrayChange?.removedValues || [],
    retainedValues: arrayChange?.retainedValues || [],
    introducedAtVersion: input.toField?.introducedAtVersion || input.fromField?.introducedAtVersion || null,
    lastChangedAtVersion: input.toField?.lastChangedAtVersion || input.fromField?.lastChangedAtVersion || null,
    candidateId: lastChange?.candidateId || null,
    reviewerId: lastChange?.reviewerId || null,
    reason: lastChange?.reason || "",
    sourceProviderType: lastChange?.sourceProviderType || "legacy_unknown",
    sourceModelId: lastChange?.sourceModelId || null,
    sourceRefs: input.includeSources ? (lastChange?.sourceRefs || []) : [],
  };
}

function entityGroups(fieldDiffs: JsonRecord[]) {
  const groups = new Map<string, JsonRecord>();
  for (const diff of fieldDiffs) {
    const key = `${diff.entityType}:${diff.entityId}`;
    const group = groups.get(key) || {
      entityType: diff.entityType,
      entityId: diff.entityId,
      entityDisplayName: diff.entityDisplayName,
      changedFieldCount: 0,
      operations: {} as Record<string, number>,
      fieldPaths: [] as string[],
    };
    group.changedFieldCount = Number(group.changedFieldCount || 0) + 1;
    const operations = asRecord(group.operations);
    operations[String(diff.operation || "updated")] = Number(operations[String(diff.operation || "updated")] || 0) + 1;
    group.operations = operations;
    group.fieldPaths = [...asArray<string>(group.fieldPaths), String(diff.fieldPath || "")].filter(Boolean);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function countOperation(fieldDiffs: JsonRecord[], operation: string) {
  return fieldDiffs.filter((diff) => diff.operation === operation).length;
}

function diffSummary(fieldDiffs: JsonRecord[], direction: string) {
  const affectedEntities = new Set(fieldDiffs.map((diff) => `${diff.entityType}:${diff.entityId}`));
  return {
    direction,
    affectedEntityCount: affectedEntities.size,
    affectedFieldCount: fieldDiffs.length,
    createdCount: countOperation(fieldDiffs, "created"),
    updatedCount: countOperation(fieldDiffs, "updated"),
    appendedCount: countOperation(fieldDiffs, "appended"),
    removedCount: countOperation(fieldDiffs, "removed"),
    deletedCount: countOperation(fieldDiffs, "deleted"),
    supersededCount: countOperation(fieldDiffs, "superseded"),
    restoredCount: countOperation(fieldDiffs, "restored"),
    unchangedCount: countOperation(fieldDiffs, "unchanged"),
  };
}

async function buildDiff(query: DiffQuery) {
  const versions = await readVersions(query.projectId);
  if (versions.length === 0) {
    throw new StoryBibleDiffError("VERSION_NOT_FOUND", "No Story Bible versions exist for this project.", 404, {
      projectIdHash: hashProject(query.projectId),
      retryable: false,
    });
  }
  const fromVersion = resolveVersion(versions, query.fromVersion, "fromVersion");
  const toVersion = resolveVersion(versions, query.toVersion, "toVersion");
  const fromNumber = versionNumber(fromVersion);
  const toNumber = versionNumber(toVersion);
  if (fromNumber < 0 || toNumber < 0) {
    throw new StoryBibleDiffError("VERSION_RANGE_INVALID", "Version range is invalid.", 400, { retryable: false });
  }
  const sources = query.includeSources ? await readSources(query.projectId) : [];
  const fromState = reconstructStateFromVersions(versions, fromNumber, sources).state;
  const toState = reconstructStateFromVersions(versions, toNumber, sources).state;
  const keys = new Set([...fromState.keys(), ...toState.keys()]);
  const fieldDiffs = [...keys].sort().flatMap((key) => {
    const fromField = fromState.get(key);
    const toField = toState.get(key);
    const field = toField || fromField;
    if (!field || !fieldPassesFilters(field, query)) return [];
    const diff = makeFieldDiff({ key, fromField, toField, includeSources: query.includeSources });
    if (!diff) return [];
    if (diff.operation === "unchanged" && !query.includeUnchanged) return [];
    return [diff];
  });
  const direction = fromNumber === toNumber ? "same" : fromNumber < toNumber ? "forward" : "backward";
  const summary = diffSummary(fieldDiffs, direction);
  return {
    projectId: query.projectId,
    fromVersionNumber: fromNumber,
    toVersionNumber: toNumber,
    fromVersionId: fromVersion.id,
    toVersionId: toVersion.id,
    direction,
    summary,
    affectedEntityCount: summary.affectedEntityCount,
    affectedFieldCount: summary.affectedFieldCount,
    createdCount: summary.createdCount,
    updatedCount: summary.updatedCount,
    appendedCount: summary.appendedCount,
    removedCount: summary.removedCount,
    deletedCount: summary.deletedCount,
    supersededCount: summary.supersededCount,
    restoredCount: summary.restoredCount,
    unchangedCount: summary.unchangedCount,
    fieldDiffs,
    entityGroups: entityGroups(fieldDiffs),
    warnings: [
      ...(query.allowUnsafeRead ? ["unsafe read was explicitly requested; diff output is untrusted"] : []),
      ...(direction === "same" && !query.includeUnchanged ? ["same-version diff returns no changed fields unless includeUnchanged=true"] : []),
    ],
    integrityVerified: query.allowUnsafeRead ? "unsafe_untrusted" : "checked",
  };
}

export async function getStoryBibleVersionDiff(input: unknown) {
  const query = VersionDiffQuerySchema.parse(input);
  if (!query.allowUnsafeRead) {
    const fromNumber = /^\d+$/.test(query.fromVersion) ? Number(query.fromVersion) : undefined;
    const toNumber = /^\d+$/.test(query.toVersion) ? Number(query.toVersion) : undefined;
    const check = await verifyVersionChain({
      projectId: query.projectId,
      fromVersion: fromNumber != null && toNumber != null ? Math.min(fromNumber, toNumber) : fromNumber,
      toVersion: fromNumber != null && toNumber != null ? Math.max(fromNumber, toNumber) : toNumber,
      includeDetails: false,
    });
    if (!check.valid) {
      throw new StoryBibleDiffError("VERSION_INTEGRITY_FAILED", "Story Bible integrity check failed; diff is blocked until the version chain is repaired or backfilled.", 409, {
        firstInvalidVersion: check.firstInvalidVersion,
        integritySchemaVersion: check.integritySchemaVersion,
        retryable: true,
      });
    }
  }
  return buildDiff(query);
}

function riskFor(currentNumber: number, targetNumber: number, fieldDiffs: JsonRecord[]) {
  if (currentNumber === targetNumber) return "low";
  const hasIdentityOrStatus = fieldDiffs.some((diff) => /lifeStatus|status|currentOwner|currentLocation|immutable/.test(String(diff.fieldPath || "")));
  const distance = Math.abs(currentNumber - targetNumber);
  if (hasIdentityOrStatus && distance >= 3) return "blocking";
  if (hasIdentityOrStatus) return "high";
  if (distance >= 5) return "high";
  if (distance >= 2) return "medium";
  return "low";
}

export async function getStoryBibleCurrentDiff(versionId: string, input: unknown) {
  const query = CurrentDiffQuerySchema.parse(input);
  const versions = await readVersions(query.projectId);
  if (versions.length === 0) throw new StoryBibleDiffError("VERSION_NOT_FOUND", "No Story Bible versions exist for this project.", 404);
  const target = resolveVersion(versions, versionId, "targetVersion");
  const current = versions[versions.length - 1];
  const diff = await buildDiff({
    projectId: query.projectId,
    fromVersion: String(target.id),
    toVersion: String(current.id),
    entityType: query.entityType,
    entityId: query.entityId,
    includeUnchanged: false,
    includeSources: query.includeSources,
    allowUnsafeRead: true,
  });
  return {
    projectId: query.projectId,
    targetVersion: versionSummary(target),
    currentVersion: versionSummary(current),
    fieldDiffs: diff.fieldDiffs,
    affectedEntities: diff.entityGroups,
    dependentChanges: diff.fieldDiffs.filter((field: JsonRecord) => /status|currentOwner|currentLocation|immutable|lifeStatus/.test(String(field.fieldPath || ""))),
    potentialConflicts: diff.fieldDiffs.filter((field: JsonRecord) => field.operation === "deleted" || /status|immutable/.test(String(field.fieldPath || ""))).map((field: JsonRecord) => ({
      entityType: field.entityType,
      entityId: field.entityId,
      fieldPath: field.fieldPath,
      reason: "Potential risk if this version is used as a revert target.",
    })),
    revertRisk: riskFor(Number(current.version_number || 0), Number(target.version_number || 0), diff.fieldDiffs),
    integrityVerified: "not_checked",
    warnings: ["P0-C2C2A only estimates revert risk; it does not execute revert or verify integrity."],
  };
}

