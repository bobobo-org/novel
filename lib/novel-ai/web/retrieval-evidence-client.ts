import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class RetrievalEvidenceClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  include(id: string) { return this.workspace.includeEvidence(id); }
  exclude(id: string) { return this.workspace.excludeEvidence(id); }
  pin(id: string) { return this.workspace.pinEvidence(id); }
  unpin(id: string) { return this.workspace.unpinEvidence(id); }
  reportConflict(id: string) { return this.workspace.reportConflict(id); }
}
