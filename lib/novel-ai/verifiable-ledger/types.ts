import type { ClosedAINamespace } from "../closed-ai-cache";

export const LEGACY_VERIFIABLE_LEDGER_SCHEMA_VERSION =
  "closed-ai-verifiable-ledger-v1" as const;
export const VERIFIABLE_LEDGER_SCHEMA_VERSION =
  "closed-ai-verifiable-ledger-v2" as const;
export const SUPPORTED_VERIFIABLE_LEDGER_SCHEMA_VERSIONS = [
  LEGACY_VERIFIABLE_LEDGER_SCHEMA_VERSION,
  VERIFIABLE_LEDGER_SCHEMA_VERSION,
] as const;

export type VerifiableLedgerSchemaVersion =
  (typeof SUPPORTED_VERIFIABLE_LEDGER_SCHEMA_VERSIONS)[number];

export type VerifiableLedgerEventType =
  | "task-accepted"
  | "backend-selected"
  | "candidate-generated"
  | "candidate-evaluated"
  | "approval-signed"
  | "canonical-commit"
  | "learning-experience"
  | "learning-candidate"
  | "learning-adopted"
  | "rollback"
  | "cache-invalidated"
  | "security-blocked";

export type LedgerSignature = {
  algorithm: "ECDSA-P256-SHA256";
  keyId: string;
  publicKeyJwk: JsonWebKey;
  signature: string;
  signedAt: string;
};

export type LedgerLineage = {
  parentBlockIds: string[];
  sourceContentAddresses: string[];
  rollbackTargetBlockId: string | null;
  causationId: string | null;
};

export type VerifiableLedgerBlock = {
  schemaVersion: VerifiableLedgerSchemaVersion;
  id: string;
  ledgerId: string;
  sequence: number;
  namespace: ClosedAINamespace;
  namespaceDigest: string;
  ledgerScopeDigest?: string;
  eventType: VerifiableLedgerEventType;
  previousHash: string | null;
  payloadDigest: string;
  resultDigest: string | null;
  contentAddress: string | null;
  contentRecordId?: string | null;
  lineage?: LedgerLineage;
  merkleRoot: string;
  timestamp: string;
  blockHash: string;
  signature: LedgerSignature | null;
  rawChainOfThoughtStored: false;
  immutable: true;
};

export type ContentAddressedRecord = {
  schemaVersion: VerifiableLedgerSchemaVersion;
  id: string;
  ledgerId: string;
  projectId: string;
  namespaceDigest?: string;
  payloadDigest?: string;
  contentAddress: string;
  content: unknown;
  byteSize: number;
  createdAt: string;
  localOnly: true;
};

export type LedgerVerificationResult = {
  valid: boolean;
  blockCount: number;
  signedApprovalCount: number;
  contentAddressCount: number;
  lineageEdgeCount: number;
  errorCodes: string[];
  headHash: string | null;
};

export type ImmutableLedgerEvidence = {
  schemaVersion: typeof VERIFIABLE_LEDGER_SCHEMA_VERSION;
  architecture: "blockchain-inspired-verifiable-architecture-v1";
  ledgerId: string;
  projectId: string;
  exportedAt: string;
  blocks: VerifiableLedgerBlock[];
  headHash: string | null;
  merkleRoot: string;
  verification: LedgerVerificationResult;
  contentIncluded: false;
  evidenceDigest: string;
  evidenceSignature: LedgerSignature;
};

export type LedgerEvidenceVerificationResult = {
  valid: boolean;
  errorCodes: string[];
  evidenceDigest: string;
  headHash: string | null;
};

export type LedgerLineageTrace = {
  ledgerId: string;
  targetBlockId: string;
  valid: boolean;
  blockIds: string[];
  sourceContentAddresses: string[];
  rollbackTargetBlockIds: string[];
  errorCodes: string[];
};
