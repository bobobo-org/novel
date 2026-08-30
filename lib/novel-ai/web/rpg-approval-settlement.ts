import type {
  AcceptedChoice,
  ChoiceCandidate,
  ConversationApprovalTransaction,
  ConversationArtifact,
  ConversationMessage,
  ConversationSession,
  IdempotencyRecord,
  OperationJournal,
  RpgTurnReceipt,
} from "../domain";
import type {
  ClosedAgentApprovalRecord,
  ClosedAgentCandidate,
  ClosedAgentMemoryRecord,
  ClosedAgentOS,
  ClosedAgentTaskRecord,
} from "../closed-agent-os";
import { sha256Hex, stableStringify } from "../closed-ai-cache";
import {
  acceptedChoiceConversationApprovalPayloadFingerprint,
} from "../conversation/approval-transaction";
import type {
  AcceptChoiceConversationApprovalInput,
  AcceptChoiceTransactionInput,
  NovelRepository,
} from "../repository";
import { acceptStudioChoice } from "../repository/studio-canonical";
import { getStudioClosedAgentOS } from "./closed-agent-os-service";
import type { RpgChatTurnCandidate } from "./rpg-chat-turn";

type RpgApprovalSettlementOS = Pick<
  ClosedAgentOS,
  "approveCandidate" | "ledger" | "state"
>;

export type RpgApprovalSettlementResult = {
  applicable: boolean;
  alreadySettled: boolean;
  canonicalReplayed: boolean;
  candidateId: string | null;
  commitId: string | null;
};

function settlementError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

function exactClosedCandidateId(message: ConversationMessage) {
  const ids = message.candidateIds.filter((id) => (
    id.startsWith("closed-agent-candidate:")
  ));
  if (ids.length > 1) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_CANDIDATE_AMBIGUOUS");
  }
  return ids[0] ?? null;
}

function parseApprovedRpgCandidate(artifact: ConversationArtifact) {
  try {
    const envelope = JSON.parse(artifact.candidateContent) as {
      schemaVersion?: unknown;
      candidate?: RpgChatTurnCandidate;
    };
    if (
      envelope.schemaVersion !== "conversation-rpg-candidate-v1"
      || !envelope.candidate
    ) return null;
    return envelope.candidate;
  } catch {
    return null;
  }
}

function revisionCandidates(record: {
  revision: number;
  parentRevision?: number | null;
}) {
  return [...new Set([
    record.revision,
    typeof record.parentRevision === "number" ? record.parentRevision : null,
  ].filter((revision): revision is number => Number.isInteger(revision)))];
}

async function assertClosedAgentSettlement(input: {
  os: RpgApprovalSettlementOS;
  candidate: ClosedAgentCandidate;
  commitId: string;
}) {
  const ledgerId = `closed-agent:${input.candidate.namespace.projectId}:${input.candidate.taskId}`;
  const [candidate, task, approval, memory, ledgerVerification, ledgerBlocks] = await Promise.all([
    input.os.state.get<ClosedAgentCandidate>(input.candidate.id),
    input.os.state.get<ClosedAgentTaskRecord>(input.candidate.taskId),
    input.os.state.get<ClosedAgentApprovalRecord>(
      `closed-agent-approval:${input.candidate.id}`,
    ),
    input.os.state.get<ClosedAgentMemoryRecord>(
      `closed-agent-memory:${input.candidate.id}`,
    ),
    input.os.ledger.verify(ledgerId),
    input.os.ledger.repository.list(ledgerId),
  ]);
  const approvalPayloadDigest = approval
    ? await sha256Hex(stableStringify({
        approvalId: approval.id,
        candidateId: input.candidate.id,
        candidateDigest: input.candidate.contentDigest,
        approvedBy: approval.approvedBy,
        humanApproved: true,
      }))
    : null;
  const canonicalPayloadDigest = await sha256Hex(stableStringify({
    approvalId: `closed-agent-approval:${input.candidate.id}`,
    candidateId: input.candidate.id,
    commitId: input.commitId,
    previousStoryBibleRevision: input.candidate.namespace.storyBibleRevision,
    resultingStoryBibleRevision: null,
  }));
  const signedApprovalBlocks = ledgerBlocks.filter((block) => (
    block.eventType === "approval-signed"
    && block.payloadDigest === approvalPayloadDigest
    && block.signature
  ));
  const canonicalCommitBlocks = ledgerBlocks.filter((block) => (
    block.eventType === "canonical-commit"
    && block.payloadDigest === canonicalPayloadDigest
  ));
  if (
    !candidate
    || candidate.status !== "committed"
    || candidate.canonicalMutationCount !== 1
    || !task
    || task.state !== "completed"
    || task.errorCode !== null
    || !approval
    || approval.candidateId !== candidate.id
    || approval.canonicalCommitId !== input.commitId
    || !memory
    || memory.candidateId !== candidate.id
    || memory.approvalId !== approval.id
    || memory.contentDigest !== candidate.contentDigest
    || memory.canonical !== true
    || ledgerVerification.valid !== true
    || ledgerVerification.signedApprovalCount !== 1
    || signedApprovalBlocks.length !== 1
    || canonicalCommitBlocks.length !== 1
  ) {
    throw settlementError(
      "RPG_APPROVAL_CLOSED_AGENT_SETTLEMENT_INCOMPLETE",
      "The approved RPG Canon transaction has not completed Closed Agent settlement.",
    );
  }
  return { candidate, task, approval, memory };
}

