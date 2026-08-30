import type {
  ConversationMessage,
  ConversationToolInvocation,
} from "../domain";
import { sha256Hex, stableStringify } from "../closed-ai-cache";

export const RPG_CHOICE_STALE_EVIDENCE_TOOL_ID =
  "conversation:evidence:rpg-choice-stale" as const;
export const RPG_CHOICE_STALE_EVIDENCE_TASK_TYPE =
  "rpg.choice.stale-abandonment.v1" as const;
export const RPG_CHOICE_STALE_EVIDENCE_STAGE =
  "rpg-choice-stale-abandonment-v1" as const;
export const RPG_CHOICE_STALE_EVIDENCE_MESSAGE =
  "這張三選一已因作品版本變更而封存，必須依最新狀態重新建立。" as const;

const RPG_CHOICES_PREFIX = "[[NOVEL_RPG_CHOICES_V1]]\n";
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;

export function rpgChoiceCardContextRevisionDigest(content: string) {
  if (!content.startsWith(RPG_CHOICES_PREFIX)) return null;
  try {
    const parsed = JSON.parse(content.slice(RPG_CHOICES_PREFIX.length)) as {
      schemaVersion?: unknown;
      contextRevisionDigest?: unknown;
      plan?: { contextRevisionDigest?: unknown; contextRevisionGuard?: { digest?: unknown } };
    };
    const digest = parsed.contextRevisionDigest;
    return parsed.schemaVersion === "conversation-rpg-choices-v1"
      && typeof digest === "string"
      && DIGEST_PATTERN.test(digest)
      && parsed.plan?.contextRevisionDigest === digest
      && parsed.plan?.contextRevisionGuard?.digest === digest
      ? digest
      : null;
  } catch {
    return null;
  }
}

export async function rpgChoiceStaleEvidenceId(input: {
  sessionId: string;
  choiceCardMessageId: string;
  contextRevisionDigest: string;
}) {
  const digest = await sha256Hex(stableStringify({
    domain: "conversation-rpg-choice-stale-evidence-v1",
    ...input,
  }));
  return `conversation-rpg-choice-stale:${digest}`;
}

export function hasRpgChoiceStaleEvidenceIdentity(
  invocation: Pick<ConversationToolInvocation, "toolId" | "taskType">,
) {
  return invocation.toolId === RPG_CHOICE_STALE_EVIDENCE_TOOL_ID
    || invocation.taskType === RPG_CHOICE_STALE_EVIDENCE_TASK_TYPE;
}

export function isRpgChoiceStaleEvidenceInvocation(
  invocation: ConversationToolInvocation,
  message?: ConversationMessage,
) {
  if (
    invocation.toolId !== RPG_CHOICE_STALE_EVIDENCE_TOOL_ID
    || invocation.taskType !== RPG_CHOICE_STALE_EVIDENCE_TASK_TYPE
    || invocation.id !== invocation.taskId
    || invocation.status !== "failed"
    || invocation.actualExecutor !== null
    || invocation.modelId !== null
    || invocation.modelDigest !== null
    || invocation.executionReceipt !== null
    || invocation.externalRequest !== false
    || invocation.dataLeftDevice !== false
    || invocation.canonicalMutationCount !== 0
    || invocation.safeErrorCode !== "RPG_CHAT_CHOICES_STALE"
    || invocation.safeProgress?.stage !== RPG_CHOICE_STALE_EVIDENCE_STAGE
    || invocation.safeProgress.percent !== 100
    || invocation.safeProgress.message !== RPG_CHOICE_STALE_EVIDENCE_MESSAGE
    || !DIGEST_PATTERN.test(invocation.inputDigest)
    || !DIGEST_PATTERN.test(invocation.contextDigest)
  ) return false;
  if (!message) return true;
  return message.projectId === invocation.projectId
    && message.sessionId === invocation.sessionId
    && message.id === invocation.messageId
    && message.role === "assistant"
    && message.status === "completed"
    && message.contentDigest === invocation.inputDigest
    && rpgChoiceCardContextRevisionDigest(message.content) === invocation.contextDigest
    && message.toolInvocationIds.includes(invocation.id);
}
