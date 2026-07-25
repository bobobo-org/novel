function revisionNumber(value: string) {
  return value.match(/\d+(?:\.\d+)?/g)?.map(Number).at(-1) ?? Number.NEGATIVE_INFINITY;
}

export function compareRevisionPrecedence(left: { revision: string; approved: boolean }, right: { revision: string; approved: boolean }) {
  if (left.approved !== right.approved) return left.approved ? -1 : 1;
  return revisionNumber(right.revision) - revisionNumber(left.revision);
}

export function selectCurrentRevision<T extends { revision: string; approved: boolean }>(values: T[]) {
  return [...values].sort(compareRevisionPrecedence)[0] ?? null;
}
