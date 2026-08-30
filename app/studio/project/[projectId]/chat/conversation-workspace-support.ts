import type { ClosedAIProgressEvent } from "@/lib/novel-ai/closed-agent-os";
import type {
  Chapter,
  Character,
  ConversationArtifact,
  ConversationMessage,
  ConversationToolInvocation,
  LearningImportSession,
  NovelProject,
  StoryState,
  WorldRule,
} from "@/lib/novel-ai/domain";
import type { ConversationPlan } from "@/lib/novel-ai/conversation/planner";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import { artifactStory, parseRpgChoices } from "./components/conversation-presentation";
import type { ArtifactView } from "./components/conversation-types";

export const MAX_TRANSIENT_ATTACHMENT_CONTEXT = 24_000;

export type ExistingUserRequest = {
  sessionId: string;
  userMessageId: string;
};

export function latestRpgChoicesFrom(messages: ConversationMessage[]) {
  for (const message of [...messages].reverse()) {
    const parsed = parseRpgChoices(message.content);
    if (parsed) return parsed.envelope ? { message, envelope: parsed.envelope } : null;
    if (message.role === "assistant" && message.candidateIds.length) break;
  }
  return null;
}

export type RpgChoiceRecoveryTarget = {
  sourceArtifactId: string;
  parentMessageId: string;
  reason: "missing" | "failed_or_interrupted";
};

export type RpgChoiceRecoverySnapshot = {
  chapter: Pick<Chapter, "id" | "revision"> | null;
  storyState: Pick<StoryState, "revision" | "worldFlags"> | null;
};

/**
 * Finds the one safe recovery point after an RPG turn has already been
 * approved into Canon but its following A/B/C card was never completed.
 * Recovery deliberately starts from the approved source message and never
 * replays the approval transaction.
 */
export function findRpgChoiceRecoveryTarget(
  messages: ConversationMessage[],
  artifacts: ConversationArtifact[],
  snapshot: RpgChoiceRecoverySnapshot,
  invocations: ConversationToolInvocation[] = [],
): RpgChoiceRecoveryTarget | null {
  if (snapshot.storyState?.worldFlags?.["story.arc.archived"] === true) return null;
  // A recovery must continue the chapter currently visible in Canon. An
  // approved RPG artifact from another chapter can coexist in the same
  // session, but must never become the source for this chapter's next A/B/C.
  const chapter = snapshot.chapter;
  if (!chapter) return null;

  const messageIndexById = new Map(messages.map((message, index) => [message.id, index]));
  let latestApproved: { artifact: ConversationArtifact; messageIndex: number } | null = null;
  for (const artifact of artifacts) {
    if (artifact.artifactType !== "rpg" || artifact.status !== "approved") continue;
    if (artifact.targetStore !== "chapters" || artifact.targetRecordId !== chapter.id) continue;
    const messageIndex = messageIndexById.get(artifact.sourceMessageId);
    if (messageIndex === undefined) continue;
    if (!latestApproved || messageIndex >= latestApproved.messageIndex) {
      latestApproved = { artifact, messageIndex };
    }
  }
  if (!latestApproved) return null;

  const laterCandidateExists = artifacts.some((artifact) => {
    if (artifact.artifactType !== "rpg" || artifact.status !== "candidate") return false;
    if (artifact.targetStore !== "chapters" || artifact.targetRecordId !== chapter.id) return false;
    const messageIndex = messageIndexById.get(artifact.sourceMessageId);
    return messageIndex !== undefined && messageIndex > latestApproved.messageIndex;
  });
  if (laterCandidateExists) return null;

  const laterMessages = messages.slice(latestApproved.messageIndex + 1);
  const laterMessageById = new Map(laterMessages.map((message) => [message.id, message]));
  const choicePlanInFlight = invocations.some((invocation) => {
    if (!["pending", "running"].includes(invocation.status)) return false;
    if (invocation.toolId !== CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan) return false;
    const message = laterMessageById.get(invocation.messageId);
    return Boolean(
      message
      && message.role === "assistant"
      && message.parentMessageId === latestApproved.artifact.sourceMessageId
      && ["pending", "streaming"].includes(message.status),
    );
  });
  if (choicePlanInFlight) return null;
  const completedChoicesExist = laterMessages.some((message) => {
    if (message.role !== "assistant") return false;
    if (message.parentMessageId !== latestApproved.artifact.sourceMessageId) return false;
    if (message.status !== "completed") return false;
    const envelope = parseRpgChoices(message.content)?.envelope;
    if (!envelope) return false;
    // When the live snapshot is temporarily unavailable, fail closed instead
    // of creating a second choice card from an unknown Canon revision.
    if (!snapshot.chapter || !snapshot.storyState) return true;
    return envelope.chapterId === chapter.id
      && envelope.chapterRevision === chapter.revision
      && envelope.storyStateRevision === snapshot.storyState.revision;
  });
  if (completedChoicesExist) return null;

  return {
    sourceArtifactId: latestApproved.artifact.id,
    parentMessageId: latestApproved.artifact.sourceMessageId,
    reason: laterMessages.some((message) => (
      message.role === "assistant" && ["failed", "cancelled"].includes(message.status)
    ))
      ? "failed_or_interrupted"
      : "missing",
  };
}

