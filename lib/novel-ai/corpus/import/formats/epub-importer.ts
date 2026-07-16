import { importHtmlText } from "./html-importer";

export function importEpubText(text: string) {
  return importHtmlText(text).replace(/\bnav\b/gi, "");
}
