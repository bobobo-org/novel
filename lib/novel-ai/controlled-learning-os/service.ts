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
  assertControlledLearningProposal,
  sanitizeControlledLearningConfiguration,
} from "./runtime-policy";
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
  type ControlledLearningSourceClass,
  type ControlledLearningVersion,
  type ControlledKnowledgeRule,
  type ControlledKnowledgeTransformation,
} from "./types";

export type ControlledLearningApprovalVerificationInput = {
  candidate: ControlledLearningCandidate;
  approvedBy: string;
  approvalId: string;
  approvalTransactionId: string;
  approvalTransactionDigest: string;
};

type ServiceOptions = {
  repository?: ControlledLearningRepository;
  now?: () => Date;
  verifyApprovalTransaction?: (
    input: ControlledLearningApprovalVerificationInput,
  ) => Promise<boolean>;
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
  if ([
    "consistency_result",
    "character_consistency_result",
    "plot_continuity_result",
    "tool_result",
    "planner_result",
  ].includes(outcome)) return "verified";
  return "positive";
}

function sourceClass(outcome: ControlledLearningOutcome): ControlledLearningSourceClass {
  if (outcome === "rejected" || outcome === "abandoned") return "negative-label-only";
  if (outcome === "approved_story_bible" || outcome === "approved_canon") {
    return "approved-authority";
  }
  if ([
    "consistency_result",
    "character_consistency_result",
    "plot_continuity_result",
    "tool_result",
    "planner_result",
  ].includes(outcome)) {
    return "verified-runtime-result";
  }
  return "user-decision";
}

function normalizedScore(value: number, code: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw error(code);
  }
  return value;
}

