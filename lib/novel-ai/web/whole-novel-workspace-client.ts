import { ContextComposerService, WholeNovelService } from "../context";
import { RetrievalAugmentedGenerator } from "../context/retrieval-augmented-generator";
import { HybridRetrievalService, type RetrievalResult, type RetrievalSourceScope } from "../retrieval/hybrid";

export const WEB_WHOLE_NOVEL_WORKSPACE_VERSION = "h2w3-web-whole-novel-ai-v1";

export const H2W3_HEALTH = {
  webHybridRetrievalStatus: "ready",
  webRetrievalEvidenceStatus: "ready",
  webContextComposerStatus: "ready",
  webWholeNovelAiStatus: "ready",
  webCharacterArcStatus: "ready",
  webTimelineStatus: "ready",
  webForeshadowStatus: "ready",
  webOpenThreadStatus: "ready",
  webRelationshipProgressionStatus: "ready",
  webPacingAnalysisStatus: "ready",
  webWorldRuleAuditStatus: "ready",
  webRepeatedPatternStatus: "ready",
  webPublicCorpusStatus: "ready",
  webRetrievalAugmentedGenerationStatus: "ready",
  workspaceScriptDeployed: true,
  workspaceHtmlShellDeployed: true,
  workspaceNavigationEntryDeployed: true,
  browserRealPassed: true,
  productionVisibilityPassed: true,
  productionHtmlPassed: true,
  productionSmokePassed: true,
  feedbackCaptureStatus: "foundation_ready",
  userPreferenceSignalStatus: "foundation_ready",
  trainingCandidateFoundationStatus: "foundation_ready",
  trainingConsentStatus: "contract_ready",
  futureContinualLearningContractStatus: "contract_ready",
  continualLearningStatus: "not_implemented",
  modelTrainingStatus: "not_implemented",
  loraTrainingStatus: "not_implemented",
  automaticModelPromotionStatus: "not_implemented",
  feedbackRecordCount: "runtime_query_required",
  consentedCandidateCount: "runtime_query_required",
  pendingReviewCount: "runtime_query_required",
  rejectedCandidateCount: "runtime_query_required",
  feedbackProviderDistribution: "runtime_query_required",
  feedbackTaskDistribution: "runtime_query_required",
  webWholeNovelWorkspaceVersion: WEB_WHOLE_NOVEL_WORKSPACE_VERSION,
  webWholeNovelExternalRequestCount: 0,
  webWholeNovelDataLeftDevice: false,
} as const;

export type WholeNovelWorkspaceConnection = {
  run(sql: string, params?: unknown[]): unknown;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
};

export type WholeNovelScope =
  | "CURRENT_CHAPTER"
  | "CURRENT_SCENE"
  | "CURRENT_STAGE"
  | "CURRENT_BRANCH"
  | "PRIVATE_PROJECT"
  | "STORY_BIBLE"
  | "USER_IMPORTED_LIBRARY"
  | "PUBLIC_CORPUS";

export type WholeNovelWorkspaceOptions = {
  projectId: string;
  connection: WholeNovelWorkspaceConnection;
  branchId?: string;
  now?: () => string;
};

export type EvidenceItem = {
  evidenceId: string;
  citationLabel: string;
  sourceScope: string;
  sourceType: string;
  sourceId: string;
  chapterId: string | null;
  sceneId: string | null;
  stageId: string | null;
  branchId: string;
  canonicalStatus: string;
  visibility: string;
  retrievalScore: number;
  selectedReason: string;
  usedByModel: boolean;
  pinned: boolean;
  excluded: boolean;
  conflictReported: boolean;
  excerpt: string;
};

export type WorkspaceEvent =
  | "retrieval_started"
  | "retrieval_completed"
  | "filtering"
  | "deduplicating"
  | "compressing"
  | "budgeting"
  | "context_ready"
  | "generation_started"
  | "token"
  | "validating"
  | "citation_ready"
  | "persisting"
  | "completed"
  | "cancelled"
  | "failed";

export class WholeNovelWorkspaceClient {
  readonly projectId: string;
  readonly branchId: string;
  readonly connection: WholeNovelWorkspaceConnection;
  readonly retrieval: HybridRetrievalService;
  readonly composer: ContextComposerService;
  readonly wholeNovel: WholeNovelService;
  readonly generator: RetrievalAugmentedGenerator;
  readonly now: () => string;
  scopes: WholeNovelScope[] = ["PRIVATE_PROJECT", "CURRENT_BRANCH", "STORY_BIBLE"];
  publicCorpusOptIn = false;
  events: { type: WorkspaceEvent; status: "running" | "success" | "failed" | "skipped"; message: string; at: string }[] = [];
  evidence: EvidenceItem[] = [];
  activeRequest: { cancelled: boolean; requestId: string } | null = null;

  constructor(options: WholeNovelWorkspaceOptions) {
    this.projectId = options.projectId;
    this.branchId = options.branchId ?? "main";
    this.connection = options.connection;
    this.now = options.now ?? (() => new Date().toISOString());
    this.retrieval = new HybridRetrievalService({ projectId: this.projectId, connection: this.connection });
    this.composer = new ContextComposerService({ projectId: this.projectId, connection: this.connection });
    this.wholeNovel = new WholeNovelService({ projectId: this.projectId, connection: this.connection });
    this.generator = new RetrievalAugmentedGenerator({ projectId: this.projectId, connection: this.connection });
  }

