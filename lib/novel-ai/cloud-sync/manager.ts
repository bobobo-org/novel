import type { DomainRecord } from "../domain";
import { createProjectBackup } from "../repository/backup";
import { createNovelRepository } from "../repository";
import type { NovelRepository } from "../repository/contracts";
import { validateImportRecords } from "../repository/import-remap";
import { CloudSyncApiClient } from "./api-client";
import { createCloudSyncKey, decryptCloudSnapshot, encryptCloudSnapshot, parseCloudSyncKey } from "./crypto";
import { CLOUD_SYNC_MUTATION_EVENT, CLOUD_SYNC_STATUS_EVENT, type CloudSyncMutationDetail } from "./mutation-events";
import { buildCloudProjectSnapshot } from "./snapshot";
import {
  IndexedDbCloudSyncStore,
  defaultCloudProjectState,
  type CloudSyncStore,
} from "./store";
import {
  CLOUD_SYNC_SCHEMA_VERSION,
  type CloudProjectRemoteSummary,
  type CloudProjectSyncState,
  type CloudSyncConfig,
  type CloudSyncHealth,
  type CloudSyncOutboxEntry,
  type CloudSyncRuntimeStatus,
} from "./types";

export type CloudSyncManagerSnapshot = {
  config: Omit<CloudSyncConfig, "syncKey"> & { hasRecoveryKey: boolean };
  health: CloudSyncHealth | null;
  outboxCount: number;
  projects: CloudProjectSyncState[];
  status: CloudSyncRuntimeStatus;
};

type PullMode = "replace" | "copy";

function errorCode(error: unknown) {
  return String((error as { code?: string })?.code || "CLOUD_SYNC_UNKNOWN_ERROR");
}

function isRetryable(error: unknown) {
  return Boolean((error as { retryable?: boolean })?.retryable ?? true);
}

function retryDelay(attempts: number) {
  return Math.min(5 * 60_000, 2_000 * 2 ** Math.min(7, attempts));
}

export class CloudSyncManager {
  private flushPromise: Promise<void> | null = null;
  private healthSnapshot: CloudSyncHealth | null = null;
  private runtimeStatus: CloudSyncRuntimeStatus = "disabled";
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly repository: NovelRepository;
  readonly store: CloudSyncStore;
  readonly api: CloudSyncApiClient;

  constructor(
    repository: NovelRepository,
    store: CloudSyncStore,
    api: CloudSyncApiClient,
  ) {
    this.repository = repository;
    this.store = store;
    this.api = api;
  }

  async snapshot(): Promise<CloudSyncManagerSnapshot> {
    const [config, outbox, projects] = await Promise.all([
      this.store.getConfig(),
      this.store.listOutbox(),
      this.store.listProjectStates(),
    ]);
    const { syncKey, ...publicConfig } = config;
    return {
      config: {
        ...publicConfig,
        hasRecoveryKey: Boolean(syncKey),
      },
      health: this.healthSnapshot,
      outboxCount: outbox.length,
      projects,
      status: config.enabled ? this.runtimeStatus : "disabled",
    };
  }

