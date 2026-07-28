import {
  assertClosedAINamespace,
  closedAINamespaceDigest,
  estimateJsonBytes,
  sha256Hex,
  stableStringify,
  type ClosedAINamespace,
} from "../closed-ai-cache";
import { BLOCKCHAIN_INSPIRED_VERIFIABLE_ARCHITECTURE } from "./architecture";
import { merkleRoot } from "./merkle";
import {
  MemoryVerifiableLedgerRepository,
  type VerifiableLedgerRepository,
} from "./repository";
import { ApprovalSigner, verifyLedgerSignature } from "./signer";
import {
  LEGACY_VERIFIABLE_LEDGER_SCHEMA_VERSION,
  SUPPORTED_VERIFIABLE_LEDGER_SCHEMA_VERSIONS,
  VERIFIABLE_LEDGER_SCHEMA_VERSION,
  type ContentAddressedRecord,
  type ImmutableLedgerEvidence,
  type LedgerEvidenceVerificationResult,
  type LedgerLineage,
  type LedgerLineageTrace,
  type LedgerVerificationResult,
  type VerifiableLedgerBlock,
  type VerifiableLedgerEventType,
} from "./types";

const SHA256 = /^[a-f0-9]{64}$/u;
const CONTENT_ADDRESS = /^sha256:[a-f0-9]{64}$/u;
const CONTENT_RECORD_ID =
  /^cas:[a-f0-9]{64}:[a-f0-9]{64}:[a-f0-9]{64}$/u;
const SUPPORTED_SCHEMA_VERSIONS = new Set<string>(
  SUPPORTED_VERIFIABLE_LEDGER_SCHEMA_VERSIONS,
);
const SENSITIVE = [
  /\bvcp_[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:sk|sbp)_[A-Za-z0-9_-]{20,}\b/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u,
  /\bAIza[A-Za-z0-9_-]{20,}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*\b/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /"(?:password|passcode|cookie|otp|verificationCode|accessToken|refreshToken)"\s*:/iu,
  /\b(?:raw )?chain[- ]of[- ]thought\b/iu,
] as const;

type AppendLineageInput = {
  parentBlockIds?: string[];
  sourceContentAddresses?: string[];
  rollbackTargetBlockId?: string | null;
  causationId?: string | null;
};

type AppendInput = {
  ledgerId: string;
  namespace: ClosedAINamespace;
  eventType: VerifiableLedgerEventType;
  payload: unknown;
  result?: unknown;
  retainContent?: boolean;
  signApproval?: boolean;
  lineage?: AppendLineageInput;
};

type LedgerOptions = {
  repository?: VerifiableLedgerRepository;
  signer?: ApprovalSigner;
  now?: () => Date;
};

function unsignedBlockBody(
  block: Omit<VerifiableLedgerBlock, "blockHash" | "signature">,
) {
  return block;
}

function storedBlockBody(block: VerifiableLedgerBlock) {
  const body: Partial<VerifiableLedgerBlock> = { ...block };
  delete body.blockHash;
  delete body.signature;
  return body as Omit<VerifiableLedgerBlock, "blockHash" | "signature">;
}

function evidenceBody(evidence: ImmutableLedgerEvidence) {
  const body: Partial<ImmutableLedgerEvidence> = { ...evidence };
  delete body.evidenceDigest;
  delete body.evidenceSignature;
  return body as Omit<
    ImmutableLedgerEvidence,
    "evidenceDigest" | "evidenceSignature"
  >;
}

function deduplicate(values: string[]) {
  return [...new Set(values)];
}

function lineageMerkleLeaf(lineage: LedgerLineage) {
  return stableStringify({
    parentBlockIds: lineage.parentBlockIds,
    sourceContentAddresses: lineage.sourceContentAddresses,
    rollbackTargetBlockId: lineage.rollbackTargetBlockId,
    causationId: lineage.causationId,
  });
}

