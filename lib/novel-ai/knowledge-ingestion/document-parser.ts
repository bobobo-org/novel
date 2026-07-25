import type { ParsedKnowledgeDocument } from "./types";

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
    return { title: input.name, text: stripHtml(input.content), format: "html", warnings: [] };
  }
  if (extension === "json" || input.mimeType === "application/json") {
    let value: unknown;
    try { value = JSON.parse(input.content); }
    catch { throw Object.assign(new Error("JSON 文件無法解析。"), { code: "KNOWLEDGE_DOCUMENT_MALFORMED" }); }
    return { title: input.name, text: JSON.stringify(value, null, 2), format: "json", warnings: [] };
  }
  return {
    title: input.name,
    text: input.content,
    format: extension === "md" || input.mimeType === "text/markdown" ? "markdown" : "text",
    warnings: [],
  };
}
