import crypto from "crypto";
import { HybridRetrievalService, type RetrievalResult } from "../retrieval/hybrid";
import type { ContextCompositionRequest, ContextCompositionResult, ContextItem } from "./context-composer-types";
import { H2C_POLICY_VERSION } from "./context-composer-types";
import { priorityForContext, sortContextItems } from "./context-priority";
import { estimateContextTokens, buildTokenBudget } from "./context-token-budget";
import { deduplicateContextItems } from "./context-deduplicator";
import { compressContextItem } from "./context-compressor";
import { buildContextCitations } from "./context-citation-builder";
import { filterContextByBranch } from "./context-branch-filter";
import { filterContextByPolicy } from "./context-policy-filter";
import { filterContextByScope } from "./context-scope-filter";
import { filterContextByVisibility } from "./context-visibility-filter";
import { mergeOmissions } from "./context-omission-reporter";
import { detectContextConflicts } from "./context-conflict-detector";
import { validateContextComposition } from "./context-validator";

export type ContextConnection = { run(sql: string, params?: unknown[]): unknown; get(sql: string, params?: unknown[]): Record<string, unknown> | undefined; all(sql: string, params?: unknown[]): Record<string, unknown>[] };

function now() { return new Date().toISOString(); }
function id(prefix: string, seed: unknown) { return `${prefix}_${crypto.createHash("sha256").update(JSON.stringify(seed)).digest("hex").slice(0, 16)}`; }
function json(value: unknown) { return JSON.stringify(value ?? null); }

function sourceScopeFromResult(result: RetrievalResult, connection?: ContextConnection, projectId?: string): ContextItem["sourceScope"] {
  const row = connection?.get("SELECT source_scope FROM retrieval_metadata WHERE project_id=? AND document_id=?", [projectId ?? "", result.documentId]);
  const storedScope = String(row?.source_scope ?? "");
  if (storedScope) return storedScope as ContextItem["sourceScope"];
  if (result.sourceType === "chapter") return "CHAPTERS";
  if (result.sourceType === "scene") return "SCENES";
  if (result.sourceType === "stage") return "STAGES";
  if (result.sourceType === "character" || result.sourceType === "world_rule" || result.sourceType === "event") return "STORY_BIBLE";
  return "PRIVATE_PROJECT";
}

function itemFromRetrieval(projectId: string, jobId: string, result: RetrievalResult, index: number, connection?: ContextConnection): ContextItem {
  const base: ContextItem = {
    contextItemId: id("ctx", { jobId, index, result }),
    sourceScope: sourceScopeFromResult(result, connection, projectId),
    sourceType: result.sourceType,
    sourceId: result.sourceId,
    chunkId: result.chunkId,
    projectId,
    branchId: result.branchId,
    canonicalStatus: result.canonicalStatus,
    visibility: result.visibility,
    retrievalScore: result.finalScore,
    selectedReason: result.explanation.join("; ") || "hybrid retrieval",
    priority: 12,
    tokenCount: estimateContextTokens(result.textExcerpt),
    text: result.textExcerpt,
    citationLabel: `[C${index + 1}]`,
    policyVersion: H2C_POLICY_VERSION,
  };
  return { ...base, priority: priorityForContext(base) };
}

export class ContextComposerService {
  readonly projectId: string;
  readonly connection: ContextConnection;
  readonly retrieval: HybridRetrievalService;