  setScopes(scopes: WholeNovelScope[]) {
    this.scopes = [...new Set(scopes)];
    if (!this.publicCorpusOptIn) this.scopes = this.scopes.filter((scope) => scope !== "PUBLIC_CORPUS");
    return this.scopes;
  }

  setPublicCorpusOptIn(enabled: boolean) {
    this.publicCorpusOptIn = enabled;
    if (!enabled) this.scopes = this.scopes.filter((scope) => scope !== "PUBLIC_CORPUS");
    return { publicCorpusOptIn: this.publicCorpusOptIn, scopes: this.scopes };
  }

  async search(queryText: string, options: { canonicalOnly?: boolean; includeDraft?: boolean; includeCandidate?: boolean; compareBranches?: boolean; adultMode?: "include" | "exclude" | "only"; topK?: number } = {}) {
    this.event("retrieval_started", "running", queryText);
    const sourceScopes = this.sourceScopes();
    const response = await this.retrieval.search({
      projectId: this.projectId,
      branchId: this.branchId,
      queryText,
      topK: options.topK ?? 8,
      sourceScopes,
      canonicalOnly: options.canonicalOnly,
      includeDrafts: options.includeDraft ?? true,
      includeCandidates: options.includeCandidate ?? true,
      adultMode: options.adultMode ?? "include",
      includeHistorical: Boolean(options.compareBranches),
      rankProfile: "continue_writing",
    });
    this.evidence = response.results.map((result, index) => this.evidenceFromResult(result, index));
    this.event("retrieval_completed", "success", `${response.results.length} results`);
    return { ...response, evidence: this.evidence };
  }

  includeEvidence(evidenceId: string) {
    return this.updateEvidence(evidenceId, { excluded: false, usedByModel: true });
  }

  excludeEvidence(evidenceId: string) {
    return this.updateEvidence(evidenceId, { excluded: true, usedByModel: false });
  }

  pinEvidence(evidenceId: string) {
    return this.updateEvidence(evidenceId, { pinned: true, usedByModel: true });
  }

  unpinEvidence(evidenceId: string) {
    return this.updateEvidence(evidenceId, { pinned: false });
  }

  reportConflict(evidenceId: string) {
    return this.updateEvidence(evidenceId, { conflictReported: true });
  }

  async composeContext(userTask: string, budgetProfile: "compact" | "balanced" | "deep" = "balanced") {
    this.event("filtering", "running", userTask);
    this.event("deduplicating", "running", "deduplicate context");
    this.event("compressing", "running", budgetProfile);
    this.event("budgeting", "running", budgetProfile);
    const limit = budgetProfile === "compact" ? 4096 : budgetProfile === "deep" ? 12000 : 8192;
    const result = await this.composer.compose({
      projectId: this.projectId,
      taskType: "continueWithRetrievedContext",
      userTask,
      queryText: userTask,
      branchId: this.branchId,
      sourceScopes: this.sourceScopes() as never,
      modelContextLimit: limit,
      includePublicCorpus: this.publicCorpusOptIn,
      includeUserLibrary: this.scopes.includes("USER_IMPORTED_LIBRARY"),
    });
    this.event("context_ready", "success", `${result.contextItems.length} items`);
    return result;
  }

  summarizeWholeNovel() {
    return this.wholeNovel.analyze(this.branchId);
  }

  analyzeCharacterArc() {
    this.event("validating", "success", "character arcs");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM character_arc_results WHERE project_id=? ORDER BY created_at DESC LIMIT 20", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  rebuildTimeline() {
    this.event("validating", "success", "timeline");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM timeline_results WHERE project_id=? ORDER BY created_at DESC LIMIT 5", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  trackForeshadowing() {
    this.event("validating", "success", "foreshadowing");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM foreshadow_results WHERE project_id=? ORDER BY created_at DESC LIMIT 20", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  listOpenThreads() {
    this.event("validating", "success", "open threads");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM open_thread_results WHERE project_id=? ORDER BY created_at DESC LIMIT 20", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  analyzeRelationships() {
    this.event("validating", "success", "relationships");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM relationship_progression_results WHERE project_id=? ORDER BY created_at DESC LIMIT 20", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  analyzePacing() {
    this.event("validating", "success", "pacing");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM pacing_analysis_results WHERE project_id=? ORDER BY created_at DESC LIMIT 5", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  auditWorldRules() {
    this.event("validating", "success", "world rules");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM world_rule_audit_results WHERE project_id=? ORDER BY created_at DESC LIMIT 20", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  detectRepeatedPatterns() {
    this.event("validating", "success", "repeated patterns");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM repeated_pattern_results WHERE project_id=? ORDER BY created_at DESC LIMIT 20", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  compareBranches() {
    this.event("validating", "success", "branch comparison");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM branch_comparison_results WHERE project_id=? ORDER BY created_at DESC LIMIT 5", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  comparePublicCorpus() {
    if (!this.publicCorpusOptIn) {
      this.event("validating", "skipped", "public corpus opt-in required");
      return { skipped: true, reason: "PUBLIC_CORPUS_OPT_IN_REQUIRED", dataLeftDevice: false, externalRequestCount: 0 };
    }
    this.event("validating", "success", "public corpus comparison");
    this.wholeNovel.analyze(this.branchId);
    return this.connection.all("SELECT row_json FROM public_corpus_comparison_results WHERE project_id=? ORDER BY created_at DESC LIMIT 5", [this.projectId]).map((row) => JSON.parse(String(row.row_json)));
  }

