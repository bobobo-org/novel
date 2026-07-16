import { createOutcomeSnapshot } from "./story-outcome-snapshot";
import { validateOutcomeParity } from "./story-outcome-parity";
import { createRetrievalMetadata, normalizeVisibility } from "./story-retrieval-metadata";
import { ratingForTransform, transformTextWithLocalModel, versionTypeForTransform } from "./story-version-transformer";
import {
  id,
  nowIso,
  stableHash,
  summarizeText,
  type StoryOutcomeParityResult,
  type StorySceneVersion,
  type StoryTransformType,
  type StoryVersionCreateInput,
  type StoryVersionOptions,
  type StoryVisibility,
} from "./story-version-types";

function mustConnection(options: StoryVersionOptions) {
  if (!options.connection) throw new Error("H2P5_SQLITE_CONNECTION_REQUIRED");
  return options.connection;
}

function parseRow<T>(row: any): T | null {
  if (!row?.row_json) return null;
  return JSON.parse(String(row.row_json)) as T;
}

function persistJson(connection: NonNullable<StoryVersionOptions["connection"]>, sql: string, values: any[]) {
  connection.run(sql, values);
}

export class StoryVersionService {
  createSceneVersion(input: StoryVersionCreateInput, options: StoryVersionOptions = {}): StorySceneVersion {
    const connection = mustConnection(options);
    const versionId = id("story_scene_version");
    const contentHash = stableHash(input.contentText);
    const createdAt = nowIso();
    const snapshot = createOutcomeSnapshot(input, contentHash);
    const retrieval = createRetrievalMetadata(input, versionId, contentHash);
    retrieval.visibility = normalizeVisibility(retrieval.visibility, retrieval.rating) as StoryVisibility;
    const version: StorySceneVersion = {
      projectId: input.projectId,
      sceneId: input.sceneId,
      stageId: input.stageId,
      branchId: input.branchId || "main",
      versionId,
      parentVersionId: input.parentVersionId,
      versionType: input.versionType || "original",
      rating: input.rating || "mature",
      visibility: retrieval.visibility,
      canonicalStatus: input.canonicalStatus || "draft",
      contentText: input.contentText,
      summary: input.summary || summarizeText(input.contentText),
      contentHash,
      outcomeSnapshot: snapshot,
      retrievalMetadata: retrieval,
      createdAt,
      updatedAt: createdAt,
    };
    this.persistVersion(version, connection);
    return version;
  }

  async transformSceneVersion(sourceVersionId: string, transformType: StoryTransformType, options: StoryVersionOptions = {}) {
    const source = this.getVersion(sourceVersionId, options);
    if (!source) throw new Error("H2P5_SOURCE_VERSION_NOT_FOUND");
    const transformed = await transformTextWithLocalModel(source.contentText, transformType, options);
    const target = this.createSceneVersion({
      projectId: source.projectId,
      sceneId: source.sceneId,
      stageId: source.stageId,
      branchId: source.branchId,
      parentVersionId: source.versionId,
      versionType: versionTypeForTransform(transformType),
      rating: ratingForTransform(source.rating, transformType),
      visibility: transformType === "private_to_public_romance" ? "public_ready" : source.visibility,
      canonicalStatus: "candidate",
      contentText: transformed.text,
      summary: summarizeText(transformed.text),
      requiredEvents: source.outcomeSnapshot.requiredEvents,
      characterChanges: source.outcomeSnapshot.characterChanges,
      relationshipChanges: source.outcomeSnapshot.relationshipChanges,
      plotConsequences: source.outcomeSnapshot.plotConsequences,
      unresolvedConsequences: source.outcomeSnapshot.unresolvedConsequences,
      canonicalFactsReferenced: source.outcomeSnapshot.canonicalFactsReferenced,
      candidateFactsIntroduced: source.outcomeSnapshot.candidateFactsIntroduced,
      consequenceCandidateIds: source.outcomeSnapshot.consequenceCandidateIds,
      classificationPackId: source.retrievalMetadata.classificationPackId,
      topicId: source.retrievalMetadata.topicId,
      storyEngineId: source.retrievalMetadata.storyEngineId,
      sceneProfileId: source.retrievalMetadata.sceneProfileId,
      sceneType: source.retrievalMetadata.sceneType,
      stageType: source.retrievalMetadata.stageType,
      participantIds: source.retrievalMetadata.participantIds,
      relationshipIds: source.retrievalMetadata.relationshipIds,
    }, options);
    const parity = this.validateOutcomeParity(source.versionId, target.versionId, options);
    const connection = mustConnection(options);
    const transformId = id("story_scene_transform");
    const transformRow = {
      id: transformId,
      projectId: source.projectId,
      sourceVersionId: source.versionId,
      targetVersionId: target.versionId,
      transformType,
      provider: transformed.provider,
      model: transformed.model,
      externalRequestCount: transformed.externalRequestCount,
      dataLeftDevice: transformed.dataLeftDevice,
      parity,
      createdAt: nowIso(),
    };
    persistJson(connection, `INSERT INTO story_scene_transforms(
      id, project_id, source_version_id, target_version_id, transform_type, provider, model,
      external_request_count, data_left_device, row_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`, [
      transformId, source.projectId, source.versionId, target.versionId, transformType, transformed.provider, transformed.model,
      transformed.externalRequestCount, transformed.dataLeftDevice ? 1 : 0, JSON.stringify(transformRow),
    ]);
    this.linkVersions(source.projectId, source.versionId, target.versionId, `transform:${transformType}`, connection);
    return { source, target, transform: transformRow, parity };
  }

