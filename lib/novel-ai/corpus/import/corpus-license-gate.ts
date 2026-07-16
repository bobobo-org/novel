import type { CorpusImportRequest } from "./corpus-import-types";
import { CorpusImportError } from "./corpus-import-errors";
import { PublicFictionCorpusService } from "../public-fiction/public-fiction-corpus-service";

export function validateCorpusLicenseGate(service: PublicFictionCorpusService, request: CorpusImportRequest) {
  const decision = service.decideLicense(request.licenseType, request.sourceType);
  if (decision.licenseStatus === "blocked") {
    throw new CorpusImportError("LICENSE_BLOCKED", "Blocked license cannot be imported as full text.", { details: { licenseType: request.licenseType } });
  }
  if (request.licenseType === "unknown") {
    throw new CorpusImportError("LICENSE_UNKNOWN_METADATA_ONLY", "Unknown license may only be imported as metadata-only.", { details: { licenseType: request.licenseType } });
  }
  if (!request.licenseEvidence.trim()) {
    throw new CorpusImportError("LICENSE_EVIDENCE_MISSING", "License evidence is required before corpus import.", { details: { sourceType: request.sourceType } });
  }
  if (request.visibility === "public_reference" && !decision.allowExport && request.sourceType === "USER_IMPORTED") {
    throw new CorpusImportError("PRIVATE_COPY_PUBLIC_VISIBILITY_BLOCKED", "User imported private copies cannot become public corpus entries.");
  }
  return decision;
}
