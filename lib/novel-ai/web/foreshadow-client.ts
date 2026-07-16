import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class ForeshadowClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  track() { return this.workspace.trackForeshadowing(); }
}
