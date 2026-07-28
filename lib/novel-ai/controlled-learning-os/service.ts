import {
  assertClosedAINamespace,
  sameClosedAINamespace,
  sha256Hex,
  stableStringify,
  type ClosedAINamespace,
} from "../closed-ai-cache";
import { inspectControlledLearningPrivacy, type ControlledLearningPrivacyInput } from "./privacy-filter";
import {
  MemoryControlledLearningRepository,
  type ControlledLearningRepository,
} from "./repository";
import {
  CONTROLLED_LEARNING_SCHEMA_VERSION,
  type ControlledLearningABTest,
  type ControlledLearningCandidate,
  type ControlledLearningConsent,
  type ControlledLearningDataset,
  type ControlledLearningExperience,
  type ControlledLearningExport,
  type ControlledLearningKillSwitch,
  type ControlledLearningOutcome,
  type ControlledLearningVersion,
  type ControlledKnowledgeRule,
  type ControlledKnowledgeTransformation,
} from "./types";

type ServiceOptions = {
  repository?: ControlledLearningRepository;
  now?: () => Date;
};

export type ControlledLearningExperienceInput = ControlledLearningPrivacyInput & {
  namespace: ClosedAINamespace;
  outcome: ControlledLearningOutcome;
  taskType: string;
  featureText?: string;
  resultText?: string;
  editDistance?: number | null;
  score?: number | null;
  tags?: string[];
  sourceApprovalId?: string | null;
};

export type ControlledLearningCollectionResult =
  | {
    collected: true;
    experience: ControlledLearningExperience;
    reasonCode: null;
  }
  | {
    collected: false;
    experience: null;
    reasonCode: string;
  };

export type ControlledLearningActiveConfiguration = {
  applied: boolean;
  versionId: string | null;
  configurationDigest: string | null;
  configuration: Record<string, string | number | boolean>;
  reasonCode: string | null;
};

function error(code: string, message = code, detailCodes: string[] = []) {
  return Object.assign(new Error(message), { code, detailCodes });
}

function outcomeLabel(outcome: ControlledLearningOutcome): ControlledLearningExperience["outcomeLabel"] {
  if (outcome === "rejected" || outcome === "abandoned") return "negative";
  if (outcome === "edited") return "edited";
  if (["consistency_result", "tool_result", "planner_result"].includes(outcome)) return "verified";
  return "positive";
}

function normalizedForCopyCheck(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hant")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function copyOverlap(source: string, rule: string) {
  const normalizedSource = normalizedForCopyCheck(source);
  const normalizedRule = normalizedForCopyCheck(rule);
  if (normalizedRule.length < 8) return normalizedSource.includes(normalizedRule) ? 1 : 0;
  if (normalizedSource.includes(normalizedRule)) return 1;
  const width = Math.min(8, Math.max(4, Math.floor(normalizedRule.length / 4)));
  const shingles = new Set<string>();
  for (let index = 0; index <= normalizedRule.length - width; index += 1) {
    shingles.add(normalizedRule.slice(index, index + width));
  }
  if (!shingles.size) return 0;
  let matches = 0;
  for (const shingle of shingles) {
    if (normalizedSource.includes(shingle)) matches += 1;
  }
  return matches / shingles.size;
}

export class ControlledLearningOS {
  readonly repository: ControlledLearningRepository;
  private readonly now: () => Date;

  constructor(options: ServiceOptions = {}) {
    this.repository = options.repository ?? new MemoryControlledLearningRepository();
    this.now = options.now ?? (() => new Date());
  }

