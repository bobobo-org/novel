import { OllamaClient } from "../../providers/ollama/ollama-client";
import { checkOllamaHealth } from "../../providers/ollama/ollama-health";
import { buildStoryStagePrompt, STORY_STAGE_PROMPT_REGISTRY_VERSION } from "./story-stage-prompt-registry";
import { repairStoryGenerationOutput } from "./story-generation-repair";
import { validateStoryStageContext, validateStoryStageOutput } from "./story-stage-validator";
import { updateStoryContinuity } from "./story-continuity-updater";
import { extractStoryConsequenceCandidate } from "./story-consequence-extractor";
import { assertAdultStagePolicy } from "./adult-stage-policy-gate";
import { adultStagePromptSafetyNote } from "./adult-stage-prompt-profile";
import { id, nowIso, stableHash, type StoryStageContext, type StoryStageGenerationOptions, type StoryStageOperation, type StoryStageVersionRecord } from "./story-stage-context";
import { storyGenerationError } from "./story-generation-errors";

export const STORY_STAGE_GENERATION_VERSION = "h2p4-universal-local-stage-generation-v1";

export class StoryStageGenerator {
  async run(operation: StoryStageOperation, context: StoryStageContext, options: StoryStageGenerationOptions = {}): Promise<StoryStageVersionRecord> {
    validateStoryStageContext(context);
    assertAdultStagePolicy(context);
    const health = await checkOllamaHealth();
    const model = options.model || health.selectedModel;
    if (!model) {
      throw storyGenerationError("STORY_GENERATION_PROVIDER_UNAVAILABLE", "No installed Ollama generation model is available.", { status: health.status });
    }
    const prompt = buildStoryStagePrompt(context, operation, [
      context.profileId === "adult_intimacy" ? adultStagePromptSafetyNote() : "",
      options.instruction ?? "",
    ].filter(Boolean).join("\n"));
    const started = Date.now();
    const client = new OllamaClient({ endpoint: options.ollamaEndpoint, timeoutMs: options.timeoutMs ?? 120_000 });
    const result = await client.generate({
      model,
      prompt,
      stream: Boolean(options.stream),
      format: "json",
      signal: options.signal,
      options: {
        temperature: operation === "regenerateStage" || operation === "branchFromStage" ? 0.45 : 0.25,
        num_predict: Math.max(120, Math.min(900, context.targetLength ?? 260)),
      },
    });
    const repaired = repairStoryGenerationOutput(result.response ?? "", { provider: "ollama-local", model });
    const continuity = updateStoryContinuity(context, repaired);
    repaired.continuityChanges = { ...repaired.continuityChanges, ...continuity };
    repaired.provider = "ollama-local";
    repaired.model = model;
    repaired.externalRequestCount = 0;
    repaired.dataLeftDevice = false;
    repaired.usedContextIds = [...new Set([
      ...repaired.usedContextIds,
      context.sceneId,
      context.stageId,
      context.classificationPackId,
      context.topicId,
      context.storyEngineId,
    ].filter(Boolean) as string[])];
    repaired.warnings = [
      ...(repaired.warnings ?? []),
      `latencyMs:${Date.now() - started}`,
      `promptTemplate:${STORY_STAGE_PROMPT_REGISTRY_VERSION}`,
    ];
    validateStoryStageOutput(repaired);
    const version: StoryStageVersionRecord = {
      ...repaired,
      versionId: id("story_stage_version"),
      parentVersionId: options.parentVersionId,
      operation,
      projectId: context.projectId,
      sceneId: context.sceneId,
      stageId: context.stageId,
      branchId: context.branchId ?? "main",
      profileId: String(context.profileId),
      stageType: context.stageType,
      promptHash: stableHash(prompt),
      contentHash: stableHash(repaired.draftText),
      createdAt: nowIso(),
    };
    this.persistVersion(version, extractStoryConsequenceCandidate(context, repaired), options);
    return version;
  }

  private persistVersion(version: StoryStageVersionRecord, consequence: Record<string, unknown>, options: StoryStageGenerationOptions) {
    const connection = options.connection;
    if (!connection) return;
    const row = JSON.stringify(version);
    connection.run(
      `INSERT INTO story_stage_generation_versions(
        id, project_id, scene_id, stage_id, branch_id, profile_id, stage_type, operation, version_id, parent_version_id,
        provider, model, draft_text, stage_summary, prompt_hash, content_hash, external_request_count, data_left_device,
        continuity_changes_json, consequence_candidate_json, used_context_ids_json, warnings_json, row_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        version.versionId, version.projectId, version.sceneId, version.stageId, version.branchId, version.profileId, version.stageType, version.operation, version.versionId, version.parentVersionId ?? null,
        version.provider, version.model, version.draftText, version.stageSummary, version.promptHash, version.contentHash, version.externalRequestCount, version.dataLeftDevice ? 1 : 0,
        JSON.stringify(version.continuityChanges), JSON.stringify(consequence), JSON.stringify(version.usedContextIds), JSON.stringify(version.warnings), row,
      ]
    );
    const consequenceId = id("story_consequence");
    const consequenceRow = {
      id: consequenceId,
      projectId: version.projectId,
      sceneId: version.sceneId,
      stageId: version.stageId,
      versionId: version.versionId,
      status: "candidate",
      candidateType: "stage_consequence",
      consequence,
      sourceVersionId: version.versionId,
      externalRequestCount: 0,
      dataLeftDevice: false,
      createdAt: nowIso(),
    };
    connection.run(
      `INSERT INTO story_consequence_candidates(
        id, project_id, scene_id, stage_id, version_id, status, candidate_type, consequence_json, source_version_id,
        external_request_count, data_left_device, row_json
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [consequenceId, version.projectId, version.sceneId, version.stageId, version.versionId, "candidate", "stage_consequence", JSON.stringify(consequence), version.versionId, 0, 0, JSON.stringify(consequenceRow)]
    );
  }
}
