export function detectKnowledgeLanguage(text: string) {
  const sample = text.slice(0, 4000);
  const han = (sample.match(/[\u3400-\u9fff]/g) ?? []).length;
  const kana = (sample.match(/[\u3040-\u30ff]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  if (kana > Math.max(5, han * 0.1)) return { language: "ja", confidence: 0.85 };
  if (han > latin) {
    const simplified = (sample.match(/[这为说后里发体书门]/g) ?? []).length;
    const traditional = (sample.match(/[這為說後裡發體書門]/g) ?? []).length;
    return { language: simplified > traditional ? "zh-Hans" : "zh-Hant", confidence: 0.8 };
  }
  if (latin > 10) return { language: "en", confidence: 0.75 };
  return { language: "und", confidence: 0.2 };
}
