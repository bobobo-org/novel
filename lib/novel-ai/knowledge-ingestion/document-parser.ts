import type { ParsedKnowledgeDocument } from "./types";
import { sanitizeRetrievedKnowledge } from "../security";

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function parseKnowledgeDocument(input: {
  name: string;
  mimeType?: string;
  content: string;
}): ParsedKnowledgeDocument {
  const extension = input.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf" || input.mimeType === "application/pdf") {
    throw Object.assign(new Error("PDF 必須先由受控文件解析器轉為文字。"), { code: "KNOWLEDGE_PDF_PARSER_REQUIRED" });
  }
  if (extension === "html" || input.mimeType === "text/html") {
    const rawBoundary = sanitizeRetrievedKnowledge(input.content, {
      sourceId: input.name,
      sourceType: "user_document",
    });
    const textBoundary = sanitizeRetrievedKnowledge(stripHtml(rawBoundary.sanitizedText), {
      sourceId: input.name,
      sourceType: "user_document",
    });
    return {
      title: input.name,
      text: textBoundary.sanitizedText,
      format: "html",
      warnings: [...new Set(
        [...rawBoundary.findings, ...textBoundary.findings]
          .map((finding) => `UNTRUSTED_CONTENT_${finding.code}`),
      )],
    };
  }
  if (extension === "json" || input.mimeType === "application/json") {
    let value: unknown;
    try { value = JSON.parse(input.content); }
    catch { throw Object.assign(new Error("JSON 文件無法解析。"), { code: "KNOWLEDGE_DOCUMENT_MALFORMED" }); }
    const boundary = sanitizeRetrievedKnowledge(JSON.stringify(value, null, 2), {
      sourceId: input.name,
      sourceType: "user_document",
    });
    return {
      title: input.name,
      text: boundary.sanitizedText,
      format: "json",
      warnings: boundary.findings.map((finding) => `UNTRUSTED_CONTENT_${finding.code}`),
    };
  }
  const boundary = sanitizeRetrievedKnowledge(input.content, {
    sourceId: input.name,
    sourceType: "user_document",
  });
  return {
    title: input.name,
    text: boundary.sanitizedText,
    format: extension === "md" || input.mimeType === "text/markdown" ? "markdown" : "text",
    warnings: boundary.findings.map((finding) => `UNTRUSTED_CONTENT_${finding.code}`),
  };
}
