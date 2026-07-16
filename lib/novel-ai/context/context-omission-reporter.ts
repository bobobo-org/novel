export function mergeOmissions(...groups: Array<Array<{ contextItemId: string; reason: string; tokenCount: number }>>) {
  return groups.flat();
}
