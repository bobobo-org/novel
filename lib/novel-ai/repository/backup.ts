import type { BackupManifest, DomainRecord, ProjectBackup } from "../domain";
import { makeRecord } from "../domain";
import type { NovelRepository } from "./contracts";

export type BackupPayload = { manifest: BackupManifest; records: Record<string, unknown[]> };

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, "0")).join("");
  }
  return `fallback-${bytes.length}-${value.slice(0, 24)}`;
}

export async function createProjectBackup(repository: NovelRepository, projectId: string, kind: ProjectBackup["kind"], release: { appCommit?: string | null; releaseTag?: string | null } = {}) {
  const records = await repository.exportProject(projectId);
  // A backup is a recovery point, not a recursive archive of earlier recovery points.
  // Keeping nested snapshots would grow exponentially with every backup.
  records.backups = [];
  const body = stableStringify(records);
  const now = new Date().toISOString();
  const manifest: BackupManifest = {
    format: "novel-project-backup", formatVersion: "novel-backup-v3", backupId: crypto.randomUUID(), projectId,
    projectSchemaVersion: "novel-domain-v1", createdAt: now, appCommit: release.appCommit ?? null, releaseTag: release.releaseTag ?? null,
    sourceDevice: "browser", contentHash: await digest(body), recordCounts: Object.fromEntries(Object.entries(records).map(([store, rows]) => [store, rows.length])),
    includedStores: Object.keys(records), compression: "none", encryption: "none",
  };
  const backup: ProjectBackup = { ...makeRecord(projectId, "system"), id: manifest.backupId, formatVersion: "novel-backup-v3", kind, byteSize: new TextEncoder().encode(body).byteLength, snapshot: records, manifest };
  await repository.put("backups", backup);
  return { backup, payload: { manifest, records } satisfies BackupPayload };
}

export async function validateBackupPayload(input: unknown): Promise<{ valid: true; payload: BackupPayload } | { valid: false; reason: string }> {
  if (!input || typeof input !== "object") return { valid: false, reason: "BACKUP_INVALID_FORMAT" };
  const payload = input as BackupPayload;
  if (payload.manifest?.format !== "novel-project-backup" || payload.manifest.formatVersion !== "novel-backup-v3") return { valid: false, reason: "BACKUP_UNSUPPORTED_FORMAT" };
  if (!payload.records || !Array.isArray(payload.records.projects) || payload.records.projects.length !== 1) return { valid: false, reason: "BACKUP_PROJECT_MISSING" };
  const actualHash = await digest(stableStringify(payload.records));
  if (actualHash !== payload.manifest.contentHash) return { valid: false, reason: "BACKUP_HASH_MISMATCH" };
  return { valid: true, payload };
}

export function backupDownload(payload: BackupPayload, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/vnd.novel-project+json" });
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${filename || "novel"}.novel-backup.json`; anchor.click();
  URL.revokeObjectURL(url);
}

export function markdownDownload(records: Record<string, unknown[]>, filename: string) {
  const project = records.projects?.[0] as { title?: string } | undefined;
  const chapters = (records.chapters ?? []) as Array<{ title?: string; order?: number; content?: string }>;
  const markdown = [`# ${project?.title || filename || "未命名作品"}`, "", ...chapters.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).flatMap((chapter) => [`## ${chapter.title || "未命名章節"}`, "", chapter.content || "", ""])].join("\n");
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${filename || "novel"}.md`; anchor.click(); URL.revokeObjectURL(url);
}
