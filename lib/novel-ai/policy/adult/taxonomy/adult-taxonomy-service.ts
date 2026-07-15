import crypto from "crypto";
import type { SQLiteProjectConnection } from "../../../storage/sqlite/sqlite-connection";
import { ADULT_SCENARIO_PACKS, ADULT_TAXONOMY_CATEGORIES, ADULT_TAXONOMY_TAGS, ADULT_TAXONOMY_VERSION } from "./adult-taxonomy-registry";
import { discoverAdultScenarios, surpriseAdultScenario } from "./adult-scenario-discovery";
import { createAdultScenarioVariation } from "./adult-scenario-variation";
import { searchAdultTaxonomyTags } from "./adult-taxonomy-search";
import type { AdultTaxonomyCategoryId, ScenarioDiscoveryInput } from "./adult-taxonomy-types";

export class AdultTaxonomyService {
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

  seedRegistry() {
    this.ensureProject();
    const now = new Date().toISOString();
    this.connection.transaction(() => {
      for (const category of ADULT_TAXONOMY_CATEGORIES) {
        this.connection.run(`
          INSERT INTO adult_taxonomy_categories(id, category_id, display_name, ordinal, enabled, row_json, created_at, updated_at)
          VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(category_id) DO UPDATE SET display_name = excluded.display_name, ordinal = excluded.ordinal, enabled = excluded.enabled, row_json = excluded.row_json, updated_at = excluded.updated_at
        `, [`adult_category_${category.categoryId}`, category.categoryId, category.displayName, category.ordinal, category.enabled ? 1 : 0, JSON.stringify(category), now, now]);
      }
      for (const tag of ADULT_TAXONOMY_TAGS) {
        this.connection.run(`
          INSERT INTO adult_taxonomy_tags(id, tag_id, category_id, display_name, description, enabled, adult_only, minimum_rating, default_weight, preference_weight, novelty_weight, repetition_weight, row_json, created_at, updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(tag_id) DO UPDATE SET category_id = excluded.category_id, display_name = excluded.display_name, description = excluded.description, enabled = excluded.enabled, adult_only = excluded.adult_only, minimum_rating = excluded.minimum_rating, default_weight = excluded.default_weight, preference_weight = excluded.preference_weight, novelty_weight = excluded.novelty_weight, repetition_weight = excluded.repetition_weight, row_json = excluded.row_json, updated_at = excluded.updated_at
        `, [`adult_tag_${tag.tagId}`, tag.tagId, tag.categoryId, tag.displayName, tag.description, tag.enabled ? 1 : 0, tag.adultOnly ? 1 : 0, tag.minimumRating, tag.defaultWeight, tag.preferenceWeight, tag.noveltyWeight, tag.repetitionWeight, JSON.stringify(tag), now, now]);
        this.connection.run("DELETE FROM adult_tag_aliases WHERE tag_id = ?", [tag.tagId]);
        for (const alias of tag.aliases) {
          this.connection.run("INSERT OR IGNORE INTO adult_tag_aliases(tag_id, alias, alias_normalized) VALUES(?,?,?)", [tag.tagId, alias, alias.trim().toLowerCase()]);
        }
        this.connection.run("DELETE FROM adult_tag_compatibility WHERE tag_id = ?", [tag.tagId]);
        for (const compatibleTagId of tag.compatibleTags) {
          this.connection.run("INSERT OR IGNORE INTO adult_tag_compatibility(tag_id, compatible_tag_id, weight) VALUES(?,?,?)", [tag.tagId, compatibleTagId, 1]);
        }
        this.connection.run("DELETE FROM adult_tag_requirements WHERE tag_id = ?", [tag.tagId]);
        for (const requiredTagId of tag.requiresTags) {
          this.connection.run("INSERT OR IGNORE INTO adult_tag_requirements(tag_id, required_tag_id) VALUES(?,?)", [tag.tagId, requiredTagId]);
        }
        this.connection.run("DELETE FROM adult_tag_exclusions WHERE tag_id = ?", [tag.tagId]);
        for (const excludedTagId of tag.excludesTags) {
          this.connection.run("INSERT OR IGNORE INTO adult_tag_exclusions(tag_id, excluded_tag_id) VALUES(?,?)", [tag.tagId, excludedTagId]);
        }
      }
      for (const pack of ADULT_SCENARIO_PACKS) {
        this.connection.run(`
          INSERT INTO adult_scenario_packs(id, scenario_pack_id, title, premise, participant_roles_json, required_relationship_stages_json, required_setup_json, location_options_json, emotional_tone_options_json, stage_template_json, narrative_purpose, consequence_template, compatible_tags_json, incompatible_tags_json, rating_min, rating_max, version, enabled, row_json, created_at, updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(scenario_pack_id) DO UPDATE SET title = excluded.title, premise = excluded.premise, participant_roles_json = excluded.participant_roles_json, required_relationship_stages_json = excluded.required_relationship_stages_json, required_setup_json = excluded.required_setup_json, location_options_json = excluded.location_options_json, emotional_tone_options_json = excluded.emotional_tone_options_json, stage_template_json = excluded.stage_template_json, narrative_purpose = excluded.narrative_purpose, consequence_template = excluded.consequence_template, compatible_tags_json = excluded.compatible_tags_json, incompatible_tags_json = excluded.incompatible_tags_json, rating_min = excluded.rating_min, rating_max = excluded.rating_max, version = excluded.version, enabled = excluded.enabled, row_json = excluded.row_json, updated_at = excluded.updated_at
        `, [
          `adult_scenario_${pack.scenarioPackId}`,
          pack.scenarioPackId,
          pack.title,
          pack.premise,
          JSON.stringify(pack.participantRoles),
          JSON.stringify(pack.requiredRelationshipStages),
          JSON.stringify(pack.requiredSetup),
          JSON.stringify(pack.locationOptions),
          JSON.stringify(pack.emotionalToneOptions),
          JSON.stringify(pack.stageTemplate),
          pack.narrativePurpose,
          pack.consequenceTemplate,
          JSON.stringify(pack.compatibleTags),
          JSON.stringify(pack.incompatibleTags),
          pack.ratingRange[0],
          pack.ratingRange[1],
          pack.version,
          pack.enabled ? 1 : 0,
          JSON.stringify(pack),
          now,
          now,
        ]);
        this.connection.run("DELETE FROM adult_scenario_pack_tags WHERE scenario_pack_id = ?", [pack.scenarioPackId]);
        for (const tagId of pack.compatibleTags) {
          this.connection.run("INSERT OR IGNORE INTO adult_scenario_pack_tags(scenario_pack_id, tag_id) VALUES(?,?)", [pack.scenarioPackId, tagId]);
        }
        this.connection.run(
          "INSERT OR IGNORE INTO adult_scenario_pack_versions(id, scenario_pack_id, version, row_json, created_at) VALUES(?,?,?,?,?)",
          [`adult_scenario_version_${pack.scenarioPackId}_${pack.version}`, pack.scenarioPackId, pack.version, JSON.stringify(pack), now],
        );
      }
    });
    return this.registryStats();
  }