function editDistance(left: string, right: string) {
  const a = [...left];
  const b = [...right];
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const upper = previous[column];
      previous[column] = a[row - 1] === b[column - 1]
        ? diagonal
        : Math.min(diagonal, previous[column - 1], upper) + 1;
      diagonal = upper;
    }
  }
  return previous[b.length];
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
  private readonly verifyApprovalTransaction:
    ServiceOptions["verifyApprovalTransaction"];
  private readonly mutationQueues = new Map<string, Promise<unknown>>();

  constructor(options: ServiceOptions = {}) {
    this.repository = options.repository ?? new MemoryControlledLearningRepository();
    this.now = options.now ?? (() => new Date());
    this.verifyApprovalTransaction = options.verifyApprovalTransaction;
  }

  async setConsent(input: {
    namespace: ClosedAINamespace;
    enabled: boolean;
    allowedOutcomes?: ControlledLearningOutcome[];
    expiresAt?: string | null;
  }): Promise<ControlledLearningConsent> {
    assertClosedAINamespace(input.namespace);
    if (
      input.expiresAt !== undefined
      && input.expiresAt !== null
      && !Number.isFinite(Date.parse(input.expiresAt))
    ) {
      throw error("CONTROLLED_LEARNING_CONSENT_EXPIRY_INVALID");
    }
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
        "regenerated_final_choice",
        "consistency_result",
        "character_consistency_result",
        "plot_continuity_result",
        "tool_result",
        "planner_result",
        "explicit_style_preference",
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
    if (
      !projectId.trim()
      || projectId.length > 200
      || (
        reasonCode
        && !/^[A-Z0-9_:-]{3,120}$/u.test(reasonCode)
      )
    ) {
      throw error("CONTROLLED_LEARNING_KILL_SWITCH_INPUT_INVALID");
    }
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
    if (!/^[A-Za-z0-9._:-]{3,120}$/u.test(input.taskType)) {
      throw error("CONTROLLED_LEARNING_TASK_TYPE_INVALID");
    }
    const negativeSignalOnly = input.outcome === "rejected" || input.outcome === "abandoned";
    const tags = [...new Set(input.tags ?? [])]
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 32);
    if (tags.some((tag) => tag.length > 120)) {
      throw error("CONTROLLED_LEARNING_TAG_INVALID");
    }
    if (
      input.sourceApprovalId
      && (
        input.sourceApprovalId.length > 200
        || !/^[A-Za-z0-9._:-]+$/u.test(input.sourceApprovalId)
      )
    ) {
      throw error("CONTROLLED_LEARNING_APPROVAL_REFERENCE_INVALID");
    }
    if (input.score !== undefined && input.score !== null) {
      normalizedScore(input.score, "CONTROLLED_LEARNING_SCORE_INVALID");
    }
    if (
      input.editDistance !== undefined
      && input.editDistance !== null
      && (!Number.isFinite(input.editDistance) || input.editDistance < 0)
    ) {
      throw error("CONTROLLED_LEARNING_EDIT_DISTANCE_INVALID");
    }
    const privacy = inspectControlledLearningPrivacy({
      ...input,
      featureText: [
        input.taskType,
        input.featureText ?? "",
        tags.join("\n"),
        input.sourceApprovalId ?? "",
      ].join("\n"),
      negativeLabelOnly: negativeSignalOnly,
    }, {
      tenantId: input.namespace.tenantId,
      userId: input.namespace.userId,
      projectId: input.namespace.projectId,
      storyId: input.namespace.storyId,
      canonId: input.namespace.canonId,
      branchId: input.namespace.branchId,
      characterId: input.namespace.characterId,
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
    const recordBody: Omit<ControlledLearningExperience, "recordDigest"> = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      kind: "experience",
      id: `learning-experience:${identity}`,
      projectId: input.namespace.projectId,
      namespace: structuredClone(input.namespace),
      outcome: input.outcome,
      outcomeLabel: outcomeLabel(input.outcome),
      sourceClass: sourceClass(input.outcome),
      taskType: input.taskType,
      featureDigest: await sha256Hex(input.featureText ?? stableStringify({
        taskType: input.taskType,
        tags: input.tags ?? [],
      })),
      resultDigest: input.resultText ? await sha256Hex(input.resultText) : null,
      editDistance: input.editDistance ?? null,
      score: input.score ?? null,
      tags,
      sourceApprovalId: input.sourceApprovalId ?? null,
      abandonedAsNegativeOnly: input.outcome === "abandoned",
      negativeSignalOnly,
      privacyFilterStatus: "passed",
      outcomeLabelingStatus: "completed",
      evaluatorEligible: true,
      formalLearningData: false,
      rawInputStored: false,
      rawOutputStored: false,
      rawChainOfThoughtStored: false,
      createdAt,
    };
    const record: ControlledLearningExperience = {
      ...recordBody,
      recordDigest: await sha256Hex(stableStringify(recordBody)),
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

  async recordUserEdit(input: {
    namespace: ClosedAINamespace;
    taskType: string;
    beforeText: string;
    afterText: string;
    finalSelected?: boolean;
    tags?: string[];
  }) {
    if (
      new TextEncoder().encode(input.beforeText).byteLength > 2 * 1024 * 1024
      || new TextEncoder().encode(input.afterText).byteLength > 2 * 1024 * 1024
    ) {
      throw error("CONTROLLED_LEARNING_EDIT_INPUT_TOO_LARGE");
    }
    const boundedBefore = input.beforeText.slice(0, 4_096);
    const boundedAfter = input.afterText.slice(0, 4_096);
    const overflowBefore = input.beforeText.length - boundedBefore.length;
    const overflowAfter = input.afterText.length - boundedAfter.length;
    const edited = await this.collectExperience({
      namespace: input.namespace,
      outcome: "edited",
      taskType: input.taskType,
      featureText: input.beforeText,
      resultText: input.afterText,
      editDistance: editDistance(boundedBefore, boundedAfter)
        + Math.abs(overflowBefore - overflowAfter),
      tags: ["user-edit", ...(input.tags ?? [])],
    });
    const finalChoice = input.finalSelected
      ? await this.collectExperience({
        namespace: input.namespace,
        outcome: "final_choice",
        taskType: input.taskType,
        featureText: input.afterText,
        tags: ["edited-final-choice", ...(input.tags ?? [])],
      })
      : null;
    return { edited, finalChoice };
  }

  recordRegeneratedFinalChoice(input: {
    namespace: ClosedAINamespace;
    taskType: string;
    selectedText: string;
    regenerationCount: number;
    tags?: string[];
  }) {
    if (
      !Number.isInteger(input.regenerationCount)
      || input.regenerationCount < 1
      || input.regenerationCount > 10_000
    ) {
      throw error("CONTROLLED_LEARNING_REGENERATION_COUNT_INVALID");
    }
    return this.collectExperience({
      namespace: input.namespace,
      outcome: "regenerated_final_choice",
      taskType: input.taskType,
      featureText: input.selectedText,
      tags: [
        "regenerated-final-choice",
        `regeneration-count:${input.regenerationCount}`,
        ...(input.tags ?? []),
      ],
    });
  }

  recordExplicitStylePreference(input: {
    namespace: ClosedAINamespace;
    preference: string;
    tags?: string[];
  }) {
    if (!input.preference.trim() || input.preference.length > 2_000) {
      throw error("CONTROLLED_LEARNING_STYLE_PREFERENCE_INVALID");
    }
    return this.collectExperience({
      namespace: input.namespace,
      outcome: "explicit_style_preference",
      taskType: "learning.explicitStylePreference",
      featureText: input.preference,
      tags: ["explicit-style-preference", ...(input.tags ?? [])],
    });
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
      let active: ControlledLearningVersion | null = null;
      const activeVersions = versions
        .filter((version) =>
          version.status === "active"
          && sameClosedAINamespace(version.namespace, namespace))
        .sort((left, right) => right.version - left.version);
      for (const version of activeVersions) {
        if (await this.isActiveVersionTrusted(version)) {
          active = version;
          break;
        }
      }
      if (!active) {
        return {
          applied: false,
          versionId: null,
          configurationDigest: null,
          configuration: {},
          reasonCode: "CONTROLLED_LEARNING_NO_ACTIVE_VERSION",
        };
      }
      const configuration = sanitizeControlledLearningConfiguration(active.configuration);
      if (!Object.keys(configuration).length && Object.keys(active.configuration).length) {
        return {
          applied: false,
          versionId: active.id,
          configurationDigest: active.configurationDigest,
          configuration: {},
          reasonCode: "CONTROLLED_LEARNING_ACTIVE_CONFIGURATION_INVALID",
        };
      }
      return {
        applied: true,
        versionId: active.id,
        configurationDigest: active.configurationDigest,
        configuration,
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
    const consent = await this.requireLearningAllowed(input.namespace);
    if (!consent.allowedLevels.includes(input.level)) {
      throw error("CONTROLLED_LEARNING_LEVEL_NOT_CONSENTED");
    }
    assertControlledLearningProposal(input);
    const experienceIds = [...new Set(input.experienceIds)];
    if (!experienceIds.length || experienceIds.length > 512) {
      throw error("CONTROLLED_LEARNING_EXPERIENCE_REQUIRED");
    }
    const experiences = await Promise.all(
      experienceIds.map((id) => this.repository.get<ControlledLearningExperience>(id)),
    );
    const trustedExperiences = await Promise.all(
      experiences.map((record) =>
        this.isExperienceTrusted(record, input.namespace)),
    );
    if (trustedExperiences.some((trusted) => !trusted)) {
      throw error("CONTROLLED_LEARNING_EXPERIENCE_SCOPE_MISMATCH");
    }
    const proposalPrivacy = inspectControlledLearningPrivacy({
      featureText: stableStringify(input.proposal),
    }, {
      tenantId: input.namespace.tenantId,
      userId: input.namespace.userId,
      projectId: input.namespace.projectId,
      storyId: input.namespace.storyId,
      canonId: input.namespace.canonId,
      branchId: input.namespace.branchId,
      characterId: input.namespace.characterId,
    });
    if (!proposalPrivacy.passed) {
      throw error(
        "CONTROLLED_LEARNING_PRIVACY_FILTER_BLOCKED",
        "This proposal cannot enter the controlled learning pipeline.",
        proposalPrivacy.blockingCodes,
      );
    }
    const createdAt = this.now().toISOString();
    const proposalDigest = await sha256Hex(stableStringify(input.proposal));
    const candidate: ControlledLearningCandidate = {
      schemaVersion: CONTROLLED_LEARNING_SCHEMA_VERSION,
      kind: "candidate",
      id: `learning-candidate:${await sha256Hex(stableStringify({
        namespace: input.namespace,
        input: experienceIds,
        proposalDigest,
        createdAt,
      }))}`,
      projectId: input.namespace.projectId,
      namespace: structuredClone(input.namespace),
      level: input.level,
      candidateType: input.candidateType,
      status: "candidate",
      experienceIds,
      proposal: structuredClone(input.proposal),
      proposalDigest,
      evaluation: null,
      humanApproval: null,
      pipelineStatus: "candidate-created",
      createdAt,
      updatedAt: createdAt,
      revision: 1,
    };
    await this.repository.put(candidate);
    return candidate;
  }

  async createEvaluatedCandidate(input: {
    namespace: ClosedAINamespace;
    level: "L0" | "L1";
    candidateType: ControlledLearningCandidate["candidateType"];
    experienceIds: string[];
    proposal: Record<string, string | number | boolean>;
    evaluation: {
      score: number;
      blockingCodes?: string[];
      evidence: Record<string, string | number | boolean>;
    };
  }) {
    normalizedScore(
      input.evaluation.score,
      "CONTROLLED_LEARNING_EVALUATION_SCORE_INVALID",
    );
    const candidate = await this.createCandidate(input);
    return this.evaluateCandidate(candidate.id, input.evaluation);
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
    sourceUserId?: string;
    sourceProjectId?: string;
    sourceStoryId?: string;
    sourceCanonId?: string;
    sourceBranchId?: string;
    sourceCharacterId?: string;
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
      sourceUserId: input.sourceUserId,
      sourceProjectId: input.sourceProjectId,
      sourceStoryId: input.sourceStoryId,
      sourceCanonId: input.sourceCanonId,
      sourceBranchId: input.sourceBranchId,
      sourceCharacterId: input.sourceCharacterId,
    }, {
      tenantId: input.namespace.tenantId,
      userId: input.namespace.userId,
      projectId: input.namespace.projectId,
      storyId: input.namespace.storyId,
      canonId: input.namespace.canonId,
      branchId: input.namespace.branchId,
      characterId: input.namespace.characterId,
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
      sourceUserId: input.sourceUserId,
      sourceProjectId: input.sourceProjectId,
      sourceStoryId: input.sourceStoryId,
      sourceCanonId: input.sourceCanonId,
      sourceBranchId: input.sourceBranchId,
      sourceCharacterId: input.sourceCharacterId,
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
    input: {
      score: number;
      blockingCodes?: string[];
      evidence?: Record<string, string | number | boolean>;
    },
  ): Promise<ControlledLearningCandidate> {
    const candidate = await this.requireCandidate(candidateId);
    if (!["candidate", "evaluated"].includes(candidate.status)) {
      throw error("CONTROLLED_LEARNING_CANDIDATE_STATE_INVALID");
    }
    const score = normalizedScore(
      input.score,
      "CONTROLLED_LEARNING_EVALUATION_SCORE_INVALID",
    );
    const blockingCodes = [...new Set(input.blockingCodes ?? [])];
    if (blockingCodes.some((code) =>
      !/^[A-Z0-9_:-]{3,120}$/u.test(code))) {
      throw error("CONTROLLED_LEARNING_EVALUATION_CODE_INVALID");
    }
    const experienceCount = candidate.experienceIds.length;
    const evaluatedAt = this.now().toISOString();
    const updated: ControlledLearningCandidate = {
      ...candidate,
      status: "evaluated",
      evaluation: {
        score,
        sampleCount: experienceCount,
        blockingCodes,
        evidenceDigest: await sha256Hex(stableStringify({
          candidateId,
          proposalDigest: candidate.proposalDigest,
          score,
          blockingCodes,
          evidence: input.evidence ?? {},
        })),
        evaluatedAt,
      },
      pipelineStatus: "evaluated",
      updatedAt: evaluatedAt,
      revision: candidate.revision + 1,
    };
    await this.repository.put(updated);
    return updated;
  }

  async approveCandidate(
    candidateId: string,
    input: {
      approvedBy: string;
      approvalId: string;
      approvalTransactionId: string;
      approvalTransactionDigest: string;
      humanApproved: boolean;
    },
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
    if (
      !input.approvedBy.trim()
      || input.approvedBy.length > 200
      || !/^[A-Za-z0-9._:-]{8,200}$/u.test(input.approvalId)
      || !/^[A-Za-z0-9._:-]{8,200}$/u.test(input.approvalTransactionId)
      || !/^[a-f0-9]{64}$/iu.test(input.approvalTransactionDigest)
    ) {
      throw error("CONTROLLED_LEARNING_APPROVAL_TRANSACTION_INVALID");
    }
    const approvalPrivacy = inspectControlledLearningPrivacy({
      featureText: [
        input.approvedBy,
        input.approvalId,
        input.approvalTransactionId,
      ].join("\n"),
    }, {
      tenantId: candidate.namespace.tenantId,
      userId: candidate.namespace.userId,
      projectId: candidate.namespace.projectId,
      storyId: candidate.namespace.storyId,
      canonId: candidate.namespace.canonId,
      branchId: candidate.namespace.branchId,
      characterId: candidate.namespace.characterId,
    });
    if (!approvalPrivacy.passed) {
      throw error(
        "CONTROLLED_LEARNING_APPROVAL_TRANSACTION_INVALID",
        "The approval transaction contains prohibited data.",
        approvalPrivacy.blockingCodes,
      );
    }
    if (!this.verifyApprovalTransaction) {
      throw error("CONTROLLED_LEARNING_APPROVAL_VERIFIER_UNAVAILABLE");
    }
    let transactionVerified = false;
    try {
      transactionVerified = await this.verifyApprovalTransaction({
        candidate,
        approvedBy: input.approvedBy,
        approvalId: input.approvalId,
        approvalTransactionId: input.approvalTransactionId,
        approvalTransactionDigest: input.approvalTransactionDigest,
      });
    } catch {
      transactionVerified = false;
    }
    if (!transactionVerified) {
      throw error("CONTROLLED_LEARNING_APPROVAL_TRANSACTION_UNVERIFIED");
    }
    const approvedAt = this.now().toISOString();
    const updated: ControlledLearningCandidate = {
      ...candidate,
      status: "approved",
      humanApproval: {
        approvedBy: input.approvedBy,
        approvalId: input.approvalId,
        approvalTransactionId: input.approvalTransactionId,
        approvalTransactionDigest: input.approvalTransactionDigest,
        approvedAt,
      },
      pipelineStatus: "approved",
      updatedAt: approvedAt,
      revision: candidate.revision + 1,
    };
    await this.repository.put(updated);
    return updated;
  }

  async rejectCandidate(candidateId: string): Promise<ControlledLearningCandidate> {
    const candidate = await this.requireCandidate(candidateId);
    if (!["candidate", "evaluated", "approved", "testing"].includes(candidate.status)) {
      throw error("CONTROLLED_LEARNING_CANDIDATE_STATE_INVALID");
    }
    const datasets = await this.repository.list<ControlledLearningDataset>(
      candidate.projectId,
      "dataset",
    );
    const dataset = datasets.find((item) =>
      item.id === `learning-dataset:${candidate.id}`
      && sameClosedAINamespace(item.namespace, candidate.namespace)
      && item.status === "approved");
    if (dataset) {
      await this.repository.put({
        ...dataset,
        status: "revoked",
        revokedAt: this.now().toISOString(),
      });
    }
    const updated: ControlledLearningCandidate = {
      ...candidate,
      status: "rejected",
      pipelineStatus: "rejected",
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
    if (!await this.isCandidateApprovalTrusted(candidate)) {
      throw error("CONTROLLED_LEARNING_APPROVAL_TRANSACTION_UNVERIFIED");
    }
    const createdAt = this.now().toISOString();
    const experienceLineage = await this.experienceLineage(candidate);
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
        experienceLineage,
        proposalDigest: candidate.proposalDigest,
        evaluationEvidenceDigest: candidate.evaluation?.evidenceDigest ?? null,
        approvalTransactionDigest: candidate.humanApproval.approvalTransactionDigest,
      })),
      status: "approved",
      approvalTransactionId: candidate.humanApproval.approvalTransactionId,
      approvalTransactionDigest: candidate.humanApproval.approvalTransactionDigest,
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
    if (!await this.isCandidateApprovalTrusted(candidate)) {
      throw error("CONTROLLED_LEARNING_APPROVAL_TRANSACTION_UNVERIFIED");
    }
    await this.requireApprovedDataset(candidate);
    if (input.baselineVersionId) {
      const baseline = await this.repository.get<ControlledLearningVersion>(input.baselineVersionId);
      if (!baseline || !sameClosedAINamespace(baseline.namespace, candidate.namespace)) {
        throw error("CONTROLLED_LEARNING_BASELINE_SCOPE_MISMATCH");
      }
    }
    const minimumSamples = input.minimumSamples ?? 10;
    const requiredImprovement = input.requiredImprovement ?? 0.03;
    if (
      !Number.isInteger(minimumSamples)
      || minimumSamples < 2
      || minimumSamples > 10_000
      || !Number.isFinite(requiredImprovement)
      || requiredImprovement < 0
      || requiredImprovement > 1
    ) {
      throw error("CONTROLLED_LEARNING_AB_CONFIGURATION_INVALID");
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
      minimumSamples,
      requiredImprovement,
      baselineScores: [],
      candidateScores: [],
      baselineMean: null,
      candidateMean: null,
      measuredImprovement: null,
      createdAt,
      completedAt: null,
    };
    await this.repository.put(test);
    await this.repository.put({
      ...candidate,
      status: "testing",
      pipelineStatus: "ab-testing",
      updatedAt: createdAt,
      revision: candidate.revision + 1,
    });
    return test;
  }

  async recordABSample(testId: string, baselineScore: number, candidateScore: number) {
    const test = await this.repository.get<ControlledLearningABTest>(testId);
    if (!test || test.status !== "running") throw error("CONTROLLED_LEARNING_AB_TEST_NOT_RUNNING");
    if (
      !Number.isInteger(test.minimumSamples)
      || test.minimumSamples < 2
      || test.minimumSamples > 10_000
      || !Number.isFinite(test.requiredImprovement)
      || test.requiredImprovement < 0
      || test.requiredImprovement > 1
      || test.baselineScores.length !== test.candidateScores.length
      || test.candidateScores.length >= test.minimumSamples
    ) {
      throw error("CONTROLLED_LEARNING_AB_TEST_INTEGRITY_FAILED");
    }
    const candidate = await this.requireCandidate(test.candidateId);
    if (
      candidate.status !== "testing"
      || !sameClosedAINamespace(candidate.namespace, test.namespace)
    ) {
      throw error("CONTROLLED_LEARNING_AB_TEST_INTEGRITY_FAILED");
    }
    await this.requireApprovedDataset(candidate);
    normalizedScore(baselineScore, "CONTROLLED_LEARNING_AB_SCORE_INVALID");
    normalizedScore(candidateScore, "CONTROLLED_LEARNING_AB_SCORE_INVALID");
    const next: ControlledLearningABTest = {
      ...test,
      baselineScores: [...test.baselineScores, baselineScore],
      candidateScores: [...test.candidateScores, candidateScore],
    };
    if (next.candidateScores.length >= next.minimumSamples) {
      const baselineMean = mean(next.baselineScores);
      const candidateMean = mean(next.candidateScores);
      const measuredImprovement = candidateMean - baselineMean;
      next.baselineMean = baselineMean;
      next.candidateMean = candidateMean;
      next.measuredImprovement = measuredImprovement;
      next.status = measuredImprovement >= next.requiredImprovement ? "passed" : "failed";
      next.completedAt = this.now().toISOString();
    }
    await this.repository.put(next);
    return next;
  }

  async adoptCandidate(candidateId: string, testId: string): Promise<ControlledLearningVersion> {
    const candidate = await this.requireCandidate(candidateId);
    const queueKey = `version:${await sha256Hex(stableStringify(
      candidate.namespace,
    ))}`;
    return this.serializeMutation(
      queueKey,
      () => this.adoptCandidateInternal(candidateId, testId),
    );
  }

  private async adoptCandidateInternal(
    candidateId: string,
    testId: string,
  ): Promise<ControlledLearningVersion> {
    const [candidate, test] = await Promise.all([
      this.requireCandidate(candidateId),
      this.repository.get<ControlledLearningABTest>(testId),
    ]);
    if (
      !test
      || test.candidateId !== candidate.id
      || test.status !== "passed"
      || !sameClosedAINamespace(test.namespace, candidate.namespace)
      || candidate.status !== "testing"
      || !candidate.humanApproval
    ) {
      throw error("CONTROLLED_LEARNING_AB_ADOPTION_GATE_FAILED");
    }
    if (!await this.isCandidateApprovalTrusted(candidate)) {
      throw error("CONTROLLED_LEARNING_APPROVAL_TRANSACTION_UNVERIFIED");
    }
    await this.requireApprovedDataset(candidate);
    if (!this.isPassedABTestTrusted(test)) {
      throw error("CONTROLLED_LEARNING_AB_TEST_INTEGRITY_FAILED");
    }
    const configuration = sanitizeControlledLearningConfiguration(candidate.proposal);
    if (!Object.keys(configuration).length) {
      throw error("CONTROLLED_LEARNING_ACTIVE_CONFIGURATION_INVALID");
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
      configuration,
      configurationDigest: await sha256Hex(stableStringify(configuration)),
      approvalTransactionId: candidate.humanApproval.approvalTransactionId,
      approvalTransactionDigest: candidate.humanApproval.approvalTransactionDigest,
      parentVersionId: active?.id ?? null,
      adoptedAt,
      rolledBackAt: null,
    };
    await this.repository.put(version);
    await this.repository.put({
      ...candidate,
      status: "adopted",
      pipelineStatus: "adopted",
      updatedAt: adoptedAt,
      revision: candidate.revision + 1,
    });
    return version;
  }

  async rollbackVersion(versionId: string): Promise<ControlledLearningVersion | null> {
    const version = await this.repository.get<ControlledLearningVersion>(versionId);
    if (!version) throw error("CONTROLLED_LEARNING_ACTIVE_VERSION_NOT_FOUND");
    const queueKey = `version:${await sha256Hex(stableStringify(
      version.namespace,
    ))}`;
    return this.serializeMutation(
      queueKey,
      () => this.rollbackVersionInternal(versionId),
    );
  }

  private async rollbackVersionInternal(
    versionId: string,
  ): Promise<ControlledLearningVersion | null> {
    const version = await this.repository.get<ControlledLearningVersion>(versionId);
    if (!version || version.status !== "active") {
      throw error("CONTROLLED_LEARNING_ACTIVE_VERSION_NOT_FOUND");
    }
    if (!await this.isActiveVersionTrusted(version)) {
      throw error("CONTROLLED_LEARNING_VERSION_INTEGRITY_FAILED");
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
      pipelineStatus: "rolled-back",
      updatedAt: rolledBackAt,
      revision: candidate.revision + 1,
    });
    if (!version.parentVersionId) return null;
    const parent = await this.repository.get<ControlledLearningVersion>(version.parentVersionId);
    if (
      !parent
      || !sameClosedAINamespace(parent.namespace, version.namespace)
      || !await this.isActiveVersionTrusted(parent)
    ) {
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

  requestAdapterWeightTraining(): never {
    throw error("CONTROLLED_LEARNING_L2_WEIGHT_TRAINING_NOT_STARTED");
  }

  requestPrivateModelTraining(): never {
    throw error("CONTROLLED_LEARNING_L3_MODEL_TRAINING_NOT_STARTED");
  }

  requestDistillation(): never {
    throw error("CONTROLLED_LEARNING_L3_DISTILLATION_NOT_STARTED");
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
    const activeVersions = records.filter((record): record is ControlledLearningVersion =>
      record.kind === "version" && record.status === "active");
    const trustedActiveVersions = (await Promise.all(
      activeVersions.map((version) => this.isActiveVersionTrusted(version)),
    )).filter(Boolean).length;
    return {
      persistence: this.repository.kind,
      consentEnabled: records.some((record) => record.kind === "consent" && record.enabled),
      killSwitchEngaged: records.some((record) => record.kind === "kill-switch" && record.engaged),
      experiences: records.filter((record) => record.kind === "experience").length,
      candidates: records.filter((record) => record.kind === "candidate").length,
      activeVersions: trustedActiveVersions,
      runningTests: records.filter((record) => record.kind === "ab-test" && record.status === "running").length,
      approvedDatasets: records.filter((record) =>
        record.kind === "dataset" && record.status === "approved").length,
      negativeOnlySignals: records.filter((record) =>
        record.kind === "experience" && record.negativeSignalOnly).length,
      privacyPassedSignals: records.filter((record) =>
        record.kind === "experience" && record.privacyFilterStatus === "passed").length,
      legacySignalsAwaitingReview: records.filter((record) =>
        record.kind === "experience"
        && record.privacyFilterStatus === "legacy-review-required").length,
      formalLearningDataBeforeApproval: 0,
      l0Status: "ready" as const,
      l1Status: "ready" as const,
      l2Status: "candidate_ready" as const,
      l3Status: "started" as const,
      rawContentStored: false,
      rawChainOfThoughtStored: false,
      modelTraining: "started" as const,
      distillation: "started" as const,
    };
  }

  private async isExperienceTrusted(
    record: ControlledLearningExperience | null,
    namespace: ClosedAINamespace,
  ) {
    if (
      !record
      || record.schemaVersion !== CONTROLLED_LEARNING_SCHEMA_VERSION
      || record.kind !== "experience"
      || record.projectId !== namespace.projectId
      || !sameClosedAINamespace(record.namespace, namespace)
      || !/^[A-Za-z0-9._:-]{3,120}$/u.test(record.taskType)
      || record.privacyFilterStatus !== "passed"
      || record.outcomeLabelingStatus !== "completed"
      || record.evaluatorEligible !== true
      || record.formalLearningData !== false
      || record.rawInputStored !== false
      || record.rawOutputStored !== false
      || record.rawChainOfThoughtStored !== false
      || !/^[a-f0-9]{64}$/iu.test(record.recordDigest)
    ) {
      return false;
    }
    const { recordDigest, ...body } = record;
    return recordDigest === await sha256Hex(stableStringify(body));
  }

  private async experienceLineage(candidate: ControlledLearningCandidate) {
    const records = await Promise.all(candidate.experienceIds.map((id) =>
      this.repository.get<ControlledLearningExperience>(id)));
    const trusted = await Promise.all(records.map((record) =>
      this.isExperienceTrusted(record, candidate.namespace)));
    if (trusted.some((value) => !value)) {
      throw error("CONTROLLED_LEARNING_EXPERIENCE_INTEGRITY_FAILED");
    }
    return records.map((record) => ({
      id: record!.id,
      recordDigest: record!.recordDigest,
    }));
  }

  private async assertCandidateIntegrity(candidate: ControlledLearningCandidate) {
    const expectedPipelineStatus: Record<
      ControlledLearningCandidate["status"],
      ControlledLearningCandidate["pipelineStatus"]
    > = {
      candidate: "candidate-created",
      evaluated: "evaluated",
      approved: "approved",
      testing: "ab-testing",
      adopted: "adopted",
      rejected: "rejected",
      rolled_back: "rolled-back",
    };
    if (
      candidate.schemaVersion !== CONTROLLED_LEARNING_SCHEMA_VERSION
      || candidate.kind !== "candidate"
      || candidate.projectId !== candidate.namespace.projectId
      || !candidate.experienceIds.length
      || candidate.experienceIds.length > 512
      || new Set(candidate.experienceIds).size !== candidate.experienceIds.length
      || ![
        "candidate",
        "evaluated",
        "approved",
        "testing",
        "adopted",
        "rejected",
        "rolled_back",
      ].includes(candidate.status)
      || expectedPipelineStatus[candidate.status] !== candidate.pipelineStatus
    ) {
      throw error("CONTROLLED_LEARNING_CANDIDATE_INTEGRITY_FAILED");
    }
    try {
      assertClosedAINamespace(candidate.namespace);
      assertControlledLearningProposal(candidate);
    } catch {
      throw error("CONTROLLED_LEARNING_CANDIDATE_INTEGRITY_FAILED");
    }
    if (
      candidate.proposalDigest !== await sha256Hex(stableStringify(candidate.proposal))
    ) {
      throw error("CONTROLLED_LEARNING_CANDIDATE_INTEGRITY_FAILED");
    }
    const experiences = await Promise.all(
      candidate.experienceIds.map((id) =>
        this.repository.get<ControlledLearningExperience>(id)),
    );
    const trustedExperiences = await Promise.all(
      experiences.map((record) =>
        this.isExperienceTrusted(record, candidate.namespace)),
    );
    if (trustedExperiences.some((trusted) => !trusted)) {
      throw error("CONTROLLED_LEARNING_CANDIDATE_INTEGRITY_FAILED");
    }
    const requiresEvaluation = [
      "evaluated",
      "approved",
      "testing",
      "adopted",
      "rolled_back",
    ].includes(candidate.status);
    if (
      (requiresEvaluation || candidate.evaluation !== null)
      && (
        !candidate.evaluation
        || !Number.isFinite(candidate.evaluation.score)
        || candidate.evaluation.score < 0
        || candidate.evaluation.score > 1
        || candidate.evaluation.sampleCount !== candidate.experienceIds.length
        || !/^[a-f0-9]{64}$/iu.test(candidate.evaluation.evidenceDigest)
        || candidate.evaluation.blockingCodes.some((code) =>
          !/^[A-Z0-9_:-]{3,120}$/u.test(code))
      )
    ) {
      throw error("CONTROLLED_LEARNING_CANDIDATE_INTEGRITY_FAILED");
    }
    const requiresApproval = [
      "approved",
      "testing",
      "adopted",
      "rolled_back",
    ].includes(candidate.status);
    if (
      requiresApproval
      && (
        !candidate.humanApproval
        || !candidate.humanApproval.approvedBy.trim()
        || !/^[A-Za-z0-9._:-]{8,200}$/u.test(
          candidate.humanApproval.approvalId,
        )
        || !/^[A-Za-z0-9._:-]{8,200}$/u.test(
          candidate.humanApproval.approvalTransactionId,
        )
        || !/^[a-f0-9]{64}$/iu.test(
          candidate.humanApproval.approvalTransactionDigest,
        )
      )
    ) {
      throw error("CONTROLLED_LEARNING_CANDIDATE_INTEGRITY_FAILED");
    }
  }

  private async isCandidateApprovalTrusted(
    candidate: ControlledLearningCandidate,
  ) {
    if (!candidate.humanApproval || !this.verifyApprovalTransaction) return false;
    try {
      return await this.verifyApprovalTransaction({
        candidate,
        approvedBy: candidate.humanApproval.approvedBy,
        approvalId: candidate.humanApproval.approvalId,
        approvalTransactionId:
          candidate.humanApproval.approvalTransactionId,
        approvalTransactionDigest:
          candidate.humanApproval.approvalTransactionDigest,
      });
    } catch {
      return false;
    }
  }

  private async requireApprovedDataset(
    candidate: ControlledLearningCandidate,
  ) {
    const experienceLineage = await this.experienceLineage(candidate);
    const dataset = await this.repository.get<ControlledLearningDataset>(
      `learning-dataset:${candidate.id}`,
    );
    if (
      !dataset
      || dataset.schemaVersion !== CONTROLLED_LEARNING_SCHEMA_VERSION
      || dataset.kind !== "dataset"
      || dataset.status !== "approved"
      || dataset.projectId !== candidate.projectId
      || dataset.level !== candidate.level
      || !sameClosedAINamespace(dataset.namespace, candidate.namespace)
      || stableStringify(dataset.experienceIds)
        !== stableStringify(candidate.experienceIds)
      || !candidate.humanApproval
      || dataset.approvalTransactionId
        !== candidate.humanApproval.approvalTransactionId
      || dataset.approvalTransactionDigest
        !== candidate.humanApproval.approvalTransactionDigest
      || dataset.rawContentStored !== false
      || dataset.contentDigest !== await sha256Hex(stableStringify({
        experienceIds: candidate.experienceIds,
        experienceLineage,
        proposalDigest: candidate.proposalDigest,
        evaluationEvidenceDigest: candidate.evaluation?.evidenceDigest ?? null,
        approvalTransactionDigest:
          candidate.humanApproval.approvalTransactionDigest,
      }))
    ) {
      throw error("CONTROLLED_LEARNING_APPROVED_DATASET_REQUIRED");
    }
    return dataset;
  }

  private isPassedABTestTrusted(test: ControlledLearningABTest) {
    if (
      test.status !== "passed"
      || !Number.isInteger(test.minimumSamples)
      || test.minimumSamples < 2
      || test.minimumSamples > 10_000
      || !Number.isFinite(test.requiredImprovement)
      || test.requiredImprovement < 0
      || test.requiredImprovement > 1
      || test.baselineScores.length !== test.candidateScores.length
      || test.candidateScores.length < test.minimumSamples
      || test.baselineScores.some((score) =>
        !Number.isFinite(score) || score < 0 || score > 1)
      || test.candidateScores.some((score) =>
        !Number.isFinite(score) || score < 0 || score > 1)
    ) {
      return false;
    }
    const baselineMean = mean(test.baselineScores);
    const candidateMean = mean(test.candidateScores);
    const measuredImprovement = candidateMean - baselineMean;
    const equal = (left: number | null, right: number) =>
      left !== null && Math.abs(left - right) <= Number.EPSILON * 16;
    return Boolean(
      test.completedAt
      && equal(test.baselineMean, baselineMean)
      && equal(test.candidateMean, candidateMean)
      && equal(test.measuredImprovement, measuredImprovement)
      && measuredImprovement >= test.requiredImprovement
    );
  }

  private async isActiveVersionTrusted(version: ControlledLearningVersion) {
    try {
      if (
        version.schemaVersion !== CONTROLLED_LEARNING_SCHEMA_VERSION
        || version.kind !== "version"
        || version.projectId !== version.namespace.projectId
        || !Number.isInteger(version.version)
        || version.version < 1
        || !/^[A-Za-z0-9._:-]{8,200}$/u.test(
          version.approvalTransactionId,
        )
        || !/^[a-f0-9]{64}$/iu.test(version.approvalTransactionDigest)
      ) return false;
      const candidate = await this.requireCandidate(version.candidateId);
      if (
        candidate.status !== "adopted"
        || !candidate.humanApproval
        || !sameClosedAINamespace(candidate.namespace, version.namespace)
        || version.approvalTransactionId
          !== candidate.humanApproval.approvalTransactionId
        || version.approvalTransactionDigest
          !== candidate.humanApproval.approvalTransactionDigest
        || !await this.isCandidateApprovalTrusted(candidate)
      ) return false;
      await this.requireApprovedDataset(candidate);
      const tests = await this.repository.list<ControlledLearningABTest>(
        candidate.projectId,
        "ab-test",
      );
      if (!tests.some((test) =>
        test.candidateId === candidate.id
        && sameClosedAINamespace(test.namespace, candidate.namespace)
        && this.isPassedABTestTrusted(test))) {
        return false;
      }
      const configuration = sanitizeControlledLearningConfiguration(
        candidate.proposal,
      );
      return Boolean(
        Object.keys(configuration).length
        && stableStringify(configuration) === stableStringify(version.configuration)
        && version.configurationDigest
          === await sha256Hex(stableStringify(configuration))
      );
    } catch {
      return false;
    }
  }

  private async serializeMutation<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutationQueues.get(key) ?? Promise.resolve();
    const current = previous.then(operation);
    const settled = current.catch(() => undefined);
    this.mutationQueues.set(key, settled);
    try {
      return await current;
    } finally {
      if (this.mutationQueues.get(key) === settled) {
        this.mutationQueues.delete(key);
      }
    }
  }

  private async requireCandidate(candidateId: string) {
    const candidate = await this.repository.get<ControlledLearningCandidate>(candidateId);
    if (!candidate) throw error("CONTROLLED_LEARNING_CANDIDATE_NOT_FOUND");
    await this.requireLearningAllowed(candidate.namespace);
    await this.assertCandidateIntegrity(candidate);
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
  l0PromptStrategyStatus: "ready",
  l0RouterPolicyStatus: "ready",
  l0PlannerPolicyStatus: "ready",
  l0CachePolicyStatus: "ready",
  l0RetrievalRerankingStatus: "ready",
  l0CharacterVoiceStatus: "ready",
  l0CorrectionRuleStatus: "ready",
  l1PolicyLearningStatus: "ready",
  l1StoryBibleRankingStatus: "ready",
  l1CharacterKnowledgeSelectionStatus: "ready",
  l1RelationshipEventRankingStatus: "ready",
  l1ToolSelectionStatus: "ready",
  l1TaskDecompositionStatus: "ready",
  l1ProjectTemplateStatus: "ready",
  l1PacingGenreStatus: "ready",
  completeSignalCatalogStatus: "ready",
  unapprovedDraftBlockStatus: "ready",
  crossUserStoryCanonBlockStatus: "ready",
  signedApprovalBeforeDatasetStatus: "ready",
  runtimeProposalAllowlistStatus: "ready",
  l2L3RuntimeGateStatus: "fail_closed",
  knowledgeTransformationStatus: "ready",
  sourceRightsConfirmationStatus: "ready",
  nonCopyingRuleGateStatus: "ready",
  activeConfigurationApplicationStatus: "ready",
  approvedOutcomeIntegrationStatus: "ready",
  l2AdapterStatus: "candidate_ready_not_activated",
  l3PrivateTrainingStatus: "started_operator_authorized",
  modelTraining: "started",
  distillation: "started",
  rawChainOfThoughtStored: false,
  silentTraining: false,
} as const;
