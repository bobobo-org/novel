import type { CorpusImportFormat } from "./corpus-import-types";
import { importTxtText } from "./formats/txt-importer";
import { importMarkdownText } from "./formats/markdown-importer";
import { importEpubText } from "./formats/epub-importer";
import { importHtmlText } from "./formats/html-importer";
import { importJsonText } from "./formats/json-importer";
import { importZipText } from "./formats/zip-importer";
import { importPdfText } from "./formats/pdf-text-importer";

export function extractCorpusText(format: CorpusImportFormat, decodedText: string) {
  switch (format) {
    case "txt": return importTxtText(decodedText);
    case "markdown": return importMarkdownText(decodedText);
    case "epub": return importEpubText(decodedText);
    case "html": return importHtmlText(decodedText);
    case "json": return importJsonText(decodedText);
    case "zip": return importZipText(decodedText);
    case "pdf-text": return importPdfText(decodedText);
  }
}
