import type { Character, DomainRecord, NovelProject, StoryBible } from "../domain";
import type { CanonicalLayer } from "../drama-os/canon-layers";
import type { KnowledgeScope } from "../drama-os/knowledge-scope";
import type { ProposalEnvelope, ProposalStatus, ProposalType } from "../drama-os/proposal-envelope";
import type { PlatformProviderId } from "../router/platform-types";

export const CHARACTER_AGENT_SCHEMA_VERSION = "character-agent-v1" as const;
export const CHARACTER_AGENT_MIGRATION_VERSION = "p24b-character-agent-v1" as const;

export type CharacterEvidenceSupport = "SUPPORTED" | "INFERRED" | "UNKNOWN" | "CONFLICTING";
export type CharacterAgentRecordStatus = "CURRENT" | "STALE" | "DISABLED" | "PRIVATE_SIMULATION";
export type CanonicalTruthStatus = "TRUE" | "FALSE" | "UNKNOWN" | "CONFLICTING";
export type BeliefStatus = "BELIEVED_TRUE" | "BELIEVED_FALSE" | "UNCERTAIN" | "SUSPICIOUS" | "DISPROVEN";
export type MemoryType = "EPISODIC" | "SEMANTIC" | "SOCIAL" | "EMOTIONAL" | "COMMITMENT" | "TRAUMA" | "RUMOR";
export type EvaluationSeverity = "INFO" | "WARNING" | "HIGH" | "BLOCKING";
export type CharacterCanonType = "NOVEL_CANON" | "DRAMA_ADAPTATION_CANON" | "PRIVATE_SIMULATION";

export type CharacterCanonContext = {
  canonContextId: string;
  projectId: string;
  canonType: CharacterCanonType;
  novelRevision: number;
  storyBibleVersion: number;
  dramaAdaptationRevision: number | null;
  privateSimulationSessionId: string | null;
  sourceCanonContextId: string | null;
  branchId: string | null;
  timelinePosition: string;
  sourceCharacterRevisions: Record<string, number>;
  createdAt: string;
};

export type InformationFlowTrace = {
  inputEntityId: string;
  sourceScope: KnowledgeScope | "PRIVATE_SIMULATION" | "CANONICAL";
  targetContext: "ACTOR" | "EVALUATOR";
  allowed: boolean;
  reason: string;
  taintLabels: string[];
  decisionHash: string;
};

export type CharacterSourceReference = {
  referenceId: string;
  entityId: string;
  entityType: "character" | "story_bible" | "chapter" | "scene" | "world_rule" | "timeline" | "relationship" | "user_input";
  sourceRevision: number;
  excerpt: string;
  support: CharacterEvidenceSupport;
};

export type SourcedCharacterFact<T> = {
  value: T | null;
  support: CharacterEvidenceSupport;
  sourceReferences: CharacterSourceReference[];
  risk: string | null;
};

export type CharacterVoiceProfile = {
  formality: number;
  sentenceLength: "short" | "mixed" | "long";
  vocabularyStyle: string[];
  directness: number;
  emotionalExpressiveness: number;
  humorStyle: string;
  preferredAddressTerms: string[];
  avoidedPhrases: string[];
  speechPatterns: string[];
  dialogueExamples: string[];
  sourceReferences: CharacterSourceReference[];
};

export type AdultEligibility = {
  isFictional: true;
  ageAtLeast18: boolean;
  ageVerified: boolean;
  adultModeEnabled: boolean;
  optedIn: boolean;
  namespace: "general" | `adult:${string}`;
  eligible: boolean;
};

export type CharacterAgentProfile = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  profileId: string;
  characterId: string;
  sourceCharacterRevision: number;
  sourceStoryBibleVersion: number;
  sourceStoryRevision: number;
  name: string;
  aliases: string[];
  age: number | null;
  ageVerified: boolean;
  lifeStatus: Character["lifeStatus"];
  identity: SourcedCharacterFact<string>;
  factionIds: string[];
  personalityTraits: SourcedCharacterFact<string[]>;
  appearance?: SourcedCharacterFact<string[]>;
  values: SourcedCharacterFact<string[]>;
  goals: SourcedCharacterFact<string[]>;
  fears: SourcedCharacterFact<string[]>;
  flaws: SourcedCharacterFact<string[]>;
  motives: SourcedCharacterFact<string[]>;
  capabilities: SourcedCharacterFact<string[]>;
  limitations: SourcedCharacterFact<string[]>;
  forbiddenContradictions: string[];
  voiceProfile: CharacterVoiceProfile;
  privateBoundaries: string[];
  adultEligibility: AdultEligibility;
  status: CharacterAgentRecordStatus;
};

