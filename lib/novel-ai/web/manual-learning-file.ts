import { sha256Hex } from "../sovereign-learning/hashing";
import {
  MANUAL_LEARNING_MIN_TEXT_CHARACTERS,
  manualLearningDocumentDescriptorFor as descriptorFor,
  manualLearningFileError,
  safeManualLearningSourceAlias,
  sha256ManualLearningBytes as sha256Bytes,
  throwIfManualLearningCancelled as throwIfCancelled,
  validateManualLearningBatch,
  type ManualLearningDocumentDescriptor as DocumentDescriptor,
} from "./manual-learning-file-validation";
import type {
  ManualLearningBatchItem,
  ManualLearningDocumentChunk,
  ManualLearningFileExtraction,
  ManualLearningFileExtractionOptions,
  ManualLearningFileProgress,
} from "./manual-learning-import-preparation";

export {
  MANUAL_LEARNING_BATCH_MAX_BYTES,
  MANUAL_LEARNING_BATCH_MAX_FILES,
  MANUAL_LEARNING_FILE_MAX_BYTES,
  MANUAL_LEARNING_MIN_TEXT_CHARACTERS,
  hashManualLearningFile,
  manualLearningFileError,
  safeManualLearningSourceAlias,
  validateManualLearningBatch,
} from "./manual-learning-file-validation";
export type {
  ManualLearningDocumentFormat,
  ManualLearningFileFormat,
} from "./manual-learning-file-validation";
export type {
  ManualLearningBatchItem,
  ManualLearningDocumentChunk,
  ManualLearningFileExtraction,
  ManualLearningFileExtractionOptions,
  ManualLearningFileProgress,
} from "./manual-learning-import-preparation";

export type PdfTextItemLike = {
  str: string;
  transform?: ArrayLike<number>;
  width?: number;
  height?: number;
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
const ZIP_MAGICS = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

function report(
  file: File,
  options: ManualLearningFileExtractionOptions,
  phase: ManualLearningFileProgress["phase"],
  current: number,
  total: number,
  pageNumber: number | null = null,
  pageCount: number | null = null,
) {
  options.onProgress?.({
    fileName: file.name,
    phase,
    current,
    total,
    pageNumber,
    pageCount,
  });
}

export function normalizeManualLearningText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\u0000/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\f\v]+/gu, " ")
    .replace(/[ ]{3,}/gu, "  ")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
}

function beginsWith(bytes: Uint8Array, magic: readonly number[]) {
  return magic.every((value, index) => bytes[index] === value);
}

function isZip(bytes: Uint8Array) {
  return ZIP_MAGICS.some((magic) => beginsWith(bytes, magic));
}

function validateMagic(descriptor: DocumentDescriptor, bytes: Uint8Array) {
  const pdf = beginsWith(bytes, PDF_MAGIC);
  const zip = isZip(bytes);
  if (descriptor.documentFormat === "pdf" && !pdf) {
    throw manualLearningFileError("LEARNING_FILE_MAGIC_MISMATCH", "PDF 檔頭驗證失敗。");
  }
  if (descriptor.documentFormat === "docx" && !zip) {
    throw manualLearningFileError("LEARNING_FILE_MAGIC_MISMATCH", "DOCX ZIP 檔頭驗證失敗。");
  }
  if (descriptor.format === "text" && (pdf || zip)) {
    throw manualLearningFileError("LEARNING_FILE_MAGIC_MISMATCH", "文字檔副檔名與實際檔案格式不一致。");
  }
}

function assertTextLength(text: string, code: string, message: string) {
  if (text.length < MANUAL_LEARNING_MIN_TEXT_CHARACTERS) {
    throw manualLearningFileError(code, message);
  }
}

function textCoordinates(item: PdfTextItemLike) {
  return {
    x: Number(item.transform?.[4] ?? 0),
    y: Number(item.transform?.[5] ?? 0),
    width: Number(item.width ?? 0),
  };
}

function orderByLines(items: PdfTextItemLike[]) {
  return [...items].sort((left, right) => {
    const a = textCoordinates(left);
    const b = textCoordinates(right);
    return Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x;
  });
}

/**
 * Produces a deterministic reading order for PDF.js text items. When both page
 * halves contain enough overlapping rows, each column is read top-to-bottom;
 * otherwise the page is treated as a normal single-column page.
 */
