import type { TaintEnvelope } from "../security/taint-tracking";

export const KNOWLEDGE_INGESTION_SCHEMA_VERSION = "p23-knowledge-ingestion-v1" as const;

export type KnowledgeLicense =
  | "user_owned"
  | "public_domain"
  | "open_license"
  | "training_permitted"
  | "retrieval_only"
  | "unknown";

export type KnowledgeSource = {
  schemaVersion: typeof KNOWLEDGE_INGESTION_SCHEMA_VERSION;
  sourceId: string;
  title: string;
  author: string | null;
  sourceType: "user_document" | "public_domain" | "open_license" | "web_import" | "manual_knowledge";
  sourceLocation: string | null;
  license: KnowledgeLicense;
  copyrightStatus: "owned" | "public_domain" | "licensed" | "unknown";
  ingestedAt: string;
  contentHash: string;
  language: string;
  trustLevel: "unverified" | "low" | "medium" | "high";
  userApproved: boolean;
  retrievalEligible: boolean;
  trainingEligible: boolean;
  retention: "temporary" | "project_lifetime" | "until_revoked";
  taint: TaintEnvelope;
};

export type KnowledgeChunk = {
  chunkId: string;
  sourceId: string;
  chunkHash: string;
  text: string;
  order: number;
  start: number;
  end: number;
  language: string;
  metadata: Record<string, string | number | boolean | null>;
  taint: TaintEnvelope;
};

export type ParsedKnowledgeDocument = {
  title: string;
  text: string;
  format: "text" | "markdown" | "html" | "json";
  warnings: string[];
  taint: TaintEnvelope;
};

export type KnowledgeVersion = {
  versionId: string;
  sourceId: string;
  version: number;
  contentHash: string;
  chunkHashes: string[];
  parentVersionId: string | null;
  createdAt: string;
  status: "active" | "superseded" | "revoked";
};