  compareSceneVersions(sourceVersionId: string, targetVersionId: string, options: StoryVersionOptions = {}) {
    return this.validateOutcomeParity(sourceVersionId, targetVersionId, options);
  }

  restoreSceneVersion(versionId: string, options: StoryVersionOptions = {}) {
    const version = this.getVersion(versionId, options);
    if (!version) throw new Error("H2P5_VERSION_NOT_FOUND");
    const restored = this.cloneSceneVersion(versionId, { ...options, marker: "restore" } as StoryVersionOptions & { marker?: string });
    restored.canonicalStatus = "candidate";
    restored.parentVersionId = version.versionId;
    this.persistVersion(restored, mustConnection(options));
    this.linkVersions(version.projectId, version.versionId, restored.versionId, "restore", mustConnection(options));
    return restored;
  }

  archiveSceneVersion(versionId: string, options: StoryVersionOptions = {}) {
    const connection = mustConnection(options);
    const version = this.getVersion(versionId, options);
    if (!version) throw new Error("H2P5_VERSION_NOT_FOUND");
    version.archivedAt = nowIso();
    version.canonicalStatus = "archived";
    version.retrievalMetadata.deletedAt = version.archivedAt;
    persistJson(connection, "UPDATE story_scene_versions SET canonical_status=?, archived_at=?, row_json=?, updated_at=? WHERE project_id=? AND version_id=?", [
      "archived", version.archivedAt, JSON.stringify(version), nowIso(), version.projectId, version.versionId,
    ]);
    persistJson(connection, "UPDATE story_retrieval_metadata SET deleted_at=?, canonical_status=?, row_json=?, updated_at=? WHERE project_id=? AND version_id=?", [
      version.archivedAt, "archived", JSON.stringify(version.retrievalMetadata), nowIso(), version.projectId, version.versionId,
    ]);
    return version;
  }

  cloneSceneVersion(versionId: string, options: StoryVersionOptions & { marker?: string } = {}) {
    const source = this.getVersion(versionId, options);
    if (!source) throw new Error("H2P5_VERSION_NOT_FOUND");
    return this.createSceneVersion({
      projectId: source.projectId,
      sceneId: source.sceneId,
      stageId: source.stageId,
      branchId: source.branchId,
      parentVersionId: source.versionId,
      versionType: source.versionType,
      rating: source.rating,
      visibility: source.visibility,
      canonicalStatus: "candidate",
      contentText: source.contentText,
      summary: `${source.summary}${options.marker ? ` (${options.marker})` : ""}`,
      requiredEvents: source.outcomeSnapshot.requiredEvents,
      characterChanges: source.outcomeSnapshot.characterChanges,
      relationshipChanges: source.outcomeSnapshot.relationshipChanges,
      plotConsequences: source.outcomeSnapshot.plotConsequences,
      unresolvedConsequences: source.outcomeSnapshot.unresolvedConsequences,
      canonicalFactsReferenced: source.outcomeSnapshot.canonicalFactsReferenced,
      candidateFactsIntroduced: source.outcomeSnapshot.candidateFactsIntroduced,
      consequenceCandidateIds: source.outcomeSnapshot.consequenceCandidateIds,
      classificationPackId: source.retrievalMetadata.classificationPackId,
      topicId: source.retrievalMetadata.topicId,
      storyEngineId: source.retrievalMetadata.storyEngineId,
      sceneProfileId: source.retrievalMetadata.sceneProfileId,
      sceneType: source.retrievalMetadata.sceneType,
      stageType: source.retrievalMetadata.stageType,
      participantIds: source.retrievalMetadata.participantIds,
      relationshipIds: source.retrievalMetadata.relationshipIds,
    }, options);
  }

