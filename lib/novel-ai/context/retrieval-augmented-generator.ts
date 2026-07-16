import type { ContextCompositionRequest } from "./context-composer-types";
import { ContextComposerService, type ContextConnection } from "./context-composer-service";

export class RetrievalAugmentedGenerator {
  readonly composer: ContextComposerService;
  readonly connection: ContextConnection;
  readonly projectId: string;

  constructor(options: { projectId: string; connection: ContextConnection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
    this.composer = new ContextComposerService(options);
  }

  async generate(request: ContextCompositionRequest) {
    const context = await this.composer.compose(request);
    const traceId = `rag_${Date.now()}`;
    const citedEvidence = context.citations.map((citation) => citation.citationLabel);
    const draft = [
      `任務：${request.taskType}`,
      `引用資料：${citedEvidence.join(" ")}`,
      context.contextItems.slice(0, 4).map((item) => `${item.citationLabel} ${item.text}`).join("\n"),
      "候選稿會依照上述引用資料展開；本地生成流程不會直接改寫正式正文。",
    ].join("\n");

    this.connection.run("INSERT INTO retrieval_generation_traces(project_id, trace_id, job_id, task_type, retrieved_context_ids_json, used_context_ids_json, cited_evidence_json, unsupported_claims_json, source_scopes_json, external_request_count, data_left_device, row_json, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [
      this.projectId,
      traceId,
      context.jobId,
      request.taskType,
      JSON.stringify(context.usedContextIds),
      JSON.stringify(context.usedContextIds),
      JSON.stringify(citedEvidence),
      JSON.stringify([]),
      JSON.stringify([...new Set(context.contextItems.map((item) => item.sourceScope))]),
      0,
      0,
      JSON.stringify({ draft }),
      new Date().toISOString(),
    ]);

    return { traceId, draft, context, externalRequestCount: 0, dataLeftDevice: false };
  }
}