export function orderPdfTextItems(items: PdfTextItemLike[], pageWidth: number) {
  const visible = items.filter((item) => item.str.trim());
  if (!visible.length) return [];
  const center = Math.max(1, pageWidth) / 2;
  const spanning = visible.filter((item) => {
    const { x, width } = textCoordinates(item);
    return x < center && x + width > center;
  });
  const nonSpanning = visible.filter((item) => !spanning.includes(item));
  const left = nonSpanning.filter((item) => textCoordinates(item).x < center);
  const right = nonSpanning.filter((item) => textCoordinates(item).x >= center);
  const leftRows = new Set(left.map((item) => Math.round(textCoordinates(item).y / 8)));
  const rightRows = new Set(right.map((item) => Math.round(textCoordinates(item).y / 8)));
  const rowOverlap = [...leftRows].filter((row) => rightRows.has(row)).length;
  const multiColumn = left.length >= 3 && right.length >= 3 && rowOverlap >= 2;
  const ordered = multiColumn
    ? [...orderByLines(spanning), ...orderByLines(left), ...orderByLines(right)]
    : orderByLines(visible);
  return ordered.map((item) => item.str.trim()).filter(Boolean);
}

type ZipEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
};

function readZipEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  for (let offset = 0; offset + 46 <= bytes.length;) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) break;
    entries.push({
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      compression: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset = end;
  }
  return entries;
}

async function readZipEntryText(bytes: Uint8Array, entry: ZipEntry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) return null;
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) return null;
  let output: Uint8Array;
  if (entry.compression === 0) {
    output = Uint8Array.from(bytes.subarray(start, end));
  } else if (entry.compression === 8 && typeof DecompressionStream !== "undefined") {
    try {
      const compressed = Uint8Array.from(bytes.subarray(start, end));
      const stream = new Blob([compressed]).stream().pipeThrough(
        new DecompressionStream("deflate-raw" as CompressionFormat),
      );
      output = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  } else {
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    return null;
  } finally {
    output.fill(0);
  }
}

async function inspectDocxArchive(bytes: Uint8Array) {
  const entries = readZipEntries(bytes);
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
  if (!names.has("[content_types].xml") || !names.has("word/document.xml")) {
    throw manualLearningFileError("LEARNING_DOCX_CONTAINER_INVALID", "DOCX 缺少必要的 Word 文件結構。");
  }
  if ([...names].some((name) => /(?:^|\/)vbaproject\.bin$/u.test(name))) {
    throw manualLearningFileError("LEARNING_DOCX_MACRO_FORBIDDEN", "不執行或匯入 DOCX 巨集內容。");
  }
  const warnings = ["DOCX_IMAGES_NOT_LOADED"];
  let relationshipScanPartial = false;
  let externalRelationship = false;
  for (const entry of entries.filter((candidate) => /(?:^|\/)_rels\/.*\.rels$/iu.test(candidate.name))) {
    const text = await readZipEntryText(bytes, entry);
    if (text === null) {
      relationshipScanPartial = true;
      continue;
    }
    if (/TargetMode\s*=\s*["']External["']/iu.test(text)) externalRelationship = true;
  }
  if (externalRelationship) warnings.push("DOCX_EXTERNAL_RELATIONSHIPS_REMOVED");
  if (relationshipScanPartial) warnings.push("DOCX_RELATIONSHIP_SCAN_PARTIAL");
  return warnings;
}

function decodeText(bytes: Uint8Array) {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    }
    const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start));
  } catch {
    throw manualLearningFileError("LEARNING_FILE_ENCODING_INVALID", "文字檔不是有效的 UTF-8 或 UTF-16LE。");
  }
}

