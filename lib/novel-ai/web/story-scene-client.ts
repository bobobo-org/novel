export type WebSceneRecord = {
  projectId: string;
  sceneId: string;
  title: string;
  status: "draft" | "planning" | "generating" | "completed" | "archived";
  rating: "general" | "mature" | "adult";
  adultPolicyStatus: "not_applicable" | "verified" | "blocked";
  externalFallbackAllowed: boolean;
  branchId: string;
  mergedContent: string;
  createdAt: string;
  updatedAt: string;
};

export class StorySceneWebClient {
  private scenes = new Map<string, WebSceneRecord>();

  createScene(input: Partial<WebSceneRecord> & { projectId: string; title: string }) {
    const now = new Date().toISOString();
    const scene: WebSceneRecord = {
      projectId: input.projectId,
      sceneId: input.sceneId ?? `web_scene_${Date.now()}_${this.scenes.size + 1}`,
      title: input.title,
      status: input.status ?? "planning",
      rating: input.rating ?? "general",
      adultPolicyStatus: input.adultPolicyStatus ?? "not_applicable",
      externalFallbackAllowed: input.externalFallbackAllowed ?? false,
      branchId: input.branchId ?? "main",
      mergedContent: input.mergedContent ?? "",
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    this.scenes.set(scene.sceneId, scene);
    return scene;
  }

  getScene(sceneId: string) {
    return this.scenes.get(sceneId) ?? null;
  }

  updateScene(sceneId: string, patch: Partial<WebSceneRecord>) {
    const scene = this.getScene(sceneId);
    if (!scene) throw new Error("H2W2_SCENE_NOT_FOUND");
    const updated = { ...scene, ...patch, sceneId, updatedAt: new Date().toISOString() };
    this.scenes.set(sceneId, updated);
    return updated;
  }

  listScenes(projectId?: string) {
    return [...this.scenes.values()].filter((scene) => !projectId || scene.projectId === projectId);
  }
}
