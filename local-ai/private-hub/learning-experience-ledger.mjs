import crypto from "node:crypto";
import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";

export const AUTONOMOUS_PRACTICE_VERSION = "controlled-autonomous-practice-v1";
export const LEARNING_EXPERIENCE_LEDGER_VERSION = "novel-learning-experience-ledger-v1";

const HASH = /^[a-f0-9]{64}$/u;
const ZERO_HASH = "0".repeat(64);
const EXPERIENCE_KEYS = [
  "approvedRuleCount",
  "approvedRuleSetDigest",
  "capabilityEvidenceDigest",
  "completeRecipeCount",
  "consentDigest",
  "createdAt",
  "experienceDigest",
  "installationDigest",
  "outcome",
  "practiceKind",
  "privacy",
  "projectDigest",
  "recommendedNextStep",
  "schemaVersion",
  "scores",
  "selectedRuleCount",
  "taskCount",
  "treatmentRecipeCount",
].sort();
const SCORE_KEYS = [
  "capabilityDelta",
  "control",
  "lineageCoverage",
  "recipeCompleteness",
  "taskCoverage",
  "treatment",
].sort();
const PRIVACY_KEYS = [
  "authorOnlyIncluded",
  "canonicalMutationCount",
  "credentialIncluded",
  "memoryMutationCount",
  "modelWeightMutationCount",
  "rawChainOfThoughtIncluded",
  "rawOutputIncluded",
  "rawPromptIncluded",
  "rawStoryIncluded",
].sort();
const LEDGER_RECORD_KEYS = [
  "experience",
  "previousHash",
  "receivedAt",
  "recordHash",
  "schemaVersion",
  "sequence",
].sort();

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function stableLearningValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableLearningValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableLearningValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function ledgerError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function validScore(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function assertAutonomousLearningExperience(value) {
  if (!exactKeys(value, EXPERIENCE_KEYS)) {
    throw ledgerError("LEARNING_EXPERIENCE_CONTRACT_INVALID", "Learning experience fields are invalid.");
  }
  const row = value;
  if (
    row.schemaVersion !== AUTONOMOUS_PRACTICE_VERSION
    || row.practiceKind !== "approved-rule-sandbox-rehearsal"
    || !HASH.test(row.projectDigest)
    || !HASH.test(row.installationDigest)
    || !HASH.test(row.consentDigest)
    || !HASH.test(row.capabilityEvidenceDigest)
    || !HASH.test(row.approvedRuleSetDigest)
    || !HASH.test(row.experienceDigest)
    || !["practice_passed", "needs_more_coverage", "blocked"].includes(row.outcome)
    || !["retain_current_version", "collect_more_approved_rules", "human_review_required"].includes(row.recommendedNextStep)
    || typeof row.createdAt !== "string"
    || !Number.isFinite(Date.parse(row.createdAt))
    || !exactKeys(row.scores, SCORE_KEYS)
    || !validScore(row.scores.control)
    || !validScore(row.scores.treatment)
    || !validScore(row.scores.capabilityDelta)
    || ![row.scores.taskCoverage, row.scores.lineageCoverage, row.scores.recipeCompleteness]
      .every((score) => typeof score === "number" && score >= 0 && score <= 1)
    || !exactKeys(row.privacy, PRIVACY_KEYS)
    || Object.entries(row.privacy).some(([key, item]) => key.endsWith("Included") ? item !== false : item !== 0)
    || ![row.approvedRuleCount, row.selectedRuleCount, row.taskCount, row.treatmentRecipeCount, row.completeRecipeCount]
      .every((item) => Number.isInteger(item) && item >= 0 && item <= 10_000)
  ) {
    throw ledgerError("LEARNING_EXPERIENCE_CONTRACT_INVALID", "Learning experience failed privacy or value validation.");
  }
  const { experienceDigest, ...body } = row;
  if (sha256(stableLearningValue(body)) !== experienceDigest) {
    throw ledgerError("LEARNING_EXPERIENCE_HASH_MISMATCH", "Learning experience digest verification failed.", 409);
  }
  return structuredClone(row);
}

function ledgerRecordPayload(record) {
  return {
    schemaVersion: record.schemaVersion,
    sequence: record.sequence,
    receivedAt: record.receivedAt,
    previousHash: record.previousHash,
    experience: record.experience,
  };
}

export class LearningExperienceLedger {
  constructor(options = {}) {
    this.directory = options.directory;
    this.filePath = options.filePath || path.join(this.directory, "experience-ledger.jsonl");
    this.records = new Map();
    this.tailHash = ZERO_HASH;
    this.initialized = false;
    this.writeChain = Promise.resolve();
  }

  async initialize() {
    if (this.initialized) return;
    if (!this.directory) throw ledgerError("LEARNING_LEDGER_DIRECTORY_REQUIRED", "Learning ledger directory is required.", 500);
    await mkdir(this.directory, { recursive: true });
    const text = await readFile(this.filePath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    let previousHash = ZERO_HASH;
    let sequence = 0;
    for (const line of text.split(/\r?\n/u).filter(Boolean)) {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw ledgerError("LEARNING_LEDGER_INTEGRITY_FAILED", "Learning ledger contains invalid JSON.", 409);
      }
      const experience = assertAutonomousLearningExperience(record.experience);
      const expectedSequence = sequence + 1;
      const expectedHash = sha256(stableLearningValue(ledgerRecordPayload({ ...record, experience })));
      if (
        !exactKeys(record, LEDGER_RECORD_KEYS)
        || record.schemaVersion !== LEARNING_EXPERIENCE_LEDGER_VERSION
        || record.sequence !== expectedSequence
        || record.previousHash !== previousHash
        || record.recordHash !== expectedHash
        || this.records.has(experience.experienceDigest)
      ) {
        throw ledgerError("LEARNING_LEDGER_INTEGRITY_FAILED", "Learning ledger hash chain verification failed.", 409);
      }
      this.records.set(experience.experienceDigest, structuredClone(record));
      previousHash = record.recordHash;
      sequence = expectedSequence;
    }
    this.tailHash = previousHash;
    this.initialized = true;
  }

  async append(value, now = () => new Date().toISOString()) {
    const experience = assertAutonomousLearningExperience(value);
    await this.initialize();
    const operation = this.writeChain.then(async () => {
      const existing = this.records.get(experience.experienceDigest);
      if (existing) return this.receipt(existing, true);
      const body = {
        schemaVersion: LEARNING_EXPERIENCE_LEDGER_VERSION,
        sequence: this.records.size + 1,
        receivedAt: now(),
        previousHash: this.tailHash,
        experience,
      };
      const record = {
        ...body,
        recordHash: sha256(stableLearningValue(body)),
      };
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      this.records.set(experience.experienceDigest, structuredClone(record));
      this.tailHash = record.recordHash;
      return this.receipt(record, false);
    });
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }

  receipt(record, deduplicated) {
    return {
      status: "durably_recorded",
      durable: true,
      deduplicated,
      sequence: record.sequence,
      receivedAt: record.receivedAt,
      experienceDigest: record.experience.experienceDigest,
      receiptDigest: record.recordHash,
      ledgerHead: this.tailHash,
      rawContentStored: false,
      canonicalMutationCount: 0,
      modelWeightMutationCount: 0,
    };
  }

  stats() {
    return {
      schemaVersion: LEARNING_EXPERIENCE_LEDGER_VERSION,
      status: "verified",
      records: this.records.size,
      ledgerHead: this.tailHash,
      appendOnly: true,
      rawContentStored: false,
    };
  }

  listExperiences() {
    return [...this.records.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .map((record) => structuredClone(record.experience));
  }
}