export type CharacterAgentState = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  stateId: string;
  characterId: string;
  canonContextId: string;
  sourceRevision: number;
  timelinePosition: string;
  locationId: string | null;
  lifeStatus: Character["lifeStatus"];
  physicalCondition: string[];
  emotionalState: Record<string, number>;
  activeGoals: string[];
  goalPriorities: Record<string, number>;
  availableResources: string[];
  inventoryReferences: string[];
  commitments: string[];
  currentConflicts: string[];
  relationshipEdgeIds: string[];
  knownKnowledgeIds: string[];
  beliefIds: string[];
  memoryIds: string[];
  privateArcIds: string[];
  status: "DERIVED" | "STALE" | "APPROVED";
  effectiveFromTimelinePosition: string;
  effectiveToTimelinePosition: string | null;
  canonicalMutation: 0;
};

export type CharacterKnowledgeRecord = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  knowledgeId: string;
  canonContextId: string;
  subjectEntityIds: string[];
  claim: string;
  canonicalTruthStatus: CanonicalTruthStatus;
  scope: KnowledgeScope;
  authorizedCharacterIds: string[];
  authorizedFactionIds: string[];
  revealConditionId: string | null;
  sourceReferences: CharacterSourceReference[];
  confidence: number;
  acquiredAt: string | null;
  usableAfterTimelinePosition: string;
  expiresAt: string | null;
  status: "CURRENT" | "REVOKED" | "EXPIRED";
};

export type CharacterBelief = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  beliefId: string;
  characterId: string;
  canonContextId: string;
  proposition: string;
  beliefStrength: number;
  beliefStatus: BeliefStatus;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  beliefSource: "OBSERVATION" | "MEMORY" | "RUMOR" | "INFERENCE" | "USER";
  formedAt: string;
  effectiveFromTimelinePosition: string;
  effectiveToTimelinePosition: string | null;
};

export type CharacterSuspicion = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  suspicionId: string;
  characterId: string;
  proposition: string;
  strength: number;
  evidenceIds: string[];
  status: "ACTIVE" | "CONFIRMED" | "DISMISSED";
};

export type CharacterMemory = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  memoryId: string;
  characterId: string;
  canonContextId: string;
  memoryType: MemoryType;
  eventId: string | null;
  sourceChapterId: string | null;
  sourceSceneId: string | null;
  timelinePosition: string;
  summary: string;
  perspective: string;
  emotionalValence: number;
  salience: number;
  confidence: number;
  truthStatus: CanonicalTruthStatus;
  visibility: KnowledgeScope;
  relatedCharacterIds: string[];
  relationshipImpact: Record<string, number>;
  originType: "CANONICAL_EVENT" | "USER_AUTHORED" | "AGENT_GENERATED" | "PRIVATE_SIMULATION" | "RUMOR" | "INFERENCE";
  sourceEventIds: string[];
  sourceRevision: number;
  approvalStatus: "CANDIDATE" | "APPROVED" | "PRIVATE_ONLY" | "SUPERSEDED" | "DISPROVEN";
  supersedesMemoryId: string | null;
  contradictedByMemoryIds: string[];
  usableInCanonTypes: CharacterCanonType[];
  usableAfterTimelinePosition: string;
  privateSimulationSessionId: string | null;
  freshnessStatus: "CURRENT" | "STALE";
};

export type CharacterMemoryCandidate = CharacterMemory & { approvalStatus: "CANDIDATE" | "PRIVATE_ONLY" };
export type ApprovedCharacterMemory = CharacterMemory & { approvalStatus: "APPROVED" };
export type PrivateSimulationMemory = CharacterMemory & {
  originType: "PRIVATE_SIMULATION";
  approvalStatus: "PRIVATE_ONLY";
  privateSimulationSessionId: string;
};

export type CharacterPerspectiveContextKind = "ACTOR" | "EVALUATOR";
export type KnowledgeDenialReason =
  | "AUTHOR_ONLY"
  | "CHARACTER_NOT_AUTHORIZED"
  | "FACTION_NOT_AUTHORIZED_AT_TIMELINE"
  | "READER_KNOWLEDGE_IS_NOT_CHARACTER_KNOWLEDGE"
  | "FUTURE_REVEAL_NOT_MET"
  | "NOT_YET_AVAILABLE_AT_TIMELINE"
  | "EXPIRED"
  | "CANON_CONTEXT_MISMATCH"
  | "PROJECT_SCOPE_MISMATCH";