  promoteVersionCandidate(versionId: string, options: StoryVersionOptions = {}) {
    const connection = mustConnection(options);
    const version = this.getVersion(versionId, options);
    if (!version) throw new Error("H2P5_VERSION_NOT_FOUND");
    version.canonicalStatus = "approved";
    version.retrievalMetadata.canonicalStatus = "approved";
    version.updatedAt = nowIso();
    persistJson(connection, "UPDATE story_scene_versions SET canonical_status=?, row_json=?, updated_at=? WHERE project_id=? AND version_id=?", [
      "approved", JSON.stringify(version), version.updatedAt, version.projectId, version.versionId,
    ]);
    persistJson(connection, "UPDATE story_retrieval_metadata SET canonical_status=?, row_json=?, updated_at=? WHERE project_id=? AND version_id=?", [
      "approved", JSON.stringify(version.retrievalMetadata), version.updatedAt, version.projectId, version.versionId,
    ]);
    const promotionId = id("branch_promotion");
    const row = { id: promotionId, projectId: version.projectId, branchId: version.branchId, sourceVersionId: version.versionId, status: "approved", createdAt: nowIso() };
    persistJson(connection, "INSERT INTO story_branch_promotion_candidates(id, project_id, branch_id, source_version_id, status, row_json) VALUES(?,?,?,?,?,?)", [
      promotionId, version.projectId, version.branchId, version.versionId, "approved", JSON.stringify(row),
    ]);
    return version;
  }

  createBranch(sourceVersionId: string, branchType: string, options: StoryVersionOptions = {}) {
    const source = this.getVersion(sourceVersionId, options);
    if (!source) throw new Error("H2P5_VERSION_NOT_FOUND");
    const branchId = `branch_${branchType}_${Date.now()}`;
    const branchVersion = this.createSceneVersion({
      ...source,
      branchId,
      parentVersionId: source.versionId,
      canonicalStatus: "candidate",
      contentText: source.contentText,
      summary: `${source.summary} / ${branchType}`,
    } as StoryVersionCreateInput, options);
    this.linkVersions(source.projectId, source.versionId, branchVersion.versionId, `branch:${branchType}`, mustConnection(options));
    return branchVersion;
  }

  compareBranches(projectId: string, sourceBranchId: string, targetBranchId: string, options: StoryVersionOptions = {}) {
    const connection = mustConnection(options);
    const sourceRows = connection.all("SELECT row_json FROM story_scene_versions WHERE project_id=? AND branch_id=? AND archived_at IS NULL", [projectId, sourceBranchId]);
    const targetRows = connection.all("SELECT row_json FROM story_scene_versions WHERE project_id=? AND branch_id=? AND archived_at IS NULL", [projectId, targetBranchId]);
    const result = {
      id: id("branch_comparison"),
      projectId,
      sourceBranchId,
      targetBranchId,
      sourceCount: sourceRows.length,
      targetCount: targetRows.length,
      branchIsolation: sourceBranchId !== targetBranchId,
      createdAt: nowIso(),
    };
    persistJson(connection, "INSERT INTO story_branch_comparisons(id, project_id, source_branch_id, target_branch_id, row_json) VALUES(?,?,?,?,?)", [
      result.id, projectId, sourceBranchId, targetBranchId, JSON.stringify(result),
    ]);
    return result;
  }

