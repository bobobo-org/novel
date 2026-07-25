export function detectTextContradictions(text: string) {
  const statements = text.split(/(?<=[。！？\n])/).map((row) => row.trim()).filter(Boolean);
  const issues: Array<{ first: string; second: string; code: string }> = [];
  for (let index = 0; index < statements.length; index += 1) {
    const current = statements[index];
    const negated = current.replace(/不是|沒有|不得|不能/g, "").replace(/\s/g, "");
    for (const other of statements.slice(index + 1)) {
      const otherNormalized = other.replace(/不是|沒有|不得|不能/g, "").replace(/\s/g, "");
      const oppositePolarity = /不是|沒有|不得|不能/.test(current) !== /不是|沒有|不得|不能/.test(other);
      if (oppositePolarity && negated.length > 4 && (otherNormalized.includes(negated) || negated.includes(otherNormalized))) {
        issues.push({ first: current, second: other, code: "INTERNAL_CONTRADICTION" });
      }
    }
  }
  return issues;
}
