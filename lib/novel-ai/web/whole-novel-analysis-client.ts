import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class WholeNovelAnalysisClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  summarize() { return this.workspace.summarizeWholeNovel(); }
}
