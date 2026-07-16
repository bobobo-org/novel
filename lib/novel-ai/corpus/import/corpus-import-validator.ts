import type { CorpusImportRequest } from "./corpus-import-types";
import { assertCorpusImport } from "./corpus-import-errors";
import { assertSafeCorpusFileName, estimateCorpusFileBytes } from "./corpus-file-detector";

export function validateCorpusImportRequest(request: CorpusImportRequest) {
  assertCorpusImport(request.file, "MISSING_FILE", "Import file is required.");
  assertSafeCorpusFileName(request.file.fileName);
  const bytes = estimateCorpusFileBytes(request.file.content);
  assertCorpusImport(bytes > 0, "EMPTY_FILE", "Import file is empty.");
  assertCorpusImport(bytes <= 5_000_000, "FILE_TOO_LARGE", "Fixture import file exceeds the H2D.2 safety limit.", { bytes });
  assertCorpusImport(!/^https?:\/\//i.test(request.file.fileName), "REMOTE_URL_IMPORT_BLOCKED", "Arbitrary source URL download is not allowed.");
}