async function resolveReplayApproval(input: {
  projectId: string;
  artifact: ConversationArtifact;
  session: ConversationSession;
  sourceMessage: ConversationMessage;
  transaction: ConversationApprovalTransaction;
  choiceCandidate: ChoiceCandidate;
  acceptedChoice: AcceptedChoice;
  idempotency: IdempotencyRecord;
}) {
  const artifactRevision = input.artifact.parentRevision;
  if (!Number.isInteger(artifactRevision)) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_ARTIFACT_REVISION_MISSING");
  }
  for (const sessionRevision of revisionCandidates(input.session)) {
    for (const messageRevision of revisionCandidates(input.sourceMessage)) {
      const conversationApproval: AcceptChoiceConversationApprovalInput = {
        operationId: input.transaction.operationId,
        idempotencyKey: input.transaction.idempotencyKey,
        sessionId: input.session.id,
        artifactId: input.artifact.id,
        sourceMessageId: input.sourceMessage.id,
        candidateDigest: input.artifact.candidateDigest,
        expectedSessionRevision: sessionRevision,
        expectedArtifactRevision: artifactRevision as number,
        expectedSourceMessageRevision: messageRevision,
        expectedSourceRevision: input.transaction.sourceRevision,
      };
      const replayFingerprintInput = {
        operationId: input.acceptedChoice.effectOperationId,
        idempotencyKey: input.idempotency.idempotencyKey,
        projectId: input.projectId,
        chapterId: input.choiceCandidate.chapterId,
        candidateId: input.choiceCandidate.id,
        acceptedText: input.acceptedChoice.acceptedText,
        choiceLabel: input.acceptedChoice.choiceLabel ?? null,
        expectedProjectRevision: input.choiceCandidate.inputRevision,
        expectedChapterRevision: input.choiceCandidate.chapterRevision,
        expectedCandidateRevision:
          input.choiceCandidate.parentRevision
          ?? Math.max(0, input.choiceCandidate.revision - 1),
        expectedStoryStateRevision: input.choiceCandidate.storyStateRevision,
        expectedStoryBibleRevision: input.choiceCandidate.storyBibleRevision!,
        conversationApproval,
      } satisfies AcceptChoiceTransactionInput;
      const fingerprint = await acceptedChoiceConversationApprovalPayloadFingerprint(
        replayFingerprintInput,
      );
      if (fingerprint === input.transaction.payloadFingerprint) {
        return conversationApproval;
      }
    }
  }
  throw settlementError(
    "RPG_APPROVAL_SETTLEMENT_REPLAY_BINDING_MISMATCH",
    "The durable RPG approval cannot be reproduced from its exact transaction binding.",
  );
}

/**
 * Complete the ClosedAgentOS half of an RPG approval saga after the atomic
 * repository transaction has already approved the conversation artifact.
 * The callback is deliberately incapable of making a new Canon write: a
 * complete operation journal, idempotency record, conversation approval and
 * RPG receipt are required before the exact acceptChoice replay is attempted.
 */
