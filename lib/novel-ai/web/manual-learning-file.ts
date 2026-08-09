export const MANUAL_LEARNING_FILE_MAX_BYTES = 12 * 1024 * 1024;

export type ManualLearningFileFormat = "text" | "pdf" | "docx";

export type ManualLearningFileExtraction = {
  fileName: string;
  format: ManualLearningFileFormat;
  text: string;
  pageCount: number | null;
  warnings: string[];
};

function learningFileError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function extensionOf(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/\.([^.]+)$/u);
  return match?.[1] ?? "";
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\u0000/gu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t\f\v]+/gu, " ")
    .replace(/[ ]{3,}/gu, "  ")
    .replace(/\n{4,}/gu, "\n\n\n")
    .trim();
}

async function extractPdf(file: File): Promise<ManualLearningFileExtraction> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useSystemFonts: true,
  }).promise;
  const pageCount = document.numPages;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .flatMap((item) => ("str" in item && typeof item.str === "string" ? [item.str] : []))
      .join(" ")
      .trim();
    if (text) pages.push(`【PDF 第 ${pageNumber} 頁】\n${text}`);
    page.cleanup();
  }
  await document.cleanup();
  const text = normalizeExtractedText(pages.join("\n\n"));
  if (text.length < 120) {
    throw learningFileError(
      "LEARNING_PDF_TEXT_NOT_FOUND",
      "PDF 沒有足夠的可選取文字；若它是掃描圖片，請先做 OCR 再匯入。",
    );
  }
  return {
    fileName: file.name,
    format: "pdf",
    text,
    pageCount,
    warnings: [],
  };
}

async function extractDocx(file: File): Promise<ManualLearningFileExtraction> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const text = normalizeExtractedText(result.value);
  if (text.length < 120) {
    throw learningFileError("LEARNING_DOCX_TEXT_NOT_FOUND", "DOCX 沒有足夠的可分析文字。");
  }
  return {
    fileName: file.name,
    format: "docx",
    text,
    pageCount: null,
    warnings: result.messages.map((message) => message.message).slice(0, 8),
  };
}

export async function extractManualLearningFile(file: File): Promise<ManualLearningFileExtraction> {
  if (file.size <= 0) throw learningFileError("LEARNING_FILE_EMPTY", "檔案是空的。");
  if (file.size > MANUAL_LEARNING_FILE_MAX_BYTES) {
    throw learningFileError(
      "LEARNING_FILE_TOO_LARGE",
      `單一檔案上限為 ${Math.round(MANUAL_LEARNING_FILE_MAX_BYTES / 1024 / 1024)} MB。`,
    );
  }
  const extension = extensionOf(file.name);
  if (extension === "pdf") return extractPdf(file);
  if (extension === "docx") return extractDocx(file);
  if (!["txt", "md", "markdown", "html", "htm", "json"].includes(extension)) {
    throw learningFileError(
      "LEARNING_FILE_FORMAT_UNSUPPORTED",
      "目前支援 TXT、Markdown、HTML、JSON、PDF 與 DOCX。",
    );
  }
  const text = normalizeExtractedText(await file.text());
  if (text.length < 120) {
    throw learningFileError("LEARNING_FILE_TEXT_TOO_SHORT", "檔案文字不足，無法抽象可靠規則。");
  }
  return {
    fileName: file.name,
    format: "text",
    text,
    pageCount: null,
    warnings: [],
  };
}

export function splitManualLearningDocument(text: string, maximumCharacters = 285_000) {
  const normalized = normalizeExtractedText(text);
  if (normalized.length <= maximumCharacters) return [normalized];
  const paragraphs = normalized.split(/\n{2,}/u).map((value) => value.trim()).filter(Boolean);
  const parts: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > maximumCharacters) {
      if (current) {
        parts.push(current);
        current = "";
      }
      for (let index = 0; index < paragraph.length; index += maximumCharacters) {
        parts.push(paragraph.slice(index, index + maximumCharacters));
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maximumCharacters) {
      parts.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.filter((part) => part.length >= 120);
}
