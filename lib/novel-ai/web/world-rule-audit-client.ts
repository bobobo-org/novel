import type { WholeNovelWorkspaceClient } from "./whole-novel-workspace-client";

export class WorldRuleAuditClient {
  private readonly workspace: WholeNovelWorkspaceClient;
  constructor(workspace: WholeNovelWorkspaceClient) { this.workspace = workspace; }
  audit() { return this.workspace.auditWorldRules(); }
}
