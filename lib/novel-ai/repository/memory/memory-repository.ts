import type { DomainRecord, ProjectBundle } from "../../domain/index";
import { NOVEL_STORES, RevisionConflictError, type NovelRepository, type NovelStoreName } from "../contracts/index";

export class MemoryNovelRepository implements NovelRepository {
  readonly kind = "memory" as const;
  private stores = new Map<NovelStoreName, Map<string, DomainRecord>>(NOVEL_STORES.map((name) => [name, new Map()]));
  private requests = new Map<string, ProjectBundle>();
  isAvailable() { return true; }
  async get<T extends DomainRecord>(store: NovelStoreName, id: string) { return (structuredClone(this.stores.get(store)?.get(id)) as T | undefined) ?? null; }
  async list<T extends DomainRecord>(store: NovelStoreName, projectId?: string) { return [...(this.stores.get(store)?.values() ?? [])].filter((item) => !projectId || item.projectId === projectId).map((item) => structuredClone(item) as T); }
  async put<T extends DomainRecord>(store: NovelStoreName, record: T, expectedRevision?: number) {
    const current = this.stores.get(store)?.get(record.id);
    if (expectedRevision !== undefined && (current?.revision ?? 0) !== expectedRevision) throw new RevisionConflictError(expectedRevision, current?.revision ?? 0);
    const next = { ...record, revision: current ? current.revision + 1 : record.revision, updatedAt: new Date().toISOString(), parentRevision: current?.revision ?? null } as T;
    this.stores.get(store)?.set(next.id, structuredClone(next)); return structuredClone(next);
  }
  async remove(store: NovelStoreName, id: string) { this.stores.get(store)?.delete(id); }
  async createProject(bundle: ProjectBundle, requestId: string) {
    const replay = this.requests.get(requestId); if (replay) return structuredClone(replay);
    if (await this.get("projects", bundle.project.id)) throw new Error("PROJECT_ALREADY_EXISTS");
    const writes: Array<[NovelStoreName, DomainRecord | null]> = [["projects",bundle.project],["projectSeeds",bundle.seed],["storyBibles",bundle.storyBible],["characters",bundle.protagonist],["worlds",bundle.world],["storyStates",bundle.storyState],["tasks",bundle.initialTask],["readerStates",bundle.readerState],["backups",bundle.initialBackup]];
    for (const [store, record] of writes) if (record) await this.put(store, record);
    this.requests.set(requestId, structuredClone(bundle)); return structuredClone(bundle);
  }
  async exportProject(projectId: string) { const output: Record<string, unknown[]> = {}; for (const store of NOVEL_STORES) output[store] = await this.list(store, projectId); return output; }
}
