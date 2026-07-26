import { makeCharacterAgentRecord } from "./record-factory";
import type {
  CharacterActionCandidate,
  CharacterActorContext,
  CharacterAgentEvaluation,
  CharacterAgentProfile,
  CharacterAgentState,
  CharacterDialogueCandidate,
  CharacterEvaluatorContext,
  CharacterRelationshipEvent,
  CharacterSourceReference,
  EvaluationSeverity,
} from "./types";

function issue(
  code: string,
  severity: EvaluationSeverity,
  reason: string,
  sourceReferences: CharacterSourceReference[] = [],
  suggestedRevision: string | null = null,
) {
  const score = severity === "BLOCKING" ? 0 : severity === "HIGH" ? 35 : severity === "WARNING" ? 65 : 90;
  return { code, score, severity, reason, sourceReferences, suggestedRevision };
}

export function evaluateCharacterCandidate(input: {
  projectId: string;
  agentRunId?: string | null;
  proposalId?: string | null;
  profile: CharacterAgentProfile;
  state: CharacterAgentState;
  actorContext: CharacterActorContext;
  evaluatorContext: CharacterEvaluatorContext;
  actions: CharacterActionCandidate[];
  dialogues: CharacterDialogueCandidate[];
  relationshipEvents?: CharacterRelationshipEvent[];
  priorActionTexts?: string[];
  attemptedCanonicalMutation?: boolean;
  privateMessageBroadcast?: boolean;
  sceneLocationId?: string | null;
  requiredAge?: number | null;
}): CharacterAgentEvaluation {
  const issues = [];
  if (input.state.lifeStatus === "dead" && input.actions.length) {
    issues.push(issue("DEAD_CHARACTER_PRESENT_ACTION", "BLOCKING", "角色在此時間點已死亡，不能執行當前行動。"));
  }
  if (input.sceneLocationId && input.state.locationId !== input.sceneLocationId) {
    issues.push(issue("CHARACTER_LOCATION_MISMATCH", "BLOCKING", "角色所在地與場景不符。"));
  }
  const supportedCapabilities = new Set(input.profile.capabilities.support === "SUPPORTED" ? (input.profile.capabilities.value ?? []) : []);
  for (const action of input.actions) {
    if (action.capabilityRequirements.some((capability) => capability !== "一般觀察與溝通" && !supportedCapabilities.has(capability))) {
      issues.push(issue("UNSUPPORTED_CHARACTER_CAPABILITY", "BLOCKING", "候選使用了沒有正式來源支持的能力。"));
    }
    const leaked = action.knowledgeIds.filter((id) => !input.actorContext.allowedKnowledge.some((record) => record.knowledgeId === id));
    if (leaked.length) issues.push(issue("UNAUTHORIZED_KNOWLEDGE", "BLOCKING", `候選引用未授權資訊 ID：${leaked.join("、")}`));
  }
  for (const trace of input.actorContext.informationFlowTrace.filter((item) => !item.allowed)) {
    if (input.actions.some((action) => action.knowledgeIds.includes(trace.inputEntityId))
      || input.dialogues.some((dialogue) => dialogue.knowledgeIds.includes(trace.inputEntityId))) {
      const code = trace.sourceScope === "AUTHOR_ONLY"
        ? "AUTHOR_ONLY_VIOLATION"
        : trace.sourceScope === "FACTION_KNOWN"
          ? "FACTION_KNOWN_VIOLATION"
          : trace.sourceScope === "FUTURE_REVEAL"
            ? "FUTURE_REVEAL_VIOLATION"
            : "KNOWLEDGE_SCOPE_VIOLATION";
      issues.push(issue(code, "BLOCKING", `角色輸出不得引用被拒絕的資訊 ID：${trace.inputEntityId}`));
    }
  }
  if (input.requiredAge != null && (!input.profile.ageVerified || input.profile.age == null || input.profile.age < input.requiredAge)) {
    issues.push(issue("CHARACTER_AGE_CONFLICT", "BLOCKING", "場景所需年齡與角色在該時間點的已驗證年齡不符。"));
  }
  if (input.profile.identity.support === "CONFLICTING") {
    issues.push(issue("CHARACTER_IDENTITY_CONFLICT", "HIGH", "角色身分來源互相衝突，應由作者確認。", input.profile.identity.sourceReferences));
  }
  if (input.profile.values.support === "SUPPORTED" && input.actions.some((action) =>
    (input.profile.values.value ?? []).some((value) => action.action.includes(`背棄${value}`)))) {
    issues.push(issue("SUDDEN_VALUE_REVERSAL", "HIGH", "候選可能突然反轉角色既有價值。"));
  }
  for (const event of input.relationshipEvents ?? []) {
    if (!event.evidenceIds.length || !event.cause) issues.push(issue("EVIDENCE_FREE_RELATIONSHIP_CHANGE", "BLOCKING", "關係變化缺少來源與原因。"));
    if (Object.values(event.delta).some((delta) => Math.abs(delta ?? 0) > event.maximumAllowedDelta)) {
      issues.push(issue("RELATIONSHIP_DELTA_EXCEEDS_LIMIT", "BLOCKING", "關係變化超過此事件允許的最大幅度。"));
    }
  }
  for (const dialogue of input.dialogues) {
    if (dialogue.voiceDrift.score < 45) issues.push(issue("DIALOGUE_VOICE_DRIFT", "HIGH", dialogue.voiceDrift.reason, dialogue.voiceDrift.conflictingEvidence, dialogue.voiceDrift.suggestedRevision));
  }
  if (input.privateMessageBroadcast) issues.push(issue("PRIVATE_MESSAGE_BROADCAST", "BLOCKING", "私人訊息不可自動廣播給其他角色。"));
  const normalizedPrior = new Set((input.priorActionTexts ?? []).map((value) => value.replace(/\s+/g, "")));
  if (input.actions.some((action) => normalizedPrior.has(action.action.replace(/\s+/g, "")))) {
    issues.push(issue("REPEATED_ACTION_LOOP", "HIGH", "候選重複先前行動，可能形成無進展循環。"));
  }
  if (input.attemptedCanonicalMutation) issues.push(issue("UNAPPROVED_CANONICAL_WRITE", "BLOCKING", "未核准候選不得寫入 Canonical。"));
  const blockingIssueCount = issues.filter((item) => item.severity === "BLOCKING").length;
  const score = Math.max(0, Math.round(100 - issues.reduce((sum, item) => sum + (item.severity === "BLOCKING" ? 30 : item.severity === "HIGH" ? 15 : item.severity === "WARNING" ? 7 : 2), 0)));
  const record = makeCharacterAgentRecord(input.projectId, "system");
  return {
    ...record,
    id: record.id,
    evaluationId: record.id,
    agentRunId: input.agentRunId ?? null,
    proposalId: input.proposalId ?? null,
    characterId: input.profile.characterId,
    deterministicIssues: issues,
    modelScores: {
      characterConsistency: score,
      motivationCoherence: score,
      emotionalContinuity: score,
      voiceConsistency: Math.min(score, ...input.dialogues.map((dialogue) => dialogue.voiceDrift.score), 100),
      relationshipRealism: score,
      knowledgeConsistency: blockingIssueCount ? 0 : 100,
      sceneContribution: input.actions.length ? 80 : 50,
      dialogueQuality: input.dialogues.length ? 80 : 50,
      repetition: issues.some((item) => item.code === "REPEATED_ACTION_LOOP") ? 20 : 100,
      readerEngagement: input.actions.length ? 75 : 50,
    },
    score,
    blockingIssueCount,
    status: blockingIssueCount ? "BLOCKED" : issues.some((item) => item.severity === "HIGH") ? "NEEDS_REVIEW" : "PASSED",
  };
}

