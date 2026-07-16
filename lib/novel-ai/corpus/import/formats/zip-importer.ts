import { CorpusImportError } from "../corpus-import-errors";
import { assertSafeCorpusFileName } from "../corpus-file-detector";

export function importZipText(text: string) {
  const parsed = JSON.parse(text) as { files?: Array<{ name: string; content: string }> };
  const files = parsed.files ?? [];
  if (files.length > 100) throw new CorpusImportError("ZIP_BOMB_BLOCKED", "ZIP fixture has too many files.");
  let totalBytes = 0;
  const parts: string[] = [];
  for (const file of files) {
    assertSafeCorpusFileName(file.name);
    totalBytes += Buffer.byteLength(file.content ?? "", "utf8");
    if (totalBytes > 5_000_000) throw new CorpusImportError("ZIP_SIZE_LIMIT_EXCEEDED", "ZIP fixture exceeds safe import size.");
    if (/\.(txt|md|markdown|html|json)$/i.test(file.name)) parts.push(file.content);
  }
  return parts.join("\n\n");
}