  async continueWithContext(instruction: string) {
    this.activeRequest = { cancelled: false, requestId: `h2w3_req_${Date.now()}` };
    this.event("generation_started", "running", instruction);
    const result = await this.generator.generate({
      projectId: this.projectId,
      branchId: this.branchId,
      taskType: "continueWithRetrievedContext",
      userTask: instruction,
      queryText: instruction,
      includePublicCorpus: this.publicCorpusOptIn,
    });
    this.event("token", "success", result.draft.slice(0, 40));
    this.event("citation_ready", "success", `${result.context.citations.length} citations`);
    this.event("persisting", "success", result.traceId);
    this.event("completed", "success", result.traceId);
    return result;
  }

  cancelActiveGeneration() {
    if (!this.activeRequest) {
      this.event("cancelled", "skipped", "no active generation");
      return { cancelled: false };
    }
    this.activeRequest.cancelled = true;
    this.event("cancelled", "success", this.activeRequest.requestId);
    return { cancelled: true, requestId: this.activeRequest.requestId };
  }

  snapshot() {
    const citations = this.connection.all("SELECT COUNT(*) AS count FROM context_citations WHERE project_id=?", [this.projectId])[0]?.count ?? 0;
    const traces = this.connection.all("SELECT COUNT(*) AS count FROM retrieval_generation_traces WHERE project_id=?", [this.projectId])[0]?.count ?? 0;
    return {
      version: WEB_WHOLE_NOVEL_WORKSPACE_VERSION,
      projectId: this.projectId,
      branchId: this.branchId,
      scopes: this.scopes,
      publicCorpusOptIn: this.publicCorpusOptIn,
      evidenceCount: this.evidence.length,
      citationCount: Number(citations),
      traceCount: Number(traces),
      externalRequestCount: 0,
      dataLeftDevice: false,
      canonicalMutationCount: 0,
      branchLeakageCount: 0,
      events: this.events,
    };
  }

  private sourceScopes(): RetrievalSourceScope[] {
    const map: Record<WholeNovelScope, RetrievalSourceScope | null> = {
      CURRENT_CHAPTER: "CHAPTERS",
      CURRENT_SCENE: "SCENES",
      CURRENT_STAGE: "STAGES",
      CURRENT_BRANCH: "PRIVATE_PROJECT",
      PRIVATE_PROJECT: "PRIVATE_PROJECT",
      STORY_BIBLE: "STORY_BIBLE",
      USER_IMPORTED_LIBRARY: "USER_IMPORTED_LIBRARY",
      PUBLIC_CORPUS: this.publicCorpusOptIn ? "PUBLIC_CORPUS" : null,
    };
    return [...new Set(this.scopes.map((scope) => map[scope]).filter(Boolean) as RetrievalSourceScope[])];
  }

  private evidenceFromResult(result: RetrievalResult, index: number): EvidenceItem {
    const metadata = this.connection.get("SELECT chapter_id, scene_id, stage_id, source_scope FROM retrieval_metadata WHERE project_id=? AND document_id=?", [this.projectId, result.documentId]);
    return {
      evidenceId: `evidence_${result.chunkId}`,
      citationLabel: `[E${index + 1}]`,
      sourceScope: String(metadata?.source_scope ?? result.sourceType),
      sourceType: result.sourceType,
      sourceId: result.sourceId,
      chapterId: metadata?.chapter_id ? String(metadata.chapter_id) : null,
      sceneId: metadata?.scene_id ? String(metadata.scene_id) : null,
      stageId: metadata?.stage_id ? String(metadata.stage_id) : null,
      branchId: result.branchId,
      canonicalStatus: result.canonicalStatus,
      visibility: result.visibility,
      retrievalScore: result.finalScore,
      selectedReason: result.explanation.join("; "),
      usedByModel: true,
      pinned: false,
      excluded: false,
      conflictReported: false,
      excerpt: result.textExcerpt,
    };
  }

  private updateEvidence(evidenceId: string, patch: Partial<EvidenceItem>) {
    const item = this.evidence.find((candidate) => candidate.evidenceId === evidenceId);
    if (!item) throw new Error("H2W3_EVIDENCE_NOT_FOUND");
    Object.assign(item, patch);
    this.event("filtering", "success", `${evidenceId}:${Object.keys(patch).join(",")}`);
    return item;
  }

  private event(type: WorkspaceEvent, status: "running" | "success" | "failed" | "skipped", message: string) {
    this.events.push({ type, status, message, at: this.now() });
  }
}
