function compareFingerprintText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableWholeNovelFingerprintValue(value) {
  if (Array.isArray(value)) return value.map(stableWholeNovelFingerprintValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => compareFingerprintText(left, right))
    .map(([key, nested]) => [key, stableWholeNovelFingerprintValue(nested)]));
}

function stableFingerprintCollection(values) {
  return [...(values ?? [])]
    .map(stableWholeNovelFingerprintValue)
    .sort((left, right) => compareFingerprintText(JSON.stringify(left) ?? "", JSON.stringify(right) ?? ""));
}

export function substantiveWholeNovelChapters(chapters) {
  return [...chapters]
    .filter((chapter) => chapter.content.trim().length > 0)
    .sort((left, right) => left.order - right.order || compareFingerprintText(left.id, right.id));
}

export function wholeNovelCompletionFingerprintPayload(snapshot) {
  return JSON.stringify(stableWholeNovelFingerprintValue({
    projectId: snapshot.project.id,
    project: snapshot.project,
    chapters: substantiveWholeNovelChapters(snapshot.chapters),
    storyBible: snapshot.storyBible ?? null,
    storyState: snapshot.storyState ?? null,
    characters: stableFingerprintCollection(snapshot.characters),
    relationships: stableFingerprintCollection(snapshot.relationships),
    worldRules: stableFingerprintCollection(snapshot.worldRules),
    timeline: stableFingerprintCollection(snapshot.timeline),
    worlds: stableFingerprintCollection(snapshot.worlds),
    offstageCharacterNames: [...(snapshot.offstageCharacterNames ?? [])].sort(compareFingerprintText),
  }));
}
