import type { ClassifiedClaim, ClaimKind } from "./types";

export function classifyClaim(text: string, fictionMode = false): ClassifiedClaim {
  let kind: ClaimKind = fictionMode ? "fiction" : "fact";
  if (/(?:我認為|我主張|較好|值得)/.test(text)) kind = "opinion";
  else if (/(?:推測|可能表示|因此可推論|看來)/.test(text)) kind = "inference";
  else if (/(?:不確定|尚無證據|無法確認|未知)/.test(text)) kind = "uncertain";
  return {
    text,
    kind,
    confidence: kind === "fact" ? 0.7 : kind === "uncertain" ? 0.4 : 0.6,
    citationRequired: kind === "fact" && !fictionMode,
  };
}