  constructor(options: { projectId: string; connection: ContextConnection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
    this.retrieval = new HybridRetrievalService(options);
  }

  async compose(request: ContextCompositionRequest): Promise<ContextCompositionResult> {
    const branchId = request.branchId ?? "main";
    const jobId = id("context_job", { at: now(), request });
    const time = now();
    this.connection.run("INSERT INTO context_composition_jobs(project_id, job_id, branch_id, task_type, status, policy_version, token_budget_json, row_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [
      this.projectId, jobId, branchId, request.taskType, "running", H2C_POLICY_VERSION, json({ requested: request.modelContextLimit ?? 8192 }), json(request), time, time,
    ]);
    this.connection.run("INSERT INTO context_composition_inputs(project_id, input_id, job_id, source_scope, row_json, created_at) VALUES(?,?,?,?,?,?)", [
      this.projectId, id("context_input", { jobId, request }), jobId, "PRIVATE_PROJECT", json(request), time,
    ]);

    const retrieval = await this.retrieval.search({
      projectId: this.projectId,
      branchId,
      queryText: request.queryText || request.userTask || request.taskType,
      topK: 30,
      includeCandidates: true,
      includeDrafts: true,
      sourceScopes: ["PRIVATE_PROJECT", "STORY_BIBLE", "CHAPTERS", "SCENES", "STAGES", "VERSIONS", "CONSEQUENCE_CANDIDATES", "USER_IMPORTED_LIBRARY", "PUBLIC_CORPUS"],
      rankProfile: request.taskType.includes("consistency") ? "consistency_check" : "continue_writing",
    });

    let items = retrieval.results.map((result, index) => itemFromRetrieval(this.projectId, jobId, result, index, this.connection));
    items = filterContextByScope(items, request.sourceScopes);
    items = filterContextByBranch(items, branchId);
    items = filterContextByVisibility(items);
    items = filterContextByPolicy(items, { includePublicCorpus: request.includePublicCorpus, includeUserLibrary: request.includeUserLibrary });
    const dedup = deduplicateContextItems(items);
    const compressed: ContextItem[] = [];
    const compressionRows: Record<string, unknown>[] = [];
    for (const item of sortContextItems(dedup.deduped)) {
      const result = compressContextItem(item);
      compressed.push(result.item);
      if (result.compression) compressionRows.push(result.compression);
    }
    const budget = buildTokenBudget(compressed, { modelContextLimit: request.modelContextLimit, reservedOutputTokens: request.reservedOutputTokens });
    const selected = budget.selected;
    const usedContextIds = selected.map((item) => item.contextItemId);
    const citations = buildContextCitations(jobId, selected);
    const conflicts = detectContextConflicts(jobId, selected);
    const validation = validateContextComposition(request, selected, usedContextIds);
    const omittedContext = mergeOmissions(dedup.omitted, budget.omitted);

    for (const item of selected) {
      this.connection.run("INSERT INTO context_composition_items(project_id, context_item_id, job_id, source_scope, source_type, source_id, chunk_id, branch_id, version_id, canonical_status, visibility, retrieval_score, selected_reason, priority, token_count, citation_label, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        this.projectId, item.contextItemId, jobId, item.sourceScope, item.sourceType, item.sourceId, item.chunkId ?? null, item.branchId, item.versionId ?? null, item.canonicalStatus, item.visibility, item.retrievalScore, item.selectedReason, item.priority, item.tokenCount, item.citationLabel, json(item), time,
      ]);
    }
    for (const [index, omission] of omittedContext.entries()) {
      this.connection.run("INSERT INTO context_omissions(project_id, omission_id, job_id, source_id, reason, token_count, row_json, created_at) VALUES(?,?,?,?,?,?,?,?)", [this.projectId, id("omission", { jobId, index, omission }), jobId, omission.contextItemId, omission.reason, omission.tokenCount, json(omission), time]);
    }
    for (const [index, citation] of citations.entries()) {
      this.connection.run("INSERT INTO context_citations(project_id, citation_id, job_id, context_item_id, citation_label, source_scope, source_id, evidence_hash, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", [this.projectId, citation.citationId, jobId, citation.contextItemId, citation.citationLabel, citation.sourceScope, citation.sourceId, id("evidence", citation), json(citation), time]);
    }
    for (const [index, conflict] of conflicts.entries()) {
      this.connection.run("INSERT INTO context_conflicts(project_id, context_conflict_id, job_id, conflict_id, competing_items_json, selected_item_id, selection_reason, unresolved, severity, suggested_review, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [this.projectId, conflict.conflictId, jobId, `conflict_${index + 1}`, json(conflict.competingItems), conflict.selectedItem ?? null, conflict.selectionReason, conflict.unresolved ? 1 : 0, conflict.severity, conflict.suggestedReview, json(conflict), time]);
    }
    for (const [index, row] of compressionRows.entries()) {
      this.connection.run("INSERT INTO context_compression_results(project_id, compression_id, job_id, source_item_ids_json, original_token_count, compressed_token_count, compression_method, preserved_facts_json, omitted_facts_json, warnings_json, content_hash, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [this.projectId, id("compression", { jobId, index, row }), jobId, json(row.sourceItemIds), Number(row.originalTokenCount), Number(row.compressedTokenCount), String(row.compressionMethod), json(row.preservedFacts), json(row.omittedFacts), json(row.warnings), String(row.contentHash), json(row), time]);
    }

    this.connection.run("INSERT INTO context_token_budgets(project_id, budget_id, job_id, model_context_limit, reserved_output_tokens, safety_margin, total_available_tokens, used_tokens, omitted_tokens, compressed_tokens, utilization, overflow_prevented, budget_breakdown_json, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
      this.projectId, id("budget", jobId), jobId, request.modelContextLimit ?? 8192, request.reservedOutputTokens ?? 1600, 512, budget.totalAvailableTokens, budget.usedTokens, budget.omittedTokens, budget.compressedTokens, budget.utilization, budget.overflowPrevented ? 1 : 0, json(budget.budgetBreakdown), json(budget), time,
    ]);
    this.connection.run("INSERT INTO context_validation_results(project_id, validation_id, job_id, citation_coverage, unsupported_claim_rate, token_overflow_count, branch_leakage_count, canonical_mutation_count, public_corpus_opt_in_violation_count, warnings_json, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [
      this.projectId, id("validation", jobId), jobId, validation.citationCoverage, validation.unsupportedClaimRate, validation.tokenOverflowCount, validation.branchLeakageCount, validation.canonicalMutationCount, validation.publicCorpusOptInViolationCount, json(validation.warnings), json(validation), time,
    ]);

