import type { KnowledgeLicense } from "./types";

const trainingLicenses = new Set<KnowledgeLicense>(["user_owned", "public_domain", "open_license", "training_permitted"]);

export function evaluateKnowledgeLicense(input: {
  license: KnowledgeLicense;
  copyrightStatus: "owned" | "public_domain" | "licensed" | "unknown";
  userApproved: boolean;
}) {
  const retrievalEligible = input.userApproved;
  const trainingEligible = input.userApproved
    && trainingLicenses.has(input.license)
    && input.copyrightStatus !== "unknown";
  return {
    retrievalEligible,
    trainingEligible,
    disposition: trainingEligible ? "training_allowed" as const : retrievalEligible ? "retrieval_only" as const : "rejected" as const,
    errorCode: input.userApproved ? null : "KNOWLEDGE_USER_APPROVAL_REQUIRED",
  };
}
