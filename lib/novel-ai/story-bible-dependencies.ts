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

function addMajor(deps: RevertDependency[], change: NormalizedChangeSet, type: string, explanation: string, suggestedResolution: string) {
  deps.push({
    dependencyId: dependencyId(type, change),
    dependencyType: type,
    severity: "major",
    entityType: change.entityType,
    entityId: change.entityId,
    fieldPath: change.fieldPath,
    targetChangeId: change.changeId,
    explanation,
    suggestedResolution,
    autoResolvable: false,
  });
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
      addMajor(deps, change, "life_status_dependency", "lifeStatus changes may affect later events, relationships, and item ownership.", "Review later events involving this character before applying the revert.");
    }
    if (/currentLocationId|locationId/.test(change.fieldPath)) {
      addMajor(deps, change, "location_dependency", "Location changes can conflict with later travel, scene placement, or simultaneous presence.", "Review nearby timeline and location records before applying.");
    }
    if (/possessions/.test(change.fieldPath)) {
      addMajor(deps, change, "possession_dependency", "Possession changes may conflict with later item ownership or usage.", "Review item and character possession history before applying.");
    }
    if (/currentOwnerCharacterId/.test(change.fieldPath)) {
      addMajor(deps, change, "ownership_dependency", "Item owner changes can conflict with later item history.", "Review item history and owner transitions before applying.");
    }
    if (/history/.test(change.fieldPath) && change.entityType === "item") {
      addMajor(deps, change, "item_history_dependency", "Item history changes may invalidate ownership, location, or status chronology.", "Review item history chronology before applying.");
    }
    if (/causes/.test(change.fieldPath) && change.entityType === "event") {
      addMajor(deps, change, "event_causal_dependency", "Event cause changes may invalidate later event causality.", "Review dependent events before applying.");
    }
    if (/consequences/.test(change.fieldPath) && change.entityType === "event") {
      addMajor(deps, change, "event_consequence_dependency", "Event consequence changes may invalidate later outcomes.", "Review later outcomes before applying.");
    }
    if (/status/.test(change.fieldPath) && change.entityType === "event") {
      addMajor(deps, change, "event_status_dependency", "Event status changes can invalidate consequences and completed-event assumptions.", "Review related consequences before applying.");
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
      addMajor(deps, change, "foreshadowing_dependency", "Foreshadowing status reverts can reopen or undo payoff state.", "Confirm payoff state and related chapter before applying.");
    }
    if (/abandonedReason/.test(change.fieldPath) && change.entityType === "foreshadowing") {
      addMajor(deps, change, "foreshadowing_abandon_dependency", "Abandon reason reverts can change whether a planted thread remains active.", "Review foreshadowing status and payoff expectations before applying.");
    }
    if (/resolvedChapterId|status/.test(change.fieldPath) && change.entityType === "open_thread") {
      addMajor(deps, change, "open_thread_dependency", "Open thread resolution reverts may invalidate later closure state.", "Confirm whether later chapters depend on the thread being resolved.");
    }
    if (/source|sourceRefs/i.test(change.fieldPath)) {
      addMajor(deps, change, "source_dependency", "Source reference changes can alter provenance for canonical facts.", "Review source evidence before applying.");
    }
    if (/derived|computed/i.test(change.fieldPath)) {
      addMajor(deps, change, "derived_fact_dependency", "Derived facts depend on other canonical values and may need recalculation.", "Review derived fact inputs before applying.");
    }
    if (/candidate/i.test(change.fieldPath)) {
      addMajor(deps, change, "candidate_dependency", "Candidate-linked changes can affect review provenance and auditability.", "Review candidate history before applying.");
    }
    if (change.operation === "created") {
      addMajor(deps, change, "entity_creation_dependency", "Reverting entity creation tombstones the entity and may affect references from other entities.", "Review cross-entity references before applying.");
    }
    if (/active|tombstone|deleted/i.test(change.fieldPath)) {
      addMajor(deps, change, "tombstone_dependency", "Tombstone state changes can hide or revive canonical facts.", "Review entity visibility before applying.");
    }
  }
  return {
    dependencies: deps,
    blockingDependencies: deps.filter((dep) => dep.severity === "blocking"),
    majorDependencies: deps.filter((dep) => dep.severity === "major"),
    warnings: deps.filter((dep) => dep.severity === "warning" || dep.severity === "info"),
  };
}