  validateOutcomeParity(sourceVersionId: string, targetVersionId: string, options: StoryVersionOptions = {}): StoryOutcomeParityResult {
    const source = this.getVersion(sourceVersionId, options);
    const target = this.getVersion(targetVersionId, options);
    if (!source || !target) throw new Error("H2P5_VERSION_NOT_FOUND");
    const result = validateOutcomeParity(source.outcomeSnapshot, target.outcomeSnapshot);
    const connection = mustConnection(options);
    const resultId = id("outcome_parity");
    persistJson(connection, `INSERT INTO story_scene_outcome_parity_results(
      id, project_id, source_version_id, target_version_id, parity_status, severity,
      matched_outcomes_json, missing_outcomes_json, changed_outcomes_json, unsupported_facts_json, recommended_fixes_json, row_json
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [
      resultId, source.projectId, source.versionId, target.versionId, result.parityStatus, result.severity,
      JSON.stringify(result.matchedOutcomes), JSON.stringify(result.missingOutcomes), JSON.stringify(result.changedOutcomes),
      JSON.stringify(result.unsupportedFacts), JSON.stringify(result.recommendedFixes), JSON.stringify({ id: resultId, ...result }),
    ]);
    return result;
  }

  getVersion(versionId: string, options: StoryVersionOptions = {}) {
    const row = mustConnection(options).get("SELECT row_json FROM story_scene_versions WHERE version_id=?", [versionId]);
    return parseRow<StorySceneVersion>(row);
  }

  private persistVersion(version: StorySceneVersion, connection: NonNullable<StoryVersionOptions["connection"]>) {
    const row = JSON.stringify(version);
    connection.run(`INSERT OR REPLACE INTO story_scene_versions(
      id, project_id, scene_id, stage_id, branch_id, version_id, parent_version_id, version_type, rating, visibility,
      canonical_status, content_text, summary, content_hash, outcome_snapshot_json, retrieval_metadata_json, row_json, updated_at, archived_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      version.versionId, version.projectId, version.sceneId, version.stageId ?? null, version.branchId, version.versionId, version.parentVersionId ?? null,
      version.versionType, version.rating, version.visibility, version.canonicalStatus, version.contentText, version.summary, version.contentHash,
      JSON.stringify(version.outcomeSnapshot), JSON.stringify(version.retrievalMetadata), row, version.updatedAt, version.archivedAt ?? null,
    ]);
    connection.run("INSERT OR REPLACE INTO story_scene_outcome_snapshots(id, project_id, scene_id, branch_id, version_id, content_hash, row_json) VALUES(?,?,?,?,?,?,?)", [
      `snapshot_${version.versionId}`, version.projectId, version.sceneId, version.branchId, version.versionId, version.contentHash, JSON.stringify(version.outcomeSnapshot),
    ]);
    connection.run(`INSERT OR REPLACE INTO story_retrieval_metadata(
      id, project_id, scene_id, stage_id, version_id, branch_id, version_type, rating, visibility, canonical_status,
      consequence_status, content_hash, indexed_at, deleted_at, row_json, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      `retrieval_${version.versionId}`, version.projectId, version.sceneId, version.stageId ?? null, version.versionId, version.branchId,
      version.versionType, version.rating, version.visibility, version.canonicalStatus, version.retrievalMetadata.consequenceStatus,
      version.contentHash, version.retrievalMetadata.indexedAt ?? null, version.retrievalMetadata.deletedAt ?? null, JSON.stringify(version.retrievalMetadata), version.updatedAt,
    ]);
  }

  private linkVersions(projectId: string, sourceVersionId: string, targetVersionId: string, linkType: string, connection: NonNullable<StoryVersionOptions["connection"]>) {
    const linkId = id("story_scene_version_link");
    const row = { id: linkId, projectId, sourceVersionId, targetVersionId, linkType, createdAt: nowIso() };
    connection.run("INSERT OR IGNORE INTO story_scene_version_links(id, project_id, source_version_id, target_version_id, link_type, row_json) VALUES(?,?,?,?,?,?)", [
      linkId, projectId, sourceVersionId, targetVersionId, linkType, JSON.stringify(row),
    ]);
  }
}

export const storyVersionService = new StoryVersionService();