  registryStats() {
    return {
      taxonomyVersion: ADULT_TAXONOMY_VERSION,
      categoryCount: Number(this.connection.get("SELECT count(*) AS count FROM adult_taxonomy_categories")?.count ?? 0),
      tagCount: Number(this.connection.get("SELECT count(*) AS count FROM adult_taxonomy_tags")?.count ?? 0),
      scenarioPackCount: Number(this.connection.get("SELECT count(*) AS count FROM adult_scenario_packs")?.count ?? 0),
    };
  }

  listCategories() {
    return this.connection.all("SELECT row_json FROM adult_taxonomy_categories WHERE enabled = 1 ORDER BY ordinal ASC").map((row) => JSON.parse(String(row.row_json)));
  }

  listTags(categoryId?: AdultTaxonomyCategoryId) {
    const rows = categoryId
      ? this.connection.all("SELECT row_json FROM adult_taxonomy_tags WHERE enabled = 1 AND category_id = ? ORDER BY display_name ASC", [categoryId])
      : this.connection.all("SELECT row_json FROM adult_taxonomy_tags WHERE enabled = 1 ORDER BY display_name ASC");
    return rows.map((row) => JSON.parse(String(row.row_json)));
  }

  searchTags(input: { query?: string; categoryId?: AdultTaxonomyCategoryId; includeAdultOnly?: boolean; limit?: number }) {
    return searchAdultTaxonomyTags(input, this.listTags());
  }

  setTagPreference(tagId: string, weight: number) {
    this.ensureProject();
    const now = new Date().toISOString();
    const row = { projectId: this.projectId, tagId, weight };
    this.connection.run(`
      INSERT INTO project_adult_taxonomy_preferences(project_id, tag_id, weight, row_json, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(project_id, tag_id) DO UPDATE SET weight = excluded.weight, row_json = excluded.row_json, updated_at = excluded.updated_at
    `, [this.projectId, tagId, weight, JSON.stringify(row), now]);
    return row;
  }

  addTagExclusion(tagId: string, reason = "author_exclusion") {
    this.ensureProject();
    const now = new Date().toISOString();
    const row = { projectId: this.projectId, tagId, reason };
    this.connection.run(`
      INSERT INTO project_adult_taxonomy_exclusions(project_id, tag_id, reason, row_json, updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(project_id, tag_id) DO UPDATE SET reason = excluded.reason, row_json = excluded.row_json, updated_at = excluded.updated_at
    `, [this.projectId, tagId, reason, JSON.stringify(row), now]);
    return row;
  }

  removeTagExclusion(tagId: string) {
    this.connection.run("DELETE FROM project_adult_taxonomy_exclusions WHERE project_id = ? AND tag_id = ?", [this.projectId, tagId]);
  }

