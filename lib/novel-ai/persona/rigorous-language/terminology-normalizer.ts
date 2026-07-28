export function normalizeTerminology(text: string, glossary: Record<string, string>) {
  let output = text;
  const replacements: Array<{ from: string; to: string }> = [];
  for (const [from, to] of Object.entries(glossary)) {
    if (from !== to && output.includes(from)) {
      output = output.split(from).join(to);
      replacements.push({ from, to });
    }
  }
  return { text: output, replacements };
}
