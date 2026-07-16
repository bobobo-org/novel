import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class CharacterArcClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  analyze() { return this.workspace.analyzeCharacterArc(); }
}
