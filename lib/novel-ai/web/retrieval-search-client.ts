import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class RetrievalSearchClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  search(queryText: string, options: Parameters<WholeNovelWorkspaceClient["search"]>[1] = {}) {
    return this.workspace.search(queryText, options);
  }
}
