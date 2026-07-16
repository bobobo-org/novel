import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class TimelineClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  rebuild() { return this.workspace.rebuildTimeline(); }
}
