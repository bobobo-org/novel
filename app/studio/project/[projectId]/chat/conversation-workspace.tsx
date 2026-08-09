"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type { ClosedAIProgressEvent } from "@/lib/novel-ai/closed-agent-os";
import { createExplicitRegenerationContract } from "@/lib/novel-ai/web/explicit-regeneration";
import {
  type Chapter,
  type Character,
  type ConversationArtifact,
  type ConversationAttachment,
  type ConversationExecutionReceipt,
  type ConversationMessage,
  type ConversationSession,
  type ConversationSummary,
  type ConversationToolInvocation,
  type LearningImportSession,
  type NovelProject,
  type StoryBible,
  type StoryState,
  type WorldRule,
} from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  createProjectBackup,
  markdownDownload,
} from "@/lib/novel-ai/repository/backup";
import { createSovereignLearningRepository } from "@/lib/novel-ai/sovereign-learning";
import {
  conversationContentDigest,
  conversationCanonicalRecordDigest,
} from "@/lib/novel-ai/conversation/approval-transaction";
import {
  buildConversationCanonicalReplacement,
  resolveConversationCanonicalTarget,
} from "@/lib/novel-ai/conversation/canonical-target";
import {
  createConversationAttachmentRecord,
} from "@/lib/novel-ai/conversation/attachments";
import {
  AtomicLearningImportCoordinator,
} from "@/lib/novel-ai/conversation/learning-import";
import {
  planConversationRequest,
  type ConversationPlan,
} from "@/lib/novel-ai/conversation/planner";
import {
  assertConversationPlannerToolAllowed,
  CONVERSATION_LOCAL_TOOL_IDS,
} from "@/lib/novel-ai/conversation/tool-registry";
import {
  ConversationRepositoryService,
} from "@/lib/novel-ai/conversation/repository";
import {
  extractManualLearningFile,
  validateManualLearningBatch,
  type ManualLearningFileExtraction,
  type ManualLearningFileProgress,
} from "@/lib/novel-ai/web/manual-learning-file";
import { conversationCanonRevisionDigest } from "@/lib/novel-ai/web/project-context-composer";
import {
  approveStudioClosedAgentCandidate,
  executeStudioClosedAgent,
  rejectStudioClosedAgentCandidate,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import {
  approveRpgChatTurn,
  buildRpgChatCustomAction,
  generateRpgChatTurnCandidate,
  loadRpgChatSnapshot,
  parseRpgChoiceSelection,
  planRpgChatChoices,
  type RpgChatChoicePlan,
  type RpgChatTurnCandidate,
} from "@/lib/novel-ai/web/rpg-chat-turn";
import styles from "./conversation.module.css";

const RPG_CHOICES_PREFIX = "[[NOVEL_RPG_CHOICES_V1]]\n";
const MAX_TRANSIENT_ATTACHMENT_CONTEXT = 24_000;

type LocalAttachment = {
  localId: string;
  file: File;
  record: ConversationAttachment | null;
  extraction: ManualLearningFileExtraction | null;
  progress: ManualLearningFileProgress | null;
  status: "queued" | "parsing" | "completed" | "failed" | "cancelled" | "ocr_required";
  errorCode: string | null;
};

type RpgChoiceEnvelope = {
  schemaVersion: "conversation-rpg-choices-v1";
  chapterId: string;
  chapterRevision: number;
  storyStateRevision: number;
  plan: RpgChatChoicePlan;
};

type RpgChoiceKey = "A" | "B" | "C";

type RpgDisplayChoice = {
  key: RpgChoiceKey;
  strategyLabel: string;
  title: string;
  description: string;
  displayedChanceBand: string;
  risk: 1 | 2 | 3 | 4 | 5;
  knownCosts: Array<{ label: string }>;
  consequenceTeaser: string;
  irreversibleWarning: string | null;
  disabledReason: string | null;
};

type ParsedRpgChoices = {
  envelope: RpgChoiceEnvelope | null;
  choices: RpgDisplayChoice[];
};

type DrawerPayload =
  | { kind: "artifact"; artifactId: string }
  | { kind: "status"; title: string; content: string }
  | { kind: "attachments"; title: string; content: string }
  | null;

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_OPERATION_FAILED");
  }
  if ((error as { name?: string })?.name === "AbortError") return "CONVERSATION_CANCELLED";
  return "CONVERSATION_OPERATION_FAILED";
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "操作沒有完成；正式作品維持原狀。";
}

