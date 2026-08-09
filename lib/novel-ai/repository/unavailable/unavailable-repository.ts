import type {
  DomainRecord,
  ProjectBundle,
} from "../../domain";
import type {
  ApproveCharacterProposalResult,
  RejectCharacterProposalResult,
} from "../../character-agent/types";
import type {
  ApproveDramaProjectionResult,
  MarkDramaProjectionsStaleResult,
} from "../../drama-os/types";
import type {
  AcceptChoiceTransactionResult,
  ApproveConversationArtifactTransactionResult,
  CommitStudioCandidateTransactionResult,
  NovelRepository,
} from "../contracts";

export class UnavailableNovelRepository implements NovelRepository {
  readonly kind = "unavailable" as const;
  readonly reasonCode: string;

  constructor(reasonCode = "INDEXEDDB_UNAVAILABLE") {
    this.reasonCode = reasonCode;
  }

  isAvailable() {
    return false;
  }

  private fail(): never {
    throw Object.assign(
      new Error(
        "Local canonical storage is unavailable. No in-memory replacement was created.",
      ),
      {
        code: this.reasonCode,
        recoveryAction: "restore_indexeddb_access",
      },
    );
  }

  async get<T extends DomainRecord>(): Promise<T | null> {
    return this.fail();
  }

  async list<T extends DomainRecord>(): Promise<T[]> {
    return this.fail();
  }

  async put<T extends DomainRecord>(): Promise<T> {
    return this.fail();
  }

  async remove(): Promise<void> {
    return this.fail();
  }

  async createProject(): Promise<ProjectBundle> {
    return this.fail();
  }

  async acceptChoiceTransaction(): Promise<AcceptChoiceTransactionResult> {
    return this.fail();
  }

  async commitStudioCandidateTransaction(): Promise<CommitStudioCandidateTransactionResult> {
    return this.fail();
  }

  async approveConversationArtifactTransaction(): Promise<ApproveConversationArtifactTransactionResult> {
    return this.fail();
  }

  async markConversationArtifactApprovedFromExternalCommit(): Promise<ApproveConversationArtifactTransactionResult> {
    return this.fail();
  }

  async saveDramaProjectionTransaction(): Promise<void> {
    return this.fail();
  }

  async approveDramaProjectionTransaction(): Promise<ApproveDramaProjectionResult> {
    return this.fail();
  }

  async markDramaProjectionsStaleTransaction(): Promise<MarkDramaProjectionsStaleResult> {
    return this.fail();
  }

  async approveCharacterProposalTransaction(): Promise<ApproveCharacterProposalResult> {
    return this.fail();
  }

  async rejectCharacterProposalTransaction(): Promise<RejectCharacterProposalResult> {
    return this.fail();
  }

  async listAcceptedChoices(): Promise<never> {
    return this.fail();
  }

  async listStoryBranches(): Promise<never> {
    return this.fail();
  }

  async deleteInteractionsByProject(): Promise<void> {
    return this.fail();
  }

  async exportProject(): Promise<Record<string, unknown[]>> {
    return this.fail();
  }

  async importProject(): Promise<string> {
    return this.fail();
  }
}