async function closedAILedgerScopeDigest(namespace: ClosedAINamespace) {
  return sha256Hex(stableStringify({
    tenantId: namespace.tenantId,
    userId: namespace.userId,
    projectId: namespace.projectId,
    storyId: namespace.storyId,
    canonId: namespace.canonId,
    branchId: namespace.branchId,
    characterId: namespace.characterId,
    agentRole: namespace.agentRole,
    promptProfileVersion: namespace.promptProfileVersion,
    storyBibleRevision: namespace.storyBibleRevision,
    knowledgeScopeRevision: namespace.knowledgeScopeRevision,
    privacyLevel: namespace.privacyLevel,
  }));
}

function blockMerkleLeaves(
  block: Pick<
    VerifiableLedgerBlock,
    | "schemaVersion"
    | "previousHash"
    | "namespaceDigest"
    | "ledgerScopeDigest"
    | "eventType"
    | "payloadDigest"
    | "resultDigest"
    | "contentAddress"
    | "contentRecordId"
    | "lineage"
  >,
) {
  const legacy = [
    block.previousHash ?? "genesis",
    block.namespaceDigest,
    block.eventType,
    block.payloadDigest,
    block.resultDigest ?? "no-result",
    block.contentAddress ?? "no-content",
  ];
  if (block.schemaVersion === LEGACY_VERIFIABLE_LEDGER_SCHEMA_VERSION) {
    return legacy;
  }
  return [
    ...legacy,
    block.ledgerScopeDigest ?? "no-ledger-scope",
    block.contentRecordId ?? "no-content-record",
    block.lineage ? lineageMerkleLeaf(block.lineage) : "no-lineage",
  ];
}

function ledgerError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function assertSafeIdentifier(value: string | null | undefined, code: string) {
  if (
    value !== null
    && value !== undefined
    && (
      !value.trim()
      || value.trim() !== value
      || value.length > 256
      || /[\u0000-\u001f\u007f]/u.test(value)
    )
  ) {
    throw ledgerError(code, "Ledger lineage identifier is invalid.");
  }
}

