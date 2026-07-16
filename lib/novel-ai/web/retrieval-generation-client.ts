import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class RetrievalGenerationClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  continueWithContext(instruction: string) { return this.workspace.continueWithContext(instruction); }
  cancel() { return this.workspace.cancelActiveGeneration(); }
}