  async setConsent(input: {
    namespace: ClosedAINamespace;
    enabled: boolean;
    allowedOutcomes?: ControlledLearningOutcome[];
    expiresAt?: string | null;
  }): Promise<ControlledLearningConsent> {
    assertClosedAINamespace(input.namespace);
    const id = `learning-consent:${await sha256Hex(stableStringify(input.namespace))}`;
    const previous = await this.repository.get<ControlledLearningConsent>(id);
    const consent: ControlledLearningConsent = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      kind: "consent",
      id,
      projectId: input.namespace.projectId,
      namespace: structuredClone(input.namespace),
      enabled: input.enabled,
      allowedLevels: ["L0", "L1"],
      allowedOutcomes: input.allowedOutcomes ?? [
        "accepted",
        "rejected",
        "edited",
        "final_choice",
        "consistency_result",
        "tool_result",
        "planner_result",
        "approved_story_bible",
        "approved_canon",
        "abandoned",
      ],
      consentedAt: this.now().toISOString(),
      expiresAt: input.expiresAt ?? null,
      revision: (previous?.revision ?? 0) + 1,
    };
    await this.repository.put(consent);
    return consent;
  }

  async setKillSwitch(projectId: string, engaged: boolean, reasonCode?: string) {
    const id = `learning-kill-switch:${projectId}`;
    const previous = await this.repository.get<ControlledLearningKillSwitch>(id);
    const record: ControlledLearningKillSwitch = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      kind: "kill-switch",
      id,
      projectId,
      engaged,
      reasonCode: engaged ? (reasonCode ?? "USER_ENGAGED") : null,
      updatedAt: this.now().toISOString(),
      revision: (previous?.revision ?? 0) + 1,
    };
    await this.repository.put(record);
    return record;
  }

  private async requireLearningAllowed(namespace: ClosedAINamespace, outcome?: ControlledLearningOutcome) {
    assertClosedAINamespace(namespace);
    const killSwitch = await this.repository.get<ControlledLearningKillSwitch>(
      `learning-kill-switch:${namespace.projectId}`,
    );
    if (killSwitch?.engaged) throw error("CONTROLLED_LEARNING_KILL_SWITCH_ENGAGED");
    const consentId = `learning-consent:${await sha256Hex(stableStringify(namespace))}`;
    const consent = await this.repository.get<ControlledLearningConsent>(consentId);
    if (!consent || !consent.enabled || !sameClosedAINamespace(consent.namespace, namespace)) {
      throw error("CONTROLLED_LEARNING_CONSENT_REQUIRED");
    }
    if (consent.expiresAt && Date.parse(consent.expiresAt) <= this.now().getTime()) {
      throw error("CONTROLLED_LEARNING_CONSENT_EXPIRED");
    }
    if (outcome && !consent.allowedOutcomes.includes(outcome)) {
      throw error("CONTROLLED_LEARNING_OUTCOME_NOT_CONSENTED");
    }
    return consent;
  }

  async collectExperience(
    input: ControlledLearningExperienceInput,
  ): Promise<ControlledLearningExperience> {
    await this.requireLearningAllowed(input.namespace, input.outcome);
    const privacy = inspectControlledLearningPrivacy(input, {
      tenantId: input.namespace.tenantId,
      projectId: input.namespace.projectId,
      canonId: input.namespace.canonId,
    });
    if (!privacy.passed) {
      throw error(
        "CONTROLLED_LEARNING_PRIVACY_FILTER_BLOCKED",
        "This experience cannot enter the controlled learning dataset.",
        privacy.blockingCodes,
      );
    }
    if (
      ["approved_story_bible", "approved_canon"].includes(input.outcome)
      && !input.sourceApprovalId
    ) {
      throw error("CONTROLLED_LEARNING_APPROVAL_REFERENCE_REQUIRED");
    }
    const createdAt = this.now().toISOString();
    const identity = await sha256Hex(stableStringify({
      namespace: input.namespace,
      outcome: input.outcome,
      taskType: input.taskType,
      createdAt,
      nonce: crypto.randomUUID(),
    }));
    const record: ControlledLearningExperience = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      kind: "experience",
      id: `learning-experience:${identity}`,
      projectId: input.namespace.projectId,
      namespace: structuredClone(input.namespace),
      outcome: input.outcome,
      outcomeLabel: outcomeLabel(input.outcome),
      taskType: input.taskType,
      featureDigest: await sha256Hex(input.featureText ?? stableStringify({
        taskType: input.taskType,
        tags: input.tags ?? [],
      })),
      resultDigest: input.resultText ? await sha256Hex(input.resultText) : null,
      editDistance: input.editDistance ?? null,
      score: input.score ?? null,
      tags: [...new Set(input.tags ?? [])].slice(0, 32),
      sourceApprovalId: input.sourceApprovalId ?? null,
      abandonedAsNegativeOnly: input.outcome === "abandoned",
      rawInputStored: false,
      rawOutputStored: false,
      rawChainOfThoughtStored: false,
      createdAt,
    };
    await this.repository.put(record);
    return record;
  }

  async collectExperienceIfConsented(
    input: ControlledLearningExperienceInput,
  ): Promise<ControlledLearningCollectionResult> {
    try {
      return {
        collected: true,
        experience: await this.collectExperience(input),
        reasonCode: null,
      };
    } catch (cause) {
      const code = String((cause as { code?: string })?.code || "");
      return {
        collected: false,
        experience: null,
        reasonCode: code.startsWith("CONTROLLED_LEARNING_")
          ? code
          : "CONTROLLED_LEARNING_COLLECTION_FAILED",
      };
    }
  }

  async activeConfiguration(
    namespace: ClosedAINamespace,
  ): Promise<ControlledLearningActiveConfiguration> {
    try {
      await this.requireLearningAllowed(namespace);
      const versions = await this.repository.list<ControlledLearningVersion>(
        namespace.projectId,
        "version",
      );
      const active = versions
        .filter((version) =>
          version.status === "active"
          && sameClosedAINamespace(version.namespace, namespace))
        .sort((left, right) => right.version - left.version)[0];
      if (!active) {
        return {
          applied: false,
          versionId: null,
          configurationDigest: null,
          configuration: {},
          reasonCode: "CONTROLLED_LEARNING_NO_ACTIVE_VERSION",
        };
      }
      return {
        applied: true,
        versionId: active.id,
        configurationDigest: active.configurationDigest,
        configuration: structuredClone(active.configuration),
        reasonCode: null,
      };
    } catch (cause) {
      const code = String((cause as { code?: string })?.code || "");
      return {
        applied: false,
        versionId: null,
        configurationDigest: null,
        configuration: {},
        reasonCode: code.startsWith("CONTROLLED_LEARNING_")
          ? code
          : "CONTROLLED_LEARNING_CONFIGURATION_UNAVAILABLE",
      };
    }
  }

  async createCandidate(input: {
    namespace: ClosedAINamespace;
    level: "L0" | "L1";
    candidateType: ControlledLearningCandidate["candidateType"];
    experienceIds: string[];
    proposal: Record<string, string | number | boolean>;
  }): Promise<ControlledLearningCandidate> {
    await this.requireLearningAllowed(input.namespace);
    if (!input.experienceIds.length) throw error("CONTROLLED_LEARNING_EXPERIENCE_REQUIRED");
    const experiences = await Promise.all(
      input.experienceIds.map((id) => this.repository.get<ControlledLearningExperience>(id)),
    );
    if (experiences.some((record) =>
      !record || !sameClosedAINamespace(record.namespace, input.namespace))) {
      throw error("CONTROLLED_LEARNING_EXPERIENCE_SCOPE_MISMATCH");
    }
    const createdAt = this.now().toISOString();
    const proposalDigest = await sha256Hex(stableStringify(input.proposal));
    const candidate: ControlledLearningCandidate = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      kind: "candidate",
      id: `learning-candidate:${await sha256Hex(stableStringify({
        namespace: input.namespace,
        input: input.experienceIds,
        proposalDigest,
        createdAt,
      }))}`,
      projectId: input.namespace.projectId,
      namespace: structuredClone(input.namespace),
      level: input.level,
      candidateType: input.candidateType,
      status: "candidate",
      experienceIds: [...new Set(input.experienceIds)],
      proposal: structuredClone(input.proposal),
      proposalDigest,
      evaluation: null,
      humanApproval: null,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    };
    await this.repository.put(candidate);
    return candidate;
  }

  async createApprovedRulePackCandidate(input: {
    namespace: ClosedAINamespace;
    approvedRuleIds: string[];
    rulePackDigest: string;
  }) {
    if (!input.approvedRuleIds.length) throw error("CONTROLLED_LEARNING_APPROVED_RULES_REQUIRED");
    const synthetic = await this.collectExperience({
      namespace: input.namespace,
      outcome: "approved_canon",
      taskType: "learning.approved-rule-pack",
      tags: input.approvedRuleIds.map((id) => `rule:${id}`).slice(0, 32),
      sourceApprovalId: input.rulePackDigest,
    });
    return this.createCandidate({
      namespace: input.namespace,
      level: "L1",
      candidateType: "approved-rule-pack",
      experienceIds: [synthetic.id],
      proposal: {
        rulePackDigest: input.rulePackDigest,
        approvedRuleCount: input.approvedRuleIds.length,
      },
    });
  }

  async createKnowledgeRulePackCandidate(input: {
    namespace: ClosedAINamespace;
    sourceText: string;
    sourceTitle?: string;
    sourceType: "user-provided-article" | "ai-export" | "reference-notes";
    rules: ControlledKnowledgeRule[];
    humanConfirmedRights: boolean;
    sourceTenantId?: string;
    sourceProjectId?: string;
    sourceCanonId?: string;
  }): Promise<ControlledKnowledgeTransformation> {
    await this.requireLearningAllowed(input.namespace, "planner_result");
    if (!input.humanConfirmedRights) {
      throw error("CONTROLLED_LEARNING_SOURCE_RIGHTS_CONFIRMATION_REQUIRED");
    }
    const sourceText = input.sourceText.trim();
    if (sourceText.length < 40) {
      throw error("CONTROLLED_LEARNING_SOURCE_TOO_SHORT");
    }
    if (!input.rules.length || input.rules.length > 64) {
      throw error("CONTROLLED_LEARNING_RULE_COUNT_INVALID");
    }
    const ids = new Set<string>();
    for (const rule of input.rules) {
      if (
        !rule.id.trim()
        || ids.has(rule.id)
        || rule.statement.trim().length < 4
        || rule.statement.length > 800
      ) {
        throw error("CONTROLLED_LEARNING_RULE_INVALID");
      }
      ids.add(rule.id);
    }
    const transformedText = stableStringify(input.rules);
    const privacy = inspectControlledLearningPrivacy({
      featureText: sourceText,
      resultText: transformedText,
      sourceTenantId: input.sourceTenantId,
      sourceProjectId: input.sourceProjectId,
      sourceCanonId: input.sourceCanonId,
    }, {
      tenantId: input.namespace.tenantId,
      projectId: input.namespace.projectId,
      canonId: input.namespace.canonId,
    });
    if (!privacy.passed) {
      throw error(
        "CONTROLLED_LEARNING_PRIVACY_FILTER_BLOCKED",
        "This source cannot enter the controlled knowledge transformation flow.",
        privacy.blockingCodes,
      );
    }
    if (input.rules.some((rule) => copyOverlap(sourceText, rule.statement) >= 0.72)) {
      throw error(
        "CONTROLLED_LEARNING_VERBATIM_COPY_RISK",
        "The transformed rule pack is too similar to the source wording.",
      );
    }
    const sourceDigest = await sha256Hex(sourceText);
    const transformationDigest = await sha256Hex(stableStringify({
      sourceDigest,
      sourceTitleDigest: input.sourceTitle ? await sha256Hex(input.sourceTitle) : null,
      sourceType: input.sourceType,
      rules: input.rules,
    }));
    const experience = await this.collectExperience({
      namespace: input.namespace,
      outcome: "planner_result",
      taskType: "knowledge.ruleSynthesis",
      featureText: sourceText,
      resultText: transformedText,
      tags: [
        "knowledge-transformation",
        `source:${input.sourceType}`,
        ...input.rules.map((rule) => `rule-category:${rule.category}`),
      ],
      sourceTenantId: input.sourceTenantId,
      sourceProjectId: input.sourceProjectId,
      sourceCanonId: input.sourceCanonId,
      sourceApprovalId: transformationDigest,
    });
    const proposal: Record<string, string | number | boolean> = {
      sourceDigest,
      transformationDigest,
      ruleCount: input.rules.length,
      sourceContentStored: false,
      verbatimCopyStored: false,
    };
    input.rules.forEach((rule, index) => {
      proposal[`rule.${index + 1}.id`] = rule.id;
      proposal[`rule.${index + 1}.category`] = rule.category;
      proposal[`rule.${index + 1}.statement`] = rule.statement.trim();
    });
    const candidate = await this.createCandidate({
      namespace: input.namespace,
      level: "L1",
      candidateType: "knowledge-rule-pack",
      experienceIds: [experience.id],
      proposal,
    });
    return {
      candidate,
      sourceDigest,
      transformationDigest,
      ruleCount: input.rules.length,
      sourceContentStored: false,
      verbatimCopyStored: false,
      copyingRiskCheck: "passed",
    };
  }

  async evaluateCandidate(
    candidateId: string,
    input: { score: number; blockingCodes?: string[] },
  ): Promise<ControlledLearningCandidate> {
    const candidate = await this.requireCandidate(candidateId);
    if (!["candidate", "evaluated"].includes(candidate.status)) {
      throw error("CONTROLLED_LEARNING_CANDIDATE_STATE_INVALID");
    }
    const blockingCodes = [...new Set(input.blockingCodes ?? [])];
    const experienceCount = candidate.experienceIds.length;
    const updated: ControlledLearningCandidate = {
      ...candidate,
      status: "evaluated",
      evaluation: {
        score: Math.max(0, Math.min(1, input.score)),
        sampleCount: experienceCount,
        blockingCodes,
        evaluatedAt: this.now().toISOString(),
      },
      updatedAt: this.now().toISOString(),
      revision: candidate.revision + 1,
    };
    await this.repository.put(updated);
    return updated;
  }

  async approveCandidate(
    candidateId: string,
    input: { approvedBy: string; approvalId: string; humanApproved: boolean },
  ): Promise<ControlledLearningCandidate> {
    const candidate = await this.requireCandidate(candidateId);
    if (!input.humanApproved) throw error("CONTROLLED_LEARNING_HUMAN_APPROVAL_REQUIRED");
    if (
      candidate.status !== "evaluated"
      || !candidate.evaluation
      || candidate.evaluation.score < 0.6
      || candidate.evaluation.blockingCodes.length
    ) {
      throw error("CONTROLLED_LEARNING_EVALUATION_GATE_FAILED");
    }
    const approvedAt = this.now().toISOString();
    const updated: ControlledLearningCandidate = {
      ...candidate,
      status: "approved",
      humanApproval: {
        approvedBy: input.approvedBy,
        approvalId: input.approvalId,
        approvedAt,
      },
      updatedAt: approvedAt,
      revision: candidate.revision + 1,
    };
    await this.repository.put(updated);
    return updated;
  }

  async rejectCandidate(candidateId: string): Promise<ControlledLearningCandidate> {
    const candidate = await this.requireCandidate(candidateId);
    const updated: ControlledLearningCandidate = {
      ...candidate,
      status: "rejected",
      updatedAt: this.now().toISOString(),
      revision: candidate.revision + 1,
    };
    await this.repository.put(updated);
    return updated;
  }

  async createDataset(
    candidateId: string,
    humanApproved: boolean,
  ): Promise<ControlledLearningDataset> {
    const candidate = await this.requireCandidate(candidateId);
    if (!humanApproved || !candidate.humanApproval || candidate.status !== "approved") {
      throw error("CONTROLLED_LEARNING_DATASET_APPROVAL_REQUIRED");
    }
    const createdAt = this.now().toISOString();
    const dataset: ControlledLearningDataset = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      kind: "dataset",
      id: `learning-dataset:${candidate.id}`,
      projectId: candidate.projectId,
      namespace: structuredClone(candidate.namespace),
      level: candidate.level,
      experienceIds: [...candidate.experienceIds],
      contentDigest: await sha256Hex(stableStringify({
        experienceIds: candidate.experienceIds,
        proposalDigest: candidate.proposalDigest,
      })),
      status: "approved",
      rawContentStored: false,
      createdAt,
      approvedAt: createdAt,
      revokedAt: null,
    };
    await this.repository.put(dataset);
    return dataset;
  }

  async startABTest(input: {
    candidateId: string;
    baselineVersionId?: string | null;
    minimumSamples?: number;
    requiredImprovement?: number;
  }): Promise<ControlledLearningABTest> {
    const candidate = await this.requireCandidate(input.candidateId);
    if (candidate.status !== "approved" || !candidate.humanApproval) {
      throw error("CONTROLLED_LEARNING_CANDIDATE_APPROVAL_REQUIRED");
    }
    if (input.baselineVersionId) {
      const baseline = await this.repository.get<ControlledLearningVersion>(input.baselineVersionId);
      if (!baseline || !sameClosedAINamespace(baseline.namespace, candidate.namespace)) {
        throw error("CONTROLLED_LEARNING_BASELINE_SCOPE_MISMATCH");
      }
    }
    const createdAt = this.now().toISOString();
    const test: ControlledLearningABTest = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      kind: "ab-test",
      id: `learning-ab:${await sha256Hex(`${candidate.id}|${createdAt}`)}`,
      projectId: candidate.projectId,
      namespace: structuredClone(candidate.namespace),
      candidateId: candidate.id,
      baselineVersionId: input.baselineVersionId ?? null,
      status: "running",
      minimumSamples: Math.max(2, input.minimumSamples ?? 10),
      requiredImprovement: Math.max(0, input.requiredImprovement ?? 0.03),
      baselineScores: [],
      candidateScores: [],
      createdAt,
      completedAt: null,
    };
    await this.repository.put(test);
    await this.repository.put({
      ...candidate,
      status: "testing",
      updatedAt: createdAt,
      revision: candidate.revision + 1,
    });
    return test;
  }

  async recordABSample(testId: string, baselineScore: number, candidateScore: number) {
    const test = await this.repository.get<ControlledLearningABTest>(testId);
    if (!test || test.status !== "running") throw error("CONTROLLED_LEARNING_AB_TEST_NOT_RUNNING");
    const next: ControlledLearningABTest = {
      ...test,
      baselineScores: [...test.baselineScores, baselineScore],
      candidateScores: [...test.candidateScores, candidateScore],
    };
    if (next.candidateScores.length >= next.minimumSamples) {
      const baselineMean = mean(next.baselineScores);
      const candidateMean = mean(next.candidateScores);
      next.status = candidateMean - baselineMean >= next.requiredImprovement ? "passed" : "failed";
      next.completedAt = this.now().toISOString();
    }
    await this.repository.put(next);
    return next;
  }

  async adoptCandidate(candidateId: string, testId: string): Promise<ControlledLearningVersion> {
    const [candidate, test] = await Promise.all([
      this.requireCandidate(candidateId),
      this.repository.get<ControlledLearningABTest>(testId),
    ]);
    if (
      !test
      || test.candidateId !== candidate.id
      || test.status !== "passed"
      || !sameClosedAINamespace(test.namespace, candidate.namespace)
    ) {
      throw error("CONTROLLED_LEARNING_AB_ADOPTION_GATE_FAILED");
    }
    const versions = await this.repository.list<ControlledLearningVersion>(candidate.projectId, "version");
    const scoped = versions
      .filter((version) => sameClosedAINamespace(version.namespace, candidate.namespace))
      .sort((left, right) => right.version - left.version);
    const active = scoped.find((version) => version.status === "active") ?? null;
    if (active) await this.repository.put({ ...active, status: "superseded" });
    const adoptedAt = this.now().toISOString();
    const version: ControlledLearningVersion = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      kind: "version",
      id: `learning-version:${await sha256Hex(`${candidate.id}|${adoptedAt}`)}`,
      projectId: candidate.projectId,
      namespace: structuredClone(candidate.namespace),
      version: (scoped[0]?.version ?? 0) + 1,
      candidateId: candidate.id,
      status: "active",
      configuration: structuredClone(candidate.proposal),
      configurationDigest: candidate.proposalDigest,
      parentVersionId: active?.id ?? null,
      adoptedAt,
      rolledBackAt: null,
    };
    await this.repository.put(version);
    await this.repository.put({
      ...candidate,
      status: "adopted",
      updatedAt: adoptedAt,
      revision: candidate.revision + 1,
    });
    return version;
  }

  async rollbackVersion(versionId: string): Promise<ControlledLearningVersion | null> {
    const version = await this.repository.get<ControlledLearningVersion>(versionId);
    if (!version || version.status !== "active") {
      throw error("CONTROLLED_LEARNING_ACTIVE_VERSION_NOT_FOUND");
    }
    const rolledBackAt = this.now().toISOString();
    await this.repository.put({
      ...version,
      status: "rolled_back",
      rolledBackAt,
    });
    const candidate = await this.requireCandidate(version.candidateId);
    await this.repository.put({
      ...candidate,
      status: "rolled_back",
      updatedAt: rolledBackAt,
      revision: candidate.revision + 1,
    });
    if (!version.parentVersionId) return null;
    const parent = await this.repository.get<ControlledLearningVersion>(version.parentVersionId);
    if (!parent || !sameClosedAINamespace(parent.namespace, version.namespace)) {
      throw error("CONTROLLED_LEARNING_ROLLBACK_PARENT_INVALID");
    }
    const restored: ControlledLearningVersion = {
      ...parent,
      status: "active",
      rolledBackAt: null,
    };
    await this.repository.put(restored);
    return restored;
  }

  async exportProject(projectId: string): Promise<ControlledLearningExport> {
    const body = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      projectId,
      exportedAt: this.now().toISOString(),
      records: await this.repository.list(projectId),
      rawContentIncluded: false as const,
    };
    return {
      ...body,
      contentDigest: await sha256Hex(stableStringify(body)),
    };
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.repository.clearProject(projectId);
  }

  async dashboard(projectId: string) {
    const records = await this.repository.list(projectId);
    return {
      persistence: this.repository.kind,
      consentEnabled: records.some((record) => record.kind === "consent" && record.enabled),
      killSwitchEngaged: records.some((record) => record.kind === "kill-switch" && record.engaged),
      experiences: records.filter((record) => record.kind === "experience").length,
      candidates: records.filter((record) => record.kind === "candidate").length,
      activeVersions: records.filter((record) => record.kind === "version" && record.status === "active").length,
      runningTests: records.filter((record) => record.kind === "ab-test" && record.status === "running").length,
      rawContentStored: false,
      rawChainOfThoughtStored: false,
      modelTraining: "not_started" as const,
      distillation: "not_started" as const,
    };
  }

  private async requireCandidate(candidateId: string) {
    const candidate = await this.repository.get<ControlledLearningCandidate>(candidateId);
    if (!candidate) throw error("CONTROLLED_LEARNING_CANDIDATE_NOT_FOUND");
    await this.requireLearningAllowed(candidate.namespace);
    return candidate;
  }
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export const CONTROLLED_LEARNING_HEALTH = {
  schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
  status: "ready",
  experienceCollectorStatus: "ready",
  privacyFilterStatus: "ready",
  outcomeLabelStatus: "ready",
  evaluatorStatus: "ready",
  candidateReviewStatus: "ready",
  humanApprovalStatus: "ready",
  versionedStoreStatus: "ready",
  abTestingStatus: "ready",
  adoptionRollbackStatus: "ready",
  consentStatus: "ready",
  exportDeleteStatus: "ready",
  killSwitchStatus: "ready",
  l0PreferenceLearningStatus: "ready",
  l1PolicyLearningStatus: "ready",
  knowledgeTransformationStatus: "ready",
  sourceRightsConfirmationStatus: "ready",
  nonCopyingRuleGateStatus: "ready",
  activeConfigurationApplicationStatus: "ready",
  approvedOutcomeIntegrationStatus: "ready",
  l2AdapterStatus: "contract_only",
  l3PrivateTrainingStatus: "not_started",
  modelTraining: "not_started",
  distillation: "not_started",
  rawChainOfThoughtStored: false,
  silentTraining: false,
} as const;
