import { sanitizeRetrievedKnowledge } from "../security/retrieval-content-sanitizer";
import { scoreSourceTrust } from "../security/knowledge-poisoning/source-trust-scorer";
import {
  estimateRuleCombinationSpace,
} from "./combination-engine";
import {
  createTextFingerprint,
  normalizeForLearning,
  sha256Hex,
  shortStableId,
  stableStringify,
} from "./hashing";
import type {
  LearningRepositoryCommit,
  SovereignLearningRepository,
} from "./repository";
import {
  buildDeepRuleExtractionPrompt,
  deduplicateRuleDrafts,
  extractDeterministicNarrativeRules,
  parseDeepRuleExtraction,
  splitForDeepExtraction,
} from "./rule-extractor";
import {
  CONTROLLED_WEB_KNOWLEDGE_VERSION,
  distilledWebKnowledgePayload,
  type DistilledWebKnowledgeBundle,
} from "./web-knowledge-contract";
import {
  SOVEREIGN_LEARNING_SCHEMA_VERSION,
  SOVEREIGN_LEARNING_SNAPSHOT_VERSION,
  type DeepRuleExtractor,
  type LearnedNarrativeRule,
  type LearningAuditAction,
  type LearningAuditRecord,
  type LearningFeedbackDecision,
  type LearningFeedbackRecord,
  type LearningPreferenceProfile,
  type LearningRightsBasis,
  type LearningRuleDraft,
  type LearningSourceKind,
  type LearningSourceRecord,
  type SovereignLearningSnapshot,
} from "./types";

const MAX_SOURCE_CHARACTERS = 300_000;
const MIN_SOURCE_CHARACTERS = 120;

const CREDENTIAL_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "VERCEL_CREDENTIAL_DETECTED", pattern: /\b(?:vcp|sbp)_[A-Za-z0-9_-]{20,}\b/gu },
  { code: "GITHUB_CREDENTIAL_DETECTED", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu },
  { code: "OPENAI_CREDENTIAL_DETECTED", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/gu },
  { code: "AWS_CREDENTIAL_DETECTED", pattern: /\bAKIA[A-Z0-9]{16}\b/gu },
  { code: "JWT_CREDENTIAL_DETECTED", pattern: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/gu },
  { code: "BEARER_CREDENTIAL_DETECTED", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/giu },
];

function now() {
  return new Date().toISOString();
}

function learningError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

