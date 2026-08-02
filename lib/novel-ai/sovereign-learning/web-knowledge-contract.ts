import type { LearningRuleDraft, TextFingerprint } from "./types";

export const CONTROLLED_WEB_KNOWLEDGE_VERSION = "controlled-web-knowledge-v1" as const;

export type ControlledTeacherProvider = "openai" | "grok";

export type ControlledWebTeacherEvidence = {
  provider: ControlledTeacherProvider;
  model: string;
  responseDigest: string;
  acceptedRuleCount: number;
  rejectionCodes: string[];
  candidateOnly: true;
  dataLeavesDevice: true;
  rawResponseRetained: false;
};

export type ControlledWebSourceEvidence = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  fetchedAt: string;
  contentType: string;
  contentCharacters: number;
  redirects: number;
  robotsPolicy: "allowed" | "not_present";
  sourceDigest: string;
  fingerprint: TextFingerprint;
  sanitizationStatus: "unchanged" | "sanitized";
  warningCodes: string[];
  rawContentRetained: false;
};

export type DistilledWebKnowledgeBundle = {
  schemaVersion: typeof CONTROLLED_WEB_KNOWLEDGE_VERSION;
  source: ControlledWebSourceEvidence;
  rules: LearningRuleDraft[];
  teachers: ControlledWebTeacherEvidence[];
  teacherAgreement: {
    requestedTeachers: number;
    completedTeachers: number;
    crossTeacherRuleCount: number;
  };
  privacy: {
    rawSourceRetained: false;
    rawTeacherResponseRetained: false;
    externalRequestCount: number;
    dataLeftDevice: true;
    candidateOnly: true;
    canonicalMutationCount: 0;
  };
  immutableDigest: string;
};

export function distilledWebKnowledgePayload(bundle: DistilledWebKnowledgeBundle) {
  return {
    schemaVersion: bundle.schemaVersion,
    source: bundle.source,
    rules: bundle.rules,
    teachers: bundle.teachers,
    teacherAgreement: bundle.teacherAgreement,
    privacy: bundle.privacy,
  };
}
