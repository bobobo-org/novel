import type { NovelRepository } from "../repository/contracts";
import { projectNovelToDrama } from "./drama-projector";
import { stableStringify, sha256 } from "./ids";
import type { ApproveDramaProjectionInput, DramaProjectionInput, DramaProjectionPackage, MarkDramaProjectionsStaleInput } from "./types";

export class DramaOsService {
  private readonly repository: NovelRepository;

  constructor(repository: NovelRepository) {
    this.repository = repository;
  }

  async project(input: DramaProjectionInput): Promise<DramaProjectionPackage> {
    const result = await projectNovelToDrama(input);
    await this.repository.saveDramaProjectionTransaction(result);
    return result;
  }

  async fingerprint(dramaProjectId: string): Promise<string> {
    const project = await this.repository.get("dramaProjects", dramaProjectId);
    return sha256(stableStringify(project));
  }

  async approve(input: ApproveDramaProjectionInput) {
    return this.repository.approveDramaProjectionTransaction(input);
  }

  async markStale(input: MarkDramaProjectionsStaleInput) {
    return this.repository.markDramaProjectionsStaleTransaction(input);
  }
}