  favoriteScenario(scenarioPackId: string) {
    this.ensureProject();
    const row = { projectId: this.projectId, scenarioPackId };
    this.connection.run("INSERT OR REPLACE INTO adult_scenario_favorites(project_id, scenario_pack_id, row_json) VALUES(?,?,?)", [this.projectId, scenarioPackId, JSON.stringify(row)]);
    return row;
  }

  hideScenario(scenarioPackId: string, reason = "author_hidden") {
    this.ensureProject();
    const row = { projectId: this.projectId, scenarioPackId, reason };
    this.connection.run("INSERT OR REPLACE INTO adult_scenario_hidden(project_id, scenario_pack_id, row_json) VALUES(?,?,?)", [this.projectId, scenarioPackId, JSON.stringify(row)]);
    return row;
  }

  recordScenarioUsage(scenarioPackId: string, metadata: Record<string, unknown> = {}) {
    this.ensureProject();
    const now = new Date().toISOString();
    const row = { projectId: this.projectId, scenarioPackId, usedAt: now, ...metadata };
    const id = `adult_scenario_usage_${hash(`${this.projectId}|${scenarioPackId}|${now}`).slice(0, 24)}`;
    this.connection.run("INSERT INTO adult_scenario_usage(id, project_id, scenario_pack_id, used_at, row_json) VALUES(?,?,?,?,?)", [id, this.projectId, scenarioPackId, now, JSON.stringify(row)]);
    return row;
  }

  recordScenarioFeedback(scenarioPackId: string, rating: number, feedbackText?: string) {
    this.ensureProject();
    const row = { projectId: this.projectId, scenarioPackId, rating, feedbackText };
    const id = `adult_scenario_feedback_${hash(`${this.projectId}|${scenarioPackId}|${Date.now()}`).slice(0, 24)}`;
    this.connection.run("INSERT INTO adult_scenario_feedback(id, project_id, scenario_pack_id, rating, feedback_text, row_json) VALUES(?,?,?,?,?,?)", [id, this.projectId, scenarioPackId, rating, feedbackText ?? null, JSON.stringify(row)]);
    return row;
  }

  discoverScenarios(input: Omit<ScenarioDiscoveryInput, "projectId"> = {}) {
    this.seedRegistry();
    const context = {
      ...input,
      projectId: this.projectId,
      preferredTagWeights: this.preferenceWeights(),
      excludedTagIds: this.excludedTags(),
      recentlyUsedScenarioIds: this.recentScenarioIds(),
      favoriteScenarioIds: this.favoriteScenarioIds(),
      hiddenScenarioIds: this.hiddenScenarioIds(),
    };
    return discoverAdultScenarios(context);
  }

  surpriseScenario(input: Omit<ScenarioDiscoveryInput, "projectId"> = {}) {
    return surpriseAdultScenario({
      ...input,
      projectId: this.projectId,
      preferredTagWeights: this.preferenceWeights(),
      excludedTagIds: this.excludedTags(),
      recentlyUsedScenarioIds: this.recentScenarioIds(),
      favoriteScenarioIds: this.favoriteScenarioIds(),
      hiddenScenarioIds: this.hiddenScenarioIds(),
    });
  }

  varyScenario(scenarioPackId: string, seed = "default") {
    const proposal = this.discoverScenarios({ selectedTags: this.packTags(scenarioPackId), seed, limit: 16 }).find((item) => item.scenarioPackId === scenarioPackId);
    return proposal ? createAdultScenarioVariation(proposal, seed) : null;
  }

  private preferenceWeights() {
    return Object.fromEntries(this.connection.all("SELECT tag_id, weight FROM project_adult_taxonomy_preferences WHERE project_id = ?", [this.projectId]).map((row) => [String(row.tag_id), Number(row.weight)]));
  }

  private excludedTags() {
    return this.connection.all("SELECT tag_id FROM project_adult_taxonomy_exclusions WHERE project_id = ?", [this.projectId]).map((row) => String(row.tag_id));
  }

  private recentScenarioIds() {
    return this.connection.all("SELECT scenario_pack_id FROM adult_scenario_usage WHERE project_id = ? ORDER BY used_at DESC LIMIT 10", [this.projectId]).map((row) => String(row.scenario_pack_id));
  }

  private favoriteScenarioIds() {
    return this.connection.all("SELECT scenario_pack_id FROM adult_scenario_favorites WHERE project_id = ?", [this.projectId]).map((row) => String(row.scenario_pack_id));
  }

  private hiddenScenarioIds() {
    return this.connection.all("SELECT scenario_pack_id FROM adult_scenario_hidden WHERE project_id = ?", [this.projectId]).map((row) => String(row.scenario_pack_id));
  }

  private packTags(scenarioPackId: string) {
    const row = this.connection.get("SELECT compatible_tags_json FROM adult_scenario_packs WHERE scenario_pack_id = ?", [scenarioPackId]);
    return row ? JSON.parse(String(row.compatible_tags_json)) as string[] : [];
  }
}

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
