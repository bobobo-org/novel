import { classifyClaim } from "./claim-classifier";

export function separateClaims(text: string, fictionMode = false) {
  const claims = text.split(/(?<=[。！？\n])/).map((row) => row.trim()).filter(Boolean).map((row) => classifyClaim(row, fictionMode));
  return {
    facts: claims.filter((claim) => claim.kind === "fact"),
    inferences: claims.filter((claim) => claim.kind === "inference"),
    opinions: claims.filter((claim) => claim.kind === "opinion"),
    uncertain: claims.filter((claim) => claim.kind === "uncertain"),
    fiction: claims.filter((claim) => claim.kind === "fiction"),
  };
}