export async function settleApprovedRpgTurnClosedAgent(input: {
  repository: NovelRepository;
  projectId: string;
  sessionId: string;
  artifactId: string;
  closedAgentOS?: RpgApprovalSettlementOS;
}): Promise<RpgApprovalSettlementResult> {
  const os = input.closedAgentOS ?? getStudioClosedAgentOS();
  const artifact = await input.repository.get<ConversationArtifact>(
    "conversationArtifacts",
    input.artifactId,
  );
  if (
    !artifact
    || artifact.projectId !== input.projectId
    || artifact.sessionId !== input.sessionId
    || artifact.artifactType !== "rpg"
    || artifact.targetStore !== "chapters"
    || artifact.status !== "approved"
    || !Number.isInteger(artifact.approvedRevision)
  ) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_ARTIFACT_INVALID");
  }
  const candidateEnvelope = parseApprovedRpgCandidate(artifact);
  if (!candidateEnvelope) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_CANDIDATE_INVALID");
  }
  const [session, sourceMessage, approvalTransactions] = await Promise.all([
    input.repository.get<ConversationSession>(
      "conversationSessions",
      input.sessionId,
    ),
    input.repository.get<ConversationMessage>(
      "conversationMessages",
      artifact.sourceMessageId,
    ),
    input.repository.list<ConversationApprovalTransaction>(
      "conversationApprovalTransactions",
      input.projectId,
    ),
  ]);
  if (
    !session
    || !sourceMessage
    || session.projectId !== input.projectId
    || sourceMessage.projectId !== input.projectId
    || sourceMessage.sessionId !== input.sessionId
  ) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_SOURCE_INVALID");
  }
  const closedCandidateId = exactClosedCandidateId(sourceMessage);
  if (!closedCandidateId) {
    return {
      applicable: false,
      alreadySettled: true,
      canonicalReplayed: false,
      candidateId: null,
      commitId: null,
    };
  }
  if (candidateEnvelope.candidateId !== closedCandidateId) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_CANDIDATE_BINDING_MISMATCH");
  }
  const matchingTransactions = approvalTransactions.filter((transaction) => (
    transaction.artifactId === artifact.id
    && transaction.sessionId === session.id
    && transaction.sourceMessageId === sourceMessage.id
    && transaction.candidateDigest === artifact.candidateDigest
    && transaction.targetStore === "chapters"
    && transaction.targetRecordId === artifact.targetRecordId
    && transaction.sourceRevision === artifact.sourceRevision
    && transaction.resultingRevision === artifact.approvedRevision
    && transaction.canonicalMutationCount === 1
    && transaction.status === "committed"
    && transaction.commitMode === "external_canonical"
    && transaction.applicationMode === "external_commit"
    && typeof transaction.externalCommitId === "string"
    && transaction.externalCommitId.startsWith("accept:")
  ));
  if (matchingTransactions.length !== 1) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_TRANSACTION_AMBIGUOUS");
  }
  const transaction = matchingTransactions[0];
  const choiceCandidateId = transaction.externalCommitId!.slice("accept:".length);
  const [choiceCandidate, journals, idempotencyRecords, acceptedChoices] = await Promise.all([
    input.repository.get<ChoiceCandidate>("candidates", choiceCandidateId),
    input.repository.list<OperationJournal>("operationJournal", input.projectId),
    input.repository.list<IdempotencyRecord>("idempotencyRecords", input.projectId),
    input.repository.list<AcceptedChoice>("acceptedChoices", input.projectId),
  ]);
  const journal = journals.find((record) => (
    record.operationType === "accept_choice"
    && record.operationId === transaction.externalCommitId
    && record.candidateId === choiceCandidateId
  ));
  const idempotency = idempotencyRecords.find((record) => (
    record.operationType === "accept_choice"
    && record.operationId === transaction.externalCommitId
    && record.candidateId === choiceCandidateId
    && record.status === "committed"
  ));
  const acceptedChoice = journal
    ? acceptedChoices.find((record) => record.id === journal.acceptedChoiceId)
    : null;
  const receipt = journal?.rpgTurnReceiptId
    ? await input.repository.get<RpgTurnReceipt>(
        "rpgTurnReceipts",
        journal.rpgTurnReceiptId,
      )
    : null;
  if (
    !choiceCandidate
    || choiceCandidate.status !== "accepted"
    || choiceCandidate.projectId !== input.projectId
    || choiceCandidate.chapterId !== artifact.targetRecordId
    || choiceCandidate.storyBibleRevision == null
    || !journal
    || !idempotency
    || idempotency.idempotencyKey
      !== `${input.projectId}:${choiceCandidate.id}:${choiceCandidate.inputRevision}`
    || !acceptedChoice
    || acceptedChoice.candidateId !== choiceCandidate.id
    || acceptedChoice.acceptedText !== candidateEnvelope.story
    || acceptedChoice.effectOperationId !== transaction.externalCommitId
    || !receipt
    || receipt.id !== journal.rpgTurnReceiptId
    || receipt.operationId !== transaction.externalCommitId
    || receipt.acceptedChoiceId !== acceptedChoice.id
    || receipt.chapterId !== artifact.targetRecordId
  ) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_CANON_PROOF_INCOMPLETE");
  }
  const closedCandidate = await os.state.get<ClosedAgentCandidate>(closedCandidateId);
  if (
    !closedCandidate
    || closedCandidate.projectId !== input.projectId
    || closedCandidate.taskId !== candidateEnvelope.taskId
    || closedCandidate.contentDigest !== candidateEnvelope.candidateDigest
    || closedCandidate.modelId !== candidateEnvelope.model
    || closedCandidate.modelDigest !== candidateEnvelope.modelDigest
    || closedCandidate.sourceChapterId !== artifact.targetRecordId
    || closedCandidate.sourceRevision !== artifact.sourceRevision
    || closedCandidate.externalRequest === true
    || closedCandidate.dataLeftDevice === true
  ) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_CLOSED_PROOF_MISMATCH");
  }
  const conversationApproval = await resolveReplayApproval({
    projectId: input.projectId,
    artifact,
    session,
    sourceMessage,
    transaction,
    choiceCandidate,
    acceptedChoice,
    idempotency,
  });
  if (closedCandidate.status === "committed") {
    await assertClosedAgentSettlement({
      os,
      candidate: closedCandidate,
      commitId: acceptedChoice.effectOperationId,
    });
    return {
      applicable: true,
      alreadySettled: true,
      canonicalReplayed: false,
      candidateId: closedCandidate.id,
      commitId: acceptedChoice.effectOperationId,
    };
  }
  if (
    closedCandidate.status !== "awaiting-approval"
    || closedCandidate.canonicalMutationCount !== 0
  ) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_CLOSED_STATE_INVALID");
  }
  let canonicalReplayed = false;
  const approval = await os.approveCandidate({
    candidateId: closedCandidate.id,
    approvedBy: "local-author",
    humanApproved: true,
    canonicalCommit: async ({ candidate }) => {
      if (
        candidate.id !== closedCandidate.id
        || candidate.taskId !== closedCandidate.taskId
        || candidate.contentDigest !== closedCandidate.contentDigest
        || candidate.modelId !== closedCandidate.modelId
        || candidate.modelDigest !== closedCandidate.modelDigest
        || candidate.sourceChapterId !== closedCandidate.sourceChapterId
        || candidate.sourceRevision !== closedCandidate.sourceRevision
      ) {
        throw settlementError("RPG_APPROVAL_SETTLEMENT_CALLBACK_MISMATCH");
      }
      const replay = await acceptStudioChoice(
        input.repository,
        choiceCandidate.id,
        acceptedChoice.acceptedText,
        acceptedChoice.choiceLabel ?? null,
        conversationApproval,
      );
      if (
        !replay.replayed
        || replay.acceptedChoice.id !== acceptedChoice.id
        || replay.acceptedChoice.effectOperationId !== acceptedChoice.effectOperationId
        || replay.conversationArtifact?.id !== artifact.id
        || replay.conversationArtifact.status !== "approved"
        || replay.conversationApprovalTransaction?.id !== transaction.id
        || replay.rpgTurnReceipt?.id !== receipt.id
      ) {
        throw settlementError("RPG_APPROVAL_SETTLEMENT_CANON_REPLAY_INVALID");
      }
      canonicalReplayed = true;
      return { commitId: acceptedChoice.effectOperationId };
    },
  });
  if (
    approval.canonicalMutationCount !== 1
    || approval.candidate.status !== "committed"
  ) {
    throw settlementError("RPG_APPROVAL_SETTLEMENT_CLOSED_STATE_INVALID");
  }
  await assertClosedAgentSettlement({
    os,
    candidate: closedCandidate,
    commitId: acceptedChoice.effectOperationId,
  });
  return {
    applicable: true,
    alreadySettled: false,
    canonicalReplayed,
    candidateId: closedCandidate.id,
    commitId: acceptedChoice.effectOperationId,
  };
}
