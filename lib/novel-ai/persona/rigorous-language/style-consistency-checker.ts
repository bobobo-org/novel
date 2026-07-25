export function checkStyleConsistency(text: string, expected: { viewpoint?: "first_person" | "third_person"; formal?: boolean }) {
  const issues: string[] = [];
  if (expected.viewpoint === "first_person" && !/[我俺]/.test(text)) issues.push("FIRST_PERSON_NOT_CONFIRMED");
  if (expected.viewpoint === "third_person" && /(^|[。！？\n])我(?:們)?/.test(text)) issues.push("THIRD_PERSON_VIEWPOINT_DRIFT");
  if (expected.formal && /哈哈哈|超扯|爆幹/.test(text)) issues.push("FORMALITY_DRIFT");
  return { passed: issues.length === 0, issues };
}
