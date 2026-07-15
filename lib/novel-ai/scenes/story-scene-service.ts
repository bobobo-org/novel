import type { SQLiteProjectConnection } from "../storage/sqlite/sqlite-connection";
import { CLASSIFICATION_TOPIC_SCENE_CONTRACTS, resolveProfile, resolveTemplate, STORY_SCENE_PROFILES } from "./story-scene-profile";
import { STORY_PROFILE_ADAPTERS, STORY_PROVIDER_POLICIES, resolveAdapter, resolveProviderPolicy } from "./story-policy-adapter";
import { STORY_STAGE_TEMPLATES } from "./story-stage-template";
import type { UniversalSceneContractResult } from "./story-scene-types";
import { storySceneError } from "./story-scene-errors";

function now() {
  return new Date().toISOString();
}

export class StorySceneService {
  readonly projectId: string;
  readonly connection: SQLiteProjectConnection;

  constructor(options: { projectId: string; connection: SQLiteProjectConnection }) {
    this.projectId = options.projectId;
    this.connection = options.connection;
  }

  seedUniversalContracts() {
    const timestamp = now();
    for (const profile of STORY_SCENE_PROFILES) {
      this.connection.run(`
        INSERT INTO story_scene_profiles(id, profile_id, profile_name, profile_family, adapter_id, default_stage_template_id, continuity_schema_version, provider_policy_id, fallback_profile_id, row_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(profile_id) DO UPDATE SET profile_name=excluded.profile_name, profile_family=excluded.profile_family, adapter_id=excluded.adapter_id, default_stage_template_id=excluded.default_stage_template_id, continuity_schema_version=excluded.continuity_schema_version, provider_policy_id=excluded.provider_policy_id, fallback_profile_id=excluded.fallback_profile_id, row_json=excluded.row_json, updated_at=excluded.updated_at
      `, [`profile_${profile.profileId}`, profile.profileId, profile.profileName, profile.profileFamily, profile.adapterId, profile.defaultStageTemplateId, profile.continuitySchemaVersion, profile.providerPolicyId, profile.fallbackProfileId, JSON.stringify(profile), timestamp, timestamp]);
    }
    for (const template of STORY_STAGE_TEMPLATES) {
      this.connection.run(`
        INSERT INTO story_stage_templates(id, template_id, profile_id, template_name, stage_types_json, stage_goals_json, dependency_rules_json, continuity_schema_version, row_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(template_id) DO UPDATE SET profile_id=excluded.profile_id, template_name=excluded.template_name, stage_types_json=excluded.stage_types_json, stage_goals_json=excluded.stage_goals_json, dependency_rules_json=excluded.dependency_rules_json, continuity_schema_version=excluded.continuity_schema_version, row_json=excluded.row_json, updated_at=excluded.updated_at
      `, [`template_${template.templateId}`, template.templateId, template.profileId, template.templateName, JSON.stringify(template.stageTypes), JSON.stringify(template.stageGoals), JSON.stringify(template.dependencyRules), template.continuitySchemaVersion, JSON.stringify(template), timestamp, timestamp]);
      this.connection.run("INSERT OR IGNORE INTO story_stage_template_versions(id, template_id, version, row_json, created_at) VALUES(?,?,?,?,?)", [`template_version_${template.templateId}_1`, template.templateId, 1, JSON.stringify(template), timestamp]);
    }
    for (const policy of STORY_PROVIDER_POLICIES) {
      this.connection.run(`
        INSERT INTO story_provider_policies(id, provider_policy_id, privacy_mode, allowed_providers_json, blocked_providers_json, external_fallback_allowed, data_left_device, row_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(provider_policy_id) DO UPDATE SET privacy_mode=excluded.privacy_mode, allowed_providers_json=excluded.allowed_providers_json, blocked_providers_json=excluded.blocked_providers_json, external_fallback_allowed=excluded.external_fallback_allowed, data_left_device=excluded.data_left_device, row_json=excluded.row_json, updated_at=excluded.updated_at
      `, [`provider_policy_${policy.providerPolicyId}`, policy.providerPolicyId, policy.privacyMode, JSON.stringify(policy.allowedProviders), JSON.stringify(policy.blockedProviders), policy.externalFallbackAllowed ? 1 : 0, 0, JSON.stringify(policy), timestamp, timestamp]);
    }
    for (const adapter of STORY_PROFILE_ADAPTERS) {
      this.connection.run(`
        INSERT INTO story_scene_profile_adapters(id, adapter_id, adapter_type, source_profile_id, target_engine, policy_gate_json, compatibility_json, row_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(adapter_id) DO UPDATE SET adapter_type=excluded.adapter_type, source_profile_id=excluded.source_profile_id, target_engine=excluded.target_engine, policy_gate_json=excluded.policy_gate_json, compatibility_json=excluded.compatibility_json, row_json=excluded.row_json, updated_at=excluded.updated_at
      `, [`adapter_${adapter.adapterId}`, adapter.adapterId, adapter.adapterType, adapter.sourceProfileId, adapter.targetEngine, JSON.stringify(adapter.policyGate), JSON.stringify(adapter.compatibility), JSON.stringify(adapter), timestamp, timestamp]);
    }
    for (const contract of CLASSIFICATION_TOPIC_SCENE_CONTRACTS) {
      this.connection.run(`
        INSERT INTO classification_topic_scene_profiles(id, classification_pack_id, topic_id, story_engine_id, scene_profile_id, default_stage_template_id, allowed_stage_template_ids_json, recommended_scene_purposes_json, policy_adapter_ids_json, provider_policy_id, continuity_schema_version, fallback_profile_id, row_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(classification_pack_id, topic_id) DO UPDATE SET story_engine_id=excluded.story_engine_id, scene_profile_id=excluded.scene_profile_id, default_stage_template_id=excluded.default_stage_template_id, allowed_stage_template_ids_json=excluded.allowed_stage_template_ids_json, recommended_scene_purposes_json=excluded.recommended_scene_purposes_json, policy_adapter_ids_json=excluded.policy_adapter_ids_json, provider_policy_id=excluded.provider_policy_id, continuity_schema_version=excluded.continuity_schema_version, fallback_profile_id=excluded.fallback_profile_id, row_json=excluded.row_json, updated_at=excluded.updated_at
      `, [`contract_${contract.classificationPackId}_${contract.topicId}`, contract.classificationPackId, contract.topicId, contract.storyEngineId, contract.sceneProfileId, contract.defaultStageTemplateId, JSON.stringify(contract.allowedStageTemplateIds), JSON.stringify(contract.recommendedScenePurposes), JSON.stringify(contract.policyAdapterIds), contract.providerPolicyId, contract.continuitySchemaVersion, contract.fallbackProfileId, JSON.stringify(contract), timestamp, timestamp]);
    }
    return this.counts();
  }

