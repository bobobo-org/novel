import crypto from "node:crypto";
import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";

export const CONTINUOUS_LEARNING_COORDINATOR_VERSION = "novel-continuous-learning-coordinator-v1";
const ZERO_HASH = "0".repeat(64);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function average(values) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : 0;
}

function recordPayload(record) {
  const payload = { ...record };
  delete payload.candidateDigest;
  return payload;
}

export class ContinuousLearningCoordinator {
  constructor(options = {}) {
    this.experienceLedger = options.experienceLedger;
    this.directory = options.directory;
    this.filePath = options.filePath || path.join(this.directory, "strategy-candidates.jsonl");
    this.intervalMs = Math.max(60_000, Number(options.intervalMs) || 5 * 60_000);
    this.now = options.now || (() => new Date().toISOString());
    this.records = [];
    this.head = ZERO_HASH;
    this.timer = null;
    this.initialized = false;
    this.runChain = Promise.resolve();
  }

  async initialize() {
    if (this.initialized) return;
    if (!this.experienceLedger || !this.directory) throw new Error("CONTINUOUS_LEARNING_CONFIGURATION_REQUIRED");
    await this.experienceLedger.initialize();
    await mkdir(this.directory, { recursive: true });
    const text = await readFile(this.filePath, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
    let previousHash = ZERO_HASH;
    for (const line of text.split(/\r?\n/u).filter(Boolean)) {
      const record = JSON.parse(line);
      const expected = sha256(stableValue(recordPayload(record)));
      if (
        record.schemaVersion !== CONTINUOUS_LEARNING_COORDINATOR_VERSION
        || record.sequence !== this.records.length + 1
        || record.previousHash !== previousHash
        || record.candidateDigest !== expected
        || record.adoptionStatus !== "candidate_only"
        || record.privacy?.rawContentStored !== false
        || record.privacy?.canonicalMutationCount !== 0
        || record.privacy?.memoryMutationCount !== 0
        || record.privacy?.modelWeightMutationCount !== 0
      ) throw new Error("CONTINUOUS_LEARNING_LEDGER_INTEGRITY_FAILED");
      this.records.push(record);
      previousHash = record.candidateDigest;
    }
    this.head = previousHash;
    this.initialized = true;
  }

  async runOnce() {
    await this.initialize();
    const operation = this.runChain.then(async () => {
      const ledgerStats = this.experienceLedger.stats();
      const last = this.records.at(-1);
      if (!ledgerStats.records || last?.inputLedgerHead === ledgerStats.ledgerHead) {
        return { created: false, reason: ledgerStats.records ? "unchanged" : "no_experience" };
      }
      const experiences = this.experienceLedger.listExperiences();
      const counts = { practice_passed: 0, needs_more_coverage: 0, blocked: 0 };
      for (const experience of experiences) counts[experience.outcome] += 1;
      const aggregate = {
        averageControl: average(experiences.map((item) => item.scores.control)),
        averageTreatment: average(experiences.map((item) => item.scores.treatment)),
        averageCapabilityDelta: average(experiences.map((item) => item.scores.capabilityDelta)),
        averageTaskCoverage: average(experiences.map((item) => item.scores.taskCoverage)),
        averageLineageCoverage: average(experiences.map((item) => item.scores.lineageCoverage)),
        outcomeCounts: counts,
      };
      const recommendedNextStep = counts.blocked > 0
        ? "human_review_required"
        : aggregate.averageCapabilityDelta > 0 && aggregate.averageTaskCoverage >= 0.8
          ? "retain_current_version"
          : "collect_more_approved_rules";
      const body = {
        schemaVersion: CONTINUOUS_LEARNING_COORDINATOR_VERSION,
        sequence: this.records.length + 1,
        createdAt: this.now(),
        previousHash: this.head,
        inputLedgerHead: ledgerStats.ledgerHead,
        inputRecordCount: ledgerStats.records,
        aggregate,
        recommendedNextStep,
        adoptionStatus: "candidate_only",
        privacy: {
          rawContentStored: false,
          canonicalMutationCount: 0,
          memoryMutationCount: 0,
          modelWeightMutationCount: 0,
        },
      };
      const record = { ...body, candidateDigest: sha256(stableValue(body)) };
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      this.records.push(record);
      this.head = record.candidateDigest;
      return { created: true, candidate: structuredClone(record) };
    });
    this.runChain = operation.catch(() => undefined);
    return operation;
  }

  async start() {
    if (this.timer) return;
    await this.runOnce();
    this.timer = setInterval(() => void this.runOnce().catch(() => undefined), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  stats() {
    return {
      schemaVersion: CONTINUOUS_LEARNING_COORDINATOR_VERSION,
      status: this.initialized ? "ready" : "initializing",
      backgroundActive: Boolean(this.timer),
      intervalMs: this.intervalMs,
      strategyCandidates: this.records.length,
      candidateLedgerHead: this.head,
      lastInputLedgerHead: this.records.at(-1)?.inputLedgerHead ?? null,
      adoptionMode: "candidate_only",
      rawContentStored: false,
    };
  }
}
