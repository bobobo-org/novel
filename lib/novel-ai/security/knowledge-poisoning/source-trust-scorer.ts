export type SourceTrustInput = {
  sourceType: string;
  userApproved: boolean;
  canonical: boolean;
  citationValid: boolean;
  identityVerified: boolean;
};

export function scoreSourceTrust(input: SourceTrustInput) {
  if (input.canonical) return 1;
  let score = input.sourceType === "web_import" ? 0.25 : input.sourceType === "user_document" ? 0.55 : 0.4;
  if (input.userApproved) score += 0.2;
  if (input.citationValid) score += 0.15;
  if (input.identityVerified) score += 0.1;
  return Math.max(0, Math.min(1, score));
}
