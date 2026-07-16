import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class PublicCorpusClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  enable() { return this.workspace.setPublicCorpusOptIn(true); }
  disable() { return this.workspace.setPublicCorpusOptIn(false); }
  compare() { return this.workspace.comparePublicCorpus(); }
}
