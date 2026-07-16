export function decodeCorpusContent(content: string | Uint8Array, declaredEncoding = "utf-8") {
  if (typeof content === "string") return { text: content, encoding: declaredEncoding, confidence: 1 };
  if (content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
    return { text: Buffer.from(content.slice(3)).toString("utf8"), encoding: "utf-8-bom", confidence: 1 };
  }
  return { text: Buffer.from(content).toString("utf8"), encoding: "utf-8", confidence: 0.95 };
}
