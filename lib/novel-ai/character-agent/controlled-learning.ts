import {
  assertLearningRecordPrivate,
  createControlledLearningRecord,
  type ControlledLearningRecord,
  type LearningConsent,
} from "../learning-data";
import { CharacterAgentError } from "./errors";
import { sha256 } from "./record-factory";
import type { CharacterLearningSelection } from "./types";

export async function createCharacterLearningSelection(input: Omit<CharacterLearningSelection, "authorOnlyReferences" | "createdAt"> & {
  projectId: string;
  authorOnlyKnowledge: Array<{ knowledgeId: string; claim: string }>;
  consent?: LearningConsent;
}): Promise<ControlledLearningRecord> {
  const authorOnlyReferences = await Promise.all(input.authorOnlyKnowledge.map(async (record) => ({
    knowledgeId: record.knowledgeId,
    scope: "AUTHOR_ONLY" as const,
    redactedFingerprint: await sha256(`${input.projectId}:${record.knowledgeId}:${record.claim}`),
  })));
  const base = createControlledLearningRecord({
    projectId: input.projectId,
    candidateId: input.proposalId,
    taskType: input.proposalType,
    promptProfile: input.promptProfileVersion,
    retrievedContextRefs: authorOnlyReferences.map((record) => record.knowledgeId),
    accepted: input.accepted,
    rejected: input.rejected,
    userEdited: input.userEdited,
    editDiff: input.editDiff ?? undefined,
    rating: input.rating ?? undefined,
    reason: input.reason ?? undefined,
    provider: input.provider,
    model: input.model ?? "",
    storyRevision: input.sourceRevision,
    consent: input.consent ?? "private_inference_only",
  });
  const record: ControlledLearningRecord = {
    ...base,
    agentRunId: input.agentRunId,
    characterId: input.characterId,
    canonContextId: input.canonContextId,
    proposalId: input.proposalId,
    proposalType: input.proposalType,
    selectedCandidate: input.selectedCandidate,
    knowledgeScopeDecisionHash: input.knowledgeScopeDecisionHash,
    relationshipDeltaCandidate: structuredClone(input.relationshipDeltaCandidate),
    storyBibleVersion: input.storyBibleVersion,
    authorOnlyReferences,
    modelTrainingAllowed: false,
    distillationAllowed: false,
  };
  assertCharacterLearningPrivacy(record);
  const serialized = JSON.stringify(record);
  if (input.authorOnlyKnowledge.some((item) => item.claim.trim() && serialized.includes(item.claim.trim()))) {
    throw new CharacterAgentError(
      "CHARACTER_LEARNING_AUTHOR_ONLY_CONTENT_LEAK",
      "AUTHOR_ONLY 學習資料只能保存 ID、scope 與去識別指紋。",
    );
  }
  return record;
}

export function assertCharacterLearningPrivacy(record: ControlledLearningRecord) {
  assertLearningRecordPrivate(record);
  const serialized = JSON.stringify(record);
  if (/(?:sk|sbp|vcp)_[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~-]{12,}|password\s*[:=]|cookie\s*[:=]|otp\s*[:=]/i.test(serialized)) {
    throw new CharacterAgentError("CHARACTER_LEARNING_CREDENTIAL_LEAK", "學習資料不得包含密碼、Token、Cookie 或 OTP。");
  }
  if (/chain[-_ ]of[-_ ]thought|system prompt|developer prompt|完整推理草稿/i.test(serialized)) {
    throw new CharacterAgentError("CHARACTER_LEARNING_REASONING_LEAK", "學習資料不得包含系統 Prompt 或 Chain-of-Thought。");
  }
  if (record.authorOnlyReferences?.some((item) =>
    item.scope !== "AUTHOR_ONLY"
    || !/^[a-f0-9]{64}$/.test(item.redactedFingerprint)
    || !item.knowledgeId)) {
    throw new CharacterAgentError("CHARACTER_LEARNING_AUTHOR_ONLY_REFERENCE_INVALID", "AUTHOR_ONLY 只能保存 ID、scope 與去識別指紋。");
  }
  if (record.modelTrainingAllowed !== false || record.distillationAllowed !== false) {
    throw new CharacterAgentError("CHARACTER_LEARNING_AUTOMATION_BLOCKED", "本階段不得自動訓練、蒸餾或更新模型。");
  }
  return true;
}

export class CharacterLearningDataStore {
  private records = new Map<string, ControlledLearningRecord>();

  put(record: ControlledLearningRecord) {
    assertCharacterLearningPrivacy(record);
    this.records.set(record.recordId, structuredClone(record));
    return structuredClone(record);
  }

  list(projectIdHash?: string) {
    return [...this.records.values()]
      .filter((record) => !projectIdHash || record.projectIdHash === projectIdHash)
      .map((record) => structuredClone(record));
  }

  delete(recordId: string) {
    return this.records.delete(recordId);
  }

  exportTrainingCandidates(projectIdHash?: string) {
    return {
      schemaVersion: "p24b-character-learning-export-v1",
      records: this.list(projectIdHash).filter((record) => record.exportEligible),
      modelTrainingStarted: false,
      distillationStarted: false,
    };
  }
}
