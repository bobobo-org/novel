import type { ClosedAIProgressEvent } from "@/lib/novel-ai/closed-agent-os";
import type {
  Chapter,
  Character,
  ConversationArtifact,
  ConversationMessage,
  LearningImportSession,
  NovelProject,
  WorldRule,
} from "@/lib/novel-ai/domain";
import type { ConversationPlan } from "@/lib/novel-ai/conversation/planner";
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
