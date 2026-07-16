import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class OpenThreadClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  list() { return this.workspace.listOpenThreads(); }
}
