import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class WebContextComposerClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  compose(task: string, budget: "compact" | "balanced" | "deep" = "balanced") {
    return this.workspace.composeContext(task, budget);
  }
}