    const outputText = selected.map((item) => `${item.citationLabel} ${item.text}`).join("\n");
    this.connection.run("INSERT INTO context_composition_outputs(project_id, output_id, job_id, used_context_ids_json, omitted_context_json, source_scopes_json, token_utilization, unsupported_claim_rate, citation_coverage, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
      this.projectId, id("context_output", jobId), jobId, json(usedContextIds), json(omittedContext), json([...new Set(selected.map((item) => item.sourceScope))]), budget.utilization, validation.unsupportedClaimRate, validation.citationCoverage, json({ outputText }), time,
    ]);
    this.connection.run("UPDATE context_composition_jobs SET status=?, updated_at=? WHERE project_id=? AND job_id=?", ["completed", now(), this.projectId, jobId]);

    return {
      jobId,
      projectId: this.projectId,
      branchId,
      contextItems: selected,
      usedContextIds,
      omittedContext,
      citations,
      conflicts: conflicts.map((conflict) => ({ conflictId: conflict.conflictId, severity: conflict.severity, unresolved: conflict.unresolved, selectedItem: conflict.selectedItem, selectionReason: conflict.selectionReason })),
      tokenBudget: {
        totalAvailableTokens: budget.totalAvailableTokens,
        reservedTokens: budget.reservedTokens,
        usedTokens: budget.usedTokens,
        omittedTokens: budget.omittedTokens,
        compressedTokens: budget.compressedTokens,
        utilization: budget.utilization,
        overflowPrevented: budget.overflowPrevented,
        budgetBreakdown: budget.budgetBreakdown,
      },
      validation,
      outputText,
      externalRequestCount: 0,
      dataLeftDevice: false,
    };
  }
}