function formatTime(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? "時間未記錄"
    : time.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

function activeChapter(project: NovelProject | null, chapters: Chapter[]) {
  return chapters.find((chapter) => chapter.id === project?.activeChapterId)
    ?? [...chapters].sort((left, right) => left.order - right.order).at(-1)
    ?? null;
}

function messageLabel(role: ConversationMessage["role"]) {
  if (role === "user") return "你";
  if (role === "assistant") return "小說專案助手";
  if (role === "tool") return "本機工具";
  return "系統通知";
}

function statusLabel(status: ConversationMessage["status"]) {
  const labels: Record<ConversationMessage["status"], string> = {
    pending: "等待執行",
    streaming: "產生中",
    completed: "已完成",
    failed: "未完成",
    cancelled: "已停止",
  };
  return labels[status];
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isExecutableRpgChoice(value: unknown): value is RpgChatChoicePlan["choices"][number] {
  const choice = objectValue(value);
  if (!choice) return false;
  return typeof choice.id === "string"
    && ["A", "B", "C"].includes(String(choice.key))
    && typeof choice.approach === "string"
    && typeof choice.primaryStat === "string"
    && typeof choice.secondaryStat === "string"
    && typeof choice.successChance === "number"
    && typeof choice.internalSuccessChance === "number"
    && typeof choice.risk === "number"
    && Array.isArray(choice.requirements)
    && Array.isArray(choice.missingRequirements)
    && Array.isArray(choice.knownCosts)
    && Array.isArray(choice.costLabels)
    && Array.isArray(choice.impactLabels)
    && Array.isArray(choice.delayedConsequenceRefs)
    && Boolean(objectValue(choice.effect))
    && Boolean(objectValue(choice.immediateEffect))
    && Boolean(objectValue(choice.failureEffect))
    && Boolean(objectValue(choice.partialSuccessEffect))
    && Boolean(objectValue(choice.successEffect))
    && Boolean(objectValue(choice.criticalSuccessEffect))
    && Boolean(objectValue(choice.sourceSnapshot))
    && Boolean(objectValue(choice.encounter));
}

function parseRpgChoices(value: string): ParsedRpgChoices | null {
  if (!value.startsWith(RPG_CHOICES_PREFIX)) return null;
  try {
    const parsed = objectValue(JSON.parse(value.slice(RPG_CHOICES_PREFIX.length)));
    const plan = objectValue(parsed?.plan);
    const rawChoices = Array.isArray(plan?.choices) ? plan.choices : [];
    if (parsed?.schemaVersion !== "conversation-rpg-choices-v1" || rawChoices.length !== 3) {
      return null;
    }
    const rows = rawChoices.map((value, index) => {
      const choice = objectValue(value);
      const key = choice?.key === "A" || choice?.key === "B" || choice?.key === "C"
        ? choice.key
        : null;
      if (!choice || !key) return null;
      const executable = isExecutableRpgChoice(choice);
      const fallbackRisk = [1, 3, 5][index] as 1 | 3 | 5;
      const numericRisk = Number(choice.risk);
      const risk = Math.max(1, Math.min(5, Number.isFinite(numericRisk) ? Math.round(numericRisk) : fallbackRisk)) as 1 | 2 | 3 | 4 | 5;
      const knownCosts = Array.isArray(choice.knownCosts)
        ? choice.knownCosts.flatMap((cost) => {
          const label = nullableText(objectValue(cost)?.label);
          return label ? [{ label }] : [];
        })
        : [];
      return {
        key,
        strategyLabel: nonEmptyText(choice.strategyLabel, ["穩健／觀察", "資源／關係", "高風險／突破"][index]),
        title: nonEmptyText(choice.title, `選項 ${key}`),
        description: nonEmptyText(choice.description, "這是舊版保存的故事選項。"),
        displayedChanceBand: nonEmptyText(choice.displayedChanceBand, "舊版未記錄機率"),
        risk,
        knownCosts,
        consequenceTeaser: nonEmptyText(choice.consequenceTeaser, nonEmptyText(choice.consequence, "部分後果仍未知。")),
        irreversibleWarning: nullableText(choice.irreversibleWarning),
        disabledReason: executable
          ? nullableText(choice.disabledReason)
          : "舊版選項僅供查看，請重新產生本回合。",
      } satisfies RpgDisplayChoice;
    });
    if (rows.some((choice) => !choice)) return null;
    const choices = rows as RpgDisplayChoice[];
    if (new Set(choices.map((choice) => choice.key)).size !== 3) return null;
    const executable = rawChoices.every(isExecutableRpgChoice)
      && typeof parsed.chapterId === "string"
      && Number.isInteger(parsed.chapterRevision)
      && Number.isInteger(parsed.storyStateRevision)
      && plan?.schemaVersion === "rpg-chat-turn-v1"
      && typeof plan.candidateId === "string";
    return {
      envelope: executable ? parsed as unknown as RpgChoiceEnvelope : null,
      choices,
    };
  } catch {
    return null;
  }
}

function serializeRpgChoices(input: RpgChoiceEnvelope) {
  return `${RPG_CHOICES_PREFIX}${JSON.stringify(input)}`;
}

function parseRpgCandidate(artifact: ConversationArtifact) {
  if (artifact.artifactType !== "rpg") return null;
  try {
    const parsed = JSON.parse(artifact.candidateContent) as {
      schemaVersion?: string;
      candidate?: RpgChatTurnCandidate;
    };
    return parsed.schemaVersion === "conversation-rpg-candidate-v1" && parsed.candidate
      ? parsed.candidate
      : null;
  } catch {
    return null;
  }
}

function parseLearningImportCandidate(artifact: ConversationArtifact) {
  if (artifact.artifactType !== "learning_rule") return null;
  try {
    const parsed = JSON.parse(artifact.candidateContent) as {
      schemaVersion?: string;
      importSessionId?: string;
      manifestDigest?: string;
      totalParts?: number;
      completedParts?: number;
      globalSynthesis?: unknown;
      rawContentRetained?: boolean;
      dataLeftDevice?: boolean;
    };
    return parsed.schemaVersion === "conversation-learning-import-candidate-v1"
      && parsed.importSessionId
      && parsed.manifestDigest
      && parsed.rawContentRetained === false
      && parsed.dataLeftDevice === false
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function artifactStory(artifact: ConversationArtifact) {
  const learningCandidate = parseLearningImportCandidate(artifact);
  if (learningCandidate) {
    return [
      `整份匯入候選：${learningCandidate.completedParts ?? 0}/${learningCandidate.totalParts ?? 0} 部分已完成`,
      "正式學習庫尚未修改；採用後才會原子提交抽象規則。",
      JSON.stringify(learningCandidate.globalSynthesis, null, 2),
    ].join("\n\n");
  }
  return parseRpgCandidate(artifact)?.story ?? artifact.candidateContent;
}

function applicationMode(plan: ConversationPlan) {
  if (plan.intent === "rewrite_selection") return "replace" as const;
  if (plan.intent === "chapter_outline") return "summary" as const;
  return "append" as const;
}

function artifactType(plan: ConversationPlan): ConversationArtifact["artifactType"] {
  if (plan.executionKind === "rpg") return "rpg";
  if (plan.intent === "character_candidate") return "character";
  if (plan.intent === "world_rule_candidate") return "world_rule";
  if (plan.intent === "learning_rule_candidate") return "learning_rule";
  if (plan.intent === "attachment_analysis") return "attachment_analysis";
  return "novel";
}

function targetStore(plan: ConversationPlan): ConversationArtifact["targetStore"] {
  if (plan.targetStore === "characters") return "characters";
  if (plan.targetStore === "worldRules") return "worldRules";
  if (plan.targetStore === "learningRules") return "controlledLearning";
  return plan.targetStore === "chapters" ? "chapters" : "none";
}

function progressLabel(event: ClosedAIProgressEvent) {
  const generated = event.generatedCharacters ?? 0;
  return `${event.label}${generated ? ` · 已產生 ${generated} 字` : ""}`;
}

function toExecutionReceipt(input: {
  taskId: string;
  modelId: string | null;
  modelDigest: string | null;
  contextDigest: string;
  outputDigest: string | null;
  externalRequest: boolean;
  dataLeftDevice: boolean;
  receipt?: {
    startedAt?: string;
    completedAt?: string;
    browserComputeReceiptId?: string;
    browserFabricReceiptId?: string;
  } | null;
}): ConversationExecutionReceipt {
  const started = input.receipt?.startedAt ? Date.parse(input.receipt.startedAt) : Number.NaN;
  const completed = input.receipt?.completedAt ? Date.parse(input.receipt.completedAt) : Number.NaN;
  return {
    receiptId: input.receipt?.browserComputeReceiptId
      ?? input.receipt?.browserFabricReceiptId
      ?? `conversation-receipt:${input.taskId}`,
    modelId: input.modelId,
    modelDigest: input.modelDigest,
    providerRunId: input.taskId,
    contextDigest: input.contextDigest,
    outputDigest: input.outputDigest,
    externalRequest: input.externalRequest,
    dataLeftDevice: input.dataLeftDevice,
    latencyMs: Number.isFinite(started) && Number.isFinite(completed)
      ? Math.max(0, completed - started)
      : null,
  };
}

async function acquireConversationLease(projectId: string, sessionId: string) {
  if (typeof navigator === "undefined" || !navigator.locks) return () => undefined;
  const lockName = `novel:conversation-operation:${projectId}:${sessionId}`;
  return new Promise<(() => void) | null>((resolve) => {
    let resolved = false;
    void navigator.locks.request(
      lockName,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          resolved = true;
          resolve(null);
          return;
        }
        await new Promise<void>((release) => {
          let released = false;
          resolved = true;
          resolve(() => {
            if (released) return;
            released = true;
            release();
          });
        });
      },
    ).catch(() => {
      if (!resolved) resolve(null);
    });
  });
}

export default function ConversationWorkspace({
  projectId,
  initialPrompt,
}: {
  projectId: string;
  initialPrompt: string;
}) {
  const repository = useMemo(() => createNovelRepository(), []);
  const learningRepository = useMemo(
    () => createSovereignLearningRepository(),
    [],
  );
  const conversation = useMemo(
    () => new ConversationRepositoryService(repository, learningRepository),
    [learningRepository, repository],
  );
  const learning = useMemo(
    () => new AtomicLearningImportCoordinator(
      repository,
      learningRepository,
    ),
    [learningRepository, repository],
  );
  const [project, setProject] = useState<NovelProject | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [artifacts, setArtifacts] = useState<ConversationArtifact[]>([]);
  const [invocations, setInvocations] = useState<ConversationToolInvocation[]>([]);
  const [attachments, setAttachments] = useState<ConversationAttachment[]>([]);
  const [localAttachments, setLocalAttachments] = useState<LocalAttachment[]>([]);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancellable, setCancellable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState("正在讀取作品對話。");
  const [safeError, setSafeError] = useState<{ code: string; message: string } | null>(null);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [retryLabel, setRetryLabel] = useState("重試");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerPayload>(null);
  const [artifactDraft, setArtifactDraft] = useState("");
  const [artifactView, setArtifactView] = useState<"candidate" | "diff" | "comparison">("candidate");
  const [artifactBefore, setArtifactBefore] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const operationLockRef = useRef(false);
  const rpgTurnLocksRef = useRef(new Set<string>());
  const retryActionRef = useRef<(() => void) | null>(null);
  const reconciledSessionIdsRef = useRef(new Set<string>());
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const initialPromptUsed = useRef(false);
  const currentChapter = activeChapter(project, chapters);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  const refreshSession = useCallback(async (sessionId: string) => {
    let [nextMessages, nextArtifacts, nextInvocations, nextAttachments] = await Promise.all([
      conversation.listMessages(projectId, sessionId),
      conversation.listArtifacts(projectId, sessionId),
      conversation.listToolInvocations(projectId, sessionId),
      conversation.listAttachments(projectId, sessionId),
    ]);
    const interruptedInvocations = nextInvocations.filter((invocation) =>
      ["pending", "running"].includes(invocation.status));
    const interruptedMessages = nextMessages.filter((message) =>
      ["pending", "streaming"].includes(message.status));
    if (
      (interruptedInvocations.length || interruptedMessages.length)
      && !operationLockRef.current
      && !reconciledSessionIdsRef.current.has(sessionId)
    ) {
      const releaseLease = await acquireConversationLease(projectId, sessionId);
      if (releaseLease) try {
      [nextMessages, nextArtifacts, nextInvocations, nextAttachments] = await Promise.all([
        conversation.listMessages(projectId, sessionId),
        conversation.listArtifacts(projectId, sessionId),
        conversation.listToolInvocations(projectId, sessionId),
        conversation.listAttachments(projectId, sessionId),
      ]);
      const orphanedInvocations = nextInvocations.filter((invocation) =>
        ["pending", "running"].includes(invocation.status));
      const orphanedMessages = nextMessages.filter((message) =>
        ["pending", "streaming"].includes(message.status));
      await Promise.all(orphanedInvocations.map((invocation) =>
        conversation.updateToolInvocationStatus({
          projectId,
          sessionId,
          invocationId: invocation.id,
          expectedRevision: invocation.revision,
          status: "failed",
          safeErrorCode: "CONVERSATION_RELOAD_INTERRUPTED",
          canonicalMutationCount: 0,
          safeProgress: {
            stage: "interrupted",
            percent: 0,
            message: "頁面重新載入後已安全停止；可按重試重新執行。",
          },
        }).catch(() => invocation)));
      await Promise.all(orphanedMessages.map((message) =>
        conversation.updateMessageStatus({
          projectId,
          sessionId,
          messageId: message.id,
          expectedRevision: message.revision,
          status: "cancelled",
          content: "頁面重新載入後已安全停止這次生成；Canon 維持原狀，可按重試重新執行。",
        }).catch(() => message)));
      [nextMessages, nextArtifacts, nextInvocations, nextAttachments] = await Promise.all([
        conversation.listMessages(projectId, sessionId),
        conversation.listArtifacts(projectId, sessionId),
        conversation.listToolInvocations(projectId, sessionId),
        conversation.listAttachments(projectId, sessionId),
      ]);
      } finally {
        reconciledSessionIdsRef.current.add(sessionId);
        releaseLease();
      }
    } else if (!interruptedInvocations.length && !interruptedMessages.length) {
      reconciledSessionIdsRef.current.add(sessionId);
    }
    await Promise.all(nextArtifacts
      .filter((artifact) => artifact.artifactType === "learning_rule" && artifact.status === "candidate")
      .map(async (artifact) => {
        const importSession = await repository.get<LearningImportSession>(
          "learningImportSessions",
          artifact.targetRecordId,
        );
        const staging = await learningRepository.getImportStaging(artifact.targetRecordId);
        if (importSession?.status === "committed" && staging?.formalCommit) {
          await learning.rollbackPendingApproval(projectId, artifact.targetRecordId);
          const currentArtifact = await repository.get<ConversationArtifact>(
            "conversationArtifacts",
            artifact.id,
          );
          if (currentArtifact?.status === "candidate") {
            await conversation.rejectArtifact(
              projectId,
              currentArtifact.sessionId,
              currentArtifact.id,
              currentArtifact.revision,
            );
          }
        }
      }));
    nextArtifacts = await conversation.listArtifacts(projectId, sessionId);
    await Promise.all(nextArtifacts
      .filter((artifact) => artifact.artifactType === "learning_rule" && artifact.status === "approved")
      .map((artifact) => learning.releaseFinalizedStaging(
        projectId,
        artifact.targetRecordId,
      ).catch(() => undefined)));
    setMessages(nextMessages);
    setArtifacts(nextArtifacts.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)));
    setInvocations(nextInvocations.sort((left, right) =>
      left.startedAt.localeCompare(right.startedAt)));
    setAttachments(nextAttachments);
  }, [conversation, learning, learningRepository, projectId, repository]);

  const loadWorkspace = useCallback(async (preferredSessionId = "") => {
    setLoading(true);
    setSafeError(null);
    try {
      const [loadedProject, loadedChapters] = await Promise.all([
        repository.get<NovelProject>("projects", projectId),
        repository.list<Chapter>("chapters", projectId),
      ]);
      if (!loadedProject || loadedProject.deletedAt) {
        throw Object.assign(new Error("找不到這個小說專案。"), {
          code: "CONVERSATION_PROJECT_NOT_FOUND",
        });
      }
      let nextSessions = await conversation.listSessions(projectId, {
        includeArchived: showArchived,
      });
      if (!nextSessions.length && !showArchived) {
        const allProjectSessions = await repository.list<ConversationSession>(
          "conversationSessions",
          projectId,
        );
        const created = await conversation.createSession({
          projectId,
          sessionId: allProjectSessions.length
            ? `conversation-session:${projectId}:recovery:${allProjectSessions.length}`
            : `conversation-session:${projectId}:primary`,
          title: "主要對話",
          activeChapterId: activeChapter(loadedProject, loadedChapters)?.id ?? null,
        });
        nextSessions = [created];
      }
      const remembered = typeof window === "undefined"
        ? ""
        : window.sessionStorage.getItem(`novel:conversation-active:${projectId}`) ?? "";
      const selected = nextSessions.find((session) =>
        session.id === (preferredSessionId || remembered))
        ?? nextSessions[0]
        ?? null;
      setProject(loadedProject);
      setChapters([...loadedChapters].sort((left, right) => left.order - right.order));
      setSessions(nextSessions);
      setActiveSessionId(selected?.id ?? "");
      if (selected) {
        window.sessionStorage.setItem(`novel:conversation-active:${projectId}`, selected.id);
        await refreshSession(selected.id);
      } else {
        setMessages([]);
        setArtifacts([]);
        setInvocations([]);
        setAttachments([]);
      }
      setProgress("對話、核准記憶與目前章節已同步。");
    } catch (error) {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [conversation, projectId, refreshSession, repository, showArchived]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    if (initialPromptUsed.current || !initialPrompt) return;
    initialPromptUsed.current = true;
    const timer = window.setTimeout(() => setDraft(initialPrompt), 0);
    return () => window.clearTimeout(timer);
  }, [initialPrompt]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      threadEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, artifacts, progress]);

  useEffect(() => () => abortRef.current?.abort("CONVERSATION_UNMOUNTED"), []);

  const latestRpgChoices = (() => {
    for (const message of [...messages].reverse()) {
      const parsed = parseRpgChoices(message.content);
      if (parsed) return parsed.envelope ? { message, envelope: parsed.envelope } : null;
      if (message.role === "assistant" && message.candidateIds.length) break;
    }
    return null;
  })();

  const visibleSessions = useMemo(() => {
    const query = search.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
    if (!query) return sessions;
    return sessions.filter((session) =>
      session.title.normalize("NFKC").toLocaleLowerCase("zh-TW").includes(query));
  }, [search, sessions]);

  async function chooseSession(sessionId: string) {
    if (busy || sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    window.sessionStorage.setItem(`novel:conversation-active:${projectId}`, sessionId);
    setSidebarOpen(false);
    await refreshSession(sessionId);
  }

  async function newSession() {
    if (busy || !project) return;
    const created = await conversation.createSession({
      projectId,
      title: "新對話",
      activeChapterId: currentChapter?.id ?? null,
    });
    await loadWorkspace(created.id);
    setSidebarOpen(false);
  }

  async function renameSession(session: ConversationSession) {
    const title = window.prompt("重新命名這個對話", session.title)?.trim();
    if (!title || title === session.title) return;
    await conversation.renameSession(projectId, session.id, title, session.revision);
    await loadWorkspace(session.id);
  }

  async function archiveSession(session: ConversationSession) {
    if (!window.confirm(`封存「${session.title}」？對話會保留，可稍後顯示封存項目。`)) return;
    await conversation.archiveSession(projectId, session.id, session.revision);
    await loadWorkspace();
  }

  async function deleteSession(session: ConversationSession) {
    if (!window.confirm(`刪除「${session.title}」？這只刪除對話，不會刪除小說 Canon。`)) return;
    await conversation.deleteSession(projectId, session.id, session.revision);
    await loadWorkspace();
  }

  async function createBranch(message: ConversationMessage, editedContent?: string) {
    if (!activeSession || busy) return;
    const branched = await conversation.branchSession({
      projectId,
      sourceSessionId: activeSession.id,
      fromMessageId: message.id,
      title: `${activeSession.title} · 分支`,
    });
    if (editedContent?.trim()) {
      await conversation.appendMessage({
        projectId,
        sessionId: branched.session.id,
        role: "user",
        content: editedContent.trim(),
        sourceMessageId: message.id,
        parentMessageId: branched.messages.at(-1)?.id ?? null,
      });
    }
    await loadWorkspace(branched.session.id);
  }

  async function editMessage(message: ConversationMessage) {
    const edited = window.prompt("編輯後會建立新分支，原對話完整保留。", message.content);
    if (!edited?.trim() || edited.trim() === message.content.trim()) return;
    const branched = await conversation.editMessageWithBranch({
      projectId,
      sessionId: message.sessionId,
      messageId: message.id,
      content: edited.trim(),
      title: `${activeSession?.title ?? "對話"} · 編輯分支`,
    });
    await loadWorkspace(branched.session.id);
  }

  function clearTransientAttachments() {
    setLocalAttachments((current) => current.map((item) => {
      if (item.extraction) item.extraction.text = "";
      return { ...item, extraction: null };
    }).filter((item) => item.status !== "completed"));
  }

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    try {
      validateManualLearningBatch(files);
      setSafeError(null);
      setRightsConfirmed(false);
      setLocalAttachments(files.map((file) => ({
        localId: crypto.randomUUID(),
        file,
        record: null,
        extraction: null,
        progress: null,
        status: "queued",
        errorCode: null,
      })));
    } catch (error) {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
    }
  }

  function updateLocalAttachment(localId: string, patch: Partial<LocalAttachment>) {
    setLocalAttachments((current) => current.map((item) =>
      item.localId === localId ? { ...item, ...patch } : item));
  }

  async function runDeterministicConversationTool<T>(input: {
    sessionId: string;
    parentMessageId: string | null;
    sourceMessageId?: string | null;
    messageRole?: "assistant" | "tool";
    idPrefix: string;
    toolId: string;
    taskType: string;
    inputDigest: string;
    contextDigest: string;
    actualExecutor: string;
    modelId?: string | null;
    modelDigest?: string | null;
    runningMessage: string;
    completedMessage: string;
    signal: AbortSignal;
    execute: () => Promise<{ result: T; assistantContent: string; receiptOutput?: string }>;
  }) {
    assertConversationPlannerToolAllowed(input.toolId);
    const attemptId = crypto.randomUUID();
    let message: ConversationMessage | null = null;
    let invocation: ConversationToolInvocation | null = null;
    try {
      message = await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        messageId: `${input.idPrefix}:message:${attemptId}`,
        role: input.messageRole ?? "assistant",
        content: "",
        status: "streaming",
        parentMessageId: input.parentMessageId,
        sourceMessageId: input.sourceMessageId ?? null,
      });
      const taskId = `${input.idPrefix}:task:${attemptId}`;
      invocation = await conversation.saveToolInvocation({
        projectId,
        sessionId: input.sessionId,
        messageId: message.id,
        invocationId: `${input.idPrefix}:invocation:${attemptId}`,
        taskId,
        toolId: input.toolId,
        taskType: input.taskType,
        inputDigest: input.inputDigest,
        contextDigest: input.contextDigest,
        status: "running",
        actualExecutor: input.actualExecutor,
        modelId: input.modelId ?? null,
        modelDigest: input.modelDigest ?? null,
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "running", percent: 1, message: input.runningMessage },
      });
      if (input.signal.aborted) {
        throw Object.assign(new Error("Conversation operation cancelled."), {
          code: "CONVERSATION_CANCELLED",
        });
      }
      const executed = await input.execute();
      const outputDigest = await conversationContentDigest(
        executed.receiptOutput ?? executed.assistantContent,
      );
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: input.actualExecutor,
        modelId: input.modelId ?? null,
        modelDigest: input.modelDigest ?? null,
        executionReceipt: toExecutionReceipt({
          taskId: invocation.taskId,
          modelId: input.modelId ?? null,
          modelDigest: input.modelDigest ?? null,
          contextDigest: invocation.contextDigest,
          outputDigest,
          externalRequest: false,
          dataLeftDevice: false,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "completed", percent: 100, message: input.completedMessage },
      });
      const currentMessage = await repository.get<ConversationMessage>("conversationMessages", message.id);
      if (!currentMessage) throw new Error("CONVERSATION_MESSAGE_MISSING");
      message = await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: currentMessage.id,
        expectedRevision: currentMessage.revision,
        status: "completed",
        content: executed.assistantContent,
        toolInvocationIds: currentMessage.toolInvocationIds,
      });
      return { ...executed, message, invocation };
    } catch (error) {
      const status = input.signal.aborted ? "cancelled" as const : "failed" as const;
      if (message) {
        const currentMessage = await repository.get<ConversationMessage>("conversationMessages", message.id);
        if (currentMessage && ["pending", "streaming"].includes(currentMessage.status)) {
          await conversation.updateMessageStatus({
            projectId,
            sessionId: input.sessionId,
            messageId: currentMessage.id,
            expectedRevision: currentMessage.revision,
            status,
            content: `本機工具未完成：${errorCode(error)}。Canon 維持原狀。`,
          }).catch(() => undefined);
        }
      }
      if (invocation) {
        const currentInvocation = await repository.get<ConversationToolInvocation>(
          "conversationToolInvocations",
          invocation.id,
        );
        if (currentInvocation && ["pending", "running"].includes(currentInvocation.status)) {
          await conversation.updateToolInvocationStatus({
            projectId,
            sessionId: input.sessionId,
            invocationId: currentInvocation.id,
            expectedRevision: currentInvocation.revision,
            status,
            safeErrorCode: errorCode(error),
            canonicalMutationCount: 0,
          }).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async function prepareLocalAttachments(
    sessionId: string,
    plan: ConversationPlan,
    userMessageId: string,
    signal: AbortSignal,
  ) {
    const contextDigest = await conversationContentDigest(JSON.stringify({
      schemaVersion: "conversation-attachment-batch-v1",
      planDigest: plan.planDigest,
      files: localAttachments.map(({ file }) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      })),
    }));
    const parserModelDigest = await conversationContentDigest("manual-learning-local-parser-v1");
    const operation = await runDeterministicConversationTool({
      sessionId,
      parentMessageId: userMessageId,
      sourceMessageId: userMessageId,
      messageRole: "tool",
      idPrefix: "conversation-attachment-parse",
      toolId: CONVERSATION_LOCAL_TOOL_IDS.attachmentParse,
      taskType: "attachment.parse.batch",
      inputDigest: plan.inputDigest,
      contextDigest,
      actualExecutor: "browser-main-thread",
      modelId: "manual-learning-local-parser-v1",
      modelDigest: parserModelDigest,
      runningMessage: "正在裝置內解析附件",
      completedMessage: "附件批次解析已完成，Canon 未修改",
      signal,
      execute: async () => {
        const prepared: Array<{
          record: ConversationAttachment;
          extraction: ManualLearningFileExtraction;
        }> = [];
        for (const item of localAttachments) {
          if (signal.aborted) throw Object.assign(new Error("附件處理已停止。"), { code: "LEARNING_FILE_CANCELLED" });
          updateLocalAttachment(item.localId, { status: "parsing", errorCode: null });
          let record: ConversationAttachment | null = null;
          try {
            record = await createConversationAttachmentRecord({
              projectId,
              sessionId,
              file: item.file,
              rightsBasis: "user_supplied_local_analysis",
              rightsEvidence: "composer-local-analysis-only",
              signal,
            });
            record = await repository.put<ConversationAttachment>("conversationAttachments", {
              ...record,
              parsingStatus: "parsing" as const,
            });
            updateLocalAttachment(item.localId, { record });
            const extraction = await extractManualLearningFile(item.file, {
              signal,
              onProgress: (fileProgress) => updateLocalAttachment(item.localId, {
                progress: fileProgress,
              }),
            });
            const parsingRecord = record;
            const completedRecord = await repository.put<ConversationAttachment>("conversationAttachments", {
              ...parsingRecord,
              parsingStatus: "completed" as const,
              warnings: extraction.warnings,
            }, parsingRecord.revision);
            record = completedRecord;
            prepared.push({ record: completedRecord, extraction });
            updateLocalAttachment(item.localId, {
              record,
              extraction,
              status: "completed",
              progress: null,
            });
          } catch (error) {
            const code = errorCode(error);
            const parsingStatus = signal.aborted || code === "LEARNING_FILE_CANCELLED"
              ? "cancelled" as const
              : code === "OCR_REQUIRED"
                ? "ocr_required" as const
                : "failed" as const;
            if (record) {
              await repository.put("conversationAttachments", {
                ...record,
                parsingStatus,
              }, record.revision).catch(() => undefined);
            }
            updateLocalAttachment(item.localId, {
              status: parsingStatus,
              errorCode: code,
              progress: null,
            });
            if (signal.aborted) throw error;
          }
        }
        if (!prepared.length && localAttachments.length) {
          throw Object.assign(new Error("所有附件都未能完成本機解析。"), {
            code: "CONVERSATION_ATTACHMENTS_ALL_FAILED",
          });
        }
        return {
          result: prepared,
          assistantContent: `已在裝置內解析 ${prepared.length}/${localAttachments.length} 個附件；原始內容只保留於本次工作記憶體，未離開裝置，也未寫入 Canon。`,
        };
      },
    });
    return operation.result;
  }

  async function currentCanonRevisionDigest() {
    const loadedProject = await repository.get<NovelProject>("projects", projectId);
    if (!loadedProject) throw new Error("CONVERSATION_PROJECT_NOT_FOUND");
    const [loadedChapters, storyBible, storyState] = await Promise.all([
      repository.list<Chapter>("chapters", projectId),
      repository.get<StoryBible>("storyBibles", loadedProject.storyBibleId),
      repository.get<StoryState>("storyStates", loadedProject.storyStateId),
    ]);
    return conversationCanonRevisionDigest({
      project: loadedProject,
      activeChapter: activeChapter(loadedProject, loadedChapters),
      storyBible,
      storyState,
    });
  }

  async function maybeUpdateRollingSummary(sessionId: string) {
    const sessionMessages = await conversation.listMessages(projectId, sessionId);
    const olderMessages = sessionMessages.slice(0, Math.max(0, sessionMessages.length - 12));
    if (olderMessages.length < 6) return null;
    const canonRevisionDigest = await currentCanonRevisionDigest();
    const existing = (await repository.list<ConversationSummary>("conversationSummaries", projectId))
      .find((summary) => summary.sessionId === sessionId && !summary.invalidatedAt && !summary.deletedAt);
    if (
      existing
      && existing.canonRevisionDigest === canonRevisionDigest
      && existing.sourceMessageIds.length === olderMessages.length
      && existing.sourceMessageIds.every((id, index) => id === olderMessages[index]?.id)
    ) {
      return existing;
    }
    const excerpts = olderMessages.slice(-18).map((message) => {
      const label = message.role === "user"
        ? "使用者"
        : message.role === "assistant"
          ? "助手候選"
          : "工具狀態";
      const compact = message.content.replace(/\s+/gu, " ").trim().slice(0, 260);
      return `${label}：${compact}`;
    });
    return conversation.upsertSummary({
      projectId,
      sessionId,
      sourceMessageIds: olderMessages.map((message) => message.id),
      content: [
        `這是同一小說專案、同一 Session 較早 ${olderMessages.length} 則訊息的非 Canon 滾動摘要。`,
        "未採用的助手內容只代表候選，不得當成正式作品事實。",
        ...excerpts,
      ].join("\n").slice(0, 6_000),
      canonRevisionDigest,
    });
  }

  async function runRepositoryAction(input: {
    plan: ConversationPlan;
    sessionId: string;
    userMessage: ConversationMessage;
    signal: AbortSignal;
  }) {
    const action = input.plan.intent === "backup_create"
      ? {
          idPrefix: "conversation-backup-create",
          toolId: CONVERSATION_LOCAL_TOOL_IDS.backupCreate,
          taskType: "repository.backup.create",
          runningMessage: "正在建立本機完整備份",
          completedMessage: "本機備份已完成，Canon 未修改",
        }
      : input.plan.intent === "project_export"
        ? {
            idPrefix: "conversation-project-export",
            toolId: CONVERSATION_LOCAL_TOOL_IDS.projectExport,
            taskType: "repository.project.export",
            runningMessage: "正在從本機 Canon 建立 Markdown 匯出",
            completedMessage: "Markdown 匯出已完成，Canon 未修改",
          }
        : {
            idPrefix: "conversation-backup-restore-guide",
            toolId: CONVERSATION_LOCAL_TOOL_IDS.backupRestoreGuide,
            taskType: "repository.backup.restore-guide",
            runningMessage: "正在開啟備份回復說明",
            completedMessage: "備份回復說明已開啟，Canon 未修改",
          };
    await runDeterministicConversationTool({
      sessionId: input.sessionId,
      parentMessageId: input.userMessage.id,
      ...action,
      inputDigest: input.plan.inputDigest,
      contextDigest: input.plan.planDigest,
      actualExecutor: "browser-main-thread",
      signal: input.signal,
      execute: async () => {
        if (!project) throw new Error("CONVERSATION_PROJECT_NOT_FOUND");
        if (input.plan.intent === "backup_create") {
          const created = await createProjectBackup(repository, projectId, "full", {
            sovereignLearningRepository: learningRepository,
          });
          return {
            result: undefined,
            assistantContent: `已建立本機完整備份。語意雜湊：${created.payload.manifest.contentHash.slice(0, 16)}…`,
          };
        }
        if (input.plan.intent === "project_export") {
          const records = await repository.exportProject(projectId);
          markdownDownload(records, project.title);
          return {
            result: undefined,
            assistantContent: "作品已從本機 Canon 匯出為 Markdown；對話原始附件不在匯出內容中。",
          };
        }
        setDrawer({
          kind: "status",
          title: "回復備份",
          content: "回復會驗證 schema、語意雜湊、作品隔離與版本。請在進階備份工作區選擇檔案；驗證失敗時不會部分還原。",
        });
        setArtifactOpen(true);
        return {
          result: undefined,
          assistantContent: "已打開備份回復說明；正式回復仍需你選取備份檔並再次確認。",
        };
      },
    });
  }

  async function runDashboardQuery(input: {
    plan: ConversationPlan;
    sessionId: string;
    userMessage: ConversationMessage;
    signal: AbortSignal;
  }) {
    await runDeterministicConversationTool({
      sessionId: input.sessionId,
      parentMessageId: input.userMessage.id,
      idPrefix: "conversation-dashboard-query",
      toolId: CONVERSATION_LOCAL_TOOL_IDS.storyStateQuery,
      taskType: "repository.story-state.query",
      inputDigest: input.plan.inputDigest,
      contextDigest: input.plan.planDigest,
      actualExecutor: "browser-main-thread",
      runningMessage: "正在讀取本機 StoryState",
      completedMessage: "StoryState 查詢已完成，Canon 未修改",
      signal: input.signal,
      execute: async () => {
        const states = await repository.list<StoryState>("storyStates", projectId);
        const state = states.find((item) => item.id === project?.storyStateId) ?? states[0] ?? null;
        const content = state
          ? JSON.stringify({
            money: state.money,
            inventory: state.inventory,
            relationships: state.relationships,
            protagonistStats: state.protagonistStats,
            resources: state.resources,
            location: state.locationState,
            time: state.timeState,
            risk: state.riskState,
          }, null, 2)
          : "目前作品沒有可顯示的 StoryState。";
        setDrawer({ kind: "status", title: "目前狀態", content });
        setArtifactOpen(true);
        return {
          result: undefined,
          assistantContent: "已依你的要求打開狀態；它不會自動出現在故事正文中。",
        };
      },
    });
  }

  async function exportActiveConversationSummary() {
    if (!activeSession || busy || operationLockRef.current) return;
    const sessionId = activeSession.id;
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "另一個分頁正在執行這個對話，請稍後再試。",
      });
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setSafeError(null);
    setProgress("正在建立不含原始附件的本機對話摘要匯出…");
    try {
      await maybeUpdateRollingSummary(sessionId);
      const [session, sessionMessages, sessionSummaries] = await Promise.all([
        repository.get<ConversationSession>("conversationSessions", sessionId),
        conversation.listMessages(projectId, sessionId),
        repository.list<ConversationSummary>("conversationSummaries", projectId),
      ]);
      if (!session || session.projectId !== projectId) {
        throw new Error("CONVERSATION_SESSION_SCOPE_MISMATCH");
      }
      const summary = sessionSummaries
        .filter((item) => item.sessionId === sessionId && !item.invalidatedAt && !item.deletedAt)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
      const parentMessage = sessionMessages.at(-1) ?? null;
      const contextDigest = await conversationContentDigest(JSON.stringify({
        sessionId: session.id,
        sessionRevision: session.revision,
        summaryDigest: summary?.contentDigest ?? null,
        canonRevisionDigest: summary?.canonRevisionDigest ?? null,
      }));
      await runDeterministicConversationTool({
        sessionId,
        parentMessageId: parentMessage?.id ?? null,
        idPrefix: "conversation-summary-export",
        toolId: CONVERSATION_LOCAL_TOOL_IDS.sessionSummaryExport,
        taskType: "repository.conversation-summary.export",
        inputDigest: await conversationContentDigest(`conversation-summary-export:${session.id}:${session.revision}`),
        contextDigest,
        actualExecutor: "browser-main-thread",
        runningMessage: "正在建立安全的對話摘要 JSON",
        completedMessage: "對話摘要已匯出，Canon 未修改",
        signal: controller.signal,
        execute: async () => {
          const exported = JSON.stringify({
            schemaVersion: "conversation-summary-export-v1",
            projectId,
            session: {
              id: session.id,
              title: session.title,
              status: session.status,
              activeChapterId: session.activeChapterId,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              lastMessageAt: session.lastMessageAt,
            },
            summary: summary ? {
              content: summary.content,
              contentDigest: summary.contentDigest,
              canonRevisionDigest: summary.canonRevisionDigest,
              sourceMessageCount: summary.sourceMessageIds.length,
              updatedAt: summary.updatedAt,
            } : null,
            privacy: {
              fullMessageTranscriptIncluded: false,
              rawAttachmentsIncluded: false,
              credentialsIncluded: false,
              dataLeftDevice: false,
            },
          }, null, 2);
          const blobUrl = URL.createObjectURL(new Blob([exported], { type: "application/json;charset=utf-8" }));
          const anchor = document.createElement("a");
          anchor.href = blobUrl;
          anchor.download = `conversation-summary-${session.id}.json`;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
          return {
            result: undefined,
            assistantContent: summary
              ? "已匯出目前對話的安全滾動摘要與 Session metadata；不含完整逐字稿、附件內容或憑證。"
              : "目前尚無足夠內容建立滾動摘要；已匯出 Session metadata，且不含完整逐字稿、附件內容或憑證。",
            receiptOutput: exported,
          };
        },
      });
      setProgress("對話摘要已在本機匯出；Canon 未修改。");
      await loadWorkspace(sessionId);
    } catch (error) {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      await loadWorkspace(sessionId).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setBusy(false);
    }
  }

  async function runAtomicLearningImport(input: {
    sessionId: string;
    content: string;
    signal: AbortSignal;
  }) {
    const files = localAttachments.map((item) => item.file);
    const parserModelId = "manual-learning-local-parser-v1";
    const parserModelDigest = await conversationContentDigest(parserModelId);
    let started: Awaited<ReturnType<AtomicLearningImportCoordinator["start"]>> | null = null;
    let userMessage: ConversationMessage | null = null;
    let assistant: ConversationMessage | null = null;
    let invocation: ConversationToolInvocation | null = null;
    let invocationCompleted = false;
    try {
      const last = (await conversation.listMessages(projectId, input.sessionId)).at(-1) ?? null;
      userMessage = await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        role: "user",
        content: input.content || "請把我附加且有權使用的作品做整份本機分析，建立學習規則候選。",
        parentMessageId: last?.id ?? null,
      });
      await maybeUpdateRollingSummary(input.sessionId);
      assistant = await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        parentMessageId: userMessage.id,
      });
      const taskId = `conversation-learning-import:${crypto.randomUUID()}`;
      invocation = await conversation.saveToolInvocation({
        projectId,
        sessionId: input.sessionId,
        messageId: assistant.id,
        taskId,
        toolId: CONVERSATION_LOCAL_TOOL_IDS.atomicLearningImport,
        taskType: "learning.import.atomic",
        inputDigest: userMessage.contentDigest,
        contextDigest: userMessage.contentDigest,
        status: "running",
        actualExecutor: "browser-main-thread",
        modelId: parserModelId,
        modelDigest: parserModelDigest,
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "starting", percent: 1, message: "正在建立本機整份匯入交易" },
      });
      started = await learning.start({
        projectId,
        sessionId: input.sessionId,
        files,
        rightsBasis: "owned_by_user",
        rightsEvidence: "conversation-explicit-owned-work",
        userConfirmedRights: rightsConfirmed,
        mode: "atomic_document",
        signal: input.signal,
      });
      userMessage = await repository.put<ConversationMessage>("conversationMessages", {
        ...userMessage,
        attachmentIds: started.attachments.map((attachment) => attachment.id),
      }, userMessage.revision);
      const processed = await learning.process({
        projectId,
        importSessionId: started.session.importSessionId,
        files,
        sourceKind: "personal_note",
        rightsBasis: "owned_by_user",
        rightsEvidence: "conversation-explicit-owned-work",
        userConfirmedRights: rightsConfirmed,
        signal: input.signal,
        onProgress: (event) => {
          const file = localAttachments[event.partIndex];
          if (file) {
            updateLocalAttachment(file.localId, {
              status: "parsing",
              progress: event.fileProgress ?? null,
            });
          }
          setProgress(`整份匯入 · ${event.phase} · ${Math.max(1, event.partIndex + 1)}/${event.partCount}`);
        },
      });
      if (processed.session.status !== "ready_to_finalize") {
        throw Object.assign(new Error("整份文件尚未完整通過，沒有正式匯入任何 Learning Source。"), {
          code: "LEARNING_IMPORT_NOT_READY_TO_FINALIZE",
        });
      }
      if (!assistant || !invocation) throw new Error("LEARNING_IMPORT_TOOL_INVOCATION_MISSING");
      const assistantContent = "整份文件已完成本機分析。抽象學習規則仍是候選；請查看結果並按下採用後，才會原子寫入正式學習庫。原文與 ArrayBuffer 已釋放。";
      const candidateContent = JSON.stringify({
        schemaVersion: "conversation-learning-import-candidate-v1",
        importSessionId: processed.session.importSessionId,
        manifestDigest: processed.session.manifestDigest,
        totalParts: processed.session.totalParts,
        completedParts: processed.session.completedParts,
        globalSynthesis: processed.globalSynthesis,
        rawContentRetained: false,
        dataLeftDevice: false,
      });
      const candidateDigest = await conversationContentDigest(candidateContent);
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: "browser-main-thread",
        modelId: parserModelId,
        modelDigest: parserModelDigest,
        executionReceipt: toExecutionReceipt({
          taskId: invocation.taskId,
          modelId: parserModelId,
          modelDigest: parserModelDigest,
          contextDigest: invocation.contextDigest,
          outputDigest: candidateDigest,
          externalRequest: false,
          dataLeftDevice: false,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "candidate", percent: 100, message: "全卷抽象規則候選已完成" },
      });
      invocationCompleted = true;
      const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
      if (!currentAssistant) throw new Error("CONVERSATION_MESSAGE_MISSING");
      assistant = await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: currentAssistant.id,
        expectedRevision: currentAssistant.revision,
        status: "completed",
        content: assistantContent,
        toolInvocationIds: currentAssistant.toolInvocationIds,
      });
      const artifact = await conversation.saveArtifact({
        projectId,
        sessionId: input.sessionId,
        sourceMessageId: assistant.id,
        artifactType: "learning_rule",
        targetStore: "learningImportSessions",
        targetRecordId: processed.session.importSessionId,
        sourceRevision: processed.session.revision,
        candidateContent,
      });
      setDrawer({ kind: "artifact", artifactId: artifact.id });
      setArtifactOpen(true);
      setLocalAttachments([]);
      setRightsConfirmed(false);
    } catch (error) {
      if (assistant) {
        const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
        if (currentAssistant && ["pending", "streaming"].includes(currentAssistant.status)) {
          await conversation.updateMessageStatus({
            projectId,
            sessionId: input.sessionId,
            messageId: currentAssistant.id,
            expectedRevision: currentAssistant.revision,
            status: input.signal.aborted ? "cancelled" : "failed",
            content: `附件匯入未完成：${errorCode(error)}`,
          }).catch(() => undefined);
        }
      }
      if (invocation && !invocationCompleted) {
        await conversation.updateToolInvocationStatus({
          projectId,
          sessionId: input.sessionId,
          invocationId: invocation.id,
          expectedRevision: invocation.revision,
          status: input.signal.aborted ? "cancelled" : "failed",
          safeErrorCode: errorCode(error),
          canonicalMutationCount: 0,
        }).catch(() => undefined);
      }
      const importSession = started
        ? await repository.get<LearningImportSession>(
          "learningImportSessions",
          started.session.importSessionId,
        )
        : null;
      if (importSession && ["cancelled", "failed"].includes(importSession.status)) {
        retryActionRef.current = () => {
          void resumeAtomicLearningImport({
            sessionId: input.sessionId,
            importSessionId: importSession.importSessionId,
            files,
          });
        };
        setRetryAvailable(true);
        setRetryLabel("繼續匯入（Resume）");
      } else {
        if (started) {
          await learning.rollback(projectId, started.session.importSessionId).catch(() => undefined);
        }
      }
      throw error;
    }
  }

  async function resumeAtomicLearningImport(input: {
    sessionId: string;
    importSessionId: string;
    files: File[];
  }) {
    const parserModelId = "manual-learning-local-parser-v1";
    const parserModelDigest = await conversationContentDigest(parserModelId);
    if (busy || operationLockRef.current) return;
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, input.sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({ code: "CONVERSATION_OPERATION_ALREADY_RUNNING", message: "另一個分頁正在執行這個對話，請稍後再試。" });
      return;
    }
    const runId = runRef.current + 1;
    runRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setCancellable(true);
    setSafeError(null);
    setProgress("正在從已完成的安全分段繼續匯入…");
    retryActionRef.current = () => { void resumeAtomicLearningImport(input); };
    setRetryAvailable(true);
    setRetryLabel("繼續匯入（Resume）");
    let assistant: ConversationMessage | null = null;
    let invocation: ConversationToolInvocation | null = null;
    try {
      const sessionMessages = await conversation.listMessages(projectId, input.sessionId);
      const lastMessage = sessionMessages.at(-1) ?? null;
      const resumeInputDigest = await conversationContentDigest(JSON.stringify({
        schemaVersion: "conversation-learning-resume-v1",
        projectId,
        sessionId: input.sessionId,
        importSessionId: input.importSessionId,
      }));
      assistant = await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        parentMessageId: lastMessage?.id ?? null,
      });
      const taskId = `conversation-learning-resume:${crypto.randomUUID()}`;
      invocation = await conversation.saveToolInvocation({
        projectId,
        sessionId: input.sessionId,
        messageId: assistant.id,
        taskId,
        toolId: CONVERSATION_LOCAL_TOOL_IDS.atomicLearningImport,
        taskType: "learning.import.resume",
        inputDigest: resumeInputDigest,
        contextDigest: resumeInputDigest,
        status: "running",
        actualExecutor: "browser-main-thread",
        modelId: parserModelId,
        modelDigest: parserModelDigest,
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "resume", percent: 1, message: "正在繼續未完成的本機分段" },
      });
      const importSession = await repository.get<LearningImportSession>(
        "learningImportSessions",
        input.importSessionId,
      );
      if (!importSession || importSession.projectId !== projectId || importSession.sessionId !== input.sessionId) {
        throw new Error("LEARNING_IMPORT_SESSION_NOT_FOUND");
      }
      const sourceUser = [...sessionMessages].reverse().find((message) =>
        message.role === "user"
        && message.attachmentIds.some((attachmentId) => importSession.attachmentIds.includes(attachmentId)));
      if (!sourceUser) throw new Error("LEARNING_IMPORT_SOURCE_MESSAGE_MISSING");
      const processed = await learning.resume({
        projectId,
        importSessionId: input.importSessionId,
        files: input.files,
        sourceKind: "personal_note",
        rightsBasis: "owned_by_user",
        rightsEvidence: "conversation-explicit-owned-work",
        userConfirmedRights: true,
        signal: controller.signal,
        onProgress: (event) => {
          const file = localAttachments[event.partIndex];
          if (file) {
            updateLocalAttachment(file.localId, {
              status: "parsing",
              progress: event.fileProgress ?? null,
            });
          }
          setProgress(`繼續匯入 · ${event.phase} · ${Math.max(1, event.partIndex + 1)}/${event.partCount}`);
        },
      });
      if (processed.session.status !== "ready_to_finalize") {
        throw Object.assign(new Error("匯入尚未完成；可再次繼續失敗的分段。"), {
          code: "LEARNING_IMPORT_NOT_READY_TO_FINALIZE",
        });
      }
      if (!assistant || !invocation) throw new Error("LEARNING_IMPORT_TOOL_INVOCATION_MISSING");
      const assistantContent = "附件已在裝置內完成全卷分析。以下只建立抽象規則候選；原文與暫存位元組已釋放，尚未寫入正式學習庫。";
      const candidateContent = JSON.stringify({
        schemaVersion: "conversation-learning-import-candidate-v1",
        importSessionId: processed.session.importSessionId,
        manifestDigest: processed.session.manifestDigest,
        totalParts: processed.session.totalParts,
        completedParts: processed.session.completedParts,
        globalSynthesis: processed.globalSynthesis,
        rawContentRetained: false,
        dataLeftDevice: false,
      });
      const candidateDigest = await conversationContentDigest(candidateContent);
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: "browser-main-thread",
        modelId: parserModelId,
        modelDigest: parserModelDigest,
        executionReceipt: toExecutionReceipt({
          taskId: invocation.taskId,
          modelId: parserModelId,
          modelDigest: parserModelDigest,
          contextDigest: invocation.contextDigest,
          outputDigest: candidateDigest,
          externalRequest: false,
          dataLeftDevice: false,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "candidate", percent: 100, message: "全卷抽象規則候選已完成" },
      });
      const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
      if (!currentAssistant) throw new Error("CONVERSATION_MESSAGE_MISSING");
      assistant = await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: currentAssistant.id,
        expectedRevision: currentAssistant.revision,
        status: "completed",
        content: assistantContent,
        toolInvocationIds: currentAssistant.toolInvocationIds,
      });
      const artifact = await conversation.saveArtifact({
        projectId,
        sessionId: input.sessionId,
        sourceMessageId: assistant.id,
        artifactType: "learning_rule",
        targetStore: "learningImportSessions",
        targetRecordId: processed.session.importSessionId,
        sourceRevision: processed.session.revision,
        candidateContent,
      });
      setDrawer({ kind: "artifact", artifactId: artifact.id });
      setArtifactOpen(true);
      setLocalAttachments([]);
      setRightsConfirmed(false);
      retryActionRef.current = null;
      setRetryAvailable(false);
      await loadWorkspace(input.sessionId);
    } catch (error) {
      const status = controller.signal.aborted ? "cancelled" as const : "failed" as const;
      if (assistant) {
        const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
        if (currentAssistant && ["pending", "streaming"].includes(currentAssistant.status)) {
          await conversation.updateMessageStatus({
            projectId,
            sessionId: input.sessionId,
            messageId: currentAssistant.id,
            expectedRevision: currentAssistant.revision,
            status,
            content: `附件匯入未完成：${errorCode(error)}。可使用 Resume 從安全分段繼續。`,
          }).catch(() => undefined);
        }
      }
      if (invocation) {
        const currentInvocation = await repository.get<ConversationToolInvocation>(
          "conversationToolInvocations",
          invocation.id,
        );
        if (currentInvocation && ["pending", "running"].includes(currentInvocation.status)) {
          await conversation.updateToolInvocationStatus({
            projectId,
            sessionId: input.sessionId,
            invocationId: currentInvocation.id,
            expectedRevision: currentInvocation.revision,
            status,
            safeErrorCode: errorCode(error),
            canonicalMutationCount: 0,
          }).catch(() => undefined);
        }
      }
      retryActionRef.current = () => { void resumeAtomicLearningImport(input); };
      setRetryAvailable(true);
      setRetryLabel("繼續匯入（Resume）");
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      await loadWorkspace(input.sessionId).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      if (runRef.current === runId) abortRef.current = null;
      setCancellable(false);
      setBusy(false);
    }
  }

  async function createRpgChoicesMessage(input: {
    sessionId: string;
    parentMessageId: string;
    signal: AbortSignal;
  }) {
    const placeholder = await conversation.appendMessage({
      projectId,
      sessionId: input.sessionId,
      role: "assistant",
      content: "",
      status: "streaming",
      parentMessageId: input.parentMessageId,
    });
    const taskId = `conversation-rpg-plan:${crypto.randomUUID()}`;
    const planningDigest = await conversationContentDigest(
      `rpg-plan:${projectId}:${input.parentMessageId}`,
    );
    let invocation = await conversation.saveToolInvocation({
      projectId,
      sessionId: input.sessionId,
      messageId: placeholder.id,
      taskId,
      toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgChoicePlan,
      taskType: "chapter.abcChoices",
      inputDigest: planningDigest,
      contextDigest: planningDigest,
      status: "running",
      canonicalMutationCount: 0,
    });
    try {
      const snapshot = await loadRpgChatSnapshot(repository, projectId);
      const plan = await planRpgChatChoices({
        snapshot,
        signal: input.signal,
        onProgress: (event) => setProgress(progressLabel(event)),
      });
      if (input.signal.aborted) {
        throw Object.assign(new Error("RPG choices cancelled."), { code: "CONVERSATION_CANCELLED" });
      }
      const envelope: RpgChoiceEnvelope = {
        schemaVersion: "conversation-rpg-choices-v1",
        chapterId: snapshot.chapter.id,
        chapterRevision: snapshot.chapter.revision,
        storyStateRevision: snapshot.storyState.revision,
        plan,
      };
      const updated = await repository.get<ConversationMessage>("conversationMessages", placeholder.id);
      if (!updated) throw new Error("CONVERSATION_MESSAGE_MISSING");
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: plan.actualExecutor,
        modelId: plan.model,
        modelDigest: plan.modelDigest,
        executionReceipt: toExecutionReceipt({
          taskId: plan.taskId,
          modelId: plan.model,
          modelDigest: plan.modelDigest,
          contextDigest: plan.contextDigest ?? invocation.contextDigest,
          outputDigest: plan.contentDigest,
          externalRequest: false,
          dataLeftDevice: false,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "completed", percent: 100, message: "三條故事路線已完成" },
      });
      await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: updated.id,
        expectedRevision: updated.revision,
        status: "completed",
        content: serializeRpgChoices(envelope),
        candidateIds: [plan.candidateId],
        toolInvocationIds: updated.toolInvocationIds,
      });
      return { placeholder, plan, invocation };
    } catch (error) {
      const currentMessage = await repository.get<ConversationMessage>("conversationMessages", placeholder.id);
      if (currentMessage) {
        await conversation.updateMessageStatus({
          projectId,
          sessionId: input.sessionId,
          messageId: currentMessage.id,
          expectedRevision: currentMessage.revision,
          status: input.signal.aborted ? "cancelled" : "failed",
          content: `本回合選項未完成：${errorCode(error)}`,
        }).catch(() => undefined);
      }
      await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: input.signal.aborted ? "cancelled" : "failed",
        safeErrorCode: errorCode(error),
        canonicalMutationCount: 0,
      }).catch(() => undefined);
      throw error;
    }
  }

  async function withRpgTurnLock<T>(turnKey: string, action: () => Promise<T>) {
    const lockName = `novel:rpg-turn:${projectId}:${turnKey}`;
    if (rpgTurnLocksRef.current.has(lockName)) {
      throw Object.assign(new Error("這張故事選擇卡正在處理，不能重複建立回合。"), {
        code: "RPG_CHAT_TURN_ALREADY_RUNNING",
      });
    }
    rpgTurnLocksRef.current.add(lockName);
    try {
      if (typeof navigator !== "undefined" && navigator.locks) {
        return await navigator.locks.request(
          lockName,
          { mode: "exclusive", ifAvailable: true },
          async (lock) => {
            if (!lock) {
              throw Object.assign(new Error("另一個頁面正在處理同一故事回合。"), {
                code: "RPG_CHAT_TURN_ALREADY_RUNNING",
              });
            }
            return action();
          },
        );
      }
      return await action();
    } finally {
      rpgTurnLocksRef.current.delete(lockName);
    }
  }

  async function executeRpgChoice(input: {
    sessionId: string;
    choice: RpgChatChoicePlan["choices"][number] | ReturnType<typeof buildRpgChatCustomAction>;
    choicePlanCandidateId: string;
    choiceSourceMessageId: string;
    expectedChapterId: string;
    expectedChapterRevision: number;
    expectedStoryStateRevision: number;
    userMessage?: ConversationMessage;
    signal: AbortSignal;
  }) {
    return withRpgTurnLock(
      `${input.sessionId}:${input.choiceSourceMessageId}:${input.choicePlanCandidateId}`,
      async () => {
      const snapshot = await loadRpgChatSnapshot(repository, projectId);
      if (
        snapshot.chapter.id !== input.expectedChapterId
        || snapshot.chapter.revision !== input.expectedChapterRevision
        || snapshot.storyState.revision !== input.expectedStoryStateRevision
      ) {
        throw Object.assign(new Error("作品狀態已改變，請重新產生本回合選項。"), {
          code: "RPG_CHAT_CHOICES_STALE",
        });
      }
      const sessionMessages = await conversation.listMessages(projectId, input.sessionId);
      const sessionArtifacts = await conversation.listArtifacts(projectId, input.sessionId);
      const choiceAttempts = sessionMessages.filter((message) =>
        message.role === "user" && message.sourceMessageId === input.choiceSourceMessageId);
      const existingChoiceMessage = choiceAttempts.find((attempt) => {
        if (attempt.id === input.userMessage?.id) return false;
        const response = sessionMessages.filter((message) =>
          message.role === "assistant" && message.parentMessageId === attempt.id).at(-1);
        if (!response || ["pending", "streaming"].includes(response.status)) return true;
        if (["failed", "cancelled"].includes(response.status)) return false;
        const responseArtifacts = sessionArtifacts.filter((artifact) =>
          artifact.sourceMessageId === response.id && artifact.artifactType === "rpg");
        return responseArtifacts.some((artifact) => ["candidate", "approved"].includes(artifact.status));
      });
      if (existingChoiceMessage) {
        throw Object.assign(new Error("這張故事選擇卡已經建立過回合。"), {
          code: "RPG_CHAT_TURN_ALREADY_CREATED",
        });
      }
      const userMessage = input.userMessage ?? await (async () => {
        const last = sessionMessages.at(-1) ?? null;
        const attemptNumber = choiceAttempts.length + 1;
        return conversation.appendMessage({
          projectId,
          sessionId: input.sessionId,
          messageId: `conversation-rpg-choice:${input.sessionId}:${input.choiceSourceMessageId}:${attemptNumber}`,
          role: "user",
          content: input.choice.key === "custom"
            ? `自訂行動：${input.choice.title}`
            : `選擇 ${input.choice.key}｜${input.choice.title}`,
          parentMessageId: last?.id ?? null,
          sourceMessageId: input.choiceSourceMessageId,
        });
      })();
      await maybeUpdateRollingSummary(input.sessionId);
      const assistantId = `conversation-rpg-turn:${input.sessionId}:${userMessage.id}`;
      const existingAssistant = await repository.get<ConversationMessage>(
        "conversationMessages",
        assistantId,
      );
      if (
        existingAssistant
        && (
          existingAssistant.projectId !== projectId
          || existingAssistant.sessionId !== input.sessionId
          || existingAssistant.parentMessageId !== userMessage.id
          || !["failed", "cancelled"].includes(existingAssistant.status)
        )
      ) {
        throw Object.assign(new Error("RPG 回合重試來源不一致。"), {
          code: "RPG_CHAT_RETRY_SOURCE_MISMATCH",
        });
      }
      let assistant: ConversationMessage;
      let taskId: string;
      let invocation: ConversationToolInvocation;
      if (existingAssistant) {
        const sourceInvocation = (await conversation.listToolInvocations(projectId, input.sessionId))
          .filter((item) => item.messageId === existingAssistant.id)
          .at(-1);
        if (!sourceInvocation) throw new Error("CONVERSATION_RETRY_TOOL_SOURCE_MISSING");
        const retry = await conversation.prepareToolInvocationRetry({
          projectId,
          sessionId: input.sessionId,
          sourceMessageId: existingAssistant.id,
          sourceInvocationId: sourceInvocation.id,
          expectedMessageRevision: existingAssistant.revision,
          expectedInvocationRevision: sourceInvocation.revision,
        });
        assistant = retry.message;
        taskId = retry.taskId;
        invocation = retry.invocation;
      } else {
        assistant = await conversation.appendMessage({
          projectId,
          sessionId: input.sessionId,
          messageId: assistantId,
          role: "assistant",
          content: "",
          status: "streaming",
          parentMessageId: userMessage.id,
        });
        taskId = `conversation-rpg-turn-task:${input.sessionId}:${userMessage.id}`;
        invocation = await conversation.saveToolInvocation({
          projectId,
          sessionId: input.sessionId,
          messageId: assistant.id,
          invocationId: `conversation-rpg-invocation:${input.sessionId}:${userMessage.id}`,
          taskId,
          toolId: CONVERSATION_LOCAL_TOOL_IDS.rpgTurn,
          taskType: "chapter.continue",
          inputDigest: userMessage.contentDigest,
          contextDigest: userMessage.contentDigest,
          status: "running",
          canonicalMutationCount: 0,
        });
      }
      let invocationCompleted = false;
      try {
        const candidate = await generateRpgChatTurnCandidate({
          snapshot,
          choice: input.choice,
          signal: input.signal,
          onProgress: (event) => setProgress(progressLabel(event)),
        });
        if (input.signal.aborted) throw Object.assign(new Error("RPG turn cancelled."), { code: "CONVERSATION_CANCELLED" });
        const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
        if (!currentAssistant) throw new Error("CONVERSATION_MESSAGE_MISSING");
        invocation = await conversation.updateToolInvocationStatus({
          projectId,
          sessionId: input.sessionId,
          invocationId: invocation.id,
          expectedRevision: invocation.revision,
          status: "completed",
          actualExecutor: candidate.actualExecutor,
          modelId: candidate.model,
          modelDigest: candidate.modelDigest,
          executionReceipt: toExecutionReceipt({
            taskId: candidate.taskId,
            modelId: candidate.model,
            modelDigest: candidate.modelDigest,
            contextDigest: candidate.contextDigest ?? invocation.contextDigest,
            outputDigest: candidate.candidateDigest,
            externalRequest: false,
            dataLeftDevice: false,
            receipt: candidate.executionReceipt as Parameters<typeof toExecutionReceipt>[0]["receipt"],
          }),
          externalRequest: false,
          dataLeftDevice: false,
          canonicalMutationCount: 0,
          safeProgress: { stage: "candidate", percent: 100, message: "完整故事回合已成為候選" },
        });
        invocationCompleted = true;
        await conversation.updateMessageStatus({
          projectId,
          sessionId: input.sessionId,
          messageId: currentAssistant.id,
          expectedRevision: currentAssistant.revision,
          status: "completed",
          content: candidate.story,
          candidateIds: [candidate.candidateId],
          toolInvocationIds: currentAssistant.toolInvocationIds,
        });
        const artifact = await conversation.saveArtifact({
          projectId,
          sessionId: input.sessionId,
          sourceMessageId: assistant.id,
          artifactId: `conversation-rpg-artifact:${input.sessionId}:${assistant.id}`,
          artifactType: "rpg",
          targetStore: "chapters",
          targetRecordId: snapshot.chapter.id,
          sourceRevision: snapshot.chapter.revision,
          candidateContent: JSON.stringify({
            schemaVersion: "conversation-rpg-candidate-v1",
            candidate,
          }),
        });
        await rejectStudioClosedAgentCandidate(input.choicePlanCandidateId).catch(() => undefined);
        setDrawer({ kind: "artifact", artifactId: artifact.id });
        return artifact;
      } catch (error) {
        const currentAssistant = await repository.get<ConversationMessage>("conversationMessages", assistant.id);
        if (currentAssistant) {
          await conversation.updateMessageStatus({
            projectId,
            sessionId: input.sessionId,
            messageId: currentAssistant.id,
            expectedRevision: currentAssistant.revision,
            status: input.signal.aborted ? "cancelled" : "failed",
            content: `本回合未完成：${errorCode(error)}。故事與數值均未寫入。`,
          }).catch(() => undefined);
        }
        if (!invocationCompleted) {
          await conversation.updateToolInvocationStatus({
            projectId,
            sessionId: input.sessionId,
            invocationId: invocation.id,
            expectedRevision: invocation.revision,
            status: input.signal.aborted ? "cancelled" : "failed",
            safeErrorCode: errorCode(error),
            canonicalMutationCount: 0,
          }).catch(() => undefined);
        }
        throw error;
      }
      },
    );
  }

  async function runClosedAgent(input: {
    plan: ConversationPlan;
    sessionId: string;
    userMessage: ConversationMessage;
    preparedAttachments: Array<{
      record: ConversationAttachment;
      extraction: ManualLearningFileExtraction;
    }>;
    signal: AbortSignal;
    regeneration?: {
      source: ConversationMessage;
      taskId: string;
      placeholderId: string;
    };
  }) {
    const placeholder = input.regeneration
      ? await repository.get<ConversationMessage>("conversationMessages", input.regeneration.placeholderId)
      : await conversation.appendMessage({
        projectId,
        sessionId: input.sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        parentMessageId: input.userMessage.id,
      });
    if (!placeholder) throw new Error("CONVERSATION_ASSISTANT_PLACEHOLDER_MISSING");
    const taskId = input.regeneration?.taskId ?? `conversation-agent:${crypto.randomUUID()}`;
    let invocation = await conversation.saveToolInvocation({
      projectId,
      sessionId: input.sessionId,
      messageId: placeholder.id,
      taskId,
      toolId: CONVERSATION_LOCAL_TOOL_IDS.closedAgentPlan,
      taskType: input.plan.taskType ?? "assistant.general",
      inputDigest: input.plan.inputDigest,
      contextDigest: input.plan.planDigest,
      status: "running",
      canonicalMutationCount: 0,
      safeProgress: { stage: "planning", percent: 10, message: "已辨識自然語言任務" },
    });
    let invocationCompleted = false;
    let closedCandidateId: string | null = null;
    try {
      const plannedTargetStore = targetStore(input.plan);
      const resolvedCanonicalTarget = plannedTargetStore === "characters" || plannedTargetStore === "worldRules"
        ? await resolveConversationCanonicalTarget({
            repository,
            projectId,
            store: plannedTargetStore,
            objective: input.plan.objective,
          })
        : null;
      const previousDigest = input.regeneration?.source.contentDigest;
      const result = await executeStudioClosedAgent({
        projectId,
        taskType: input.plan.taskType ?? "assistant.general",
        objective: input.plan.objective,
        taskId,
        sourceChapterId: currentChapter?.id,
        sourceRevision: currentChapter?.revision,
        conversationSessionId: input.sessionId,
        conversationRecentMessageLimit: 12,
        selectedAttachmentSummaries: input.preparedAttachments.map(({ record, extraction }) => ({
          attachmentId: record.id,
          summary: extraction.text.slice(0, MAX_TRANSIENT_ATTACHMENT_CONTEXT),
          contentDigest: extraction.contentHash,
        })),
        regeneration: previousDigest
          ? createExplicitRegenerationContract({
            previousCandidateDigest: previousDigest,
            regenerationAttempt: 1,
            extraRequirement: "建立新的 taskId 與候選，不覆蓋原訊息；保持 Canon 不變。",
          })
          : undefined,
        preferredBackend: previousDigest ? "local-ollama" : undefined,
        browserComputePolicy: previousDigest ? "quality-first" : "browser-first",
        allowPreAuthorizedClosedEscalation: Boolean(previousDigest),
        signal: input.signal,
        onProgress: (event) => setProgress(progressLabel(event)),
      });
      closedCandidateId = result.candidate.id;
      if (input.signal.aborted) {
        throw Object.assign(new Error("Conversation generation cancelled."), { code: "CONVERSATION_CANCELLED" });
      }
      if (
        result.candidate.canonicalMutationCount !== 0
        || result.candidate.externalRequest
        || result.candidate.dataLeftDevice
      ) {
        throw Object.assign(new Error("模型回覆越過候選或裝置邊界。"), {
          code: "CONVERSATION_CANDIDATE_BOUNDARY_VIOLATION",
        });
      }
      for (const execution of result.toolExecutions ?? []) {
        await conversation.saveToolInvocation({
          projectId,
          sessionId: input.sessionId,
          messageId: placeholder.id,
          invocationId: `conversation-agent-tool:${input.sessionId}:${execution.receiptId}`,
          taskId: execution.taskId,
          toolId: execution.toolId,
          taskType: execution.taskType,
          inputDigest: execution.inputDigest,
          contextDigest: execution.contextDigest,
          status: "completed",
          actualExecutor: execution.actualExecutor,
          modelId: null,
          modelDigest: null,
          executionReceipt: {
            receiptId: execution.receiptId,
            modelId: null,
            modelDigest: null,
            providerRunId: null,
            contextDigest: execution.contextDigest,
            outputDigest: execution.outputDigest,
            externalRequest: false,
            dataLeftDevice: false,
            latencyMs: execution.latencyMs,
          },
          externalRequest: false,
          dataLeftDevice: false,
          canonicalMutationCount: 0,
          safeProgress: {
            stage: execution.cacheHit ? "tool-cache" : "tool-completed",
            percent: 100,
            message: `${execution.toolId} 已完成。`,
          },
        });
      }
      const currentPlaceholder = await repository.get<ConversationMessage>("conversationMessages", placeholder.id);
      if (!currentPlaceholder) throw new Error("CONVERSATION_MESSAGE_MISSING");
      if (input.signal.aborted) {
        throw Object.assign(new Error("Conversation generation cancelled."), { code: "CONVERSATION_CANCELLED" });
      }
      invocation = await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: "completed",
        actualExecutor: result.candidate.actualExecutor,
        modelId: result.candidate.modelId,
        modelDigest: result.candidate.modelDigest,
        executionReceipt: toExecutionReceipt({
          taskId: result.candidate.taskId,
          modelId: result.candidate.modelId,
          modelDigest: result.candidate.modelDigest,
          contextDigest: result.candidate.contextDigest ?? invocation.contextDigest,
          outputDigest: result.candidate.contentDigest,
          externalRequest: false,
          dataLeftDevice: false,
          receipt: result.candidate.executionReceipt,
        }),
        externalRequest: false,
        dataLeftDevice: false,
        canonicalMutationCount: 0,
        safeProgress: { stage: "candidate", percent: 100, message: "候選已完成，Canon 未修改" },
      });
      invocationCompleted = true;
      await conversation.updateMessageStatus({
        projectId,
        sessionId: input.sessionId,
        messageId: currentPlaceholder.id,
        expectedRevision: currentPlaceholder.revision,
        status: "completed",
        content: result.candidate.content,
        candidateIds: [result.candidate.id],
        toolInvocationIds: currentPlaceholder.toolInvocationIds,
      });
      let artifact: ConversationArtifact | null = null;
      if (input.plan.approvalRequired) {
        const targetRecordId = plannedTargetStore === "chapters"
          ? currentChapter?.id ?? ""
          : resolvedCanonicalTarget?.targetRecordId ?? "";
        const sourceRevision = plannedTargetStore === "chapters"
          ? currentChapter?.revision ?? 0
          : resolvedCanonicalTarget?.sourceRevision ?? 0;
        if (plannedTargetStore !== "none" && plannedTargetStore !== "controlledLearning" && targetRecordId) {
          artifact = await conversation.saveArtifact({
            projectId,
            sessionId: input.sessionId,
            sourceMessageId: placeholder.id,
            artifactType: artifactType(input.plan),
            targetStore: plannedTargetStore,
            targetRecordId,
            sourceRevision,
            candidateContent: result.candidate.content,
          });
        }
      }
      if (artifact) setDrawer({ kind: "artifact", artifactId: artifact.id });
      return { result, artifact, invocation };
    } catch (error) {
      const currentPlaceholder = await repository.get<ConversationMessage>("conversationMessages", placeholder.id);
      if (currentPlaceholder) {
        await conversation.updateMessageStatus({
          projectId,
          sessionId: input.sessionId,
          messageId: currentPlaceholder.id,
          expectedRevision: currentPlaceholder.revision,
          status: input.signal.aborted ? "cancelled" : "failed",
          content: `這次執行沒有完成：${errorCode(error)}。Canon 維持原狀。`,
        }).catch(() => undefined);
      }
      if (!invocationCompleted) await conversation.updateToolInvocationStatus({
        projectId,
        sessionId: input.sessionId,
        invocationId: invocation.id,
        expectedRevision: invocation.revision,
        status: input.signal.aborted ? "cancelled" : "failed",
        safeErrorCode: errorCode(error),
        canonicalMutationCount: 0,
      }).catch(() => undefined);
      if (closedCandidateId) {
        await rejectStudioClosedAgentCandidate(closedCandidateId).catch(() => undefined);
      }
      throw error;
    }
  }

  async function sendRequest(contentOverride?: string) {
    const content = (contentOverride ?? draft).trim();
    if (!activeSession || busy || operationLockRef.current || (!content && !localAttachments.length)) return;
    const requestHadAttachments = localAttachments.length > 0;
    let learningResumeEnabled = false;
    retryActionRef.current = () => { void sendRequest(content); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, activeSession.id);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({
        code: "CONVERSATION_OPERATION_ALREADY_RUNNING",
        message: "另一個分頁正在執行這個對話，請稍後再試。",
      });
      return;
    }
    const runId = runRef.current + 1;
    runRef.current = runId;
    const controller = new AbortController();
    abortRef.current?.abort("CONVERSATION_REPLACED");
    abortRef.current = controller;
    setCancellable(true);
    setBusy(true);
    setSafeError(null);
    setDraft("");
    setProgress("正在辨識你的自然語言要求。");
    try {
      const plan = await planConversationRequest({
        content,
        attachmentCount: localAttachments.length,
        hasActiveRpgTurn: Boolean(latestRpgChoices),
      });
      if (plan.executionKind === "learning_import") {
        learningResumeEnabled = true;
        if (!localAttachments.length) {
          throw Object.assign(new Error("請先附加你擁有或獲授權的作品檔案。"), {
            code: "LEARNING_IMPORT_FILES_REQUIRED",
          });
        }
        if (!rightsConfirmed) {
          throw Object.assign(new Error("整份匯入前，請先確認你擁有或已獲授權分析這些作品。"), {
            code: "LEARNING_RIGHTS_CONFIRMATION_REQUIRED",
          });
        }
        await runAtomicLearningImport({
          sessionId: activeSession.id,
          content,
          signal: controller.signal,
        });
        await loadWorkspace(activeSession.id);
        return;
      }
      const currentSessionMessages = await conversation.listMessages(projectId, activeSession.id);
      const currentSessionArtifacts = await conversation.listArtifacts(projectId, activeSession.id);
      const last = currentSessionMessages.at(-1) ?? null;
      const activeRpgChoiceMessage = plan.executionKind === "rpg" ? latestRpgChoices : null;
      const rpgAttempts = activeRpgChoiceMessage
        ? currentSessionMessages.filter((message) =>
          message.role === "user"
          && message.sourceMessageId === activeRpgChoiceMessage.message.id)
        : [];
      const responseFor = (attempt: ConversationMessage) => currentSessionMessages.filter((message) =>
        message.role === "assistant" && message.parentMessageId === attempt.id).at(-1) ?? null;
      const existingRpgUser = rpgAttempts.find((attempt) => {
        const response = responseFor(attempt);
        return attempt.content === content
          && Boolean(response && ["failed", "cancelled"].includes(response.status));
      }) ?? null;
      const rpgChoiceConsumed = rpgAttempts.some((attempt) => {
        const response = responseFor(attempt);
        if (!response || ["pending", "streaming"].includes(response.status)) return true;
        if (["failed", "cancelled"].includes(response.status)) return false;
        const responseArtifacts = currentSessionArtifacts.filter((artifact) =>
          artifact.sourceMessageId === response.id && artifact.artifactType === "rpg");
        return responseArtifacts.some((artifact) => ["candidate", "approved"].includes(artifact.status));
      });
      if (
        rpgChoiceConsumed
      ) {
        throw Object.assign(new Error("這張故事選擇卡已經建立過回合。"), {
          code: "RPG_CHAT_TURN_ALREADY_CREATED",
        });
      }
      let userMessage = existingRpgUser ?? await conversation.appendMessage({
        projectId,
        sessionId: activeSession.id,
        messageId: activeRpgChoiceMessage
          ? `conversation-rpg-choice:${activeSession.id}:${activeRpgChoiceMessage.message.id}:${rpgAttempts.length + 1}`
          : undefined,
        role: "user",
        content: content || "請分析我剛附加的檔案。",
        status: localAttachments.length ? "pending" : "completed",
        parentMessageId: last?.id ?? null,
        sourceMessageId: activeRpgChoiceMessage?.message.id ?? null,
      });
      let preparedAttachments: Array<{
        record: ConversationAttachment;
        extraction: ManualLearningFileExtraction;
      }> = [];
      if (localAttachments.length) {
        try {
          preparedAttachments = await prepareLocalAttachments(
            activeSession.id,
            plan,
            userMessage.id,
            controller.signal,
          );
        } catch (error) {
          const currentUserMessage = await repository.get<ConversationMessage>(
            "conversationMessages",
            userMessage.id,
          );
          if (currentUserMessage && ["pending", "streaming"].includes(currentUserMessage.status)) {
            await conversation.updateMessageStatus({
              projectId,
              sessionId: activeSession.id,
              messageId: currentUserMessage.id,
              expectedRevision: currentUserMessage.revision,
              status: controller.signal.aborted ? "cancelled" : "failed",
            }).catch(() => undefined);
          }
          throw error;
        }
        const currentUserMessage = await repository.get<ConversationMessage>(
          "conversationMessages",
          userMessage.id,
        );
        if (!currentUserMessage || currentUserMessage.status !== "pending") {
          throw new Error("CONVERSATION_ATTACHMENT_USER_MESSAGE_STALE");
        }
        userMessage = await repository.put<ConversationMessage>("conversationMessages", {
          ...currentUserMessage,
          status: "completed",
          attachmentIds: preparedAttachments.map(({ record }) => record.id),
          completedAt: new Date().toISOString(),
        }, currentUserMessage.revision);
      }
      await maybeUpdateRollingSummary(activeSession.id);
      if (plan.executionKind === "repository") {
        await runRepositoryAction({
          plan,
          sessionId: activeSession.id,
          userMessage,
          signal: controller.signal,
        });
      } else if (plan.executionKind === "query") {
        await runDashboardQuery({
          plan,
          sessionId: activeSession.id,
          userMessage,
          signal: controller.signal,
        });
      } else if (plan.executionKind === "rpg") {
        const plannedChoice = latestRpgChoices
          ? parseRpgChoiceSelection(content, latestRpgChoices.envelope.plan.choices)
          : null;
        if (plannedChoice && latestRpgChoices) {
          await executeRpgChoice({
            sessionId: activeSession.id,
            choice: plannedChoice,
            choicePlanCandidateId: latestRpgChoices.envelope.plan.candidateId,
            choiceSourceMessageId: latestRpgChoices.message.id,
            expectedChapterId: latestRpgChoices.envelope.chapterId,
            expectedChapterRevision: latestRpgChoices.envelope.chapterRevision,
            expectedStoryStateRevision: latestRpgChoices.envelope.storyStateRevision,
            userMessage,
            signal: controller.signal,
          });
        } else if (plan.intent === "rpg_custom_action" && latestRpgChoices) {
          const snapshot = await loadRpgChatSnapshot(repository, projectId);
          await executeRpgChoice({
            sessionId: activeSession.id,
            choice: buildRpgChatCustomAction({ snapshot, action: content }),
            choicePlanCandidateId: latestRpgChoices.envelope.plan.candidateId,
            choiceSourceMessageId: latestRpgChoices.message.id,
            expectedChapterId: latestRpgChoices.envelope.chapterId,
            expectedChapterRevision: latestRpgChoices.envelope.chapterRevision,
            expectedStoryStateRevision: latestRpgChoices.envelope.storyStateRevision,
            userMessage,
            signal: controller.signal,
          });
        } else {
          await createRpgChoicesMessage({
            sessionId: activeSession.id,
            parentMessageId: userMessage.id,
            signal: controller.signal,
          });
        }
      } else {
        await runClosedAgent({
          plan,
          sessionId: activeSession.id,
          userMessage,
          preparedAttachments,
          signal: controller.signal,
        });
      }
      if (runRef.current === runId) {
        setProgress("已完成；正式 Canon 只會在你按下採用後修改。");
      }
      clearTransientAttachments();
      await loadWorkspace(activeSession.id);
    } catch (error) {
      if (runRef.current !== runId) return;
      if (requestHadAttachments && !learningResumeEnabled) {
        retryActionRef.current = null;
        setRetryAvailable(false);
        setDraft(content);
        setSafeError({
          code: "CONVERSATION_ATTACHMENTS_RESELECT_REQUIRED",
          message: "附件暫存內容已安全釋放。請重新附加原檔後再送出；系統不會在缺少附件時假裝重試分析。",
        });
      } else {
        setSafeError({ code: errorCode(error), message: errorMessage(error) });
      }
      setProgress(controller.signal.aborted
        ? "已停止；生成中的內容與 Canon 均未修改。"
        : "操作沒有完成；可修正後重試。");
      clearTransientAttachments();
      await loadWorkspace(activeSession.id).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setCancellable(false);
      if (runRef.current === runId) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  async function chooseRpgOption(
    envelope: RpgChoiceEnvelope,
    sourceMessageId: string,
    key: "A" | "B" | "C",
  ) {
    if (!activeSession || busy || operationLockRef.current) return;
    const choice = envelope.plan.choices.find((item) => item.key === key);
    if (!choice) return;
    retryActionRef.current = () => { void chooseRpgOption(envelope, sourceMessageId, key); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, activeSession.id);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({ code: "CONVERSATION_OPERATION_ALREADY_RUNNING", message: "另一個分頁正在執行這個對話，請稍後再試。" });
      return;
    }
    const controller = new AbortController();
    const runId = runRef.current + 1;
    runRef.current = runId;
    abortRef.current = controller;
    setCancellable(true);
    setBusy(true);
    setSafeError(null);
    try {
      const snapshot = await loadRpgChatSnapshot(repository, projectId);
      if (
        snapshot.chapter.id !== envelope.chapterId
        || snapshot.chapter.revision !== envelope.chapterRevision
        || snapshot.storyState.revision !== envelope.storyStateRevision
      ) {
        throw Object.assign(new Error("作品狀態已改變，請重新產生本回合選項。"), {
          code: "RPG_CHAT_CHOICES_STALE",
        });
      }
      const sessionMessages = await conversation.listMessages(projectId, activeSession.id);
      const sessionArtifacts = await conversation.listArtifacts(projectId, activeSession.id);
      const attempts = sessionMessages.filter((message) =>
        message.role === "user" && message.sourceMessageId === sourceMessageId);
      const responseFor = (attempt: ConversationMessage) => sessionMessages.filter((message) =>
        message.role === "assistant" && message.parentMessageId === attempt.id).at(-1) ?? null;
      const existingUser = attempts.find((attempt) => {
        const response = responseFor(attempt);
        return attempt.content.includes(choice.title)
          && Boolean(response && ["failed", "cancelled"].includes(response.status));
      }) ?? null;
      const consumed = attempts.some((attempt) => {
        const response = responseFor(attempt);
        if (!response || ["pending", "streaming"].includes(response.status)) return true;
        if (["failed", "cancelled"].includes(response.status)) return false;
        const responseArtifacts = sessionArtifacts.filter((artifact) =>
          artifact.sourceMessageId === response.id && artifact.artifactType === "rpg");
        return responseArtifacts.some((artifact) =>
          ["candidate", "approved"].includes(artifact.status));
      });
      if (consumed) {
        throw Object.assign(new Error("這組選項已經建立過回合。"), {
          code: "RPG_CHAT_TURN_ALREADY_CREATED",
        });
      }
      await executeRpgChoice({
        sessionId: activeSession.id,
        choice,
        choicePlanCandidateId: envelope.plan.candidateId,
        choiceSourceMessageId: sourceMessageId,
        expectedChapterId: envelope.chapterId,
        expectedChapterRevision: envelope.chapterRevision,
        expectedStoryStateRevision: envelope.storyStateRevision,
        userMessage: existingUser ?? undefined,
        signal: controller.signal,
      });
      await loadWorkspace(activeSession.id);
    } catch (error) {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setCancellable(false);
      if (runRef.current === runId) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  async function approveArtifact(artifact: ConversationArtifact, editedContent?: string) {
    if (!activeSession || busy || operationLockRef.current || artifact.status !== "candidate") return;
    retryActionRef.current = () => { void approveArtifact(artifact, editedContent); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, activeSession.id);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({ code: "CONVERSATION_OPERATION_ALREADY_RUNNING", message: "另一個分頁正在執行這個對話，請稍後再試。" });
      return;
    }
    setBusy(true);
    setSafeError(null);
    try {
      let selected = artifact;
      if (
        !["rpg", "learning_rule"].includes(artifact.artifactType)
        && editedContent !== undefined
        && editedContent.trim() !== artifactStory(artifact).trim()
      ) {
        const originalSourceMessage = await repository.get<ConversationMessage>(
          "conversationMessages",
          artifact.sourceMessageId,
        );
        if (
          !originalSourceMessage
          || originalSourceMessage.projectId !== projectId
          || originalSourceMessage.sessionId !== activeSession.id
          || originalSourceMessage.status !== "completed"
        ) {
          throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
        }
        const editedArtifact = await conversation.saveArtifact({
          projectId,
          sessionId: activeSession.id,
          sourceMessageId: artifact.sourceMessageId,
          artifactType: artifact.artifactType,
          targetStore: artifact.targetStore,
          targetRecordId: artifact.targetRecordId,
          sourceRevision: artifact.sourceRevision,
          candidateContent: editedContent.trim(),
        });
        let editInvocation: ConversationToolInvocation | null = null;
        try {
          const attemptId = crypto.randomUUID();
          const contextDigest = await conversationContentDigest(JSON.stringify({
            schemaVersion: "conversation-local-user-edit-v1",
            originalArtifactId: artifact.id,
            originalCandidateDigest: artifact.candidateDigest,
            sourceMessageId: artifact.sourceMessageId,
          }));
          editInvocation = await conversation.saveToolInvocation({
            projectId,
            sessionId: activeSession.id,
            messageId: originalSourceMessage.id,
            invocationId: `conversation-local-user-edit:invocation:${attemptId}`,
            taskId: `conversation-local-user-edit:task:${attemptId}`,
            toolId: CONVERSATION_LOCAL_TOOL_IDS.localUserEdit,
            taskType: "candidate.user-edit",
            inputDigest: artifact.candidateDigest,
            contextDigest,
            status: "running",
            externalRequest: false,
            dataLeftDevice: false,
            canonicalMutationCount: 0,
            safeProgress: { stage: "editing", percent: 50, message: "正在記錄本機使用者修改" },
          });
          editInvocation = await conversation.updateToolInvocationStatus({
            projectId,
            sessionId: activeSession.id,
            invocationId: editInvocation.id,
            expectedRevision: editInvocation.revision,
            status: "completed",
            actualExecutor: "local-user-edit",
            modelId: null,
            modelDigest: null,
            executionReceipt: toExecutionReceipt({
              taskId: editInvocation.taskId,
              modelId: null,
              modelDigest: null,
              contextDigest: editInvocation.contextDigest,
              outputDigest: editedArtifact.candidateDigest,
              externalRequest: false,
              dataLeftDevice: false,
            }),
            externalRequest: false,
            dataLeftDevice: false,
            canonicalMutationCount: 0,
            safeProgress: { stage: "completed", percent: 100, message: "本機使用者修改已記錄，Canon 未修改" },
          });
        } catch (error) {
          if (editInvocation) {
            const currentInvocation = await repository.get<ConversationToolInvocation>(
              "conversationToolInvocations",
              editInvocation.id,
            );
            if (currentInvocation && ["pending", "running"].includes(currentInvocation.status)) {
              await conversation.updateToolInvocationStatus({
                projectId,
                sessionId: activeSession.id,
                invocationId: currentInvocation.id,
                expectedRevision: currentInvocation.revision,
                status: "failed",
                safeErrorCode: errorCode(error),
                canonicalMutationCount: 0,
              }).catch(() => undefined);
            }
          }
          const currentEditedArtifact = await repository.get<ConversationArtifact>(
            "conversationArtifacts",
            editedArtifact.id,
          );
          if (currentEditedArtifact?.status === "candidate") {
            await conversation.rejectArtifact(
              projectId,
              activeSession.id,
              currentEditedArtifact.id,
              currentEditedArtifact.revision,
            ).catch(() => undefined);
          }
          throw error;
        }
        selected = editedArtifact;
        await conversation.rejectArtifact(projectId, activeSession.id, artifact.id, artifact.revision);
      }
      const session = await repository.get<ConversationSession>("conversationSessions", activeSession.id);
      const sourceMessage = await repository.get<ConversationMessage>("conversationMessages", selected.sourceMessageId);
      const freshArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", selected.id);
      if (!session || !sourceMessage || !freshArtifact) throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
      if (freshArtifact.artifactType === "learning_rule") {
        const candidate = parseLearningImportCandidate(freshArtifact);
        const importSession = await repository.get<LearningImportSession>(
          "learningImportSessions",
          freshArtifact.targetRecordId,
        );
        if (
          !candidate
          || !importSession
          || candidate.importSessionId !== importSession.importSessionId
          || candidate.manifestDigest !== importSession.manifestDigest
          || importSession.projectId !== projectId
          || importSession.sessionId !== session.id
          || freshArtifact.targetStore !== "learningImportSessions"
          || (importSession.status === "ready_to_finalize"
            ? importSession.revision !== freshArtifact.sourceRevision
            : importSession.revision !== freshArtifact.sourceRevision + 1)
          || !["ready_to_finalize", "committed"].includes(importSession.status)
        ) {
          throw Object.assign(new Error("整份學習匯入候選已過期或範圍不符。"), {
            code: "LEARNING_IMPORT_APPROVAL_SOURCE_STALE",
          });
        }
        const finalized = await learning.finalize(
          projectId,
          importSession.importSessionId,
          { retainStagingUntilApproval: true },
        );
        try {
          await learning.approveFinalizedRules(
            projectId,
            importSession.importSessionId,
          );
          const committed = await repository.get<LearningImportSession>(
            "learningImportSessions",
            importSession.id,
          );
          if (!committed || committed.status !== "committed") {
            throw new Error("LEARNING_IMPORT_CANONICAL_COMMIT_MISSING");
          }
          const currentSession = await repository.get<ConversationSession>("conversationSessions", session.id);
          const currentMessage = await repository.get<ConversationMessage>("conversationMessages", sourceMessage.id);
          const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id);
          if (!currentSession || !currentMessage || !currentArtifact) {
            throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
          }
          await conversation.markArtifactApprovedFromExternalCommit({
            operationId: `conversation-learning-approval:${freshArtifact.id}`,
            idempotencyKey: `conversation-learning-approval:${freshArtifact.id}:${freshArtifact.candidateDigest}`,
            projectId,
            sessionId: session.id,
            artifactId: freshArtifact.id,
            sourceMessageId: sourceMessage.id,
            candidateDigest: freshArtifact.candidateDigest,
            targetStore: "learningImportSessions",
            targetRecordId: committed.id,
            expectedSessionRevision: currentSession.revision,
            expectedArtifactRevision: currentArtifact.revision,
            expectedSourceMessageRevision: currentMessage.revision,
            expectedSourceRevision: freshArtifact.sourceRevision,
            resultingRevision: committed.revision,
            canonicalRecordDigest: await conversationCanonicalRecordDigest(committed),
            commitId: `learning-import:${committed.manifestDigest}`,
          });
        } catch (approvalError) {
          try {
            await learning.compensateFinalizedApproval(projectId, importSession.importSessionId);
          } catch (compensationError) {
            throw Object.assign(
              new AggregateError(
                [approvalError, compensationError],
                "Learning approval compensation failed.",
              ),
              { code: "LEARNING_IMPORT_APPROVAL_COMPENSATION_FAILED" },
            );
          }
          throw approvalError;
        }
        await learning.releaseFinalizedStaging(
          projectId,
          importSession.importSessionId,
        ).catch(() => undefined);
        setProgress(
          `整份學習匯入已採用：${finalized.sources?.length ?? 0} 個安全來源、${finalized.rules?.length ?? 0} 條抽象規則；原文未保存。`,
        );
      } else if (freshArtifact.artifactType === "rpg") {
        const candidate = parseRpgCandidate(freshArtifact);
        if (!candidate) throw new Error("RPG_CHAT_CANDIDATE_INVALID");
        const snapshot = await loadRpgChatSnapshot(repository, projectId);
        const currentSession = await repository.get<ConversationSession>("conversationSessions", session.id);
        const currentMessage = await repository.get<ConversationMessage>("conversationMessages", sourceMessage.id);
        const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id);
        if (!currentSession || !currentMessage || !currentArtifact) {
          throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
        }
        await approveRpgChatTurn({
          repository,
          snapshot,
          candidate,
          conversationApproval: {
            operationId: `conversation-rpg-approval:${freshArtifact.id}`,
            idempotencyKey: `conversation-rpg-approval:${freshArtifact.id}:${freshArtifact.candidateDigest}`,
            sessionId: session.id,
            artifactId: freshArtifact.id,
            sourceMessageId: sourceMessage.id,
            candidateDigest: freshArtifact.candidateDigest,
            expectedSessionRevision: currentSession.revision,
            expectedArtifactRevision: currentArtifact.revision,
            expectedSourceMessageRevision: currentMessage.revision,
            expectedSourceRevision: freshArtifact.sourceRevision,
          },
        });
        const latest = (await conversation.listMessages(projectId, session.id)).at(-1) ?? sourceMessage;
        const controller = new AbortController();
        await createRpgChoicesMessage({
          sessionId: session.id,
          parentMessageId: latest.id,
          signal: controller.signal,
        });
      } else if (freshArtifact.targetStore === "chapters") {
        const closedCandidateId = sourceMessage.candidateIds.find((id) => id !== freshArtifact.id);
        const requestMessage = sourceMessage.parentMessageId
          ? await repository.get<ConversationMessage>("conversationMessages", sourceMessage.parentMessageId)
          : null;
        const sourcePlan = await planConversationRequest({ content: requestMessage?.content ?? "" });
        const commit = async () => {
          const currentSession = await repository.get<ConversationSession>("conversationSessions", session.id);
          const currentMessage = await repository.get<ConversationMessage>("conversationMessages", sourceMessage.id);
          const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id);
          if (!currentSession || !currentMessage || !currentArtifact) throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
          return conversation.approveChapterArtifact({
            operationId: `conversation-approval:${freshArtifact.id}`,
            idempotencyKey: `conversation-approval:${freshArtifact.id}:${freshArtifact.candidateDigest}`,
            projectId,
            sessionId: session.id,
            artifactId: freshArtifact.id,
            sourceMessageId: sourceMessage.id,
            candidateDigest: freshArtifact.candidateDigest,
            targetRecordId: freshArtifact.targetRecordId,
            expectedSessionRevision: currentSession.revision,
            expectedArtifactRevision: currentArtifact.revision,
            expectedSourceMessageRevision: currentMessage.revision,
            expectedSourceRevision: freshArtifact.sourceRevision,
            applicationMode: applicationMode(sourcePlan),
          });
        };
        if (closedCandidateId && editedContent === undefined) {
          await approveStudioClosedAgentCandidate({
            candidateId: closedCandidateId,
            canonicalCommit: async () => {
              const result = await commit();
              return { commitId: result.approvalTransaction.operationId };
            },
          });
        } else {
          await commit();
        }
      } else if (freshArtifact.targetStore === "characters" || freshArtifact.targetStore === "worldRules") {
        const current = await repository.get<Character | WorldRule>(
          freshArtifact.targetStore,
          freshArtifact.targetRecordId,
        );
        const nextCanonicalRecord = buildConversationCanonicalReplacement({
          projectId,
          store: freshArtifact.targetStore,
          targetRecordId: freshArtifact.targetRecordId,
          candidateContent: freshArtifact.candidateContent,
          current,
        });
        const currentSession = await repository.get<ConversationSession>("conversationSessions", session.id);
        const currentMessage = await repository.get<ConversationMessage>("conversationMessages", sourceMessage.id);
        const currentArtifact = await repository.get<ConversationArtifact>("conversationArtifacts", freshArtifact.id);
        if (!currentSession || !currentMessage || !currentArtifact) {
          throw new Error("CONVERSATION_APPROVAL_SOURCE_MISSING");
        }
        await conversation.approveArtifact({
          operationId: `conversation-approval:${freshArtifact.id}`,
          idempotencyKey: `conversation-approval:${freshArtifact.id}:${freshArtifact.candidateDigest}`,
          projectId,
          sessionId: session.id,
          artifactId: freshArtifact.id,
          sourceMessageId: sourceMessage.id,
          candidateDigest: freshArtifact.candidateDigest,
          targetStore: freshArtifact.targetStore,
          targetRecordId: freshArtifact.targetRecordId,
          expectedSessionRevision: currentSession.revision,
          expectedArtifactRevision: currentArtifact.revision,
          expectedSourceMessageRevision: currentMessage.revision,
          expectedSourceRevision: freshArtifact.sourceRevision,
          applicationMode: "record_replace",
          nextCanonicalRecord,
        });
      }
      await conversation.invalidateSummariesForCanonChange(
        projectId,
        await currentCanonRevisionDigest(),
      );
      setProgress("候選已由你明確採用；唯一 Canon 交易與安全備份已完成。");
      setArtifactOpen(false);
      setDrawer(null);
      await loadWorkspace(activeSession.id);
    } catch (error) {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      await loadWorkspace(activeSession.id).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setBusy(false);
    }
  }

  async function rejectArtifact(artifact: ConversationArtifact) {
    if (!activeSession || busy || operationLockRef.current || artifact.status !== "candidate") return;
    const sessionId = activeSession.id;
    retryActionRef.current = () => { void rejectArtifact(artifact); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({ code: "CONVERSATION_OPERATION_ALREADY_RUNNING", message: "另一個分頁正在執行這個對話，請稍後再試。" });
      return;
    }
    setBusy(true);
    setSafeError(null);
    try {
      if (artifact.artifactType === "learning_rule") {
        await learning.rollbackPendingApproval(projectId, artifact.targetRecordId);
      }
      const currentArtifact = await repository.get<ConversationArtifact>(
        "conversationArtifacts",
        artifact.id,
      );
      if (!currentArtifact || currentArtifact.status !== "candidate") {
        throw Object.assign(new Error("Conversation artifact is no longer rejectable."), {
          code: "CONVERSATION_ARTIFACT_STALE",
        });
      }
      await conversation.rejectArtifact(
        projectId,
        sessionId,
        currentArtifact.id,
        currentArtifact.revision,
      );
      const source = await repository.get<ConversationMessage>("conversationMessages", artifact.sourceMessageId);
      const closedCandidateId = source?.candidateIds.find((id) => id !== artifact.id);
      if (closedCandidateId) await rejectStudioClosedAgentCandidate(closedCandidateId).catch(() => undefined);
      await refreshSession(sessionId);
    } catch (error) {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      await refreshSession(sessionId).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      setBusy(false);
    }
  }

  async function regenerateMessage(message: ConversationMessage) {
    if (!activeSession || busy || operationLockRef.current || message.role !== "assistant") return;
    const sessionId = activeSession.id;
    retryActionRef.current = () => { void regenerateMessage(message); };
    setRetryAvailable(true);
    setRetryLabel("重試");
    operationLockRef.current = true;
    const releaseLease = await acquireConversationLease(projectId, sessionId);
    if (!releaseLease) {
      operationLockRef.current = false;
      setSafeError({ code: "CONVERSATION_OPERATION_ALREADY_RUNNING", message: "另一個分頁正在執行這個對話，請稍後再試。" });
      return;
    }
    const runId = runRef.current + 1;
    runRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    setCancellable(true);
    setBusy(true);
    setSafeError(null);
    try {
      const sourceArtifacts = (await conversation.listArtifacts(projectId, sessionId))
        .filter((artifact) => artifact.sourceMessageId === message.id);
      if (sourceArtifacts.some((artifact) => ["rpg", "learning_rule"].includes(artifact.artifactType))) {
        throw Object.assign(new Error("這類候選必須從原本的 RPG 選擇或附件匯入流程重新執行。"), {
          code: "CONVERSATION_REGENERATION_SPECIALIZED_FLOW_REQUIRED",
        });
      }
      const sourceUser = message.parentMessageId
        ? await repository.get<ConversationMessage>("conversationMessages", message.parentMessageId)
        : null;
      if (!sourceUser || sourceUser.role !== "user") {
        throw Object.assign(new Error("找不到原始使用者訊息。"), {
          code: "CONVERSATION_REGENERATION_SOURCE_MISSING",
        });
      }
      if (sourceUser.attachmentIds.length > 0) {
        retryActionRef.current = null;
        setRetryAvailable(false);
        setDraft(sourceUser.content);
        throw Object.assign(new Error("原始附件內容未被保留。已回填原要求，請重新附加原檔後再送出。"), {
          code: "CONVERSATION_ATTACHMENTS_RESELECT_REQUIRED",
        });
      }
      const plan = await planConversationRequest({ content: sourceUser.content });
      if (plan.executionKind !== "closed_agent") {
        throw Object.assign(new Error("這則回覆必須使用原本的專用本機工具重新執行，不能改由通用 AI 重新產生。"), {
          code: "CONVERSATION_REGENERATION_SPECIALIZED_FLOW_REQUIRED",
        });
      }
      const prepared = await conversation.prepareRegeneration({
        projectId,
        sessionId,
        sourceMessageId: message.id,
      });
      await runClosedAgent({
        plan,
        sessionId,
        userMessage: sourceUser,
        preparedAttachments: [],
        signal: controller.signal,
        regeneration: {
          source: message,
          taskId: prepared.taskId,
          placeholderId: prepared.messageId,
        },
      });
      await loadWorkspace(sessionId);
    } catch (error) {
      setSafeError({ code: errorCode(error), message: errorMessage(error) });
      await loadWorkspace(sessionId).catch(() => undefined);
    } finally {
      operationLockRef.current = false;
      releaseLease();
      if (runRef.current === runId) abortRef.current = null;
      setCancellable(false);
      setBusy(false);
    }
  }

  function stopGeneration() {
    if (!abortRef.current) return;
    abortRef.current?.abort("CONVERSATION_USER_CANCELLED");
    clearTransientAttachments();
    setProgress("正在安全停止；未完成候選不會修改 Canon。");
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void sendRequest();
  }

  async function openArtifact(
    artifact: ConversationArtifact,
    view: "candidate" | "diff" | "comparison" = "candidate",
  ) {
    setDrawer({ kind: "artifact", artifactId: artifact.id });
    setArtifactDraft(artifactStory(artifact));
    setArtifactView(view);
    setArtifactBefore("");
    setArtifactOpen(true);
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
      setArtifactBefore(previousArtifact ? artifactStory(previousArtifact) : "");
      return;
    }
    if (view !== "diff") return;
    if (artifact.targetStore === "chapters") {
      const chapter = await repository.get<Chapter>("chapters", artifact.targetRecordId);
      setArtifactBefore(chapter?.content ?? "");
      return;
    }
    if (artifact.targetStore === "characters") {
      const character = await repository.get<Character>("characters", artifact.targetRecordId);
      setArtifactBefore(character ? JSON.stringify(character, null, 2) : "");
      return;
    }
    if (artifact.targetStore === "worldRules") {
      const rule = await repository.get<WorldRule>("worldRules", artifact.targetRecordId);
      setArtifactBefore(rule?.description ?? "");
      return;
    }
    if (artifact.targetStore === "learningImportSessions") {
      const importSession = await repository.get<LearningImportSession>(
        "learningImportSessions",
        artifact.targetRecordId,
      );
      setArtifactBefore(importSession ? JSON.stringify({
        status: importSession.status,
        revision: importSession.revision,
        manifestDigest: importSession.manifestDigest,
      }, null, 2) : "");
    }
  }

  const selectedArtifact = drawer?.kind === "artifact"
    ? artifacts.find((artifact) => artifact.id === drawer.artifactId) ?? null
    : null;
  const artifactsByMessage = useMemo(() => {
    const map = new Map<string, ConversationArtifact[]>();
    for (const artifact of artifacts) {
      map.set(artifact.sourceMessageId, [...(map.get(artifact.sourceMessageId) ?? []), artifact]);
    }
    return map;
  }, [artifacts]);
  const invocationsByMessage = useMemo(() => new Map(
    invocations.map((invocation) => [invocation.messageId, invocation]),
  ), [invocations]);
  const selectedArtifactInvocations = selectedArtifact
    ? invocations.filter((invocation) => invocation.messageId === selectedArtifact.sourceMessageId)
    : [];
  const latestInvocation = invocations.at(-1) ?? null;
  const attachmentsById = useMemo(() => new Map(
    attachments.map((attachment) => [attachment.id, attachment]),
  ), [attachments]);
  const canStop = busy && cancellable;

  return (
    <main className={styles.shell} data-testid="conversation-first-workspace">
      <header className={styles.mobileBar}>
        <button className={styles.iconButton} type="button" aria-label="打開專案欄" onClick={() => setSidebarOpen(true)}>☰</button>
        <strong>{project?.title ?? "小說專案"}</strong>
        <button className={styles.iconButton} type="button" aria-label="打開作品結果" onClick={() => setArtifactOpen(true)}>◇</button>
      </header>
      {(sidebarOpen || artifactOpen) ? (
        <button className={styles.backdrop} type="button" aria-label="關閉抽屜" onClick={() => { setSidebarOpen(false); setArtifactOpen(false); }} />
      ) : null}
      <div className={styles.workspace} data-artifact-open={artifactOpen}>
        <aside className={styles.sidebar} data-open={sidebarOpen} aria-label="小說專案欄">
          <div className={styles.brandRow}>
            <span className={styles.brandMark}>文</span>
            <div><strong>{project?.title ?? "載入中"}</strong><span>獨立作品記憶</span></div>
          </div>
          <button className={styles.newSession} type="button" onClick={() => void newSession()} disabled={busy}>＋ 新對話</button>
          <input className={styles.searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜尋對話" aria-label="搜尋對話" />
          <div className={styles.sidebarHeading}>
            <span>{showArchived ? "含封存對話" : "最近對話"}</span>
            <button className={styles.quietButton} type="button" disabled={busy} onClick={() => setShowArchived((value) => !value)}>{showArchived ? "隱藏封存" : "顯示封存"}</button>
          </div>
          <div className={styles.sessionList}>
            {visibleSessions.map((session) => (
              <div className={styles.sessionRow} data-active={session.id === activeSessionId} key={session.id}>
                <button className={styles.sessionButton} type="button" disabled={busy} onClick={() => void chooseSession(session.id)}>{session.status === "archived" ? "〔封存〕" : ""}{session.title}</button>
                <span className={styles.sessionActions}>
                  <button className={styles.iconButton} type="button" title="重新命名" onClick={() => void renameSession(session)}>✎</button>
                  <button className={styles.iconButton} type="button" title="封存" onClick={() => void archiveSession(session)}>⌁</button>
                  <button className={`${styles.iconButton} ${styles.danger}`} type="button" title="刪除" onClick={() => void deleteSession(session)}>×</button>
                </span>
              </div>
            ))}
          </div>
          <div className={styles.sidebarHeading}><span>專案檔案與指令</span></div>
          <div className={styles.projectLinks}>
            <Link href={`/studio/project/${encodeURIComponent(projectId)}/write`}>章節正文</Link>
            <Link href={`/studio/project/${encodeURIComponent(projectId)}/story-bible`}>Story Bible</Link>
            <Link href={`/studio/project/${encodeURIComponent(projectId)}/characters`}>角色與關係</Link>
            <Link href={`/studio/project/${encodeURIComponent(projectId)}/world`}>世界規則</Link>
            <Link href={`/studio/project/${encodeURIComponent(projectId)}/timeline`}>時間線</Link>
             <Link href={`/studio/project/${encodeURIComponent(projectId)}/learning`}>閉端學習</Link>
             <Link href={`/studio/project/${encodeURIComponent(projectId)}/backups`}>備份與還原</Link>
             <button className={styles.quietButton} type="button" disabled={busy || !activeSession} onClick={() => void exportActiveConversationSummary()}>匯出目前對話摘要</button>
           </div>
          <div className={styles.sidebarHeading}><span>最近章節</span></div>
          <div className={styles.recentChapters}>
            {[...chapters].slice(-4).reverse().map((chapter) => (
              <Link href={`/studio/project/${encodeURIComponent(projectId)}/write?chapterId=${encodeURIComponent(chapter.id)}`} key={chapter.id}>{chapter.title}</Link>
            ))}
          </div>
        </aside>

        <section className={styles.main}>
          <header className={styles.threadHeader}>
            <div><h1>{activeSession?.title ?? "小說專案對話"}</h1><p>{currentChapter ? `目前章節：${currentChapter.title}` : "尚未指定章節"}</p></div>
            <div className={styles.rightActions}>
              <button className={styles.quietButton} type="button" onClick={() => setArtifactOpen((value) => !value)}>作品結果</button>
              <Link className={styles.quietButton} href={`/studio/project/${encodeURIComponent(projectId)}/write`}>進階工作區</Link>
            </div>
          </header>

          <div className={styles.thread} aria-live="polite">
            <div className={styles.threadInner}>
              {!messages.length && !loading ? (
                <section className={styles.welcome}>
                  <h2>把這部小說當成一個長期專案</h2>
                  <p>直接說你要續寫、改寫、建立角色、檢查矛盾、分析檔案，或開始故事回合。AI 只建立候選；按下採用前，正式正文與 RPG 狀態不會改變。</p>
                  <div className={styles.starterGrid}>
                    {["接續目前章節，寫出一個有後果的新場景。", "檢查目前作品的設定矛盾。", "建立一名能推動主線的新角色。", "開始 RPG 故事回合並給我 A／B／C。"].map((starter) => (
                      <button type="button" key={starter} onClick={() => setDraft(starter)}>{starter}</button>
                    ))}
                  </div>
                </section>
              ) : null}

              {messages.map((message) => {
                const rpgChoices = parseRpgChoices(message.content);
                const rpgAttempts = rpgChoices
                  ? messages.filter((candidate) =>
                    candidate.role === "user" && candidate.sourceMessageId === message.id)
                  : [];
                const rpgChoicesConsumed = rpgChoices
                  ? rpgAttempts.some((attempt) => {
                    const response = messages.filter((candidate) =>
                      candidate.role === "assistant" && candidate.parentMessageId === attempt.id).at(-1);
                    if (!response || ["pending", "streaming"].includes(response.status)) return true;
                    if (["failed", "cancelled"].includes(response.status)) return false;
                    const responseArtifacts = artifactsByMessage.get(response.id) ?? [];
                    return responseArtifacts.some((artifact) =>
                      artifact.artifactType === "rpg"
                      && ["candidate", "approved"].includes(artifact.status));
                  })
                  : false;
                const messageArtifacts = artifactsByMessage.get(message.id) ?? [];
                const invocation = invocationsByMessage.get(message.id);
                const messageInvocations = invocations.filter((item) => item.messageId === message.id);
                const retryParent = message.parentMessageId
                  ? messages.find((candidate) => candidate.id === message.parentMessageId) ?? null
                  : null;
                const retryNeedsAttachment = Boolean(retryParent?.attachmentIds.length);
                const canRegenerate = message.role === "assistant"
                  && message.status === "completed"
                  && !retryNeedsAttachment
                  && messageInvocations.some((item) => item.toolId.startsWith("closed-agent-os:"))
                  && !rpgChoices
                  && !messageArtifacts.some((item) => ["rpg", "learning_rule"].includes(item.artifactType));
                const hasComparableCandidate = Boolean(
                  message.sourceMessageId
                  && messageArtifacts.some((artifact) => (
                    (artifactsByMessage.get(message.sourceMessageId ?? "") ?? []).some((previous) => (
                      previous.artifactType === artifact.artifactType
                      && previous.targetStore === artifact.targetStore
                      && previous.targetRecordId === artifact.targetRecordId
                    ))
                  )),
                );
                return (
                  <article className={styles.message} data-role={message.role} data-status={message.status} key={message.id}>
                    <div className={styles.messageMeta}>
                      <strong>{messageLabel(message.role)}</strong>
                      <span>{formatTime(message.createdAt)}</span>
                      <span>{statusLabel(message.status)}</span>
                    </div>
                    {rpgChoices ? (
                      <>
                      <div className={styles.choices} data-testid="rpg-inline-choices">
                        {rpgChoices.choices.map((choice) => (
                          <button className={styles.choiceCard} type="button" key={choice.key} aria-label={`選項 ${choice.key}：${choice.title}；${choice.strategyLabel}；${choice.displayedChanceBand}`} title={choice.disabledReason ?? undefined} disabled={busy || rpgChoicesConsumed || !rpgChoices.envelope || Boolean(choice.disabledReason)} onClick={() => {
                            if (rpgChoices.envelope) void chooseRpgOption(rpgChoices.envelope, message.id, choice.key);
                          }}>
                            <span className={styles.choiceKey}>{choice.key} · {choice.strategyLabel}</span>
                            <h3>{choice.title}</h3>
                            <p>{choice.description}</p>
                            <span className={styles.choiceMeta}>風險 {choice.risk}/5 · {choice.displayedChanceBand}</span>
                            <span className={styles.choiceMeta}>已知成本：{choice.knownCosts.map((cost) => cost.label).join("、") || "無"}</span>
                            <span className={styles.choiceMeta}>{choice.consequenceTeaser}</span>
                            {choice.irreversibleWarning ? <strong>不可逆警告：{choice.irreversibleWarning}</strong> : null}
                            {choice.disabledReason ? <span role="status">目前不可選：{choice.disabledReason}</span> : null}
                          </button>
                        ))}
                      </div>
                      {rpgChoicesConsumed ? <p className={styles.emptyNote}>這張選擇卡已建立回合；請採用或放棄目前候選。</p> : null}
                      </>
                    ) : message.content ? (
                      <div className={styles.messageBody}>{message.content}</div>
                    ) : null}
                    {message.attachmentIds.map((attachmentId) => {
                      const attachment = attachmentsById.get(attachmentId);
                      return attachment ? (
                        <div className={styles.attachmentCard} key={attachment.id}>
                          <strong>{attachment.displayName}</strong> · {attachment.parsingStatus} · {Math.ceil(attachment.byteLength / 1024)} KB
                          <small> 僅本機分析 · 原始內容未保留</small>
                          {attachment.warnings?.length ? (
                            <details className={styles.evidenceDetails}>
                              <summary>DOCX 解析警告（{attachment.warnings.length}）</summary>
                              <ul>{attachment.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                            </details>
                          ) : null}
                        </div>
                      ) : null;
                    })}
                    {invocation && ["pending", "running"].includes(invocation.status) ? (
                      <div className={styles.progressCard}><span className={styles.pulse} /><span>{invocation.safeProgress?.message ?? progress}</span>{canStop ? <button className={styles.quietButton} type="button" onClick={stopGeneration}>停止</button> : null}</div>
                    ) : null}
                    {messageArtifacts.map((artifact) => (
                      <section className={styles.candidateCard} key={artifact.id} data-status={artifact.status}>
                        <h3>{artifact.artifactType === "rpg" ? "故事回合候選" : "Canon 候選"} · {artifact.status === "candidate" ? "等待採用" : artifact.status}</h3>
                        <p className={styles.candidatePreview}>{artifactStory(artifact)}</p>
                        {parseRpgCandidate(artifact) ? (
                          <details className={styles.outcomeDetails}>
                            <summary>行動結果與數值變化（預設收合）</summary>
                            <ul>{parseRpgCandidate(artifact)?.outcomeLines.map((line) => <li key={line}>{line}</li>)}</ul>
                          </details>
                        ) : null}
                        <div className={styles.candidateActions}>
                          <button type="button" onClick={() => void openArtifact(artifact, "candidate")}>查看完整候選</button>
                          <button type="button" onClick={() => void openArtifact(artifact, "diff")}>查看 Diff</button>
                          {hasComparableCandidate ? <button type="button" onClick={() => void openArtifact(artifact, "comparison")}>比較候選</button> : null}
                          {artifact.status === "candidate" ? <button className={styles.primaryAction} type="button" disabled={busy} onClick={() => void approveArtifact(artifact)}>採用</button> : null}
                          {artifact.status === "candidate" && canRegenerate ? <button type="button" disabled={busy} onClick={() => void regenerateMessage(message)}>重新產生</button> : null}
                          {artifact.status === "candidate" ? <button type="button" disabled={busy} onClick={() => void rejectArtifact(artifact)}>放棄</button> : null}
                        </div>
                      </section>
                    ))}
                    <div className={styles.candidateActions}>
                      {message.role === "user" && message.status === "completed" ? <button type="button" onClick={() => void editMessage(message)}>編輯並分支</button> : null}
                      {message.status === "completed" ? <button type="button" onClick={() => void createBranch(message)}>從這裡分支</button> : null}
                      {canRegenerate ? <button type="button" onClick={() => void regenerateMessage(message)}>重新產生</button> : null}
                      {(message.status === "failed" || message.status === "cancelled") && !retryNeedsAttachment ? <button type="button" onClick={() => void sendRequest(retryParent?.content ?? "")}>重試</button> : null}
                      {(message.status === "failed" || message.status === "cancelled") && retryNeedsAttachment ? <span className={styles.emptyNote}>請重新附加原檔後再試</span> : null}
                    </div>
                  </article>
                );
              })}
              {busy ? <div className={styles.progressCard}><span className={styles.pulse} /><span>{progress}</span>{canStop ? <button className={styles.quietButton} type="button" onClick={stopGeneration}>停止生成</button> : null}</div> : null}
              {safeError ? <section className={styles.resultCard} role="alert"><strong>{safeError.code}</strong><p>{safeError.message}</p>{retryAvailable ? <button type="button" disabled={busy} onClick={() => retryActionRef.current?.()}>{retryLabel}</button> : null}</section> : null}
              <div ref={threadEndRef} />
            </div>
          </div>

          <footer className={styles.composerWrap}>
            <div className={styles.composer}>
              {localAttachments.length ? (
                <div className={styles.attachmentStrip}>
                  {localAttachments.map((item) => (
                    <span className={styles.attachmentPill} key={item.localId}>
                      <span title={item.errorCode
                        ? `${item.errorCode}${item.errorCode === "OCR_REQUIRED" ? "：需先 OCR，或移除後重新選擇可解析檔案" : "：可重試，或移除後重新選擇檔案"}`
                        : undefined}>
                        {item.file.name} · {item.progress
                          ? `${item.progress.phase} ${item.progress.current}/${item.progress.total}`
                          : item.errorCode
                            ? `${item.status} · ${item.errorCode}${item.errorCode === "OCR_REQUIRED" ? "（需先 OCR／可重選）" : "（可重試／重選）"}`
                            : item.status}
                      </span>
                      {!busy && ["failed", "cancelled"].includes(item.status) ? (
                        <button className={styles.quietButton} type="button" onClick={() => updateLocalAttachment(item.localId, { status: "queued", errorCode: null })}>重試</button>
                      ) : null}
                      {!busy ? <button className={styles.iconButton} type="button" aria-label={`移除 ${item.file.name}`} onClick={() => setLocalAttachments((current) => current.filter((row) => row.localId !== item.localId))}>×</button> : null}
                    </span>
                  ))}
                  <label className={styles.rightsConfirm}>
                    <input
                      type="checkbox"
                      checked={rightsConfirmed}
                      disabled={busy}
                      onChange={(event) => setRightsConfirmed(event.target.checked)}
                    />
                    我確認擁有或已獲授權分析這些作品；只有整份學習匯入會使用此確認
                  </label>
                </div>
              ) : null}
              <textarea value={draft} disabled={busy || !activeSession} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="直接說你想對這部小說做什麼……" aria-label="小說專案訊息" />
              <div className={styles.composerActions}>
                <div className={styles.leftActions}>
                  <label className={styles.quietButton} title="附加本機檔案">＋ 檔案<input className={styles.fileInput} type="file" multiple accept=".txt,.md,.markdown,.html,.htm,.json,.pdf,.docx" onChange={onFilesSelected} disabled={busy} /></label>
                  <button className={styles.quietButton} type="button" onClick={() => setArtifactOpen((value) => !value)}>結果</button>
                </div>
                <div className={styles.rightActions}>
                  {canStop ? <button className={styles.quietButton} type="button" onClick={stopGeneration}>停止</button> : null}
                  <button className={styles.sendButton} type="button" onClick={() => void sendRequest()} disabled={busy || !activeSession || (!draft.trim() && !localAttachments.length)}>送出</button>
                </div>
              </div>
            </div>
            <div className={styles.composerMeta}>
              <span>Enter 送出 · Shift＋Enter 換行</span>
              <span>·</span>
              <span className={styles.localBadge}>
                {latestInvocation?.actualExecutor ?? (busy ? "Closed Agent OS" : "Closed-only")}
                {latestInvocation?.modelId ? ` · ${latestInvocation.modelId}` : ""}
                {` · 資料${latestInvocation?.dataLeftDevice ? "已" : "未"}離開裝置`}
              </span>
            </div>
          </footer>
        </section>

        {artifactOpen ? (
          <aside className={styles.artifactDrawer} aria-label="作品結果抽屜">
            <header className={styles.artifactHeader}><strong>作品結果</strong><button className={styles.iconButton} type="button" aria-label="關閉作品結果" onClick={() => setArtifactOpen(false)}>×</button></header>
            <div className={styles.artifactList}>
              {selectedArtifact ? (
                <section className={styles.drawerCard}>
                  <h3>{selectedArtifact.artifactType} · {selectedArtifact.status}</h3>
                  {artifactView === "diff" || artifactView === "comparison" ? (
                    <div className={styles.diffGrid} data-testid="artifact-diff">
                      <section className={styles.diffPane} data-side="before">
                        <h4>{artifactView === "comparison" ? "上一個候選" : "修改前"}</h4>
                        <pre>{artifactBefore || (artifactView === "comparison" ? "（找不到上一個候選）" : "（目前尚無正式內容）")}</pre>
                      </section>
                      <section className={styles.diffPane} data-side="candidate">
                        <h4>{artifactView === "comparison" ? "新候選" : "候選內容"}</h4>
                        <pre>{artifactDraft || artifactStory(selectedArtifact)}</pre>
                      </section>
                    </div>
                  ) : (
                    <textarea className={styles.renameInput} rows={16} value={artifactDraft || artifactStory(selectedArtifact)} disabled={selectedArtifact.status !== "candidate" || ["rpg", "learning_rule"].includes(selectedArtifact.artifactType)} onChange={(event) => setArtifactDraft(event.target.value)} />
                  )}
                  <details className={styles.evidenceDetails}>
                    <summary>技術證據</summary>
                    <pre>{JSON.stringify({
                      candidateDigest: selectedArtifact.candidateDigest,
                      sourceRevision: selectedArtifact.sourceRevision,
                      targetStore: selectedArtifact.targetStore,
                      targetRecordId: selectedArtifact.targetRecordId,
                      canonicalMutationCount: selectedArtifact.status === "approved" ? 1 : 0,
                      toolInvocations: selectedArtifactInvocations.map((invocation) => ({
                        taskId: invocation.taskId,
                        toolId: invocation.toolId,
                        taskType: invocation.taskType,
                        status: invocation.status,
                        actualExecutor: invocation.actualExecutor,
                        modelId: invocation.modelId,
                        modelDigest: invocation.modelDigest,
                        inputDigest: invocation.inputDigest,
                        contextDigest: invocation.contextDigest,
                        executionReceipt: invocation.executionReceipt,
                        externalRequest: invocation.externalRequest,
                        dataLeftDevice: invocation.dataLeftDevice,
                        canonicalMutationCount: invocation.canonicalMutationCount,
                        safeErrorCode: invocation.safeErrorCode,
                      })),
                    }, null, 2)}</pre>
                  </details>
                  {selectedArtifact.status === "candidate" ? (
                    <div className={styles.candidateActions}>
                      <button className={styles.primaryAction} type="button" disabled={busy} onClick={() => void approveArtifact(
                        selectedArtifact,
                        ["rpg", "learning_rule"].includes(selectedArtifact.artifactType)
                          ? undefined
                          : artifactDraft || artifactStory(selectedArtifact),
                      )}>{selectedArtifact.artifactType === "rpg"
                          ? "採用回合"
                          : selectedArtifact.artifactType === "learning_rule"
                            ? "採用整份學習規則"
                            : "修改後採用"}</button>
                      <button type="button" disabled={busy} onClick={() => void rejectArtifact(selectedArtifact)}>放棄</button>
                    </div>
                  ) : null}
                </section>
              ) : drawer?.kind === "status" || drawer?.kind === "attachments" ? (
                <section className={styles.drawerCard}><h3>{drawer.title}</h3><pre>{drawer.content}</pre>{drawer.kind === "status" && drawer.title === "回復備份" ? <Link href={`/studio/project/${encodeURIComponent(projectId)}/backups`}>前往備份工作區</Link> : null}</section>
              ) : artifacts.length ? (
                [...artifacts].reverse().map((artifact) => (
                  <button className={styles.drawerCard} type="button" key={artifact.id} onClick={() => void openArtifact(artifact)}><h3>{artifact.artifactType} · {artifact.status}</h3><p className={styles.candidatePreview}>{artifactStory(artifact)}</p></button>
                ))
              ) : <p className={styles.emptyNote}>候選、Diff、RPG 狀態與附件分析會出現在這裡。</p>}
            </div>
          </aside>
        ) : null}
      </div>
      {loading ? <p className={styles.emptyNote}>正在載入對話……</p> : null}
    </main>
  );
}
