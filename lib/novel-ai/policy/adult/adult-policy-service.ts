import crypto from "crypto";
import type { SQLiteProjectConnection } from "../../storage/sqlite/sqlite-connection";
import { defaultAdultPolicy, normalizeAdultPolicy } from "./adult-policy-schema";
import type {
  AdultPolicyAuditInput,
  AdultPolicyExclusion,
  AdultPolicyPreference,
  AdultPolicyProfile,
  AdultPolicyValidationContext,
  CharacterAdultAssertion,
  ProjectAdultPolicy,
  RelationshipIntimacyRule,
} from "./adult-policy-types";
import { validateAdultPolicyContext } from "./adult-policy-validator";

export class AdultPolicyService {
  private readonly projectId: string;
  private readonly connection: SQLiteProjectConnection;

  constructor(options: { projectId: string; connection: SQLiteProjectConnection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
  }

  ensureProject() {
    const now = new Date().toISOString();
    this.connection.run(
      "INSERT OR IGNORE INTO projects(id, project_id, row_json, created_at, updated_at) VALUES(?,?,?,?,?)",
      [this.projectId, this.projectId, JSON.stringify({ projectId: this.projectId }), now, now],
    );
  }

  getProjectPolicy() {
    this.ensureProject();
    const row = this.connection.get("SELECT row_json FROM project_adult_policy WHERE project_id = ?", [this.projectId]);
    if (!row) return defaultAdultPolicy(this.projectId);
    return normalizeAdultPolicy(this.projectId, JSON.parse(String(row.row_json)));
  }

  saveProjectPolicy(input: Partial<ProjectAdultPolicy>, reason = "manual_update") {
    this.ensureProject();
    const existing = this.connection.get("SELECT policy_version FROM project_adult_policy WHERE project_id = ?", [this.projectId]);
    const nextVersion = Number(existing?.policy_version ?? 0) + 1;
    const policy = normalizeAdultPolicy(this.projectId, { ...this.getProjectPolicy(), ...input, policyVersion: nextVersion });
    const now = new Date().toISOString();
    this.connection.transaction(() => {
      this.connection.run(`
        INSERT INTO project_adult_policy(project_id, enabled, rating, explicitness, direct_language, fade_to_black, pacing, dialogue_ratio, sensory_detail, emotional_detail, psychological_detail, default_scene_length, aftermath_length, public_version_mode, generation_mode, policy_version, row_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id) DO UPDATE SET
          enabled = excluded.enabled,
          rating = excluded.rating,
          explicitness = excluded.explicitness,
          direct_language = excluded.direct_language,
          fade_to_black = excluded.fade_to_black,
          pacing = excluded.pacing,
          dialogue_ratio = excluded.dialogue_ratio,
          sensory_detail = excluded.sensory_detail,
          emotional_detail = excluded.emotional_detail,
          psychological_detail = excluded.psychological_detail,
          default_scene_length = excluded.default_scene_length,
          aftermath_length = excluded.aftermath_length,
          public_version_mode = excluded.public_version_mode,
          generation_mode = excluded.generation_mode,
          policy_version = excluded.policy_version,
          row_json = excluded.row_json,
          updated_at = excluded.updated_at
      `, policyParams(policy, now));
      this.connection.run(
        "INSERT INTO project_adult_policy_versions(id, project_id, policy_version, change_reason, row_json, created_at) VALUES(?,?,?,?,?,?)",
        [`adult_policy_version_${hash(`${this.projectId}|${nextVersion}|${now}`).slice(0, 24)}`, this.projectId, nextVersion, reason, JSON.stringify(policy), now],
      );
      this.writeAudit({ projectId: this.projectId, policyVersion: nextVersion, action: "policy_saved", validationStatus: "completed", details: { reason } });
    });
    return policy;
  }

  listPolicyVersions() {
    return this.connection.all("SELECT policy_version, change_reason, row_json, created_at FROM project_adult_policy_versions WHERE project_id = ? ORDER BY policy_version ASC", [this.projectId])
      .map((row) => ({ policyVersion: Number(row.policy_version), changeReason: String(row.change_reason), policy: JSON.parse(String(row.row_json)), createdAt: String(row.created_at) }));
  }

  saveProfile(profile: AdultPolicyProfile) {
    this.ensureProject();
    const now = new Date().toISOString();
    this.connection.run(`
      INSERT INTO adult_policy_profiles(id, project_id, profile_id, title, enabled, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id, profile_id) DO UPDATE SET title = excluded.title, enabled = excluded.enabled, row_json = excluded.row_json, updated_at = excluded.updated_at
    `, [`adult_profile_${this.projectId}_${profile.profileId}`, this.projectId, profile.profileId, profile.title, profile.enabled ? 1 : 0, JSON.stringify(profile), now, now]);
    return profile;
  }

  setPreference(input: AdultPolicyPreference) {
    this.ensureProject();
    const now = new Date().toISOString();
    this.connection.run(`
      INSERT INTO project_adult_preferences(id, project_id, preference_key, preference_value, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(project_id, preference_key) DO UPDATE SET preference_value = excluded.preference_value, row_json = excluded.row_json, updated_at = excluded.updated_at
    `, [`adult_pref_${this.projectId}_${input.key}`, this.projectId, input.key, input.value, JSON.stringify(input), now, now]);
    return input;
  }

  addExclusion(input: AdultPolicyExclusion) {
    this.ensureProject();
    this.connection.run(
      "INSERT OR REPLACE INTO project_adult_exclusions(id, project_id, exclusion_key, reason, row_json) VALUES(?,?,?,?,?)",
      [`adult_exclusion_${this.projectId}_${input.key}`, this.projectId, input.key, input.reason ?? null, JSON.stringify(input)],
    );
    return input;
  }

  upsertCharacterAssertion(input: CharacterAdultAssertion) {
    this.ensureProject();
    const now = new Date().toISOString();
    const row: CharacterAdultAssertion = { ...input, projectId: this.projectId, id: input.id ?? `adult_assertion_${this.projectId}_${input.characterId}`, verificationVersion: input.verificationVersion ?? 1 };
    this.connection.run(`
      INSERT INTO character_adult_assertions(id, project_id, character_id, age_value, age_source, verification_status, canonical_entity_id, verified_at, verification_version, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id, character_id) DO UPDATE SET age_value = excluded.age_value, age_source = excluded.age_source, verification_status = excluded.verification_status, canonical_entity_id = excluded.canonical_entity_id, verified_at = excluded.verified_at, verification_version = excluded.verification_version, row_json = excluded.row_json, updated_at = excluded.updated_at
    `, [row.id!, this.projectId, row.characterId, row.ageValue ?? null, row.ageSource, row.verificationStatus, row.canonicalEntityId ?? null, row.verifiedAt ?? now, row.verificationVersion ?? 1, JSON.stringify(row), now, now]);
    return row;
  }

  upsertRelationshipRule(input: RelationshipIntimacyRule) {
    this.ensureProject();
    const now = new Date().toISOString();
    const row: RelationshipIntimacyRule = { ...input, projectId: this.projectId, id: input.id ?? `adult_relationship_${this.projectId}_${input.relationshipId}` };
    this.connection.run(`
      INSERT INTO relationship_intimacy_rules(id, project_id, relationship_id, participant_ids_json, relationship_type, relationship_stage, intimacy_allowed, allowed_from_chapter, required_events_json, forbidden_events_json, exclusivity_rule, public_risk, trust_level, attraction_level, resentment_level, power_balance, consequence_profile, row_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id, relationship_id) DO UPDATE SET participant_ids_json = excluded.participant_ids_json, relationship_type = excluded.relationship_type, relationship_stage = excluded.relationship_stage, intimacy_allowed = excluded.intimacy_allowed, allowed_from_chapter = excluded.allowed_from_chapter, required_events_json = excluded.required_events_json, forbidden_events_json = excluded.forbidden_events_json, exclusivity_rule = excluded.exclusivity_rule, public_risk = excluded.public_risk, trust_level = excluded.trust_level, attraction_level = excluded.attraction_level, resentment_level = excluded.resentment_level, power_balance = excluded.power_balance, consequence_profile = excluded.consequence_profile, row_json = excluded.row_json, updated_at = excluded.updated_at
    `, [row.id!, this.projectId, row.relationshipId, JSON.stringify(row.participantIds), row.relationshipType, row.relationshipStage, row.intimacyAllowed ? 1 : 0, row.allowedFromChapter ?? null, JSON.stringify(row.requiredEvents), JSON.stringify(row.forbiddenEvents), row.exclusivityRule ?? null, row.publicRisk, row.trustLevel, row.attractionLevel, row.resentmentLevel, row.powerBalance ?? null, row.consequenceProfile ?? null, JSON.stringify(row), now, now]);
    return row;
  }

  validateContext(input: Omit<AdultPolicyValidationContext, "policy">) {
    const result = validateAdultPolicyContext({ ...input, projectId: this.projectId, policy: this.getProjectPolicy() });
    this.writeAudit({ projectId: this.projectId, policyVersion: result.policyVersion, action: "policy_validation", validationStatus: result.status, details: { issues: result.issues } });
    return result;
  }

  writeAudit(input: AdultPolicyAuditInput) {
    const safe = sanitizeAudit(input);
    this.connection.run(
      "INSERT INTO adult_policy_audits(id, project_id, policy_version, action, provider, model, prompt_template_version, validation_status, data_left_device, external_request_count, output_hash, row_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      [`adult_audit_${hash(`${this.projectId}|${input.action}|${Date.now()}|${Math.random()}`).slice(0, 24)}`, this.projectId, input.policyVersion ?? null, input.action, input.provider ?? "local-policy", input.model ?? null, input.promptTemplateVersion ?? null, input.validationStatus, input.dataLeftDevice ? 1 : 0, input.externalRequestCount ?? 0, input.outputHash ?? null, JSON.stringify(safe)],
    );
    return safe;
  }
}

function policyParams(policy: ProjectAdultPolicy, now: string) {
  return [
    policy.projectId,
    policy.enabled ? 1 : 0,
    policy.rating,
    policy.explicitness,
    policy.directLanguage ? 1 : 0,
    policy.fadeToBlack ? 1 : 0,
    policy.pacing,
    policy.dialogueRatio,
    policy.sensoryDetail,
    policy.emotionalDetail,
    policy.psychologicalDetail,
    policy.defaultSceneLength,
    policy.aftermathLength,
    policy.publicVersionMode,
    policy.generationMode,
    policy.policyVersion,
    JSON.stringify(policy),
    policy.createdAt ?? now,
    now,
  ];
}

function sanitizeAudit(input: AdultPolicyAuditInput) {
  return {
    projectId: input.projectId,
    policyVersion: input.policyVersion,
    action: input.action,
    provider: input.provider ?? "local-policy",
    model: input.model,
    promptTemplateVersion: input.promptTemplateVersion,
    validationStatus: input.validationStatus,
    dataLeftDevice: Boolean(input.dataLeftDevice),
    externalRequestCount: input.externalRequestCount ?? 0,
    outputHash: input.outputHash,
    details: input.details ?? {},
  };
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