function extractSafeHtmlText(value: string) {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(value, "text/html");
    document.querySelectorAll("script,style,noscript,iframe,object,embed,link,meta").forEach((node) => node.remove());
    return document.body.textContent ?? "";
  }
  return value
    .replace(/<(?:script|style|noscript|iframe|object|embed)[\s\S]*?<\/(?:script|style|noscript|iframe|object|embed)>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

async function extractPdf(
  file: File,
  bytes: Uint8Array,
  contentHash: string,
  options: ManualLearningFileExtractionOptions,
): Promise<ManualLearningFileExtraction> {
  throwIfCancelled(options.signal);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  const loadingTask = pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
  let document: Awaited<typeof loadingTask.promise> | null = null;
  try {
    document = await loadingTask.promise;
    const pageCount = document.numPages;
    const pages: string[] = [];
    report(file, options, "parsing", 0, pageCount, null, pageCount);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      throwIfCancelled(options.signal);
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = orderPdfTextItems(
          content.items.flatMap((item) => (
            "str" in item && typeof item.str === "string"
              ? [{ str: item.str, transform: item.transform, width: item.width, height: item.height }]
              : []
          )),
          page.view[2] - page.view[0],
        ).join(" ");
        if (text.trim()) pages.push(`【PDF 第 ${pageNumber} 頁】\n${text.trim()}`);
      } finally {
        page.cleanup();
      }
      report(file, options, "page", pageNumber, pageCount, pageNumber, pageCount);
    }
    const text = normalizeManualLearningText(pages.join("\n\n"));
    if (text.length < MANUAL_LEARNING_MIN_TEXT_CHARACTERS) {
      throw manualLearningFileError(
        "OCR_REQUIRED",
        "PDF 沒有足夠的可選取文字；這可能是掃描 PDF，必須先完成 OCR。",
      );
    }
    return {
      fileName: file.name,
      safeSourceAlias: safeManualLearningSourceAlias(file.name),
      format: "pdf",
      documentFormat: "pdf",
      mediaType: file.type || "application/pdf",
      byteLength: file.size,
      contentHash,
      text,
      pageCount,
      warnings: [],
      parsingStatus: "completed",
      localAnalysisOnly: true,
      rawContentRetained: false,
      dataLeftDevice: false,
    };
  } finally {
    if (document) await document.cleanup();
    await loadingTask.destroy();
  }
}

async function extractDocx(
  file: File,
  bytes: Uint8Array,
  contentHash: string,
): Promise<ManualLearningFileExtraction> {
  const archiveWarnings = await inspectDocxArchive(bytes);
  const mammoth = await import("mammoth");
  const docxBytes = Uint8Array.from(bytes);
  const result = await (async () => {
    const nodeBuffer = typeof window === "undefined" ? Buffer.from(docxBytes) : null;
    try {
      return nodeBuffer
        ? await mammoth.extractRawText({ buffer: nodeBuffer })
        : await mammoth.extractRawText({ arrayBuffer: docxBytes.buffer });
    } finally {
      nodeBuffer?.fill(0);
      docxBytes.fill(0);
    }
  })();
  const text = normalizeManualLearningText(result.value);
  assertTextLength(text, "LEARNING_DOCX_TEXT_NOT_FOUND", "DOCX 沒有足夠的可分析文字。");
  return {
    fileName: file.name,
    safeSourceAlias: safeManualLearningSourceAlias(file.name),
    format: "docx",
    documentFormat: "docx",
    mediaType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    byteLength: file.size,
    contentHash,
    text,
    pageCount: null,
    warnings: [
      ...archiveWarnings,
      ...result.messages.map((message) => `MAMMOTH:${message.type}:${message.message}`).slice(0, 16),
    ],
    parsingStatus: "completed",
    localAnalysisOnly: true,
    rawContentRetained: false,
    dataLeftDevice: false,
  };
}

function extractStructuredText(
  file: File,
  bytes: Uint8Array,
  descriptor: DocumentDescriptor,
  contentHash: string,
): ManualLearningFileExtraction {
  const decoded = decodeText(bytes);
  let value = decoded;
  if (descriptor.documentFormat === "html") value = extractSafeHtmlText(decoded);
  if (descriptor.documentFormat === "json") {
    try {
      value = JSON.stringify(JSON.parse(decoded), null, 2);
    } catch {
      throw manualLearningFileError("LEARNING_JSON_INVALID", "JSON 語法無效，無法安全解析。");
    }
  }
  const text = normalizeManualLearningText(value);
  assertTextLength(text, "LEARNING_FILE_TEXT_TOO_SHORT", "檔案文字不足，無法抽象可靠規則。");
  return {
    fileName: file.name,
    safeSourceAlias: safeManualLearningSourceAlias(file.name),
    format: "text",
    documentFormat: descriptor.documentFormat,
    mediaType: file.type || descriptor.mediaTypes[0],
    byteLength: file.size,
    contentHash,
    text,
    pageCount: null,
    warnings: [],
    parsingStatus: "completed",
    localAnalysisOnly: true,
    rawContentRetained: false,
    dataLeftDevice: false,
  };
}

