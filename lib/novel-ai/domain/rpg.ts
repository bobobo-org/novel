import type { DomainRecord } from "./common";

export const RPG_STATE_V3_SCHEMA_VERSION = "rpg-state-v3" as const;
export const RPG_FORMULA_V3 = "novel-rpg-unified-v3" as const;

export type RpgDifficulty = "story" | "standard" | "hard" | "extreme";
export type RpgChoiceStrategy = "steady" | "resource" | "bold";
export type RpgChoiceKey = "A" | "B" | "C" | "custom";
export type RpgOutcome = "critical_success" | "success" | "partial_success" | "failure";

export type RpgCanonicalEffect = {
  statChanges: Record<string, number>;
  relationshipChanges: Record<string, number>;
  resourceChanges: Record<string, number>;
  moneyChange: number;
  worldFlags: Record<string, boolean | string | number>;
  questProgress: Record<string, number>;
  achievementProgress: Record<string, number>;
  timelineEvents: string[];
};

export type NarrativeMeterState = {
  daoHeart: number;
  mindDemon: number;
  karma: number;
  merit: number;
  fate: number;
  pursuit: number;
  injury: number;
  sectReputation: number;
  worldAttention: number;
};

export type CultivationRealmDefinition = {
  id: string;
  localizedName: string;
  levelRange: readonly [number, number | null];
  lifespanDescription: string;
  narrativePowerRange: string;
  cultivationQualityMultiplier: number;
  advancementRequirements: string[];
  requiredResources: Record<string, number>;
  requiredMeters: Partial<Record<keyof NarrativeMeterState, { minimum?: number; maximum?: number }>>;
  typicalRisks: string[];
  tribulationProfile: {
    baseRealmTribulation: number;
    lifeAndDeathRiskDisclosed: boolean;
    stages: number;
  };
  failureProfiles: string[];
  unlockedCapabilities: string[];
};

export type CultivationRealmState = {
  definitionId: string;
  level: number;
  stage: "early" | "middle" | "late" | "peak";
  progress: number;
  foundationIntegrity: number;
  lastBreakthroughTurn: number | null;
};

export type ResourceDefinition = {
  id: string;
  localizedName: string;
  type: "currency" | "consumable" | "material" | "equipment" | "strategic_asset" | "quest" | "knowledge" | "social_capital";
  description: string;
  nonNegative: boolean;
  sources: string[];
  sinks: string[];
};

export type ResourceDelta = {
  resourceId: string;
  amount: number;
  label: string;
  reason: string;
};

export type StrategicAssetState = {
  assetId: string;
  definitionId: string;
  name: string;
  ownerFactionId: string | null;
  tier: number;
  condition: number;
  capacity: number;
  outputPerCycle: Record<string, number>;
  maintenancePerCycle: Record<string, number>;
  risk: number;
  locationId: string | null;
  contestedByFactionIds: string[];
  modifiers: Record<string, number>;
  acquiredAtTurn: number;
};

export type ChoiceRequirement = {
  requirementId: string;
  kind: "resource" | "money" | "stat" | "meter" | "realm" | "flag";
  key: string;
  operator: "gte" | "lte" | "eq";
  value: number | string | boolean;
  label: string;
  hard: boolean;
};

export type DelayedConsequenceTriggerType =
  | "exact_turn"
  | "turn_range"
  | "resource_threshold"
  | "meter_threshold"
  | "location_entered"
  | "faction_encountered"
  | "realm_breakthrough"
  | "quest_state"
  | "random_with_seed";

export type DelayedConsequence = {
  consequenceId: string;
  sourceTurnReceiptId: string;
  triggerType: DelayedConsequenceTriggerType;
  triggerTurn: number | readonly [number, number] | null;
  triggerCondition: Record<string, number | string | boolean>;
  visibility: "known" | "foreshadowed" | "hidden";
  status: "pending" | "triggered" | "resolved" | "expired";
  effects: {
    storyEffect: RpgCanonicalEffect;
    meterChanges: Partial<Record<keyof NarrativeMeterState, number>>;
  };
  narrativeHint: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type RpgPresetInitialization = {
  presetId: string;
  initializationId: string;
  initializedAt: string;
  storyStateRevisionBefore: number;
};

export type RpgStateV3 = {
  schemaVersion: typeof RPG_STATE_V3_SCHEMA_VERSION;
  formulaVersion: typeof RPG_FORMULA_V3;
  rulesetId: string;
  presetId: string | null;
  difficulty: RpgDifficulty;
  realm: CultivationRealmState | null;
  meters: NarrativeMeterState;
  strategicAssets: StrategicAssetState[];
  pendingConsequences: DelayedConsequence[];
  lastTurnReceiptId: string | null;
  customActionEnabled: boolean;
  presetInitialization: RpgPresetInitialization | null;
};

export type RpgTurnSnapshot = {
  schemaVersion: "rpg-turn-snapshot-v1";
  storyStateRevision: number;
  turnNumber: number;
  realm: CultivationRealmState | null;
  meters: NarrativeMeterState;
  stats: Record<string, number>;
  resources: Record<string, number>;
  relationships: Record<string, number>;
  strategicAssets: StrategicAssetState[];
  pendingConsequences: DelayedConsequence[];
};

export type RpgRealmChange = {
  from: CultivationRealmState | null;
  to: CultivationRealmState | null;
  progressDelta: number;
  breakthrough: boolean;
};

export type RpgTurnSettlement = {
  schemaVersion: "rpg-turn-settlement-v1";
  formulaVersion: typeof RPG_FORMULA_V3;
  rulesetId: string;
  presetId: string | null;
  turnNumber: number;
  choiceKey: RpgChoiceKey;
  choiceId: string;
  choiceTitle: string;
  selectedStrategy: RpgChoiceStrategy;
  requirements: ChoiceRequirement[];
  outcome: RpgOutcome;
  roll: number;
  successChance: number;
  beforeSnapshot: RpgTurnSnapshot;
  resolvedEffect: RpgCanonicalEffect;
  meterChanges: Partial<Record<keyof NarrativeMeterState, number>>;
  realmChange: RpgRealmChange | null;
  triggeredConsequences: DelayedConsequence[];
  scheduledConsequences: DelayedConsequence[];
};

export type RpgTurnReceipt = DomainRecord & {
  receiptId: string;
  projectId: string;
  chapterId: string;
  sourceRevision: number;
  resultingRevision: number;
  turnNumber: number;
  choiceKey: RpgChoiceKey;
  choiceId: string;
  choiceTitle: string;
  selectedStrategy: RpgChoiceStrategy;
  outcome: RpgOutcome;
  roll: number;
  successChance: number;
  beforeSnapshot: RpgTurnSnapshot;
  appliedStatChanges: Record<string, number>;
  appliedResourceChanges: Record<string, number>;
  appliedRelationshipChanges: Record<string, number>;
  appliedMeterChanges: Partial<Record<keyof NarrativeMeterState, number>>;
  appliedRealmChanges: RpgRealmChange | null;
  triggeredConsequences: DelayedConsequence[];
  scheduledConsequences: DelayedConsequence[];
  afterSnapshot: RpgTurnSnapshot;
  operationId: string;
  acceptedChoiceId: string;
  createdAt: string;
  formulaVersion: typeof RPG_FORMULA_V3;
  rulesetId: string;
  presetId: string | null;
};

export type RpgDerivedCultivationStats = {
  spiritualPower: number;
  divineSense: number;
  breakthroughStability: number;
  tribulationResistance: number;
  craftingControl: number;
  sectLeadership: number;
};
