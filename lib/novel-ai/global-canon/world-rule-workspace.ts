import type { GlobalWorld, GlobalWorldRule } from "./types";

/** The deterministic catalog keeps its original, immutable address range. */
export const GLOBAL_INDEXED_WORLD_CATALOG_LIMIT = 100_000;
/** Author-created worlds continue the same visible catalog without renumbering old worlds. */
export const FIRST_CUSTOM_GLOBAL_WORLD_NUMBER = GLOBAL_INDEXED_WORLD_CATALOG_LIMIT + 1;

export function nextCustomGlobalWorldNumber(worlds: readonly GlobalWorld[]) {
  const highestCustomNumber = worlds.reduce((highest, world) => {
    const value = world.catalogWorldNumber;
    return typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= FIRST_CUSTOM_GLOBAL_WORLD_NUMBER
      ? Math.max(highest, value)
      : highest;
  }, GLOBAL_INDEXED_WORLD_CATALOG_LIMIT);
  if (highestCustomNumber >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("GLOBAL_CUSTOM_WORLD_CATALOG_EXHAUSTED");
  }
  return highestCustomNumber + 1;
}

/**
 * Rules created from the combined world workspace must always retain a real
 * world coordinate. Existing multi-world links and era guards are preserved.
 */
export function attachGlobalWorldRule(
  rule: GlobalWorldRule,
  world: Pick<GlobalWorld, "id" | "eraContext">,
): GlobalWorldRule {
  const worldId = world.id.trim();
  if (!worldId) throw new Error("GLOBAL_WORLD_RULE_WORLD_REQUIRED");
  return {
    ...rule,
    eraContexts: [...new Set([...rule.eraContexts, world.eraContext])],
    appliesToGlobalWorldIds: [...new Set([...rule.appliesToGlobalWorldIds, worldId])],
  };
}

export function globalWorldRulesFor(
  rules: readonly GlobalWorldRule[],
  worldId: string,
) {
  return rules.filter((rule) => rule.appliesToGlobalWorldIds.includes(worldId));
}

export function formatGlobalWorldCatalogNumber(world: Pick<GlobalWorld, "catalogWorldNumber">) {
  return world.catalogWorldNumber === null
    ? "未編號舊資料"
    : `第${String(world.catalogWorldNumber).padStart(6, "0")}世界`;
}