export type CharacterPerspectiveContext = {
  contextId: string;
  projectId: string;
  characterId: string;
  kind: CharacterPerspectiveContextKind;
  timelinePosition: string;
  allowedKnowledgeIds: string[];
  deniedKnowledgeIds: string[];
  denialReasons: Record<string, KnowledgeDenialReason>;
  sourceReferences: CharacterSourceReference[];
  visibilityTrace: Array<{
    knowledgeId: string;
    scope: KnowledgeScope;
    decision: "ALLOW" | "DENY";
    reason: KnowledgeDenialReason | "PUBLIC" | "AUTHORIZED" | "EVALUATOR_AUTHORIZED" | "REVEAL_MET";
  }>;
  scopeDecisionHash: string;
  informationFlowTrace: InformationFlowTrace[];
};

export type CharacterActorContext = {
  contextId: string;
  canonContext: CharacterCanonContext;
  characterId: string;
  observableEvents: string[];
  allowedKnowledge: CharacterKnowledgeRecord[];
  beliefs: CharacterBelief[];
  memories: CharacterMemory[];
  goals: string[];
  relationshipView: CharacterRelationshipEdge[];
  allowedWorldRules: string[];
  allowedSceneData: string[];
  informationFlowTrace: InformationFlowTrace[];
};

export type CharacterEvaluatorContext = {
  contextId: string;
  canonContext: CharacterCanonContext;
  characterId: string;
  canonicalTruth: CharacterKnowledgeRecord[];
  authorOnlyKnowledge: CharacterKnowledgeRecord[];
  futureForeshadowing: string[];
  globalTimeline: string[];
  privateCharacterData: string[];
  consistencyConstraints: string[];
  informationFlowTrace: InformationFlowTrace[];
};

export type CharacterGoalPlan = {
  selectedGoal: string | null;
  activeGoals: string[];
  goalPriorities: Record<string, number>;
  plan: string[];
  conflicts: string[];
  sourceReferenceIds: string[];
};

export type CharacterActionCandidate = {
  candidateId: string;
  key: "A" | "B" | "C";
  characterId: string;
  label: string;
  action: string;
  rationale: string;
  knowledgeIds: string[];
  capabilityRequirements: string[];
  locationId: string | null;
  timelinePosition: string;
  relationshipImpact: Record<string, Partial<RelationshipMetrics>>;
  futureRisk: number;
  influencedByBeliefIds: string[];
  canonicalMutation: 0;
};

export type VoiceDriftReport = {
  score: number;
  reason: string;
  conflictingEvidence: CharacterSourceReference[];
  suggestedRevision: string | null;
};

export type CharacterDialogueCandidate = {
  candidateId: string;
  characterId: string;
  recipientCharacterIds: string[];
  line: string;
  intention: string;
  publicMessage: boolean;
  knowledgeIds: string[];
  blockedKnowledgeIds: string[];
  relationshipImpact: Record<string, Partial<RelationshipMetrics>>;
  voiceDrift: VoiceDriftReport;
  canonicalMutation: 0;
};

export type RelationshipMetrics = {
  trust: number;
  affection: number;
  attraction: number;
  fear: number;
  resentment: number;
  loyalty: number;
  debt: number;
  dependency: number;
  conflict: number;
  powerBalance: number;
};

export type CharacterRelationshipEdge = DomainRecord & RelationshipMetrics & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  relationshipId: string;
  canonContextId: string;
  fromCharacterId: string;
  toCharacterId: string;
  relationshipTypes: string[];
  publicStatus: string;
  privateStatus: string;
  knownByCharacterIds: string[];
  sourceReferences: CharacterSourceReference[];
  effectiveFromTimelinePosition: string;
  effectiveToTimelinePosition: string | null;
};

export type CharacterRelationshipEventType =
  | "FIRST_MEETING"
  | "TRUST_GAIN"
  | "TRUST_LOSS"
  | "BETRAYAL"
  | "RESCUE"
  | "CONFLICT"
  | "ALLIANCE"
  | "DEBT_CREATED"
  | "DEBT_REPAID"
  | "ATTRACTION_GAIN"
  | "RELATIONSHIP_BREAK"
  | "POWER_SHIFT"
  | "SECRET_SHARED"
  | "SECRET_DISCOVERED"
  | "RECONCILIATION";

