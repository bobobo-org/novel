export function importJsonText(text: string) {
  const parsed = JSON.parse(text);
  if (typeof parsed === "string") return parsed;
  if (Array.isArray(parsed?.chapters)) return parsed.chapters.map((c: any, i: number) => `${c.title ?? `Chapter ${i + 1}`}\n${c.content ?? c.text ?? ""}`).join("\n\n");
  return [parsed.title, parsed.author, parsed.content ?? parsed.text ?? ""].filter(Boolean).join("\n\n");
}
