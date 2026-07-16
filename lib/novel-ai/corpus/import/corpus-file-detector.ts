import type { CorpusImportFile, CorpusImportFormat } from "./corpus-import-types";
import { CorpusImportError } from "./corpus-import-errors";

const EXTENSION_FORMATS: Record<string, CorpusImportFormat> = {
  txt: "txt",
  md: "markdown",
  markdown: "markdown",
  epub: "epub",
  html: "html",
  htm: "html",
  json: "json",
  zip: "zip",
  pdf: "pdf-text",
};

export function detectCorpusFileFormat(file: CorpusImportFile): CorpusImportFormat {
  if (file.declaredFormat) return file.declaredFormat;
  const ext = file.fileName.split(".").pop()?.toLowerCase() ?? "";
  const format = EXTENSION_FORMATS[ext];
  if (!format) throw new CorpusImportError("UNSUPPORTED_FORMAT", `Unsupported corpus import format: ${ext || "unknown"}`, { details: { fileName: file.fileName } });
  return format;
}

export function assertSafeCorpusFileName(fileName: string) {
  const normalized = fileName.replace(/\\/g, "/");
  if (normalized.includes("../") || normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new CorpusImportError("PATH_TRAVERSAL_BLOCKED", "Unsafe import path rejected.", { details: { fileName } });
  }
  if (normalized.includes("\0")) {
    throw new CorpusImportError("NULL_BYTE_BLOCKED", "Unsafe import path rejected.", { details: { fileName } });
  }
}

export function estimateCorpusFileBytes(content: string | Uint8Array) {
  return typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
}