export type CharacterRelationshipEvent = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  eventId: string;
  relationshipId: string;
  canonContextId: string;
  sourceChapterId: string | null;
  sourceSceneId: string | null;
  timelinePosition: string;
  eventType: CharacterRelationshipEventType;
  beforeSnapshot: RelationshipMetrics;
  delta: Partial<RelationshipMetrics>;
  afterSnapshot: RelationshipMetrics;
  cause: string;
  evidence: CharacterSourceReference[];
  status: "CANDIDATE" | "APPROVED" | "REJECTED";
  idempotencyKey: string;
  idempotencyScope: string;
  sourceEventId: string;
  sourceEventScope: string;
  beforeRevision: number;
  afterRevision: number;
  deltaReason: string;
  evidenceIds: string[];
  maximumAllowedDelta: number;
  requiresApproval: true;
  canonicalImpact: 0 | 1;
  freshnessStatus: "CURRENT" | "STALE";
};

export type CharacterPrivateArc = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  privateArcId: string;
  characterId: string;
  canonContextId: string;
  title: string;
  privateGoal: string;
  hiddenMotivation: string;
  secret: string;
  plan: string[];
  milestones: string[];
  risk: number;
  relatedRelationshipIds: string[];
  sourceRevision: number;
  status: "PRIVATE_SIMULATION" | "PROPOSAL_GENERATED" | "PROMOTED" | "DISCARDED";
  visibility: "PRIVATE_SIMULATION";
  canonicalMutation: 0;
  freshnessStatus: "CURRENT" | "STALE";
};

export type CharacterSimulationStatus = "READY" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED" | "DISCARDED" | "TIMED_OUT" | "FAILED";
export type CharacterSimulationSession = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  sessionId: string;
  canonContextId: string;
  canonContext: CharacterCanonContext;
  participantCharacterIds: string[];
  scenario: string;
  timelinePosition: string;
  locationId: string | null;
  privateMode: true;
  turnBudget: number;
  resourceBudget: { timeoutMs: number; maxContextCharacters: number; maxGeneratedCharacters: number };
  seed: string;
  status: CharacterSimulationStatus;
  currentTurn: number;
  startedAt: string | null;
  completedAt: string | null;
  noProgressCount: number;
  fairnessCounter: Record<string, number>;
  providerReplay: {
    providerId: PlatformProviderId;
    model: string | null;
    modelDigest: string | null;
    temperature: number;
    topP: number;
    seed: string;
    contextHash: string;
    promptProfileVersion: string;
    providerRunId: string;
    deterministicClaim: "STRUCTURE_ONLY" | "FULL";
  };
  terminationCode: "TURN_BUDGET_REACHED" | "NO_PROGRESS_TERMINATION" | "CANCELLED" | "TIMEOUT" | null;
  canonicalMutation: 0;
};

export type CharacterSimulationTurn = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  turnId: string;
  sessionId: string;
  canonContextId: string;
  turnNumber: number;
  speakerCharacterId: string;
  recipientCharacterIds: string[];
  observableEventIds: string[];
  allowedKnowledgeIds: string[];
  deniedKnowledgeIds: string[];
  action: CharacterActionCandidate;
  dialogue: CharacterDialogueCandidate | null;
  publicMessage: string | null;
  privateMessages: Array<{ recipientCharacterId: string; message: string }>;
  relationshipChangeCandidates: Array<{ relationshipId: string; delta: Partial<RelationshipMetrics>; cause: string }>;
  memoryCandidates: CharacterMemory[];
  decisionSummary: string;
  knownEvidenceIds: string[];
  uncertainty: string[];
  rejectedCandidateCodes: string[];
  constraintViolations: string[];
  decisionHash: string;
  canonicalMutation: 0;
};

export type CharacterSimulationResult = {
  resultId: string;
  sessionId: string;
  projectId: string;
  status: CharacterSimulationStatus;
  session: CharacterSimulationSession;
  turns: CharacterSimulationTurn[];
  relationshipImpactCandidates: CharacterSimulationTurn["relationshipChangeCandidates"];
  memoryCandidates: CharacterMemory[];
  proposalCandidates: CharacterProposalEnvelope[];
  canonicalMutation: 0;
};

export type CharacterEvaluationIssue = {
  code: string;
  score: number;
  severity: EvaluationSeverity;
  reason: string;
  sourceReferences: CharacterSourceReference[];
  suggestedRevision: string | null;
};

