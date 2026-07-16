export function importPdfText(text: string) {
  return text.replace(/\f/g, "\n\n").replace(/\[OCR[^\]]*\]/gi, "");
}