function normalizeLineage(
  eventType: VerifiableLedgerEventType,
  input: AppendLineageInput | undefined,
  blocks: VerifiableLedgerBlock[],
): LedgerLineage {
  const previous = blocks.at(-1) ?? null;
  const parentBlockIds = deduplicate(
    input?.parentBlockIds ?? (previous ? [previous.id] : []),
  );
  const sourceContentAddresses = deduplicate(
    input?.sourceContentAddresses ?? [],
  );
  const rollbackTargetBlockId = input?.rollbackTargetBlockId ?? null;
  const causationId = input?.causationId ?? null;
  const priorIds = new Set(blocks.map((block) => block.id));

  if (previous && !parentBlockIds.includes(previous.id)) {
    throw ledgerError(
      "LEDGER_LINEAGE_PREVIOUS_PARENT_REQUIRED",
      "Lineage must retain the previous append-only block.",
    );
  }
  if (!previous && parentBlockIds.length) {
    throw ledgerError(
      "LEDGER_LINEAGE_GENESIS_PARENT_INVALID",
      "A genesis block cannot reference a parent.",
    );
  }
  if (parentBlockIds.some((id) => !priorIds.has(id))) {
    throw ledgerError(
      "LEDGER_LINEAGE_PARENT_NOT_FOUND",
      "Lineage parent must be an earlier block in the same ledger.",
    );
  }
  if (
    sourceContentAddresses.some((address) => !CONTENT_ADDRESS.test(address))
  ) {
    throw ledgerError(
      "LEDGER_LINEAGE_CONTENT_ADDRESS_INVALID",
      "Lineage source content address is invalid.",
    );
  }
  if (eventType === "rollback") {
    if (!rollbackTargetBlockId || !priorIds.has(rollbackTargetBlockId)) {
      throw ledgerError(
        "LEDGER_ROLLBACK_TARGET_REQUIRED",
        "Rollback must reference an earlier block in the same ledger.",
      );
    }
  } else if (rollbackTargetBlockId !== null) {
    throw ledgerError(
      "LEDGER_ROLLBACK_TARGET_EVENT_INVALID",
      "Only rollback events can reference a rollback target.",
    );
  }
  assertSafeIdentifier(causationId, "LEDGER_LINEAGE_CAUSATION_ID_INVALID");
  return {
    parentBlockIds,
    sourceContentAddresses,
    rollbackTargetBlockId,
    causationId,
  };
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
    assertSafeIdentifier(input.ledgerId, "VERIFIABLE_LEDGER_ID_REQUIRED");
    if (input.signApproval && input.eventType !== "approval-signed") {
      throw ledgerError(
        "LEDGER_SIGNATURE_EVENT_INVALID",
        "Signed approval is only valid for an approval event.",
      );
    }
    if (input.eventType === "approval-signed" && !input.signApproval) {
      throw ledgerError(
        "LEDGER_APPROVAL_SIGNATURE_REQUIRED",
        "Approval events must be signed.",
      );
    }
    const serializedPayload = stableStringify(input.payload);
    const serializedResult = input.result === undefined
      ? null
      : stableStringify(input.result);
    const serializedLineage = stableStringify(input.lineage ?? null);
    if (
      SENSITIVE.some((pattern) =>
        pattern.test(
          `${serializedPayload}\n${serializedResult ?? ""}\n${serializedLineage}`,
        ))
    ) {
      throw ledgerError(
        "VERIFIABLE_LEDGER_SENSITIVE_PAYLOAD_BLOCKED",
        "Sensitive data cannot enter the immutable ledger.",
      );
    }

    const blocks = await this.repository.list(input.ledgerId);
    const previous = blocks.at(-1) ?? null;
    const lineage = normalizeLineage(input.eventType, input.lineage, blocks);
    const [
      namespaceDigest,
      ledgerScopeDigest,
      ledgerIdDigest,
      payloadDigest,
      resultDigest,
    ] =
      await Promise.all([
        closedAINamespaceDigest(input.namespace),
        closedAILedgerScopeDigest(input.namespace),
        sha256Hex(input.ledgerId),
        sha256Hex(serializedPayload),
        serializedResult === null
          ? Promise.resolve(null)
          : sha256Hex(serializedResult),
      ]);
    const existingLedgerScopeDigest = blocks.length
      ? blocks[0].ledgerScopeDigest
        ?? await closedAILedgerScopeDigest(blocks[0].namespace)
      : null;
    if (existingLedgerScopeDigest && existingLedgerScopeDigest !== ledgerScopeDigest) {
      throw ledgerError(
        "LEDGER_NAMESPACE_SCOPE_MISMATCH",
        "One ledger cannot mix closed AI namespaces.",
      );
    }
    const contentAddress = input.retainContent
      ? `sha256:${payloadDigest}`
      : null;
    const contentRecordId = contentAddress
      ? `cas:${namespaceDigest}:${ledgerIdDigest}:${payloadDigest}`
      : null;
    if (contentAddress && contentRecordId) {
      const record: ContentAddressedRecord = {
        schemaVersion: VERIFIABLE_LEDGER_SCHEMA_VERSION,
        id: contentRecordId,
        ledgerId: input.ledgerId,
        projectId: input.namespace.projectId,
        namespaceDigest,
        payloadDigest,
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
      ledgerScopeDigest,
      eventType: input.eventType,
      previousHash: previous?.blockHash ?? null,
      payloadDigest,
      resultDigest,
      contentAddress,
      contentRecordId,
      lineage,
      merkleRoot: "",
      timestamp,
      rawChainOfThoughtStored: false,
      immutable: true,
    };
    base.merkleRoot = await merkleRoot(blockMerkleLeaves(base));
    const blockHash = await sha256Hex(stableStringify(unsignedBlockBody(base)));
    const signature = input.signApproval
      ? await this.signer.sign(blockHash, timestamp)
      : null;
    const block: VerifiableLedgerBlock = { ...base, blockHash, signature };
    await this.repository.append(block);
    return block;
  }

  private async verifyBlocks(
    blocks: VerifiableLedgerBlock[],
    options: { verifyRetainedContent: boolean },
  ): Promise<LedgerVerificationResult> {
    const errorCodes: string[] = [];
    let previousHash: string | null = null;
    let signedApprovalCount = 0;
    let contentAddressCount = 0;
    let lineageEdgeCount = 0;
    const priorBlocks = new Map<string, VerifiableLedgerBlock>();
    const expectedLedgerId = blocks[0]?.ledgerId ?? null;
    const expectedLedgerScopeDigest = blocks[0]
      ? blocks[0].ledgerScopeDigest
        ?? await closedAILedgerScopeDigest(blocks[0].namespace)
      : null;

    for (const [index, block] of blocks.entries()) {
      const suffix = block.sequence;
      if (!SUPPORTED_SCHEMA_VERSIONS.has(block.schemaVersion)) {
        errorCodes.push(`LEDGER_SCHEMA_UNSUPPORTED:${suffix}`);
      }
      if (block.ledgerId !== expectedLedgerId) {
        errorCodes.push(`LEDGER_ID_MISMATCH:${suffix}`);
      }
      if (block.sequence !== index + 1) {
        errorCodes.push(`LEDGER_SEQUENCE_INVALID:${suffix}`);
      }
      if (block.previousHash !== previousHash) {
        errorCodes.push(`LEDGER_PREVIOUS_HASH_INVALID:${suffix}`);
      }
      if (!SHA256.test(block.payloadDigest)) {
        errorCodes.push(`LEDGER_PAYLOAD_DIGEST_INVALID:${suffix}`);
      }
      if (block.resultDigest !== null && !SHA256.test(block.resultDigest)) {
        errorCodes.push(`LEDGER_RESULT_DIGEST_INVALID:${suffix}`);
      }
      if (
        block.rawChainOfThoughtStored !== false
        || block.immutable !== true
      ) {
        errorCodes.push(`LEDGER_IMMUTABILITY_FLAGS_INVALID:${suffix}`);
      }

      const body = storedBlockBody(block);
      const actualHash = await sha256Hex(stableStringify(body));
      if (actualHash !== block.blockHash) {
        errorCodes.push(`LEDGER_BLOCK_HASH_INVALID:${suffix}`);
      }
      const expectedRoot = await merkleRoot(blockMerkleLeaves(block));
      if (expectedRoot !== block.merkleRoot) {
        errorCodes.push(`LEDGER_MERKLE_ROOT_INVALID:${suffix}`);
      }
      try {
        const expectedNamespace = await closedAINamespaceDigest(block.namespace);
        if (expectedNamespace !== block.namespaceDigest) {
          errorCodes.push(`LEDGER_NAMESPACE_DIGEST_INVALID:${suffix}`);
        }
        const actualLedgerScopeDigest = await closedAILedgerScopeDigest(
          block.namespace,
        );
        if (
          block.schemaVersion === VERIFIABLE_LEDGER_SCHEMA_VERSION
          && block.ledgerScopeDigest !== actualLedgerScopeDigest
        ) {
          errorCodes.push(`LEDGER_SCOPE_DIGEST_INVALID:${suffix}`);
        }
        if (actualLedgerScopeDigest !== expectedLedgerScopeDigest) {
          errorCodes.push(`LEDGER_NAMESPACE_SCOPE_MISMATCH:${suffix}`);
        }
      } catch {
        errorCodes.push(`LEDGER_NAMESPACE_INVALID:${suffix}`);
      }

      if (block.signature) {
        signedApprovalCount += 1;
        if (
          block.signature.signedAt !== block.timestamp
          || !await verifyLedgerSignature(block.blockHash, block.signature)
        ) {
          errorCodes.push(`LEDGER_SIGNATURE_INVALID:${suffix}`);
        }
      }
      if (block.eventType === "approval-signed" && !block.signature) {
        errorCodes.push(`LEDGER_APPROVAL_SIGNATURE_MISSING:${suffix}`);
      }

      if (block.schemaVersion === VERIFIABLE_LEDGER_SCHEMA_VERSION) {
        if (!block.lineage) {
          errorCodes.push(`LEDGER_LINEAGE_MISSING:${suffix}`);
        } else {
          lineageEdgeCount += block.lineage.parentBlockIds.length;
          const expectedPreviousId = index > 0 ? blocks[index - 1]?.id : null;
          if (
            expectedPreviousId
            && !block.lineage.parentBlockIds.includes(expectedPreviousId)
          ) {
            errorCodes.push(`LEDGER_LINEAGE_PREVIOUS_PARENT_MISSING:${suffix}`);
          }
          if (!expectedPreviousId && block.lineage.parentBlockIds.length) {
            errorCodes.push(`LEDGER_LINEAGE_GENESIS_PARENT_INVALID:${suffix}`);
          }
          for (const parentId of block.lineage.parentBlockIds) {
            if (!priorBlocks.has(parentId)) {
              errorCodes.push(`LEDGER_LINEAGE_PARENT_INVALID:${suffix}`);
            }
          }
          if (
            block.lineage.sourceContentAddresses.some(
              (address) => !CONTENT_ADDRESS.test(address),
            )
          ) {
            errorCodes.push(`LEDGER_LINEAGE_CONTENT_ADDRESS_INVALID:${suffix}`);
          }
          if (
            block.eventType === "rollback"
            && (
              !block.lineage.rollbackTargetBlockId
              || !priorBlocks.has(block.lineage.rollbackTargetBlockId)
            )
          ) {
            errorCodes.push(`LEDGER_ROLLBACK_TARGET_INVALID:${suffix}`);
          }
          if (
            block.eventType !== "rollback"
            && block.lineage.rollbackTargetBlockId !== null
          ) {
            errorCodes.push(`LEDGER_ROLLBACK_TARGET_EVENT_INVALID:${suffix}`);
          }
        }
      }

      if (block.contentAddress) {
        contentAddressCount += 1;
        if (
          !CONTENT_ADDRESS.test(block.contentAddress)
          || block.contentAddress !== `sha256:${block.payloadDigest}`
        ) {
          errorCodes.push(`LEDGER_CONTENT_ADDRESS_INVALID:${suffix}`);
        }
        const contentRecordId = block.contentRecordId ?? block.contentAddress;
        if (
          block.schemaVersion === VERIFIABLE_LEDGER_SCHEMA_VERSION
          && (
            !block.contentRecordId
            || !CONTENT_RECORD_ID.test(block.contentRecordId)
          )
        ) {
          errorCodes.push(`LEDGER_CONTENT_RECORD_ID_INVALID:${suffix}`);
        }
        if (options.verifyRetainedContent) {
          const record = await this.repository.getContent(contentRecordId, {
            ledgerId: block.ledgerId,
            projectId: block.namespace.projectId,
            namespaceDigest: block.namespaceDigest,
          });
          if (!record) {
            errorCodes.push(`LEDGER_CONTENT_RECORD_MISSING:${suffix}`);
          } else {
            const actualPayloadDigest = await sha256Hex(
              stableStringify(record.content),
            );
            if (
              record.contentAddress !== block.contentAddress
              || actualPayloadDigest !== block.payloadDigest
              || record.byteSize !== estimateJsonBytes(record.content)
              || record.localOnly !== true
            ) {
              errorCodes.push(`LEDGER_CONTENT_RECORD_INVALID:${suffix}`);
            }
            if (
              block.schemaVersion === VERIFIABLE_LEDGER_SCHEMA_VERSION
              && (
                record.id !== block.contentRecordId
                || record.ledgerId !== block.ledgerId
                || record.projectId !== block.namespace.projectId
                || record.namespaceDigest !== block.namespaceDigest
                || record.payloadDigest !== block.payloadDigest
              )
            ) {
              errorCodes.push(`LEDGER_CONTENT_SCOPE_INVALID:${suffix}`);
            }
          }
        }
      } else if (block.contentRecordId) {
        errorCodes.push(`LEDGER_CONTENT_RECORD_ORPHANED:${suffix}`);
      }

      priorBlocks.set(block.id, block);
      previousHash = block.blockHash;
    }
    return {
      valid: errorCodes.length === 0,
      blockCount: blocks.length,
      signedApprovalCount,
      contentAddressCount,
      lineageEdgeCount,
      errorCodes,
      headHash: blocks.at(-1)?.blockHash ?? null,
    };
  }

  async verify(ledgerId: string): Promise<LedgerVerificationResult> {
    const blocks = await this.repository.list(ledgerId);
    const verification = await this.verifyBlocks(blocks, {
      verifyRetainedContent: true,
    });
    if (blocks.some((block) => block.ledgerId !== ledgerId)) {
      verification.errorCodes.push("LEDGER_QUERY_SCOPE_MISMATCH");
      verification.valid = false;
    }
    return verification;
  }

  async traceLineage(
    ledgerId: string,
    targetBlockId: string,
  ): Promise<LedgerLineageTrace> {
    const blocks = await this.repository.list(ledgerId);
    const verification = await this.verify(ledgerId);
    const byId = new Map(blocks.map((block) => [block.id, block]));
    const target = byId.get(targetBlockId);
    const errorCodes = [...verification.errorCodes];
    if (!target) errorCodes.push("LEDGER_LINEAGE_TARGET_NOT_FOUND");
    const visited = new Set<string>();
    const sourceContentAddresses = new Set<string>();
    const rollbackTargetBlockIds = new Set<string>();
    const pending = target ? [target.id] : [];

    while (pending.length) {
      const blockId = pending.pop()!;
      if (visited.has(blockId)) continue;
      const block = byId.get(blockId);
      if (!block) {
        errorCodes.push(`LEDGER_LINEAGE_REFERENCE_MISSING:${blockId}`);
        continue;
      }
      visited.add(blockId);
      if (block.contentAddress) sourceContentAddresses.add(block.contentAddress);
      if (block.lineage) {
        for (const address of block.lineage.sourceContentAddresses) {
          sourceContentAddresses.add(address);
        }
        for (const parentId of block.lineage.parentBlockIds) pending.push(parentId);
        if (block.lineage.rollbackTargetBlockId) {
          rollbackTargetBlockIds.add(block.lineage.rollbackTargetBlockId);
          pending.push(block.lineage.rollbackTargetBlockId);
        }
      } else if (block.previousHash) {
        const previous = blocks.find(
          (candidate) => candidate.blockHash === block.previousHash,
        );
        if (previous) pending.push(previous.id);
      }
    }

    return {
      ledgerId,
      targetBlockId,
      valid: errorCodes.length === 0,
      blockIds: blocks
        .filter((block) => visited.has(block.id))
        .map((block) => block.id),
      sourceContentAddresses: [...sourceContentAddresses].sort(),
      rollbackTargetBlockIds: [...rollbackTargetBlockIds].sort(),
      errorCodes: deduplicate(errorCodes),
    };
  }

  async exportEvidence(
    ledgerId: string,
    projectId: string,
  ): Promise<ImmutableLedgerEvidence> {
    const blocks = await this.repository.list(ledgerId);
    if (blocks.some((block) => block.namespace.projectId !== projectId)) {
      throw ledgerError(
        "VERIFIABLE_LEDGER_EXPORT_SCOPE_MISMATCH",
        "Ledger export project scope mismatch.",
      );
    }
    const verification = await this.verify(ledgerId);
    if (!verification.valid) {
      throw Object.assign(
        new Error("Ledger integrity verification failed."),
        {
          code: "VERIFIABLE_LEDGER_INTEGRITY_FAILED",
          errorCodes: verification.errorCodes,
        },
      );
    }
    const exportedAt = this.now().toISOString();
    const body = {
      schemaVersion: VERIFIABLE_LEDGER_SCHEMA_VERSION,
      architecture:
        BLOCKCHAIN_INSPIRED_VERIFIABLE_ARCHITECTURE.schemaVersion,
      ledgerId,
      projectId,
      exportedAt,
      blocks,
      headHash: verification.headHash,
      merkleRoot: await merkleRoot(blocks.map((block) => block.blockHash)),
      verification,
      contentIncluded: false as const,
    };
    const evidenceDigest = await sha256Hex(stableStringify(body));
    return {
      ...body,
      evidenceDigest,
      evidenceSignature: await this.signer.sign(evidenceDigest, exportedAt),
    };
  }

  async verifyEvidence(
    evidence: ImmutableLedgerEvidence,
  ): Promise<LedgerEvidenceVerificationResult> {
    const errorCodes: string[] = [];
    if (evidence.schemaVersion !== VERIFIABLE_LEDGER_SCHEMA_VERSION) {
      errorCodes.push("LEDGER_EVIDENCE_SCHEMA_INVALID");
    }
    if (
      evidence.architecture
      !== BLOCKCHAIN_INSPIRED_VERIFIABLE_ARCHITECTURE.schemaVersion
    ) {
      errorCodes.push("LEDGER_EVIDENCE_ARCHITECTURE_INVALID");
    }
    const actualDigest = await sha256Hex(
      stableStringify(evidenceBody(evidence)),
    );
    if (actualDigest !== evidence.evidenceDigest) {
      errorCodes.push("LEDGER_EVIDENCE_DIGEST_INVALID");
    }
    if (
      evidence.evidenceSignature.signedAt !== evidence.exportedAt
      || !await verifyLedgerSignature(
        evidence.evidenceDigest,
        evidence.evidenceSignature,
      )
    ) {
      errorCodes.push("LEDGER_EVIDENCE_SIGNATURE_INVALID");
    }
    const blockVerification = await this.verifyBlocks(evidence.blocks, {
      verifyRetainedContent: false,
    });
    errorCodes.push(
      ...blockVerification.errorCodes.map((code) => `EVIDENCE_${code}`),
    );
    if (
      evidence.blocks.some(
        (block) =>
          block.ledgerId !== evidence.ledgerId
          || block.namespace.projectId !== evidence.projectId,
      )
    ) {
      errorCodes.push("LEDGER_EVIDENCE_SCOPE_INVALID");
    }
    const expectedMerkleRoot = await merkleRoot(
      evidence.blocks.map((block) => block.blockHash),
    );
    if (expectedMerkleRoot !== evidence.merkleRoot) {
      errorCodes.push("LEDGER_EVIDENCE_MERKLE_ROOT_INVALID");
    }
    if (
      blockVerification.headHash !== evidence.headHash
      || evidence.verification.headHash !== evidence.headHash
      || evidence.verification.valid !== true
    ) {
      errorCodes.push("LEDGER_EVIDENCE_HEAD_INVALID");
    }
    if (
      evidence.verification.blockCount !== blockVerification.blockCount
      || evidence.verification.signedApprovalCount
        !== blockVerification.signedApprovalCount
      || evidence.verification.contentAddressCount
        !== blockVerification.contentAddressCount
      || evidence.verification.lineageEdgeCount
        !== blockVerification.lineageEdgeCount
      || evidence.verification.errorCodes.length !== 0
    ) {
      errorCodes.push("LEDGER_EVIDENCE_VERIFICATION_SUMMARY_INVALID");
    }
    if (evidence.contentIncluded !== false) {
      errorCodes.push("LEDGER_EVIDENCE_CONTENT_BOUNDARY_INVALID");
    }
    return {
      valid: errorCodes.length === 0,
      errorCodes: deduplicate(errorCodes),
      evidenceDigest: actualDigest,
      headHash: blockVerification.headHash,
    };
  }
}

