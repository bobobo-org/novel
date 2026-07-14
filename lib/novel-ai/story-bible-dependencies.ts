import type { NormalizedChangeSet } from "./story-bible-change-sets";

export type RevertDependency = {
  dependencyId: string;
  dependencyType: string;
  severity: "info" | "warning" | "major" | "blocking";
  entityType: string;
  entityId: string;
  fieldPath: string;
  targetChangeId: string;
  laterChangeId?: string;
  laterModifiedAtVersion?: number;
  explanation: string;
  suggestedResolution: string;
  autoResolvable: boolean;
};

function key(change: Pick<NormalizedChangeSet, "entityType" | "entityId" | "fieldPath">) {
  return `${change.entityType}:${change.entityId}:${change.fieldPath}`;
}

function dependencyId(type: string, change: NormalizedChangeSet, suffix = "") {
  return `dep_${type}_${change.changeId}${suffix ? `_${suffix}` : ""}`;
}

export function buildDependencyGraph(input: {
  targetVersionNumber: number;
  selectedChanges: NormalizedChangeSet[];
  laterChanges: NormalizedChangeSet[];
}) {
  const deps: RevertDependency[] = [];
  const laterByField = new Map<string, NormalizedChangeSet[]>();
  for (const change of input.laterChanges) {
    const list = laterByField.get(key(change)) || [];
    list.push(change);
    laterByField.set(key(change), list);
  }
  for (const change of input.selectedChanges) {
    const laterSameField = laterByField.get(key(change)) || [];
    for (const later of laterSameField) {
      deps.push({
        dependencyId: dependencyId("later_field", change, later.changeId),
        dependencyType: "field_dependency",
        severity: "blocking",
        entityType: change.entityType,
        entityId: change.entityId,
        fieldPath: change.fieldPath,
        targetChangeId: change.changeId,
        laterChangeId: later.changeId,
        laterModifiedAtVersion: later.versionNumber,
        explanation: `Field was modified again at version ${later.versionNumber}; reverting the older change would overwrite newer canonical state.`,
        suggestedResolution: "Revert the later dependent version first, or create a new author-declared correction.",
        autoResolvable: false,
      });
    }
    if (/lifeStatus/.test(change.fieldPath)) {
      deps.push({
        dependencyId: dependencyId("life_status", change),
        dependencyType: "state_transition",
        severity: "major",
        entityType: change.entityType,
        entityId: change.entityId,
        fieldPath: change.fieldPath,
        targetChangeId: change.changeId,
        explanation: "lifeStatus changes may affect later events, relationships, and item ownership.",
        suggestedResolution: "Review later events involving this character before applying the revert.",
        autoResolvable: false,
      });
    }
    if (/currentOwnerCharacterId/.test(change.fieldPath)) {
      deps.push({
        dependencyId: dependencyId("item_owner", change),
        dependencyType: "ownership_dependency",
        severity: "major",
        entityType: change.entityType,
        entityId: change.entityId,
        fieldPath: change.fieldPath,
        targetChangeId: change.changeId,
        explanation: "Item owner changes can conflict with later item history.",
        suggestedResolution: "Review item history and owner transitions before applying.",
        autoResolvable: false,
      });
    }
    if (/immutable/.test(change.fieldPath)) {
      deps.push({
        dependencyId: dependencyId("immutable_rule", change),
        dependencyType: "world_rule_dependency",
        severity: "blocking",
        entityType: change.entityType,
        entityId: change.entityId,
        fieldPath: change.fieldPath,
        targetChangeId: change.changeId,
        explanation: "Immutable world rule changes require manual review and cannot be safely reverted automatically.",
        suggestedResolution: "Create a separate author-declared correction after review.",
        autoResolvable: false,
      });
    }
    if (/payoffChapterId|status/.test(change.fieldPath) && change.entityType === "foreshadowing") {
      deps.push({
        dependencyId: dependencyId("foreshadowing", change),
        dependencyType: "foreshadowing_dependency",
        severity: "major",
        entityType: change.entityType,
        entityId: change.entityId,
        fieldPath: change.fieldPath,
        targetChangeId: change.changeId,
        explanation: "Foreshadowing status reverts can reopen or undo payoff state.",
        suggestedResolution: "Confirm payoff state and related chapter before applying.",
        autoResolvable: false,
      });
    }
    if (/resolvedChapterId|status/.test(change.fieldPath) && change.entityType === "open_thread") {
      deps.push({
        dependencyId: dependencyId("open_thread", change),
        dependencyType: "open_thread_dependency",
        severity: "major",
        entityType: change.entityType,
        entityId: change.entityId,
        fieldPath: change.fieldPath,
        targetChangeId: change.changeId,
        explanation: "Open thread resolution reverts may invalidate later closure state.",
        suggestedResolution: "Confirm whether later chapters depend on the thread being resolved.",
        autoResolvable: false,
      });
    }
  }
  return {
    dependencies: deps,
    blockingDependencies: deps.filter((dep) => dep.severity === "blocking"),
    majorDependencies: deps.filter((dep) => dep.severity === "major"),
    warnings: deps.filter((dep) => dep.severity === "warning" || dep.severity === "info"),
  };
}
