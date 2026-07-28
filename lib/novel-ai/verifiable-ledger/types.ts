import type { ClosedAINamespace } from "../closed-ai-cache";

export const VERIFIABLE_LEDGER_SCHEMA_VERSION = "closed-ai-verifiable-ledger-v1" as const;

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

export type VerifiableLedgerBlock = {
  schemaVersion: typeof VERIFIABLE_LEDGER_SCHEMA_VERSION;
  id: string;
  ledgerId: string;
  sequence: number;
  namespace: ClosedAINamespace;
  namespaceDigest: string;
  eventType: VerifiableLedgerEventType;
  previousHash: string | null;
  payloadDigest: string;
  resultDigest: string | null;
  contentAddress: string | null;
  merkleRoot: string;
  timestamp: string;
  blockHash: string;
  signature: LedgerSignature | null;
  rawChainOfThoughtStored: false;
  immutable: true;
};

export type ContentAddressedRecord = {
  schemaVersion: typeof VERIFIABLE_LEDGER_SCHEMA_VERSION;
  id: string;
  ledgerId: string;
  projectId: string;
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
  errorCodes: string[];
  headHash: string | null;
};

export type ImmutableLedgerEvidence = {
  schemaVersion: typeof VERIFIABLE_LEDGER_SCHEMA_VERSION;
  ledgerId: string;
  projectId: string;
  exportedAt: string;
  blocks: VerifiableLedgerBlock[];
  headHash: string | null;
  merkleRoot: string;
  verification: LedgerVerificationResult;
  contentIncluded: false;
  evidenceDigest: string;
};