function scanCredentialCodes(value: string) {
  return CREDENTIAL_PATTERNS.flatMap(({ code, pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(value) ? [code] : [];
  });
}

function stripMarkup(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#39;/giu, "'")
    .replace(/&quot;/giu, '"');
}

function detectLanguage(value: string) {
  const traditional = (value.match(/[體學會國臺萬與為這還開關點說後發現實應該書]/gu) ?? []).length;
  const simplified = (value.match(/[体学会国台万与为这还开关点说后发现实应该书]/gu) ?? []).length;
  const cjk = (value.match(/[\u3400-\u9fff]/gu) ?? []).length;
  if (cjk > value.length * 0.08) {
    return simplified > traditional * 1.2 ? "zh-Hans" : "zh-Hant";
  }
  return /[A-Za-z]/u.test(value) ? "en" : "unknown";
}

function validateRights(input: {
  sourceKind: LearningSourceKind;
  rightsBasis: LearningRightsBasis;
  userConfirmedRights: boolean;
  rightsEvidence?: string;
}) {
  if (!input.userConfirmedRights) {
    throw learningError(
      "LEARNING_RIGHTS_CONFIRMATION_REQUIRED",
      "必須先確認你有權在本機分析這份內容。",
    );
  }
  if (input.sourceKind === "ai_output" && input.rightsBasis !== "ai_output_authorized") {
    throw learningError(
      "LEARNING_AI_OUTPUT_RIGHTS_MISMATCH",
      "其他 AI 的輸出必須標示為已獲授權的 AI 輸出。",
    );
  }
  if (
    ["public_domain", "licensed_for_analysis"].includes(input.rightsBasis)
    && !input.rightsEvidence?.trim()
  ) {
    throw learningError(
      "LEARNING_RIGHTS_EVIDENCE_REQUIRED",
      "公版或授權資料必須填寫授權依據。",
    );
  }
}

function auditRecord(input: {
  projectId: string;
  action: LearningAuditAction;
  sourceId?: string | null;
  ruleId?: string | null;
  detailCodes?: string[];
}): LearningAuditRecord {
  const createdAt = now();
  return {
    schemaVersion: SOVEREIGN_LEARNING_SCHEMA_VERSION,
    id: `${shortStableId("learning-audit", `${input.projectId}|${input.action}|${input.sourceId}|${input.ruleId}|${createdAt}`)}-${globalThis.crypto.randomUUID()}`,
    projectId: input.projectId,
    action: input.action,
    sourceId: input.sourceId ?? null,
    ruleId: input.ruleId ?? null,
    detailCodes: input.detailCodes ?? [],
    rawContentIncluded: false,
    createdAt,
  };
}

function toLearnedRules(input: {
  projectId: string;
  sourceId: string;
  drafts: LearningRuleDraft[];
  quarantined: boolean;
  existingRules: LearnedNarrativeRule[];
}) {
  const createdAt = now();
  const rules = input.drafts.map((draft, index): LearnedNarrativeRule => ({
    ...draft,
    schemaVersion: SOVEREIGN_LEARNING_SCHEMA_VERSION,
    id: shortStableId(
      "learning-rule",
      `${input.projectId}|${input.sourceId}|${draft.family}|${draft.dimension}|${draft.statement}|${index}`,
    ),
    projectId: input.projectId,
    sourceId: input.sourceId,
    status: input.quarantined ? "quarantined" : "candidate",
    conflictRuleIds: [],
    approvedAt: null,
    rejectedAt: null,
    revokedAt: null,
    supersededByRuleId: null,
    createdAt,
    updatedAt: createdAt,
    revision: 1,
  }));
  const allRules = [...input.existingRules, ...rules];
  return rules.map((rule) => ({
    ...rule,
    conflictRuleIds: rule.conflictKey
      ? allRules
        .filter((candidate) =>
          candidate.id !== rule.id
          && candidate.conflictKey === rule.conflictKey
          && !["rejected", "revoked"].includes(candidate.status))
        .map((candidate) => candidate.id)
      : [],
  }));
}

export type IngestLearningSourceInput = {
  projectId: string;
  title: string;
  author?: string;
  sourceReference?: string;
  sourceKind: LearningSourceKind;
  rightsBasis: LearningRightsBasis;
  rightsEvidence?: string;
  userConfirmedRights: boolean;
  content: string;
  deepExtractor?: DeepRuleExtractor;
  onProgress?: (status: {
    phase: "validating" | "deterministic" | "deep_extraction" | "persisting";
    current: number;
    total: number;
  }) => void;
};

export async function ingestLearningSource(
  repository: SovereignLearningRepository,
  input: IngestLearningSourceInput,
) {
  input.onProgress?.({ phase: "validating", current: 0, total: 1 });
  if (!input.projectId.trim() || !input.title.trim()) {
    throw learningError("LEARNING_SOURCE_IDENTITY_REQUIRED", "作品與來源標題不可空白。");
  }
  validateRights(input);
  const normalizedInput = normalizeForLearning(input.content);
  if (normalizedInput.length < MIN_SOURCE_CHARACTERS) {
    throw learningError(
      "LEARNING_SOURCE_TOO_SHORT",
      `內容至少需要 ${MIN_SOURCE_CHARACTERS} 個字元，才能抽象出可靠規則。`,
    );
  }
  if (normalizedInput.length > MAX_SOURCE_CHARACTERS) {
    throw learningError(
      "LEARNING_SOURCE_TOO_LARGE",
      `單次最多分析 ${MAX_SOURCE_CHARACTERS.toLocaleString("zh-TW")} 個字元。`,
    );
  }
  const credentialCodes = scanCredentialCodes(normalizedInput);
  if (credentialCodes.length) {
    throw Object.assign(
      new Error("內容疑似含有密鑰或登入憑證，已阻止匯入。請先移除敏感字串。"),
      { code: "LEARNING_CREDENTIAL_INPUT_BLOCKED", detailCodes: credentialCodes },
    );
  }
  const boundary = sanitizeRetrievedKnowledge(normalizedInput, {
    sourceType: "user_document",
  });
  const analysisText = normalizeForLearning(stripMarkup(boundary.sanitizedText));
  if (analysisText.length < MIN_SOURCE_CHARACTERS) {
    throw learningError(
      "LEARNING_SOURCE_EMPTY_AFTER_SANITIZATION",
      "移除不安全內容後，剩餘文字不足以分析。",
    );
  }
  const [contentHash, rightsEvidenceHash] = await Promise.all([
    sha256Hex(analysisText),
    sha256Hex(input.rightsEvidence?.trim() || `${input.rightsBasis}:user-confirmed`),
  ]);
  const existingSources = await repository.listSources(input.projectId);
  const duplicate = existingSources.find((source) =>
    source.contentHash === contentHash && source.status !== "revoked");
  if (duplicate) {
    const existingRules = (await repository.listRules(input.projectId))
      .filter((rule) => rule.sourceId === duplicate.id);
    await repository.commit({
      audit: [auditRecord({
        projectId: input.projectId,
        action: "source_duplicate",
        sourceId: duplicate.id,
        detailCodes: ["CONTENT_HASH_MATCH"],
      })],
    });
    return {
      duplicate: true,
      source: duplicate,
      rules: existingRules,
      warnings: ["LEARNING_DUPLICATE_SOURCE_REUSED"],
      deepExtractionFailures: 0,
      rawContentRetained: false,
      externalRequestCount: 0,
      dataLeftDevice: false,
    };
  }

  input.onProgress?.({ phase: "deterministic", current: 0, total: 1 });
  const fingerprint = createTextFingerprint(analysisText);
  const deterministicDrafts = extractDeterministicNarrativeRules(analysisText);
  const warningCodes = [
    ...boundary.findings.map((finding) => `UNTRUSTED_CONTENT_${finding.code}`),
  ];
  const quarantined = boundary.sanitizationStatus === "quarantined";
  const deepDrafts: LearningRuleDraft[] = [];
  let deepExtractionProvider: string | null = null;
  let deepExtractionModel: string | null = null;
  let deepExtractionFailures = 0;
  if (input.deepExtractor && !quarantined) {
    const chunks = splitForDeepExtraction(analysisText);
    for (const [index, chunk] of chunks.entries()) {
      input.onProgress?.({
        phase: "deep_extraction",
        current: index + 1,
        total: chunks.length,
      });
      try {
        const result = await input.deepExtractor({
          prompt: buildDeepRuleExtractionPrompt(chunk, index, chunks.length),
          chunkIndex: index,
          chunkCount: chunks.length,
        });
        if (result.externalRequest || result.dataLeftDevice) {
          throw learningError(
            "LEARNING_CLOSED_AI_BOUNDARY_VIOLATION",
            "深度抽象結果離開裝置，已拒絕使用。",
          );
        }
        deepExtractionProvider = result.provider;
        deepExtractionModel = result.model;
        const parsed = parseDeepRuleExtraction({
          raw: result.content,
          sourceText: chunk,
          sourceFingerprint: createTextFingerprint(chunk),
          provider: result.provider,
          model: result.model,
        });
        deepDrafts.push(...parsed.rules);
        warningCodes.push(...parsed.rejectionCodes);
      } catch (error) {
        if ((error as { code?: string })?.code === "LEARNING_CLOSED_AI_BOUNDARY_VIOLATION") {
          throw error;
        }
        deepExtractionFailures += 1;
        warningCodes.push(
          String((error as { code?: string })?.code || "LEARNING_DEEP_EXTRACTION_FAILED"),
        );
      }
    }
  } else if (input.deepExtractor && quarantined) {
    warningCodes.push("LEARNING_DEEP_EXTRACTION_SKIPPED_QUARANTINE");
  }

  const drafts = deduplicateRuleDrafts([...deterministicDrafts, ...deepDrafts]);
  const sourceId = shortStableId(
    "learning-source",
    `${input.projectId}|${contentHash}|${input.sourceKind}`,
  );
  const createdAt = now();
  const source: LearningSourceRecord = {
    schemaVersion: SOVEREIGN_LEARNING_SCHEMA_VERSION,
    id: sourceId,
    projectId: input.projectId,
    title: input.title.trim().slice(0, 180),
    author: input.author?.trim().slice(0, 120) || null,
    sourceReference: input.sourceReference?.trim().slice(0, 500) || null,
    sourceKind: input.sourceKind,
    rightsBasis: input.rightsBasis,
    rightsEvidenceHash,
    userConfirmedRights: true,
    localAnalysisOnly: true,
    rawContentRetained: false,
    contentHash,
    fingerprint,
    language: detectLanguage(analysisText),
    status: quarantined ? "quarantined" : "active",
    sanitizationStatus: boundary.sanitizationStatus,
    warningCodes: [...new Set(warningCodes)],
    trustScore: scoreSourceTrust({
      sourceType: input.sourceKind === "ai_output" ? "manual_knowledge" : "user_document",
      userApproved: true,
      canonical: false,
      citationValid: Boolean(input.sourceReference || input.rightsEvidence),
      identityVerified: input.rightsBasis !== "lawful_private_reference",
    }),
    deepExtractionAttempted: Boolean(input.deepExtractor),
    deepExtractionProvider,
    deepExtractionModel,
    dataLeftDevice: false,
    externalRequestCount: 0,
    webProvenance: null,
    teacherEvidence: [],
    createdAt,
    updatedAt: createdAt,
    revision: 1,
  };
  const existingRules = await repository.listRules(input.projectId);
  const rules = toLearnedRules({
    projectId: input.projectId,
    sourceId,
    drafts,
    quarantined,
    existingRules,
  });
  input.onProgress?.({ phase: "persisting", current: 1, total: 1 });
  await repository.commit({
    sources: [source],
    rules,
    audit: [auditRecord({
      projectId: input.projectId,
      action: quarantined ? "source_quarantined" : "source_ingested",
      sourceId,
      detailCodes: [
        `RULE_COUNT_${rules.length}`,
        ...(input.deepExtractor ? ["DEEP_EXTRACTION_REQUESTED"] : ["DETERMINISTIC_ONLY"]),
      ],
    })],
  });
  return {
    duplicate: false,
    source,
    rules,
    warnings: source.warningCodes,
    deepExtractionFailures,
    rawContentRetained: false,
    externalRequestCount: 0,
    dataLeftDevice: false,
  };
}

const WEB_RULE_FAMILIES = new Set([
  "structure",
  "pacing",
  "character",
  "relationship",
  "dialogue",
  "style",
  "foreshadowing",
  "worldbuilding",
  "revision",
]);

const WEB_RULE_DIMENSIONS = new Set([
  "viewpoint",
  "sentence_rhythm",
  "paragraph_rhythm",
  "dialogue_density",
  "opening_hook",
  "conflict_escalation",
  "reveal_cadence",
  "scene_transition",
  "ending_hook",
  "character_pressure",
  "relationship_movement",
  "world_rule_delivery",
  "foreshadow_payoff",
  "information_control",
  "tone",
  "other",
]);

function validateDistilledWebRules(bundle: DistilledWebKnowledgeBundle) {
  if (!Array.isArray(bundle.rules) || bundle.rules.length < 1 || bundle.rules.length > 16) {
    throw learningError("WEB_DISTILLATION_RULE_COUNT_INVALID", "受控蒸餾規則數量無效。");
  }
  const combined = bundle.rules.map((rule) => [
    rule.statement,
    rule.recipe?.when,
    rule.recipe?.operation,
    rule.recipe?.constraint,
    rule.recipe?.evaluate,
  ].join(" ")).join("\n");
  const credentialCodes = scanCredentialCodes(combined);
  if (credentialCodes.length) {
    throw Object.assign(new Error("教師規則疑似含有憑證，已阻止匯入。"), {
      code: "WEB_DISTILLATION_CREDENTIAL_OUTPUT_BLOCKED",
      detailCodes: credentialCodes,
    });
  }
  const boundary = sanitizeRetrievedKnowledge(combined, { sourceType: "web_content" });
  if (boundary.sanitizationStatus === "quarantined") {
    throw learningError("WEB_DISTILLATION_TEACHER_OUTPUT_QUARANTINED", "教師規則含有高風險指令，已阻止匯入。");
  }
  for (const rule of bundle.rules) {
    const recipe = rule.recipe;
    if (
      !WEB_RULE_FAMILIES.has(rule.family)
      || !WEB_RULE_DIMENSIONS.has(rule.dimension)
      || rule.extractorKind !== "external_teacher_ai"
      || !rule.statement?.trim()
      || !recipe
      || [recipe.when, recipe.operation, recipe.constraint, recipe.evaluate].some((value) => !value?.trim())
      || rule.longestSourceMatch >= 18
      || rule.sourceOverlapScore >= 0.14
      || rule.abstractionScore < 0.55
    ) {
      throw learningError("WEB_DISTILLATION_RULE_CONTRACT_INVALID", "教師規則未通過非抄寫或結構契約。");
    }
  }
}

export async function ingestDistilledWebKnowledge(
  repository: SovereignLearningRepository,
  input: {
    projectId: string;
    bundle: DistilledWebKnowledgeBundle;
    rightsBasis: LearningRightsBasis;
    rightsEvidence: string;
    userConfirmedRights: boolean;
    externalConsent: boolean;
  },
) {
  if (!input.projectId.trim()) throw learningError("LEARNING_SOURCE_IDENTITY_REQUIRED");
  if (!input.externalConsent) {
    throw learningError("WEB_DISTILLATION_EXTERNAL_CONSENT_REQUIRED", "必須明確同意清理後的來源送往教師 AI。");
  }
  validateRights({
    sourceKind: "web_research",
    rightsBasis: input.rightsBasis,
    rightsEvidence: input.rightsEvidence,
    userConfirmedRights: input.userConfirmedRights,
  });
  if (!input.rightsEvidence.trim()) {
    throw learningError("LEARNING_RIGHTS_EVIDENCE_REQUIRED", "網路來源必須填寫授權、來源或合法私人分析依據。");
  }
  const bundle = input.bundle;
  if (
    bundle.schemaVersion !== CONTROLLED_WEB_KNOWLEDGE_VERSION
    || bundle.source.rawContentRetained !== false
    || bundle.privacy.rawSourceRetained !== false
    || bundle.privacy.rawTeacherResponseRetained !== false
    || bundle.privacy.candidateOnly !== true
    || bundle.privacy.canonicalMutationCount !== 0
    || bundle.privacy.dataLeftDevice !== true
    || !bundle.source.sourceProfile
    || (!["article", "classical_chinese"].includes(bundle.source.sourceProfile.channel) && (
      !bundle.source.sourceProfile.engagement
      || bundle.source.sourceProfile.engagement.thresholdPassed !== true
      || bundle.source.sourceProfile.engagement.minimumRequired !== 100_000
      || bundle.source.sourceProfile.engagement.observedCount < 100_000
    ))
    || !bundle.teachers.length
    || bundle.teachers.some((teacher) =>
      teacher.candidateOnly !== true
      || teacher.rawResponseRetained !== false
      || !["openai", "grok"].includes(teacher.provider))
  ) {
    throw learningError("WEB_DISTILLATION_BUNDLE_INVALID", "受控蒸餾封包的隱私或候選邊界無效。");
  }
  const expectedDigest = await sha256Hex(stableStringify(distilledWebKnowledgePayload(bundle)));
  if (expectedDigest !== bundle.immutableDigest) {
    throw learningError("WEB_DISTILLATION_BUNDLE_HASH_MISMATCH", "受控蒸餾封包完整性驗證失敗。");
  }
  let finalUrl: URL;
  try {
    finalUrl = new URL(bundle.source.finalUrl);
  } catch {
    throw learningError("WEB_DISTILLATION_SOURCE_URL_INVALID");
  }
  if (finalUrl.protocol !== "https:") throw learningError("WEB_DISTILLATION_SOURCE_URL_INVALID");
  validateDistilledWebRules(bundle);

  const existingSources = await repository.listSources(input.projectId);
  const duplicate = existingSources.find((source) =>
    source.contentHash === bundle.source.sourceDigest && source.status !== "revoked");
  if (duplicate) {
    const rules = (await repository.listRules(input.projectId)).filter((rule) => rule.sourceId === duplicate.id);
    await repository.commit({
      audit: [auditRecord({
        projectId: input.projectId,
        action: "source_duplicate",
        sourceId: duplicate.id,
        detailCodes: ["CONTROLLED_WEB_DIGEST_MATCH"],
      })],
    });
    return {
      duplicate: true,
      source: duplicate,
      rules,
      externalRequestCount: duplicate.externalRequestCount ?? 0,
      dataLeftDevice: duplicate.dataLeftDevice ?? false,
      rawContentRetained: false,
    };
  }
  const [rightsEvidenceHash] = await Promise.all([
    sha256Hex(input.rightsEvidence.trim()),
  ]);
  const sourceId = shortStableId(
    "learning-source",
    `${input.projectId}|${bundle.source.sourceDigest}|web_research`,
  );
  const createdAt = now();
  const providers = [...new Set(bundle.teachers.map((teacher) => teacher.provider))];
  const models = [...new Set(bundle.teachers.map((teacher) => teacher.model))];
  const source: LearningSourceRecord = {
    schemaVersion: SOVEREIGN_LEARNING_SCHEMA_VERSION,
    id: sourceId,
    projectId: input.projectId,
    title: bundle.source.title.trim().slice(0, 180) || finalUrl.hostname,
    author: null,
    sourceReference: finalUrl.toString().slice(0, 500),
    sourceKind: "web_research",
    rightsBasis: input.rightsBasis,
    rightsEvidenceHash,
    userConfirmedRights: true,
    localAnalysisOnly: false,
    rawContentRetained: false,
    contentHash: bundle.source.sourceDigest,
    fingerprint: bundle.source.fingerprint,
    language: "unknown",
    status: "active",
    sanitizationStatus: bundle.source.sanitizationStatus,
    warningCodes: [...new Set([
      ...bundle.source.warningCodes,
      "CONTROLLED_EXTERNAL_TEACHER_CANDIDATE_ONLY",
      "RAW_SOURCE_NOT_RETAINED",
      "RAW_TEACHER_RESPONSE_NOT_RETAINED",
      `SOURCE_CHANNEL_${bundle.source.sourceProfile.channel.toUpperCase()}`,
      ...(bundle.source.sourceProfile.engagement ? [
        `POPULAR_SOURCE_${bundle.source.sourceProfile.engagement.metric.toUpperCase()}_${bundle.source.sourceProfile.engagement.observedCount}`,
        "POPULAR_SOURCE_OPERATOR_ATTESTED",
      ] : []),
    ])],
    trustScore: scoreSourceTrust({
      sourceType: "web_content",
      userApproved: true,
      canonical: false,
      citationValid: true,
      identityVerified: false,
    }),
    deepExtractionAttempted: true,
    deepExtractionProvider: providers.join("+"),
    deepExtractionModel: models.join("+").slice(0, 240),
    dataLeftDevice: true,
    externalRequestCount: bundle.privacy.externalRequestCount,
    webProvenance: {
      requestedUrl: bundle.source.requestedUrl,
      finalUrl: bundle.source.finalUrl,
      fetchedAt: bundle.source.fetchedAt,
      contentType: bundle.source.contentType,
      robotsPolicy: bundle.source.robotsPolicy,
      redirects: bundle.source.redirects,
      sourceDigest: bundle.source.sourceDigest,
      sourceProfile: bundle.source.sourceProfile,
      rawContentRetained: false,
    },
    teacherEvidence: bundle.teachers.map((teacher) => ({
      provider: teacher.provider,
      model: teacher.model,
      responseDigest: teacher.responseDigest,
      acceptedRuleCount: teacher.acceptedRuleCount,
      candidateOnly: true,
      rawResponseRetained: false,
    })),
    createdAt,
    updatedAt: createdAt,
    revision: 1,
  };
  const existingRules = await repository.listRules(input.projectId);
  const rules = toLearnedRules({
    projectId: input.projectId,
    sourceId,
    drafts: bundle.rules,
    quarantined: false,
    existingRules,
  });
  await repository.commit({
    sources: [source],
    rules,
    audit: [auditRecord({
      projectId: input.projectId,
      action: "source_ingested",
      sourceId,
      detailCodes: [
        "CONTROLLED_WEB_RESEARCH",
        "EXTERNAL_TEACHER_CANDIDATE_ONLY",
        `EXTERNAL_REQUEST_COUNT_${bundle.privacy.externalRequestCount}`,
        `RULE_COUNT_${rules.length}`,
        `CROSS_TEACHER_RULE_COUNT_${bundle.teacherAgreement.crossTeacherRuleCount}`,
        `SOURCE_CHANNEL_${bundle.source.sourceProfile.channel.toUpperCase()}`,
        `BUNDLE_DIGEST_${bundle.immutableDigest}`,
      ],
    })],
  });
  return {
    duplicate: false,
    source,
    rules,
    externalRequestCount: bundle.privacy.externalRequestCount,
    dataLeftDevice: true,
    rawContentRetained: false,
  };
}

async function requireRuleAndSource(
  repository: SovereignLearningRepository,
  projectId: string,
  ruleId: string,
) {
  const rule = await repository.getRule(ruleId);
  if (!rule || rule.projectId !== projectId) {
    throw learningError("LEARNING_RULE_NOT_FOUND", "找不到這條學習規則。");
  }
  const source = await repository.getSource(rule.sourceId);
  if (!source || source.projectId !== projectId) {
    throw learningError("LEARNING_SOURCE_NOT_FOUND", "規則的來源紀錄不存在。");
  }
  return { rule, source };
}

export async function approveLearningRule(
  repository: SovereignLearningRepository,
  projectId: string,
  ruleId: string,
) {
  const { rule, source } = await requireRuleAndSource(repository, projectId, ruleId);
  if (source.status !== "active" || rule.status === "quarantined") {
    throw learningError(
      "LEARNING_SOURCE_REVIEW_REQUIRED",
      "來源仍在隔離或已撤銷，不能核准規則。",
    );
  }
  if (rule.status === "approved") return rule;
  if (["rejected", "revoked"].includes(rule.status)) {
    throw learningError("LEARNING_RULE_STATE_INVALID", "已拒絕或撤銷的規則不能直接核准。");
  }
  const allRules = await repository.listRules(projectId);
  const approvedConflicts = rule.conflictKey
    ? allRules.filter((candidate) =>
      candidate.id !== rule.id
      && candidate.status === "approved"
      && candidate.conflictKey === rule.conflictKey)
    : [];
  if (approvedConflicts.length) {
    throw Object.assign(
      new Error("這條規則與已核准規則衝突；請使用「取代舊規則」明確處理。"),
      {
        code: "LEARNING_RULE_CONFLICT_REQUIRES_RESOLUTION",
        conflictRuleIds: approvedConflicts.map((candidate) => candidate.id),
      },
    );
  }
  const updatedAt = now();
  const updated: LearnedNarrativeRule = {
    ...rule,
    status: "approved",
    approvedAt: updatedAt,
    updatedAt,
    revision: rule.revision + 1,
  };
  await repository.commit({
    rules: [updated],
    audit: [auditRecord({
      projectId,
      action: "rule_approved",
      sourceId: source.id,
      ruleId,
    })],
  });
  return updated;
}

export async function rejectLearningRule(
  repository: SovereignLearningRepository,
  projectId: string,
  ruleId: string,
) {
  const { rule, source } = await requireRuleAndSource(repository, projectId, ruleId);
  if (rule.status === "rejected") return rule;
  const updatedAt = now();
  const updated: LearnedNarrativeRule = {
    ...rule,
    status: "rejected",
    rejectedAt: updatedAt,
    updatedAt,
    revision: rule.revision + 1,
  };
  await repository.commit({
    rules: [updated],
    audit: [auditRecord({
      projectId,
      action: "rule_rejected",
      sourceId: source.id,
      ruleId,
    })],
  });
  return updated;
}

export async function replaceLearningRule(
  repository: SovereignLearningRepository,
  projectId: string,
  ruleId: string,
) {
  const { rule, source } = await requireRuleAndSource(repository, projectId, ruleId);
  if (source.status !== "active" || rule.status === "quarantined") {
    throw learningError("LEARNING_SOURCE_REVIEW_REQUIRED");
  }
  const allRules = await repository.listRules(projectId);
  const conflicts = rule.conflictKey
    ? allRules.filter((candidate) =>
      candidate.id !== rule.id
      && candidate.status === "approved"
      && candidate.conflictKey === rule.conflictKey)
    : [];
  const updatedAt = now();
  const updatedConflicts = conflicts.map((candidate): LearnedNarrativeRule => ({
    ...candidate,
    status: "revoked",
    revokedAt: updatedAt,
    supersededByRuleId: rule.id,
    updatedAt,
    revision: candidate.revision + 1,
  }));
  const approved: LearnedNarrativeRule = {
    ...rule,
    status: "approved",
    approvedAt: updatedAt,
    updatedAt,
    revision: rule.revision + 1,
  };
  await repository.commit({
    rules: [...updatedConflicts, approved],
    audit: [auditRecord({
      projectId,
      action: "rule_replaced",
      sourceId: source.id,
      ruleId,
      detailCodes: updatedConflicts.map((candidate) => `SUPERSEDED_${candidate.id}`),
    })],
  });
  return { approved, superseded: updatedConflicts };
}

export async function clearLearningSourceQuarantine(
  repository: SovereignLearningRepository,
  projectId: string,
  sourceId: string,
  userReviewed: boolean,
) {
  if (!userReviewed) throw learningError("LEARNING_SOURCE_HUMAN_REVIEW_REQUIRED");
  const source = await repository.getSource(sourceId);
  if (!source || source.projectId !== projectId) throw learningError("LEARNING_SOURCE_NOT_FOUND");
  if (source.status !== "quarantined") return source;
  const rules = (await repository.listRules(projectId))
    .filter((rule) => rule.sourceId === sourceId && rule.status === "quarantined");
  const updatedAt = now();
  const updatedSource: LearningSourceRecord = {
    ...source,
    status: "active",
    updatedAt,
    revision: source.revision + 1,
    warningCodes: [...new Set([...source.warningCodes, "HUMAN_REVIEW_COMPLETED"])],
  };
  const updatedRules = rules.map((rule): LearnedNarrativeRule => ({
    ...rule,
    status: "candidate",
    updatedAt,
    revision: rule.revision + 1,
  }));
  await repository.commit({
    sources: [updatedSource],
    rules: updatedRules,
    audit: [auditRecord({
      projectId,
      action: "source_quarantine_cleared",
      sourceId,
      detailCodes: ["USER_REVIEWED_UNTRUSTED_CONTENT"],
    })],
  });
  return updatedSource;
}

export async function revokeLearningSource(
  repository: SovereignLearningRepository,
  projectId: string,
  sourceId: string,
) {
  const source = await repository.getSource(sourceId);
  if (!source || source.projectId !== projectId) throw learningError("LEARNING_SOURCE_NOT_FOUND");
  if (source.status === "revoked") return source;
  const rules = (await repository.listRules(projectId))
    .filter((rule) => rule.sourceId === sourceId && rule.status !== "revoked");
  const updatedAt = now();
  const updatedSource: LearningSourceRecord = {
    ...source,
    status: "revoked",
    updatedAt,
    revision: source.revision + 1,
  };
  const updatedRules = rules.map((rule): LearnedNarrativeRule => ({
    ...rule,
    status: "revoked",
    revokedAt: updatedAt,
    updatedAt,
    revision: rule.revision + 1,
  }));
  await repository.commit({
    sources: [updatedSource],
    rules: updatedRules,
    audit: [auditRecord({
      projectId,
      action: "source_revoked",
      sourceId,
      detailCodes: [`REVOKED_RULE_COUNT_${updatedRules.length}`],
    })],
  });
  return updatedSource;
}

function defaultProfile(projectId: string): LearningPreferenceProfile {
  const createdAt = now();
  return {
    schemaVersion: SOVEREIGN_LEARNING_SCHEMA_VERSION,
    id: `learning-profile:${projectId}`,
    projectId,
    familyWeights: {},
    ruleWeights: {},
    acceptedCount: 0,
    editedCount: 0,
    rejectedCount: 0,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

function clampWeight(value: number) {
  return Math.max(-1, Math.min(1, Math.round(value * 1_000) / 1_000));
}

export async function recordSovereignLearningFeedback(
  repository: SovereignLearningRepository,
  input: {
    projectId: string;
    decision: LearningFeedbackDecision;
    taskType: string;
    ruleIds: string[];
    output?: string;
    reasonTags?: string[];
    editDistance?: number | null;
    provider?: string | null;
    model?: string | null;
  },
) {
  const rules = (await repository.listRules(input.projectId))
    .filter((rule) => input.ruleIds.includes(rule.id) && rule.status === "approved");
  const profile = await repository.getProfile(input.projectId)
    ?? defaultProfile(input.projectId);
  const delta = input.decision === "accepted" ? 0.14 : input.decision === "edited" ? 0.05 : -0.18;
  const updatedAt = now();
  const nextProfile: LearningPreferenceProfile = {
    ...profile,
    familyWeights: { ...profile.familyWeights },
    ruleWeights: { ...profile.ruleWeights },
    acceptedCount: profile.acceptedCount + (input.decision === "accepted" ? 1 : 0),
    editedCount: profile.editedCount + (input.decision === "edited" ? 1 : 0),
    rejectedCount: profile.rejectedCount + (input.decision === "rejected" ? 1 : 0),
    version: profile.version + 1,
    updatedAt,
  };
  for (const rule of rules) {
    nextProfile.ruleWeights[rule.id] = clampWeight(
      (nextProfile.ruleWeights[rule.id] ?? 0) + delta,
    );
    nextProfile.familyWeights[rule.family] = clampWeight(
      (nextProfile.familyWeights[rule.family] ?? 0) + delta / Math.max(1, rules.length),
    );
  }
  const feedback: LearningFeedbackRecord = {
    schemaVersion: SOVEREIGN_LEARNING_SCHEMA_VERSION,
    id: `${shortStableId("learning-feedback", `${input.projectId}|${input.taskType}|${updatedAt}`)}-${globalThis.crypto.randomUUID()}`,
    projectId: input.projectId,
    decision: input.decision,
    taskType: input.taskType,
    ruleIds: rules.map((rule) => rule.id),
    outputHash: input.output ? await sha256Hex(input.output) : null,
    rawOutputRetained: false,
    reasonTags: [...new Set(input.reasonTags ?? [])].slice(0, 16),
    editDistance: input.editDistance ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    createdAt: updatedAt,
  };
  await repository.commit({
    feedback: [feedback],
    profiles: [nextProfile],
    audit: [auditRecord({
      projectId: input.projectId,
      action: "feedback_recorded",
      detailCodes: [
        input.decision.toUpperCase(),
        `RULE_COUNT_${feedback.ruleIds.length}`,
      ],
    })],
  });
  return { feedback, profile: nextProfile };
}

export async function getSovereignLearningDashboard(
  repository: SovereignLearningRepository,
  projectId: string,
) {
  const [sources, rules, feedback, profile, audit] = await Promise.all([
    repository.listSources(projectId),
    repository.listRules(projectId),
    repository.listFeedback(projectId),
    repository.getProfile(projectId),
    repository.listAudit(projectId),
  ]);
  const activeRules = rules.filter((rule) =>
    rule.status === "approved"
    && sources.some((source) => source.id === rule.sourceId && source.status === "active"));
  return {
    sources,
    rules,
    feedback,
    profile,
    audit,
    counts: {
      activeSources: sources.filter((source) => source.status === "active").length,
      quarantinedSources: sources.filter((source) => source.status === "quarantined").length,
      revokedSources: sources.filter((source) => source.status === "revoked").length,
      candidateRules: rules.filter((rule) => rule.status === "candidate").length,
      approvedRules: activeRules.length,
      rejectedRules: rules.filter((rule) => rule.status === "rejected").length,
      quarantinedRules: rules.filter((rule) => rule.status === "quarantined").length,
      feedback: feedback.length,
    },
    combinationSpace: estimateRuleCombinationSpace(activeRules),
    privacy: {
      rawSourceContentStored: false,
      rawOutputStored: false,
      externalRequestCount: sources.reduce(
        (total, source) => total + (source.externalRequestCount ?? 0),
        0,
      ),
      dataLeftDevice: sources.some((source) => source.dataLeftDevice === true),
    },
  };
}

export async function createSovereignLearningSnapshot(
  repository: SovereignLearningRepository,
  projectId: string,
) {
  const [sources, rules, feedback, profile, audit] = await Promise.all([
    repository.listSources(projectId),
    repository.listRules(projectId),
    repository.listFeedback(projectId),
    repository.getProfile(projectId),
    repository.listAudit(projectId),
  ]);
  const body = {
    schemaVersion: SOVEREIGN_LEARNING_SNAPSHOT_VERSION,
    projectId,
    createdAt: now(),
    sources,
    rules,
    feedback,
    profile,
    audit,
    rawSourceContentIncluded: false as const,
  };
  return {
    ...body,
    contentHash: await sha256Hex(stableStringify(body)),
  } satisfies SovereignLearningSnapshot;
}

export async function restoreSovereignLearningSnapshot(
  repository: SovereignLearningRepository,
  snapshot: SovereignLearningSnapshot,
  expectedProjectId: string,
) {
  if (
    snapshot.schemaVersion !== SOVEREIGN_LEARNING_SNAPSHOT_VERSION
    || snapshot.projectId !== expectedProjectId
    || snapshot.rawSourceContentIncluded !== false
  ) {
    throw learningError("LEARNING_SNAPSHOT_INVALID");
  }
  const { contentHash, ...body } = snapshot;
  const actualHash = await sha256Hex(stableStringify(body));
  if (actualHash !== contentHash) throw learningError("LEARNING_SNAPSHOT_HASH_MISMATCH");
  const records = [
    ...snapshot.sources,
    ...snapshot.rules,
    ...snapshot.feedback,
    ...(snapshot.profile ? [snapshot.profile] : []),
    ...snapshot.audit,
  ];
  if (records.some((record) =>
    record.projectId !== expectedProjectId
    || record.schemaVersion !== SOVEREIGN_LEARNING_SCHEMA_VERSION
    || "rawContentRetained" in record && record.rawContentRetained !== false
    || "rawOutputRetained" in record && record.rawOutputRetained !== false)) {
    throw learningError("LEARNING_SNAPSHOT_RECORD_INVALID");
  }
  await repository.clearProject(expectedProjectId);
  const commit: LearningRepositoryCommit = {
    sources: snapshot.sources,
    rules: snapshot.rules,
    feedback: snapshot.feedback,
    profiles: snapshot.profile ? [snapshot.profile] : [],
    audit: [
      ...snapshot.audit,
      auditRecord({
        projectId: expectedProjectId,
        action: "snapshot_restored",
        detailCodes: ["HASH_VERIFIED", "RAW_SOURCE_ABSENT"],
      }),
    ],
  };
  await repository.commit(commit);
  return getSovereignLearningDashboard(repository, expectedProjectId);
}

export const SOVEREIGN_LEARNING_HEALTH = {
  schemaVersion: SOVEREIGN_LEARNING_SCHEMA_VERSION,
  narrativeRuleAbstractionStatus: "ready",
  approvedRuleRagLearningStatus: "ready",
  preferenceFeedbackLearningStatus: "ready",
  sourceProvenanceStatus: "ready",
  sourceRevocationStatus: "ready",
  promptInjectionQuarantineStatus: "ready",
  credentialIngestionBlockStatus: "ready",
  originalityGuardStatus: "ready",
  combinationEngineStatus: "ready",
  localDeepExtractionStatus: "runtime_required",
  controlledWebResearchStatus: "ready_with_explicit_rights_and_consent",
  externalTeacherDistillationStatus: "server_credentials_required",
  teacherOutputPromotionStatus: "candidate_only_human_approval_required",
  rawSourceRetention: false,
  externalRequestCount: 0,
  dataLeftDevice: false,
  modelWeightTrainingStatus: "not_started",
  automaticModelPromotionStatus: "not_implemented",
} as const;