export async function extractManualLearningFile(
  file: File,
  options: ManualLearningFileExtractionOptions = {},
): Promise<ManualLearningFileExtraction> {
  validateManualLearningBatch([file]);
  throwIfCancelled(options.signal);
  const descriptor = descriptorFor(file);
  report(file, options, "validating", 0, 1);
  let bytes: Uint8Array | null = null;
  try {
    report(file, options, "reading", 0, file.size);
    bytes = new Uint8Array(await file.arrayBuffer());
    throwIfCancelled(options.signal);
    validateMagic(descriptor, bytes);
    const contentHash = await sha256Bytes(bytes);
    throwIfCancelled(options.signal);
    report(file, options, "reading", file.size, file.size);
    const extraction = descriptor.documentFormat === "pdf"
      ? await extractPdf(file, bytes, contentHash, options)
      : descriptor.documentFormat === "docx"
        ? await extractDocx(file, bytes, contentHash)
        : extractStructuredText(file, bytes, descriptor, contentHash);
    throwIfCancelled(options.signal);
    report(file, options, "completed", 1, 1, extraction.pageCount, extraction.pageCount);
    return extraction;
  } finally {
    if (bytes) bytes.fill(0);
    bytes = null;
  }
}

export async function extractManualLearningFiles(
  files: readonly File[],
  options: ManualLearningFileExtractionOptions = {},
): Promise<ManualLearningBatchItem[]> {
  validateManualLearningBatch(files);
  const results: ManualLearningBatchItem[] = [];
  for (const [fileIndex, file] of files.entries()) {
    if (options.signal?.aborted) {
      results.push({ fileName: file.name, fileIndex, status: "cancelled", extraction: null, errorCode: "LEARNING_FILE_CANCELLED" });
      continue;
    }
    try {
      results.push({
        fileName: file.name,
        fileIndex,
        status: "completed",
        extraction: await extractManualLearningFile(file, options),
        errorCode: null,
      });
    } catch (error) {
      const code = String((error as { code?: string })?.code ?? "LEARNING_FILE_PARSE_FAILED");
      results.push({
        fileName: file.name,
        fileIndex,
        status: code === "LEARNING_FILE_CANCELLED" ? "cancelled" : "failed",
        extraction: null,
        errorCode: code,
      });
    }
  }
  return results;
}

export function retryManualLearningFile(
  file: File,
  options: ManualLearningFileExtractionOptions = {},
) {
  return extractManualLearningFile(file, options);
}

type SemanticSection = {
  label: string;
  boundary: ManualLearningDocumentChunk["boundary"];
  text: string;
};