export type CharacterAgentEvaluation = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  evaluationId: string;
  agentRunId: string | null;
  proposalId: string | null;
  characterId: string;
  deterministicIssues: CharacterEvaluationIssue[];
  modelScores: {
    characterConsistency: number;
    motivationCoherence: number;
    emotionalContinuity: number;
    voiceConsistency: number;
    relationshipRealism: number;
    knowledgeConsistency: number;
    sceneContribution: number;
    dialogueQuality: number;
    repetition: number;
    readerEngagement: number;
  };
  score: number;
  blockingIssueCount: number;
  status: "PASSED" | "NEEDS_REVIEW" | "BLOCKED";
};

export type CharacterProposalType = Extract<
  ProposalType,
  | "CHARACTER_ACTION"
  | "CHARACTER_DIALOGUE"
  | "CHARACTER_STATE_CHANGE"
  | "RELATIONSHIP_CHANGE"
  | "KNOWLEDGE_ACQUISITION"
  | "KNOWLEDGE_REVEAL"
  | "PRIVATE_ARC_PROMOTION"
  | "MULTI_CHARACTER_SCENE"
>;

export type CharacterCanonicalPatch = {
  targetLayer: "NOVEL_CANON" | "DRAMA_ADAPTATION_CANON";
  entityType: "character" | "relationship" | "drama_scene";
  entityId: string;
  changes: Record<string, unknown>;
};

export type CharacterProposalEnvelope = ProposalEnvelope & DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  proposalType: CharacterProposalType;
  canonContext: CharacterCanonContext;
  characterIds: string[];
  sourceCharacterRevisions: Record<string, number>;
  sourceStoryBibleVersion: number;
  knowledgeScopeImpact: string[];
  relationshipImpact: Record<string, Partial<RelationshipMetrics>>;
  storyBibleImpact: "NONE";
  canonicalImpact: CanonicalLayer[];
  canonicalPatch: CharacterCanonicalPatch;
  status: ProposalStatus;
  evaluationId: string;
  approvalEffects: CharacterApprovalEffects;
  freshnessStatus: "CURRENT" | "STALE";
};

export type CharacterApprovalEffects = {
  stateUpdate: CharacterAgentState | null;
  approvedMemories: CharacterMemory[];
  relationshipEdge: CharacterRelationshipEdge | null;
  relationshipEvent: CharacterRelationshipEvent | null;
  knowledgeAcquisition: CharacterKnowledgeRecord | null;
  privateArcPromotion: CharacterPrivateArc | null;
};

export type CharacterAgentAuditEvent = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  auditEventId: string;
  eventType: "PROPOSAL_APPROVED" | "PROPOSAL_REJECTED";
  proposalId: string;
  approvalId: string | null;
  canonContextId: string;
  actor: string;
  affectedEntityIds: string[];
  decisionSummary: string;
  sourceReferenceIds: string[];
};

export type CharacterAgentApprovalRecord = DomainRecord & {
  characterAgentSchemaVersion: typeof CHARACTER_AGENT_SCHEMA_VERSION;
  approvalId: string;
  proposalId: string;
  idempotencyKey: string;
  idempotencyScope: string;
  payloadFingerprint: string;
  expectedProposalRevision: number;
  expectedSourceRevision: number;
  expectedSourceStoryBibleVersion: number;
  targetLayer: CharacterCanonicalPatch["targetLayer"];
  canonContextId: string;
  canonicalEntityId: string;
  resultingCanonicalRevision: number;
  approvedChanges: Record<string, unknown>;
  approvedBy: string;
  approvedAt: string;
  status: "COMMITTED";
};

export type CharacterAgentProviderTrace = {
  providerId: PlatformProviderId;
  modelId: string | null;
  externalRequest: boolean;
  dataLeavesDevice: boolean;
  consentId: string | null;
};

