import type { WebVersionRecord } from "./story-version-client";

export type WebBranchRecord = {
  branchId: string;
  sceneId: string;
  name: string;
  status: "active" | "archived";
  createdAt: string;
};

export class StoryBranchWebClient {
  private branches = new Map<string, WebBranchRecord>();

  createBranch(sceneId: string, name = "alternate") {
    const branch: WebBranchRecord = {
      branchId: `web_branch_${name}_${Date.now()}`,
      sceneId,
      name,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    this.branches.set(branch.branchId, branch);
    return branch;
  }

  listBranches() {
    return [...this.branches.values()];
  }

  compareBranches(sourceBranchId: string, targetBranchId: string, versions: WebVersionRecord[]) {
    return {
      sourceBranchId,
      targetBranchId,
      sourceVersionCount: versions.filter((version) => version.branchId === sourceBranchId).length,
      targetVersionCount: versions.filter((version) => version.branchId === targetBranchId).length,
      branchIsolation: sourceBranchId !== targetBranchId,
      canonicalMutation: 0,
      dataLeftDevice: false,
    };
  }
}
