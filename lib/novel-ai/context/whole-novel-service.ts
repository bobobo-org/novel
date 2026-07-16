import type { ContextConnection } from "./context-composer-service";
import { summarizeWholeNovel } from "./whole-novel-summary";
import { analyzeCharacterArcs } from "./character-arc-analyzer";
import { reconstructTimeline } from "./timeline-reconstructor";
import { trackForeshadowing } from "./foreshadow-tracker";
import { analyzeOpenThreads } from "./open-thread-analyzer";
import { analyzeRelationshipProgression } from "./relationship-progression-analyzer";
import { analyzePacing } from "./pacing-analyzer";
import { detectRepeatedPatterns } from "./repeated-pattern-detector";
import { auditWorldRules } from "./world-rule-auditor";
import { compareBranches } from "./branch-comparator";
import { comparePublicCorpusStructure } from "./public-corpus-structure-comparator";
import type { WholeNovelAnalysisResult } from "./context-composer-types";

function now() { return new Date().toISOString(); }
function json(value: unknown) { return JSON.stringify(value ?? null); }

export class WholeNovelService {
  readonly projectId: string;
  readonly connection: ContextConnection;
  constructor(options: { projectId: string; connection: ContextConnection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
  }
  analyze(branchId = "main"): WholeNovelAnalysisResult {
    const jobId = `whole_${Date.now()}`;
    const time = now();
    this.connection.run("INSERT INTO whole_novel_analysis_jobs(project_id, job_id, branch_id, analysis_type, status, row_json, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)", [this.projectId, jobId, branchId, "whole_novel", "completed", json({ branchId }), time, time]);
    const summary = summarizeWholeNovel(this.connection, this.projectId, branchId);
    const arcs = analyzeCharacterArcs(this.connection, this.projectId);
    const timeline = reconstructTimeline(this.connection, this.projectId, branchId);
    const foreshadow = trackForeshadowing(this.connection, this.projectId);
    const threads = analyzeOpenThreads(this.connection, this.projectId);
    const relationships = analyzeRelationshipProgression(this.connection, this.projectId);
    const pacing = analyzePacing(this.connection, this.projectId);
    const patterns = detectRepeatedPatterns(this.connection, this.projectId);
    const rules = auditWorldRules(this.connection, this.projectId);
    const branchComparison = compareBranches(this.connection, this.projectId);
    const corpusComparison = comparePublicCorpusStructure(this.connection, this.projectId);
    this.connection.run("INSERT INTO whole_novel_analysis_results(project_id, result_id, job_id, premise, major_arcs_json, major_events_json, unresolved_threads_json, foreshadowing_json, pacing_notes_json, evidence_json, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [this.projectId, `whole_result_${jobId}`, jobId, summary.premise, json(summary.majorArcs), json(summary.majorEvents), json(summary.unresolvedThreads), json(summary.foreshadowing), json(summary.pacingNotes), json(summary.evidence), json(summary), time]);
    for (const arc of arcs) this.connection.run("INSERT INTO character_arc_results(project_id, result_id, job_id, character_id, row_json, created_at) VALUES(?,?,?,?,?,?)", [this.projectId, `arc_${jobId}_${arc.characterId}`, jobId, arc.characterId, json(arc), time]);
    this.connection.run("INSERT INTO timeline_results(project_id, result_id, job_id, row_json, created_at) VALUES(?,?,?,?,?)", [this.projectId, `timeline_${jobId}`, jobId, json(timeline), time]);
    for (const item of foreshadow) this.connection.run("INSERT INTO foreshadow_results(project_id, result_id, job_id, status, row_json, created_at) VALUES(?,?,?,?,?,?)", [this.projectId, `fs_${jobId}_${item.foreshadowId}`, jobId, item.status, json(item), time]);
    for (const item of threads) this.connection.run("INSERT INTO open_thread_results(project_id, result_id, job_id, urgency, row_json, created_at) VALUES(?,?,?,?,?,?)", [this.projectId, `thread_${jobId}_${item.threadId}`, jobId, item.urgency, json(item), time]);
    for (const item of relationships) this.connection.run("INSERT INTO relationship_progression_results(project_id, result_id, job_id, relationship_id, row_json, created_at) VALUES(?,?,?,?,?,?)", [this.projectId, `rel_${jobId}_${item.relationshipId}`, jobId, item.relationshipId, json(item), time]);
    this.connection.run("INSERT INTO pacing_analysis_results(project_id, result_id, job_id, pacing_profile, row_json, created_at) VALUES(?,?,?,?,?,?)", [this.projectId, `pacing_${jobId}`, jobId, pacing.pacingProfile, json(pacing), time]);
    for (const item of patterns) this.connection.run("INSERT INTO repeated_pattern_results(project_id, result_id, job_id, pattern_type, row_json, created_at) VALUES(?,?,?,?,?,?)", [this.projectId, `pattern_${jobId}_${item.patternType}`, jobId, item.patternType, json(item), time]);
    for (const item of rules) this.connection.run("INSERT INTO world_rule_audit_results(project_id, result_id, job_id, severity, row_json, created_at) VALUES(?,?,?,?,?,?)", [this.projectId, `rule_${jobId}_${item.ruleId}`, jobId, item.severity, json(item), time]);
    this.connection.run("INSERT INTO branch_comparison_results(project_id, result_id, job_id, branch_ids_json, row_json, created_at) VALUES(?,?,?,?,?,?)", [this.projectId, `branch_${jobId}`, jobId, json(branchComparison.branchIds), json(branchComparison), time]);
    this.connection.run("INSERT INTO public_corpus_comparison_results(project_id, result_id, job_id, selected_works_json, originality_risks_json, row_json, created_at) VALUES(?,?,?,?,?,?,?)", [this.projectId, `corpus_${jobId}`, jobId, json(corpusComparison.selectedWorks), json(corpusComparison.originalityRisks), json(corpusComparison), time]);
    return {
      jobId,
      ...summary,
      externalRequestCount: 0,
      dataLeftDevice: false,
    };
  }
}
