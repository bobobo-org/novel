import {
  assertClosedAINamespace,
  closedAINamespaceDigest,
  estimateJsonBytes,
  sha256Hex,
  stableStringify,
  type ClosedAINamespace,
} from "../closed-ai-cache";
import { merkleRoot } from "./merkle";
import {
  MemoryVerifiableLedgerRepository,
  type VerifiableLedgerRepository,
} from "./repository";
import { ApprovalSigner, verifyLedgerSignature } from "./signer";
import {
  VERIFIABLE_LEDGER_SCHEMA_VERSION,
  type ContentAddressedRecord,
  type ImmutableLedgerEvidence,
  type LedgerVerificationResult,
  type VerifiableLedgerBlock,
  type VerifiableLedgerEventType,
} from "./types";

const SENSITIVE = [
  /\bvcp_[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:sk|sbp)_[A-Za-z0-9_-]{20,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bchain[- ]of[- ]thought\b/iu,
] as const;

type AppendInput = {
  ledgerId: string;
  namespace: ClosedAINamespace;
  eventType: VerifiableLedgerEventType;
  payload: unknown;
  result?: unknown;
  retainContent?: boolean;
  signApproval?: boolean;
};

type LedgerOptions = {
  repository?: VerifiableLedgerRepository;
  signer?: ApprovalSigner;
  now?: () => Date;
};

function unsignedBlockBody(block: Omit<VerifiableLedgerBlock, "blockHash" | "signature">) {
  return block;
}

function storedBlockBody(block: VerifiableLedgerBlock) {
  const body: Partial<VerifiableLedgerBlock> = { ...block };
  delete body.blockHash;
  delete body.signature;
  return body as Omit<VerifiableLedgerBlock, "blockHash" | "signature">;
}

export class VerifiableLedger {
  readonly repository: VerifiableLedgerRepository;
  private readonly signer: ApprovalSigner;
  private readonly now: () => Date;
  private queues = new Map<string, Promise<unknown>>();

  constructor(options: LedgerOptions = {}) {
    this.repository = options.repository ?? new MemoryVerifiableLedgerRepository();
    this.signer = options.signer ?? new ApprovalSigner();
    this.now = options.now ?? (() => new Date());
  }

  append(input: AppendInput): Promise<VerifiableLedgerBlock> {
    const previous = this.queues.get(input.ledgerId) ?? Promise.resolve();
    const operation = previous.then(() => this.appendInternal(input));
    this.queues.set(input.ledgerId, operation.catch(() => undefined));
    return operation;
  }

  private async appendInternal(input: AppendInput): Promise<VerifiableLedgerBlock> {
    assertClosedAINamespace(input.namespace);
    if (!input.ledgerId.trim()) throw new Error("VERIFIABLE_LEDGER_ID_REQUIRED");
    const serializedPayload = stableStringify(input.payload);
    const serializedResult = input.result === undefined ? null : stableStringify(input.result);
    if (SENSITIVE.some((pattern) => pattern.test(`${serializedPayload}\n${serializedResult ?? ""}`))) {
      throw Object.assign(new Error("Sensitive data cannot enter the immutable ledger."), {
        code: "VERIFIABLE_LEDGER_SENSITIVE_PAYLOAD_BLOCKED",
      });
    }
    const blocks = await this.repository.list(input.ledgerId);
    const previous = blocks.at(-1) ?? null;
    const [namespaceDigest, payloadDigest, resultDigest] = await Promise.all([
      closedAINamespaceDigest(input.namespace),
      sha256Hex(serializedPayload),
      serializedResult === null ? Promise.resolve(null) : sha256Hex(serializedResult),
    ]);
    const contentAddress = input.retainContent
      ? `sha256:${payloadDigest}`
      : null;
    if (contentAddress) {
      const record: ContentAddressedRecord = {
        schemaVersion: VERIFIABLE_LEDGER_SCHEMA_VERSION,
        id: contentAddress,
        ledgerId: input.ledgerId,
        projectId: input.namespace.projectId,
        contentAddress,
        content: structuredClone(input.payload),
        byteSize: estimateJsonBytes(input.payload),
        createdAt: this.now().toISOString(),
        localOnly: true,
      };
      await this.repository.putContent(record);
    }
    const timestamp = this.now().toISOString();
    const base: Omit<VerifiableLedgerBlock, "blockHash" | "signature"> = {
      schemaVersion: VERIFIABLE_LEDGER_SCHEMA_VERSION,
      id: `${input.ledgerId}:${blocks.length + 1}`,
      ledgerId: input.ledgerId,
      sequence: blocks.length + 1,
      namespace: structuredClone(input.namespace),
      namespaceDigest,
      eventType: input.eventType,
      previousHash: previous?.blockHash ?? null,
      payloadDigest,
      resultDigest,
      contentAddress,
      merkleRoot: await merkleRoot([
        previous?.blockHash ?? "genesis",
        namespaceDigest,
        input.eventType,
        payloadDigest,
        resultDigest ?? "no-result",
        contentAddress ?? "no-content",
      ]),
      timestamp,
      rawChainOfThoughtStored: false,
      immutable: true,
    };
    const blockHash = await sha256Hex(stableStringify(unsignedBlockBody(base)));
    const signature = input.signApproval
      ? await this.signer.sign(blockHash, timestamp)
      : null;
    const block: VerifiableLedgerBlock = { ...base, blockHash, signature };
    await this.repository.append(block);
    return block;
  }

  async verify(ledgerId: string): Promise<LedgerVerificationResult> {
    const blocks = await this.repository.list(ledgerId);
    const errorCodes: string[] = [];
    let previousHash: string | null = null;
    let signedApprovalCount = 0;
    for (const [index, block] of blocks.entries()) {
      if (block.sequence !== index + 1) errorCodes.push(`LEDGER_SEQUENCE_INVALID:${block.sequence}`);
      if (block.previousHash !== previousHash) errorCodes.push(`LEDGER_PREVIOUS_HASH_INVALID:${block.sequence}`);
      const body = storedBlockBody(block);
      const actualHash = await sha256Hex(stableStringify(body));
      if (actualHash !== block.blockHash) errorCodes.push(`LEDGER_BLOCK_HASH_INVALID:${block.sequence}`);
      const expectedRoot = await merkleRoot([
        block.previousHash ?? "genesis",
        block.namespaceDigest,
        block.eventType,
        block.payloadDigest,
        block.resultDigest ?? "no-result",
        block.contentAddress ?? "no-content",
      ]);
      if (expectedRoot !== block.merkleRoot) errorCodes.push(`LEDGER_MERKLE_ROOT_INVALID:${block.sequence}`);
      const expectedNamespace = await closedAINamespaceDigest(block.namespace);
      if (expectedNamespace !== block.namespaceDigest) {
        errorCodes.push(`LEDGER_NAMESPACE_DIGEST_INVALID:${block.sequence}`);
      }
      if (block.signature) {
        signedApprovalCount += 1;
        if (!await verifyLedgerSignature(block.blockHash, block.signature)) {
          errorCodes.push(`LEDGER_SIGNATURE_INVALID:${block.sequence}`);
        }
      }
      if (block.eventType === "approval-signed" && !block.signature) {
        errorCodes.push(`LEDGER_APPROVAL_SIGNATURE_MISSING:${block.sequence}`);
      }
      previousHash = block.blockHash;
    }
    return {
      valid: errorCodes.length === 0,
      blockCount: blocks.length,
      signedApprovalCount,
      errorCodes,
      headHash: blocks.at(-1)?.blockHash ?? null,
    };
  }

  async exportEvidence(ledgerId: string, projectId: string): Promise<ImmutableLedgerEvidence> {
    const blocks = await this.repository.list(ledgerId);
    if (blocks.some((block) => block.namespace.projectId !== projectId)) {
      throw Object.assign(new Error("Ledger export project scope mismatch."), {
        code: "VERIFIABLE_LEDGER_EXPORT_SCOPE_MISMATCH",
      });
    }
    const verification = await this.verify(ledgerId);
    if (!verification.valid) {
      throw Object.assign(new Error("Ledger integrity verification failed."), {
        code: "VERIFIABLE_LEDGER_INTEGRITY_FAILED",
        errorCodes: verification.errorCodes,
      });
    }
    const body = {
      schemaVersion: VERIFIABLE_LEDGER_SCHEMA_VERSION,
      ledgerId,
      projectId,
      exportedAt: this.now().toISOString(),
      blocks,
      headHash: verification.headHash,
      merkleRoot: await merkleRoot(blocks.map((block) => block.blockHash)),
      verification,
      contentIncluded: false as const,
    };
    return {
      ...body,
      evidenceDigest: await sha256Hex(stableStringify(body)),
    };
  }
}

export const VERIFIABLE_LEDGER_HEALTH = {
  schemaVersion: VERIFIABLE_LEDGER_SCHEMA_VERSION,
  status: "ready",
  appendOnlyAuditStatus: "ready",
  hashChainStatus: "ready",
  merkleTreeStatus: "ready",
  signedApprovalStatus: "ready",
  contentAddressedStorageStatus: "ready",
  immutableEvidenceStatus: "ready",
  learningCandidateLedgerStatus: "ready",
  rollbackLineageStatus: "ready",
  publicBlockchainStatus: "not_used",
  consensusVotingStatus: "not_used",
  crossUserReplicationStatus: "not_used",
  rawChainOfThoughtStored: false,
} as const;