export type CharacterAgentRun = {
  agentRunId: string;
  projectId: string;
  characterId: string;
  canonContext: CharacterCanonContext;
  observations: string[];
  allowedKnowledge: CharacterKnowledgeRecord[];
  deniedKnowledge: CharacterKnowledgeRecord[];
  beliefStateBefore: CharacterBelief[];
  beliefUpdateCandidates: CharacterBelief[];
  activeGoals: string[];
  selectedGoal: string | null;
  plan: string[];
  actionCandidates: CharacterActionCandidate[];
  dialogueCandidates: CharacterDialogueCandidate[];
  relationshipImpactCandidates: Array<{ relationshipId: string; delta: Partial<RelationshipMetrics>; cause: string }>;
  privateArcImpact: string[];
  characterConsistencyReport: CharacterAgentEvaluation;
  knowledgeLeakReport: { leakedKnowledgeIds: string[]; blockedKnowledgeIds: string[]; status: "PASS" | "BLOCKED" };
  canonicalImpact: CanonicalLayer[];
  canonicalMutation: 0;
  provider: PlatformProviderId;
  model: string | null;
  latency: number;
  tokenEstimate: number;
  status: "CANDIDATE" | "BLOCKED" | "CANCELLED";
  decisionSummary: string;
  knownEvidenceIds: string[];
  uncertainty: string[];
  rejectedCandidateCodes: string[];
  constraintViolations: string[];
  sourceReferences: CharacterSourceReference[];
  freshnessStatus: "CURRENT" | "STALE";
};

export type CharacterAgentLoopInput = {
  project: NovelProject;
  storyBible: StoryBible;
  character: Character;
  canonContext: CharacterCanonContext;
  profile: CharacterAgentProfile;
  state: CharacterAgentState;
  knowledge: CharacterKnowledgeRecord[];
  beliefs: CharacterBelief[];
  memories: CharacterMemory[];
  relationships: CharacterRelationshipEdge[];
  otherProfiles: CharacterAgentProfile[];
  observations: string[];
  timelinePosition: string;
  sceneId: string | null;
  targetCharacterIds: string[];
  factionIdsAtTimeline: string[];
  revealedConditionIds: string[];
  provider: CharacterAgentProviderTrace;
  currentProjectRevision: number;
  currentStoryBibleRevision: number;
  currentCharacterRevision: number;
  currentCharacterRevisions: Record<string, number>;
  currentDramaAdaptationRevision: number | null;
  signal?: AbortSignal;
};

export type CharacterAgentProfileInput = {
  project: NovelProject;
  storyBible: StoryBible;
  character: Character;
  sourceStoryRevision: number;
  age?: number | null;
  ageVerified?: boolean;
  factionIds?: string[];
  personalityTraits?: SourcedCharacterFact<string[]>;
  values?: SourcedCharacterFact<string[]>;
  fears?: SourcedCharacterFact<string[]>;
  flaws?: SourcedCharacterFact<string[]>;
  motives?: SourcedCharacterFact<string[]>;
  capabilities?: SourcedCharacterFact<string[]>;
  limitations?: SourcedCharacterFact<string[]>;
  voiceProfile?: Partial<CharacterVoiceProfile>;
  privateBoundaries?: string[];
  adultModeEnabled?: boolean;
  adultOptedIn?: boolean;
};

export type ApproveCharacterProposalInput = {
  projectId: string;
  proposalId: string;
  idempotencyKey: string;
  payloadFingerprint: string;
  expectedProposalRevision: number;
  expectedSourceRevision: number;
  expectedSourceStoryBibleVersion: number;
  approvedBy: string;
  expectedCanonContextId: string;
};

export type RejectCharacterProposalInput = {
  projectId: string;
  proposalId: string;
  expectedProposalRevision: number;
  expectedCanonContextId: string;
  rejectedBy: string;
};

export type RejectCharacterProposalResult = {
  proposal: CharacterProposalEnvelope;
  audit: CharacterAgentAuditEvent;
};

export type ApproveCharacterProposalResult = {
  replayed: boolean;
  proposal: CharacterProposalEnvelope;
  approval: CharacterAgentApprovalRecord;
  canonicalRecord: DomainRecord;
};

export type CharacterLearningSelection = {
  agentRunId: string;
  characterId: string;
  canonContextId: string;
  proposalId: string;
  proposalType: CharacterProposalType;
  selectedCandidate: string;
  accepted: boolean;
  rejected: boolean;
  userEdited: boolean;
  editDiff: string | null;
  rating: number | null;
  reason: string | null;
  knowledgeScopeDecisionHash: string;
  relationshipDeltaCandidate: Record<string, Partial<RelationshipMetrics>>;
  provider: PlatformProviderId;
  model: string | null;
  promptProfileVersion: string;
  sourceRevision: number;
  storyBibleVersion: number;
  authorOnlyReferences: Array<{ knowledgeId: string; scope: "AUTHOR_ONLY"; redactedFingerprint: string }>;
  createdAt: string;
};