export function evaluatorSuggestionWithoutSecretLeak(
  actor: CharacterActorContext,
  evaluator: CharacterEvaluatorContext,
  evaluation: CharacterAgentEvaluation,
) {
  const actorKnowledgeIds = new Set(actor.allowedKnowledge.map((record) => record.knowledgeId));
  const actorReferenceIds = new Set(actor.allowedKnowledge.flatMap((record) =>
    record.sourceReferences.map((reference) => reference.referenceId)));
  const excludedEvaluatorKnowledgeIds = evaluator.canonicalTruth
    .filter((record) => !actorKnowledgeIds.has(record.knowledgeId))
    .map((record) => record.knowledgeId);
  return evaluation.deterministicIssues.map((item) => ({
    code: item.code,
    severity: item.severity,
    // Evaluator-authored prose is deliberately not copied into an actor-facing
    // revision. The stable template cannot launder AUTHOR_ONLY or future facts.
    suggestion: "依角色可知資訊重新產生候選。",
    allowedEvidenceIds: item.sourceReferences
      .map((reference) => reference.referenceId)
      .filter((id) => actorReferenceIds.has(id)),
    excludedEvaluatorKnowledgeIds,
    taintLabels: excludedEvaluatorKnowledgeIds.length ? ["EVALUATOR_ONLY_INPUT_EXCLUDED"] : [],
  }));
}
