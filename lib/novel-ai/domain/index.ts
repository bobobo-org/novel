import type { DomainRecord, OptionalValue, Provenance } from "./common";
export * from "./common";

export type ProjectSeed = DomainRecord & {
  titleCandidates: string[];
  logline: OptionalValue<string>;
  protagonist: OptionalValue<string>;
  goal: OptionalValue<string>;
  weakness: OptionalValue<string>;
  world: OptionalValue<string>;
  worldRule: OptionalValue<string>;
  conflict: OptionalValue<string>;
  opposition: OptionalValue<string>;
  opening: OptionalValue<string>;
  directions: string[];
};

export type NovelProject = DomainRecord & {
  title: string;
  creationMode: "quick" | "guided" | "blank" | "legacy";
  genrePackId: string | null;
  genreId: string | null;
  subgenreId: string | null;
  coreIdea: OptionalValue<string>;
  narrativeStyle: OptionalValue<string>;
  adultMode: boolean;
  activeChapterId: string | null;
  storyBibleId: string;
  storyStateId: string;
};

export type ProjectCreationDraft = DomainRecord & {
  mode: NovelProject["creationMode"];
  step: number;
  title: string;
  genrePackId: string | null;
  genreId: string | null;
  subgenreId: string | null;
  coreIdea: OptionalValue<string>;
  protagonist: OptionalValue<string>;
  style: OptionalValue<string>;
  answers: Record<string, OptionalValue<string>>;
  seedCandidate: ProjectSeed | null;
};

export type Chapter = DomainRecord & { title: string; order: number; content: string; summary: string | null; status: "draft" | "completed" };
export type Scene = DomainRecord & { chapterId: string; order: number; title: string; content: string; summary: string | null };
export type Character = DomainRecord & { name: string; aliases: string[]; identity: OptionalValue<string>; personality: OptionalValue<string>; goal: OptionalValue<string>; lifeStatus: "unknown" | "alive" | "dead"; locationId: string | null };
export type CharacterRelationship = DomainRecord & { fromCharacterId: string; toCharacterId: string; kind: string; summary: string; trust: number | null };
export type World = DomainRecord & { name: OptionalValue<string>; era: OptionalValue<string>; summary: OptionalValue<string> };
export type WorldRule = DomainRecord & { title: string; description: string; immutable: boolean };
export type LoreEntry = DomainRecord & { kind: "location" | "faction" | "item" | "secret" | "custom"; title: string; content: string };
export type TimelineEvent = DomainRecord & { chapterId: string | null; storyTime: string | null; title: string; summary: string };

export type StoryState = DomainRecord & {
  protagonistStats: Record<string, number>;
  resources: Record<string, number>;
  money: number | null;
  inventory: string[];
  relationships: Record<string, number>;
  reputation: number | null;
  factionStanding: Record<string, number>;
  worldFlags: Record<string, boolean | string | number>;
  questStates: Record<string, string>;
  achievementStates: Record<string, string>;
  timeState: string | null;
  locationState: string | null;
  riskState: string | null;
};

export type StoryChoiceEffect = { statChanges: Record<string, number>; relationshipChanges: Record<string, number>; resourceChanges: Record<string, number>; moneyChange: number; worldFlags: Record<string, boolean | string | number>; questProgress: Record<string, number>; achievementProgress: Record<string, number>; timelineEvents: string[] };
export type ChoiceCandidate = DomainRecord & { prompt: string; optionKey: "A" | "B" | "C" | "custom"; text: string; consequence: string; effect: StoryChoiceEffect; status: "pending" | "accepted" | "rejected" };
export type AcceptedChoice = DomainRecord & { candidateId: string; branchId: string; appliedEffect: StoryChoiceEffect };
export type StoryBranch = DomainRecord & { name: string; parentBranchId: string | null; headRevision: number };
export type StoryBible = DomainRecord & { theme: OptionalValue<string>; style: OptionalValue<string>; protagonistIds: string[]; characterIds: string[]; relationshipIds: string[]; worldId: string | null; worldRuleIds: string[]; loreIds: string[]; timelineEventIds: string[]; foreshadowing: string[]; unresolvedThreads: string[]; forbiddenContradictions: string[]; authorPreferences: string[] };
export type WritingTask = DomainRecord & { title: string; kind: "main" | "side" | "character" | "world" | "writing" | "exploration" | "relationship"; status: "not_started" | "active" | "completed" | "paused"; progress: number; target: number };
export type Achievement = DomainRecord & { title: string; progress: number; target: number; unlockedAt: string | null };
export type ReaderState = DomainRecord & {
  chapterId: string | null;
  positionType: "anchor" | "ratio" | "legacy_scroll";
  positionValue: string | number | null;
  contentAnchor: string | null;
  scrollTop: number;
  percentage: number;
  theme: "light" | "night" | "eye" | "paper";
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  paragraphSpacing: number;
  lastReadAt: string | null;
};
export type ReaderNote = DomainRecord & { chapterId: string; anchor: string; excerpt: string; content: string; needsRelocation: boolean };
export type ReaderBookmark = DomainRecord & { chapterId: string; anchor: string; excerpt: string; label: string | null; needsRelocation: boolean };
export type BackupManifest = {
  format: "novel-project-backup";
  formatVersion: "novel-backup-v3";
  backupId: string;
  projectId: string;
  projectSchemaVersion: string;
  createdAt: string;
  appCommit: string | null;
  releaseTag: string | null;
  sourceDevice: "browser";
  contentHash: string;
  recordCounts: Record<string, number>;
  includedStores: string[];
  compression: "none";
  encryption: "none";
};
export type ProjectBackup = DomainRecord & {
  formatVersion: "novel-backup-v2" | "novel-backup-v3";
  kind: "initial" | "quick" | "full" | "safety";
  byteSize: number;
  snapshot: Record<string, unknown>;
  manifest?: BackupManifest;
};
export type AIProvenance = Provenance & { providerId: string; modelId: string | null; taskType: string; externalRequest: boolean; dataLeftDevice: boolean; contextSources: string[]; elapsedMs: number | null };

export type ProjectBundle = {
  project: NovelProject;
  seed: ProjectSeed;
  storyBible: StoryBible;
  protagonist: Character | null;
  world: World | null;
  storyState: StoryState;
  initialTask: WritingTask;
  readerState: ReaderState;
  initialBackup: ProjectBackup;
};
