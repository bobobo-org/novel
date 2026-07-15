import type { AdultPolicyService } from "./adult-policy-service";

export function listAdultPolicyVersions(service: AdultPolicyService) {
  return service.listPolicyVersions();
}
