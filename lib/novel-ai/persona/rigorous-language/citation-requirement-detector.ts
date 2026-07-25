import type { ClassifiedClaim } from "./types";

export function detectCitationRequirements(claims: ClassifiedClaim[]) {
  return claims.filter((claim) => claim.citationRequired).map((claim) => ({
    claim: claim.text,
    required: true,
    reason: "外部可驗證事實需要來源；小說內事實則需要 Story Bible 或章節證據。",
  }));
}