  resolveTopicContract(classificationPackId: string, topicId: string): UniversalSceneContractResult {
    const row = this.connection.get("SELECT row_json FROM classification_topic_scene_profiles WHERE classification_pack_id=? AND topic_id=?", [classificationPackId, topicId]);
    if (!row) throw storySceneError("STORY_TOPIC_CONTRACT_NOT_FOUND", "No scene contract exists for the requested topic.", { classificationPackId, topicId });
    const contract = JSON.parse(String(row.row_json));
    const profile = resolveProfile(contract.sceneProfileId);
    const template = resolveTemplate(contract.defaultStageTemplateId);
    const providerPolicy = resolveProviderPolicy(contract.providerPolicyId);
    const adapter = resolveAdapter(contract.policyAdapterIds?.[0] ?? profile.adapterId);
    return { contract, profile, template, providerPolicy, adapter, dataLeftDevice: false, externalRequestCount: 0 };
  }

  counts() {
    return {
      profileCount: Number(this.connection.get("SELECT count(*) AS count FROM story_scene_profiles")?.count ?? 0),
      templateCount: Number(this.connection.get("SELECT count(*) AS count FROM story_stage_templates")?.count ?? 0),
      topicContractCount: Number(this.connection.get("SELECT count(*) AS count FROM classification_topic_scene_profiles")?.count ?? 0),
      providerPolicyCount: Number(this.connection.get("SELECT count(*) AS count FROM story_provider_policies")?.count ?? 0),
      adapterCount: Number(this.connection.get("SELECT count(*) AS count FROM story_scene_profile_adapters")?.count ?? 0),
    };
  }
}
