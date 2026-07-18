export function importJsonText(text: string) {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object") return "";
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.chapters))
    return record.chapters
      .map((chapter, index) => {
        const entry =
          chapter && typeof chapter === "object"
            ? (chapter as Record<string, unknown>)
            : {};
        return `${String(entry.title ?? `Chapter ${index + 1}`)}\n${String(entry.content ?? entry.text ?? "")}`;
      })
      .join("\n\n");
  return [record.title, record.author, record.content ?? record.text ?? ""]
    .filter(Boolean)
    .map(String)
    .join("\n\n");
}
