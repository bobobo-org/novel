export function detectDuplicateFlood(items: Array<{ id: string; contentHash: string; sourceId: string }>, threshold = 3) {
  const byHash = new Map<string, typeof items>();
  for (const item of items) byHash.set(item.contentHash, [...(byHash.get(item.contentHash) ?? []), item]);
  const flooded = [...byHash.entries()]
    .filter(([, rows]) => rows.length > threshold)
    .map(([contentHash, rows]) => ({
      contentHash,
      count: rows.length,
      sourceIds: [...new Set(rows.map((row) => row.sourceId))],
      penalizedIds: rows.slice(1).map((row) => row.id),
    }));
  return { detected: flooded.length > 0, flooded };
}
