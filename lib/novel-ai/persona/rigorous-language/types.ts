export type ClaimKind = "fact" | "inference" | "opinion" | "fiction" | "uncertain";
export type ClassifiedClaim = {
  text: string;
  kind: ClaimKind;
  confidence: number;
  citationRequired: boolean;
};
