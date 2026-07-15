import type { AdultPolicyService } from "./adult-policy-service";
import type { AdultPolicyAuditInput } from "./adult-policy-types";

export function recordAdultPolicyAudit(service: AdultPolicyService, input: AdultPolicyAuditInput) {
  return service.writeAudit(input);
}
