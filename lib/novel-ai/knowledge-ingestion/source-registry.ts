import crypto from "node:crypto";
import { detectKnowledgeLanguage } from "./language-detector";
import { evaluateKnowledgeLicense } from "./license-registry";
import { normalizeKnowledgeText } from "./text-normalizer";
import { KNOWLEDGE_INGESTION_SCHEMA_VERSION, type KnowledgeSource } from "./types";
import { createTaintEnvelope } from "../security";

export function registerKnowledgeSource(input: Omit<KnowledgeSource, "schemaVersion" | "sourceId" | "ingestedAt" | "contentHash" | "language" | "retrievalEligible" | "trainingEligible" | "retention" | "taint"> & {
  content: string;
  retention?: KnowledgeSource["retention"];
}) {
  const content = normalizeKnowledgeText(input.content);
  if (!content) throw Object.assign(new Error("知識來源沒有可用文字。"), { code: "KNOWLEDGE_SOURCE_EMPTY" });
  const contentHash = crypto.createHash("sha256").update(content).digest("hex");
  const eligibility = evaluateKnowledgeLicense(input);
  const source: KnowledgeSource = {
    schemaVersion: KNOWLEDGE_INGESTION_SCHEMA_VERSION,
    sourceId: `knowledge_${contentHash.slice(0, 24)}`,
    title: input.title,
    author: input.author,
    sourceType: input.sourceType,
    sourceLocation: input.sourceLocation,
    license: input.license,
    copyrightStatus: input.copyrightStatus,
    ingestedAt: new Date().toISOString(),
    contentHash,
    language: detectKnowledgeLanguage(content).language,
    trustLevel: input.trustLevel,
    userApproved: input.userApproved,
    retrievalEligible: eligibility.retrievalEligible,
    trainingEligible: eligibility.trainingEligible,
    retention: input.retention ?? (eligibility.trainingEligible ? "until_revoked" : "temporary"),
    taint: createTaintEnvelope({
      sourceId: `knowledge_${contentHash.slice(0, 24)}`,
      sourceType: input.sourceType,
      content,
      trustLevel: input.userApproved ? "user_approved" : "untrusted",
      taintLabels: [
        input.sourceType === "web_import" ? "UNTRUSTED_WEB_CONTENT" : "UNTRUSTED_DOCUMENT",
        "EXTERNAL_TRANSFER_RESTRICTED",
        ...(eligibility.trainingEligible ? [] : ["TRAINING_EXCLUDED" as const]),
      ],
    }),
  };
  return { source, normalizedContent: content, eligibility };
}