function headingBoundary(line: string): ManualLearningDocumentChunk["boundary"] | null {
  const value = line.trim().replace(/^#{1,6}\s*/u, "");
  if (/^(?:第\s*[〇零一二三四五六七八九十百千兩\d]+\s*[卷部篇]|[卷部篇]\s*[〇零一二三四五六七八九十百千兩\d]+)/u.test(value)) {
    return "volume";
  }
  if (/^(?:第\s*[〇零一二三四五六七八九十百千兩\d]+\s*[章回節幕]|chapter\s+\d+)/iu.test(value)) {
    return "chapter";
  }
  if (/^#{1,6}\s+\S/u.test(line) || /^[^\n]{1,48}[：:]$/u.test(value)) return "heading";
  return null;
}

function sectionDocument(text: string) {
  const lines = normalizeManualLearningText(text).split("\n");
  const sections: SemanticSection[] = [];
  let hierarchy = { volume: "", chapter: "", heading: "" };
  let buffer: string[] = [];
  let boundary: ManualLearningDocumentChunk["boundary"] = "paragraph";
  const flush = () => {
    const content = normalizeManualLearningText(buffer.join("\n"));
    if (!content) return;
    const label = [hierarchy.volume, hierarchy.chapter, hierarchy.heading].filter(Boolean).join(" / ") || "正文";
    sections.push({ label, boundary, text: content });
    buffer = [];
  };
  for (const line of lines) {
    const nextBoundary = headingBoundary(line);
    if (nextBoundary) {
      flush();
      const title = line.trim().replace(/^#{1,6}\s*/u, "").slice(0, 120);
      if (nextBoundary === "volume") hierarchy = { volume: title, chapter: "", heading: "" };
      if (nextBoundary === "chapter") hierarchy = { ...hierarchy, chapter: title, heading: "" };
      if (nextBoundary === "heading") hierarchy = { ...hierarchy, heading: title };
      boundary = nextBoundary;
    }
    buffer.push(line);
  }
  flush();
  return sections.length ? sections : [{ label: "正文", boundary: "paragraph" as const, text: normalizeManualLearningText(text) }];
}

function splitLongUnit(value: string, maximumCharacters: number) {
  if (value.length <= maximumCharacters) return [{ text: value, boundary: "paragraph" as const }];
  const paragraphs = value.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean);
  const units: Array<{ text: string; boundary: ManualLearningDocumentChunk["boundary"] }> = [];
  for (const paragraph of paragraphs.length ? paragraphs : [value]) {
    if (paragraph.length <= maximumCharacters) {
      units.push({ text: paragraph, boundary: "paragraph" });
      continue;
    }
    const sentences = paragraph.split(/(?<=[。！？!?；;\.])\s*/u).map((item) => item.trim()).filter(Boolean);
    for (const sentence of sentences.length ? sentences : [paragraph]) {
      if (sentence.length <= maximumCharacters) {
        units.push({ text: sentence, boundary: "sentence" });
        continue;
      }
      for (let index = 0; index < sentence.length; index += maximumCharacters) {
        units.push({
          text: sentence.slice(index, index + maximumCharacters),
          boundary: "safe_character_limit",
        });
      }
    }
  }
  return units;
}

function splitSemanticSections(text: string, maximumCharacters: number) {
  const sections = sectionDocument(text);
  const output: Array<{ sourceSection: string; boundary: ManualLearningDocumentChunk["boundary"]; text: string }> = [];
  let current: (typeof output)[number] | null = null;
  const flush = () => {
    if (current?.text.trim()) output.push({ ...current, text: normalizeManualLearningText(current.text) });
    current = null;
  };
  for (const section of sections) {
    const units = splitLongUnit(section.text, maximumCharacters);
    for (const unit of units) {
      const candidate = current ? `${current.text}\n\n${unit.text}` : unit.text;
      if (current && candidate.length > maximumCharacters) flush();
      if (!current) {
        current = { sourceSection: section.label, boundary: units.length === 1 ? section.boundary : unit.boundary, text: unit.text };
      } else {
        const previous = current as (typeof output)[number];
        current = {
          sourceSection: previous.sourceSection === section.label
            ? previous.sourceSection
            : `${previous.sourceSection} → ${section.label}`,
          boundary: previous.boundary,
          text: `${previous.text}\n\n${unit.text}`,
        };
      }
    }
  }
  flush();
  return output.filter((part) => part.text.length >= MANUAL_LEARNING_MIN_TEXT_CHARACTERS);
}

/** Compatibility API used by the existing Learning workspace. */
export function splitManualLearningDocument(text: string, maximumCharacters = 285_000) {
  if (maximumCharacters < MANUAL_LEARNING_MIN_TEXT_CHARACTERS) {
    throw manualLearningFileError("LEARNING_CHUNK_LIMIT_INVALID", "分段上限不可小於最小分析長度。");
  }
  return splitSemanticSections(text, maximumCharacters).map((part) => part.text);
}

export async function splitManualLearningDocumentSemantically(
  text: string,
  maximumCharacters = 285_000,
): Promise<ManualLearningDocumentChunk[]> {
  if (maximumCharacters < MANUAL_LEARNING_MIN_TEXT_CHARACTERS) {
    throw manualLearningFileError("LEARNING_CHUNK_LIMIT_INVALID", "分段上限不可小於最小分析長度。");
  }
  const parts = splitSemanticSections(text, maximumCharacters);
  const hashes = await Promise.all(parts.map((part) => sha256Hex(part.text)));
  return Promise.all(parts.map(async (part, index) => ({
    chunkIndex: index,
    sourceSection: part.sourceSection,
    boundary: part.boundary,
    text: part.text,
    contentHash: hashes[index],
    previousOverlapDigest: index === 0
      ? null
      : await sha256Hex(parts[index - 1].text.slice(-240)),
    nextOverlapDigest: index === parts.length - 1
      ? null
      : await sha256Hex(parts[index + 1].text.slice(0, 240)),
  })));
}