export function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_OPERATION_FAILED");
  }
  if ((error as { name?: string })?.name === "AbortError") return "CONVERSATION_CANCELLED";
  return "CONVERSATION_OPERATION_FAILED";
}

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "操作沒有完成；正式作品維持原狀。";
}

export function activeChapter(project: NovelProject | null, chapters: Chapter[]) {
  return chapters.find((chapter) => chapter.id === project?.activeChapterId)
    ?? [...chapters].sort((left, right) => left.order - right.order).at(-1)
    ?? null;
}

export function artifactType(plan: ConversationPlan): ConversationArtifact["artifactType"] {
  if (plan.executionKind === "rpg") return "rpg";
  if (plan.intent === "character_candidate") return "character";
  if (plan.intent === "world_rule_candidate") return "world_rule";
  if (plan.intent === "learning_rule_candidate") return "learning_rule";
  if (plan.intent === "attachment_analysis") return "attachment_analysis";
  return "novel";
}

export function targetStore(plan: ConversationPlan): ConversationArtifact["targetStore"] {
  if (plan.targetStore === "characters") return "characters";
  if (plan.targetStore === "worldRules") return "worldRules";
  if (plan.targetStore === "learningRules") return "controlledLearning";
  return plan.targetStore === "chapters" ? "chapters" : "none";
}

export function progressLabel(event: ClosedAIProgressEvent) {
  const generated = event.generatedCharacters ?? 0;
  return `${event.label}${generated ? ` · 已產生 ${generated} 字` : ""}`;
}

export async function resolveArtifactBefore({
  repository,
  artifact,
  view,
  messages,
  artifacts,
}: {
  repository: NovelRepository;
  artifact: ConversationArtifact;
  view: ArtifactView;
  messages: ConversationMessage[];
  artifacts: ConversationArtifact[];
}) {
  if (view === "comparison") {
    const sourceMessage = messages.find((message) => message.id === artifact.sourceMessageId);
    const previousArtifact = sourceMessage?.sourceMessageId
      ? [...artifacts].reverse().find((candidate) => (
        candidate.sourceMessageId === sourceMessage.sourceMessageId
        && candidate.artifactType === artifact.artifactType
        && candidate.targetStore === artifact.targetStore
        && candidate.targetRecordId === artifact.targetRecordId
      ))
      : null;
    return previousArtifact ? artifactStory(previousArtifact) : "";
  }
  if (view !== "diff") return "";
  if (artifact.targetStore === "chapters") {
    const chapter = await repository.get<Chapter>("chapters", artifact.targetRecordId);
    return chapter?.content ?? "";
  }
  if (artifact.targetStore === "characters") {
    const character = await repository.get<Character>("characters", artifact.targetRecordId);
    return character ? JSON.stringify(character, null, 2) : "";
  }
  if (artifact.targetStore === "worldRules") {
    const rule = await repository.get<WorldRule>("worldRules", artifact.targetRecordId);
    return rule?.description ?? "";
  }
  if (artifact.targetStore !== "learningImportSessions") return "";
  const importSession = await repository.get<LearningImportSession>(
    "learningImportSessions",
    artifact.targetRecordId,
  );
  return importSession ? JSON.stringify({
    status: importSession.status,
    revision: importSession.revision,
    manifestDigest: importSession.manifestDigest,
  }, null, 2) : "";
}
