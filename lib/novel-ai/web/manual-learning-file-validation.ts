export const MANUAL_LEARNING_FILE_MAX_BYTES = 12 * 1024 * 1024;
export const MANUAL_LEARNING_BATCH_MAX_BYTES = 48 * 1024 * 1024;
export const MANUAL_LEARNING_BATCH_MAX_FILES = 12;
export const MANUAL_LEARNING_MIN_TEXT_CHARACTERS = 120;

export type ManualLearningFileFormat = "text" | "pdf" | "docx";
export type ManualLearningDocumentFormat =
  | "txt"
  | "markdown"
  | "html"
  | "json"
  | "pdf"
  | "docx";

export type ManualLearningDocumentDescriptor = {
  documentFormat: ManualLearningDocumentFormat;
  format: ManualLearningFileFormat;
  mediaTypes: readonly string[];
};

const DOCUMENTS: Record<string, ManualLearningDocumentDescriptor> = {
  txt: { documentFormat: "txt", format: "text", mediaTypes: ["text/plain"] },
  md: { documentFormat: "markdown", format: "text", mediaTypes: ["text/markdown", "text/plain"] },
  markdown: { documentFormat: "markdown", format: "text", mediaTypes: ["text/markdown", "text/plain"] },
  html: { documentFormat: "html", format: "text", mediaTypes: ["text/html", "text/plain"] },
  htm: { documentFormat: "html", format: "text", mediaTypes: ["text/html", "text/plain"] },
  json: { documentFormat: "json", format: "text", mediaTypes: ["application/json", "text/json", "text/plain"] },
  pdf: { documentFormat: "pdf", format: "pdf", mediaTypes: ["application/pdf"] },
  docx: {
    documentFormat: "docx",
    format: "docx",
    mediaTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"],
  },
};

const GENERIC_MEDIA_TYPES = new Set(["", "application/octet-stream"]);

export function manualLearningFileError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

export function throwIfManualLearningCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw manualLearningFileError("LEARNING_FILE_CANCELLED", "已取消本機檔案解析。");
  }
}

export function safeManualLearningSourceAlias(fileName: string) {
  const leaf = fileName.trim().split(/[\\/]/u).filter(Boolean).at(-1) ?? "local-document";
  const safe = leaf
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .replace(/[<>:"|?*]/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 160);
  return safe || "local-document";
}

export async function sha256ManualLearningBytes(bytes: Uint8Array) {
  const copy = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)]
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashManualLearningFile(file: File, signal?: AbortSignal) {
  throwIfManualLearningCancelled(signal);
  let bytes: Uint8Array | null = new Uint8Array(await file.arrayBuffer());
  try {
    throwIfManualLearningCancelled(signal);
    return await sha256ManualLearningBytes(bytes);
  } finally {
    bytes.fill(0);
    bytes = null;
  }
}

function extensionOf(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/\.([^.]+)$/u);
  return match?.[1] ?? "";
}

export function manualLearningDocumentDescriptorFor(file: File) {
  const extension = extensionOf(file.name);
  if (extension === "docm") {
    throw manualLearningFileError("LEARNING_DOCX_MACRO_FORBIDDEN", "不執行或匯入含巨集的 Word 檔案。");
  }
  const descriptor = DOCUMENTS[extension];
  if (!descriptor) {
    throw manualLearningFileError(
      "LEARNING_FILE_FORMAT_UNSUPPORTED",
      "目前支援 TXT、Markdown、HTML、JSON、PDF 與 DOCX。",
    );
  }
  const mediaType = file.type.trim().toLowerCase().split(";", 1)[0];
  if (!GENERIC_MEDIA_TYPES.has(mediaType) && !descriptor.mediaTypes.includes(mediaType)) {
    throw manualLearningFileError(
      "LEARNING_FILE_MIME_MISMATCH",
      "檔案宣告的 MIME 類型與副檔名不一致。",
    );
  }
  return descriptor;
}

export function validateManualLearningBatch(files: readonly File[]) {
  if (!files.length) throw manualLearningFileError("LEARNING_BATCH_EMPTY", "請至少附加一個檔案。");
  if (files.length > MANUAL_LEARNING_BATCH_MAX_FILES) {
    throw manualLearningFileError(
      "LEARNING_BATCH_FILE_COUNT_EXCEEDED",
      `一次最多附加 ${MANUAL_LEARNING_BATCH_MAX_FILES} 個檔案。`,
    );
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MANUAL_LEARNING_BATCH_MAX_BYTES) {
    throw manualLearningFileError(
      "LEARNING_BATCH_TOO_LARGE",
      `整批檔案上限為 ${Math.round(MANUAL_LEARNING_BATCH_MAX_BYTES / 1024 / 1024)} MB。`,
    );
  }
  for (const file of files) {
    if (file.size <= 0) throw manualLearningFileError("LEARNING_FILE_EMPTY", `${file.name} 是空檔案。`);
    if (file.size > MANUAL_LEARNING_FILE_MAX_BYTES) {
      throw manualLearningFileError(
        "LEARNING_FILE_TOO_LARGE",
        `單一檔案上限為 ${Math.round(MANUAL_LEARNING_FILE_MAX_BYTES / 1024 / 1024)} MB。`,
      );
    }
    manualLearningDocumentDescriptorFor(file);
  }
  return { fileCount: files.length, totalBytes };
}