  private async emit(status?: CloudSyncRuntimeStatus) {
    if (status) this.runtimeStatus = status;
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(CLOUD_SYNC_STATUS_EVENT, {
      detail: await this.snapshot(),
    }));
  }

  async probe(signal?: AbortSignal) {
    await this.emit("checking");
    try {
      this.healthSnapshot = await this.api.health(signal);
      await this.emit(this.healthSnapshot.status === "ready"
        ? "ready"
        : this.healthSnapshot.status);
    } catch (error) {
      this.healthSnapshot = {
        schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
        status: "degraded",
        provider: "Supabase",
        storageBackend: "private-object-storage",
        encryption: "client-side-aes-gcm",
        canonicalAuthority: "IndexedDB",
        migrationVersion: null,
        retryable: isRetryable(error),
      };
      await this.emit(typeof navigator !== "undefined" && !navigator.onLine
        ? "offline"
        : "degraded");
    }
    return this.healthSnapshot;
  }

  async enable() {
    const previous = await this.store.getConfig();
    const created = !previous.syncKey;
    const now = new Date().toISOString();
    const config: CloudSyncConfig = {
      ...previous,
      schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
      enabled: true,
      autoSync: true,
      syncKey: previous.syncKey ?? createCloudSyncKey(),
      createdAt: previous.createdAt ?? now,
      updatedAt: now,
    };
    await this.store.putConfig(config);
    await this.probe();
    await this.emit(this.healthSnapshot?.status ?? "degraded");
    return { created, recoveryKey: created ? config.syncKey : null };
  }

  async disable() {
    const config = await this.store.getConfig();
    await this.store.putConfig({
      ...config,
      enabled: false,
      updatedAt: new Date().toISOString(),
    });
    await this.emit("disabled");
  }

  async recoveryKey() {
    return (await this.store.getConfig()).syncKey;
  }

  async importRecoveryKey(value: string) {
    parseCloudSyncKey(value);
    const normalizedKey = value.trim();
    const remote = await this.api.list(normalizedKey);
    const now = new Date().toISOString();
    const previous = await this.store.getConfig();
    await this.store.clearSyncState();
    await this.store.putConfig({
      ...previous,
      schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
      enabled: true,
      autoSync: true,
      syncKey: normalizedKey,
      createdAt: previous.createdAt ?? now,
      updatedAt: now,
    });
    for (const project of remote.projects) {
      await this.store.putProjectState({
        ...defaultCloudProjectState(project.projectId),
        status: "conflict",
        remoteRevision: project.revision,
        lastRemoteHash: project.payloadHash,
        conflictRemoteRevision: project.revision,
        conflictRemoteHash: project.payloadHash,
        lastErrorCode: "CLOUD_SYNC_RECOVERY_REVIEW_REQUIRED",
        updatedAt: now,
      });
    }
    await this.emit(remote.projects.length ? "conflict" : "ready");
    return remote.projects;
  }

  async queueProject(projectId: string, options: { forceRemoteRevision?: number } = {}) {
    const config = await this.store.getConfig();
    if (!config.enabled || !config.syncKey) return { queued: false, reason: "disabled" } as const;
    const currentState = await this.store.getProjectState(projectId)
      ?? defaultCloudProjectState(projectId);
    if (currentState.status === "conflict" && options.forceRemoteRevision === undefined) {
      return { queued: false, reason: "conflict" } as const;
    }
    const { snapshot, contentHash } = await buildCloudProjectSnapshot(this.repository, projectId);
    if (
      options.forceRemoteRevision === undefined
      && currentState.lastLocalHash === contentHash
      && currentState.lastRemoteHash
    ) {
      return { queued: false, reason: "unchanged" } as const;
    }
    const envelope = await encryptCloudSnapshot(snapshot, config.syncKey);
    if (envelope.encryptedBytes > 2_700_000) {
      throw Object.assign(new Error("作品加密後超過目前單次雲端快照上限，請先下載本機備份。"), {
        code: "CLOUD_SYNC_PAYLOAD_TOO_LARGE",
        retryable: false,
      });
    }
    const now = new Date().toISOString();
    await this.store.deleteProjectOutbox(projectId);
    const entry: CloudSyncOutboxEntry = {
      operationId: `sync:${crypto.randomUUID()}`,
      projectId,
      envelope,
      localContentHash: contentHash,
      expectedRemoteRevision: options.forceRemoteRevision ?? currentState.remoteRevision,
      state: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
      lastErrorCode: null,
    };
    await this.store.putOutbox(entry);
    await this.store.putProjectState({
      ...currentState,
      status: "syncing",
      lastErrorCode: null,
      updatedAt: now,
    });
    await this.emit("syncing");
    return { queued: true, operationId: entry.operationId } as const;
  }

  scheduleProject(projectId: string) {
    const previous = this.debounceTimers.get(projectId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(projectId);
      void this.queueProject(projectId)
        .then(() => this.flush())
        .catch(async (error) => {
          const state = await this.store.getProjectState(projectId)
            ?? defaultCloudProjectState(projectId);
          await this.store.putProjectState({
            ...state,
            status: "degraded",
            lastErrorCode: errorCode(error),
            updatedAt: new Date().toISOString(),
          });
          await this.emit("degraded");
        });
    }, 900);
    this.debounceTimers.set(projectId, timer);
  }

  async syncAll() {
    const projects = await this.repository.list<DomainRecord>("projects");
    for (const project of projects) await this.queueProject(project.id);
    await this.flush();
  }

  flush() {
    if (!this.flushPromise) {
      this.flushPromise = this.flushInternal().finally(() => {
        this.flushPromise = null;
      });
    }
    return this.flushPromise;
  }

  private async flushInternal() {
    const config = await this.store.getConfig();
    if (!config.enabled || !config.syncKey) return;
    const health = await this.probe();
    if (!health || health.status !== "ready") return;
    const now = Date.now();
    const outbox = (await this.store.listOutbox())
      .filter((entry) => entry.state !== "conflict" && Date.parse(entry.nextAttemptAt) <= now)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    for (const entry of outbox) {
      try {
        const result = await this.api.push(config.syncKey, {
          operationId: entry.operationId,
          projectId: entry.projectId,
          expectedRemoteRevision: entry.expectedRemoteRevision,
          envelope: entry.envelope,
        });
        const state = await this.store.getProjectState(entry.projectId)
          ?? defaultCloudProjectState(entry.projectId);
        if (result.status === "conflict") {
          await this.store.putOutbox({
            ...entry,
            state: "conflict",
            updatedAt: new Date().toISOString(),
            lastErrorCode: "CLOUD_SYNC_REVISION_CONFLICT",
          });
          await this.store.putProjectState({
            ...state,
            status: "conflict",
            remoteRevision: result.revision,
            lastRemoteHash: result.payloadHash,
            conflictRemoteRevision: result.revision,
            conflictRemoteHash: result.payloadHash,
            lastErrorCode: "CLOUD_SYNC_REVISION_CONFLICT",
            updatedAt: new Date().toISOString(),
          });
          await this.emit("conflict");
          continue;
        }
        await this.store.deleteOutbox(entry.operationId);
        await this.store.putProjectState({
          ...state,
          status: "synced",
          remoteRevision: result.revision,
          lastLocalHash: entry.localContentHash,
          lastRemoteHash: result.payloadHash,
          lastSyncedAt: result.updatedAt,
          conflictRemoteRevision: null,
          conflictRemoteHash: null,
          lastErrorCode: null,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        const attempts = entry.attempts + 1;
        const code = errorCode(error);
        const retryable = isRetryable(error);
        await this.store.putOutbox({
          ...entry,
          state: retryable ? "retry" : "conflict",
          attempts,
          nextAttemptAt: new Date(Date.now() + retryDelay(attempts)).toISOString(),
          updatedAt: new Date().toISOString(),
          lastErrorCode: code,
        });
        const state = await this.store.getProjectState(entry.projectId)
          ?? defaultCloudProjectState(entry.projectId);
        await this.store.putProjectState({
          ...state,
          status: retryable ? "degraded" : "conflict",
          lastErrorCode: code,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    const remaining = await this.store.listOutbox();
    await this.emit(remaining.some((entry) => entry.state === "conflict")
      ? "conflict"
      : remaining.length
        ? "degraded"
        : "synced");
  }

  async listRemoteProjects(): Promise<CloudProjectRemoteSummary[]> {
    const config = await this.store.getConfig();
    if (!config.syncKey) return [];
    return (await this.api.list(config.syncKey)).projects;
  }

  async pullProject(projectId: string, mode: PullMode) {
    const config = await this.store.getConfig();
    if (!config.syncKey) throw Object.assign(new Error("尚未設定同步復原金鑰。"), {
      code: "CLOUD_SYNC_AUTH_REQUIRED",
    });
    const remote = await this.api.pull(config.syncKey, projectId);
    const snapshot = await decryptCloudSnapshot(remote.envelope, config.syncKey);
    validateImportRecords(snapshot.records);
    const local = await this.repository.get<DomainRecord>("projects", projectId);
    if (mode === "replace" && local) {
      await createProjectBackup(this.repository, projectId, "safety");
    }
    const importedProjectId = await this.repository.importProject(
      snapshot.records,
      local ? mode : "replace",
      local && mode === "replace" ? projectId : undefined,
    );
    const state = await this.store.getProjectState(projectId)
      ?? defaultCloudProjectState(projectId);
    await this.store.deleteProjectOutbox(projectId);
    await this.store.putProjectState({
      ...state,
      status: "synced",
      remoteRevision: remote.revision,
      lastLocalHash: mode === "replace" || !local ? snapshot.contentHash : state.lastLocalHash,
      lastRemoteHash: remote.payloadHash,
      lastSyncedAt: remote.updatedAt,
      conflictRemoteRevision: null,
      conflictRemoteHash: null,
      lastErrorCode: null,
      updatedAt: new Date().toISOString(),
    });
    await this.emit("synced");
    return { importedProjectId, remoteRevision: remote.revision };
  }

  async keepLocal(projectId: string) {
    const state = await this.store.getProjectState(projectId);
    if (!state?.conflictRemoteRevision) {
      throw Object.assign(new Error("這部作品目前沒有待解決的同步衝突。"), {
        code: "CLOUD_SYNC_CONFLICT_NOT_FOUND",
      });
    }
    await this.store.deleteProjectOutbox(projectId);
    await this.queueProject(projectId, { forceRemoteRevision: state.conflictRemoteRevision });
    await this.flush();
  }
}

let browserManager: CloudSyncManager | null = null;

export function getCloudSyncManager() {
  if (!browserManager) {
    browserManager = new CloudSyncManager(
      createNovelRepository(),
      new IndexedDbCloudSyncStore(),
      new CloudSyncApiClient(),
    );
  }
  return browserManager;
}

export function startCloudSyncRuntime(manager = getCloudSyncManager()) {
  if (typeof window === "undefined") return () => undefined;
  let active = true;
  const mutation = (event: Event) => {
    const detail = (event as CustomEvent<CloudSyncMutationDetail>).detail;
    if (detail?.projectId) manager.scheduleProject(detail.projectId);
  };
  const online = () => void manager.flush();
  const visible = () => {
    if (document.visibilityState === "visible") void manager.flush();
  };
  window.addEventListener(CLOUD_SYNC_MUTATION_EVENT, mutation);
  window.addEventListener("online", online);
  document.addEventListener("visibilitychange", visible);
  const initial = window.setTimeout(() => {
    if (!active) return;
    void manager.snapshot().then((state) => {
      if (state.config.enabled && state.config.autoSync) return manager.syncAll();
    }).catch(() => undefined);
  }, 1_500);
  const interval = window.setInterval(() => void manager.flush(), 45_000);
  return () => {
    active = false;
    window.clearTimeout(initial);
    window.clearInterval(interval);
    window.removeEventListener(CLOUD_SYNC_MUTATION_EVENT, mutation);
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visible);
  };
}