export const VERIFIABLE_LEDGER_HEALTH = {
  schemaVersion: VERIFIABLE_LEDGER_SCHEMA_VERSION,
  architecture:
    BLOCKCHAIN_INSPIRED_VERIFIABLE_ARCHITECTURE.schemaVersion,
  formalName:
    BLOCKCHAIN_INSPIRED_VERIFIABLE_ARCHITECTURE.formalName,
  status: "ready",
  topologyStatus: "one_agent_os_three_compute_backends",
  appendOnlyAuditStatus: "ready",
  hashChainStatus: "ready",
  merkleTreeStatus: "ready",
  signedApprovalStatus: "ready",
  contentAddressedStorageStatus: "ready_scoped",
  immutableEvidenceStatus: "ready_signed",
  learningCandidateLedgerStatus: "ready",
  rollbackLineageStatus: "ready",
  dataLineageTracingStatus: "ready",
  legacyV1ReadCompatibilityStatus: "ready",
  publicBlockchainStatus: "not_used",
  consensusVotingStatus: "not_used",
  heavyConsensusStatus: "not_used",
  crossBackendFullReplicationStatus: "not_used",
  publicLedgerStatus: "not_used",
  perGenerationBlockchainCostStatus: "not_used",
  backendNodesMaintainSharedChain: false,
  rawChainOfThoughtStored: false,
} as const;
