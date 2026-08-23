"use client";

import { useMemo } from "react";
import type {
  ConversationArtifact,
  ConversationAttachment,
  ConversationMessage,
  ConversationToolInvocation,
  StoryState,
} from "@/lib/novel-ai/domain";
import {
  isGameStoryPlayMode,
  STORY_PLAY_MODE_LABELS,
  type StoryPlayModeId,
} from "@/lib/novel-ai/domain/play-mode";
import { readRpgProgression, type RpgMode } from "@/lib/novel-ai/game/progression/rpg-progression";
import { useConversationTimelineWindow } from "../hooks/use-conversation-timeline-window";
import { useConversationApproval } from "../hooks/use-conversation-approval";
import { useConversationAttachments } from "../hooks/use-conversation-attachments";
import { useConversationBranch } from "../hooks/use-conversation-branch";
import type { ConversationMessageActions } from "./conversation-types";
import { parseRpgChoices } from "./conversation-presentation";
import { MessageRow } from "./message-row";
import { ToolProgressCard } from "./tool-progress-card";
import styles from "../conversation.module.css";

function progressionMode(playMode: StoryPlayModeId): RpgMode {
  if (playMode === "management") return "management";
  if (playMode === "romance") return "cultivation";
  return "adventure";
}

type DashboardTarget = {
  messageId: string;
  placement: "choices" | "afterCandidate";
} | null;

const dashboardTargetCache = new WeakMap<
  ConversationMessage[],
  WeakMap<ConversationArtifact[], DashboardTarget>
>();

function findDashboardTarget(
  messages: ConversationMessage[],
  artifacts: ConversationArtifact[],
  artifactsByMessage: Map<string, ConversationArtifact[]>,
): DashboardTarget {
  const choiceMessages: ConversationMessage[] = [];
  const attemptsBySource = new Map<string, ConversationMessage[]>();
  const responseByParent = new Map<string, ConversationMessage>();
  for (const message of messages) {
    if (parseRpgChoices(message.content)) choiceMessages.push(message);
    if (message.role === "user" && message.sourceMessageId) {
      const attempts = attemptsBySource.get(message.sourceMessageId) ?? [];
      attempts.push(message);
      attemptsBySource.set(message.sourceMessageId, attempts);
    }
    if (message.role === "assistant" && message.parentMessageId) {
      responseByParent.set(message.parentMessageId, message);
    }
  }
  for (let index = choiceMessages.length - 1; index >= 0; index -= 1) {
    const choiceMessage = choiceMessages[index];
    const attempts = attemptsBySource.get(choiceMessage.id) ?? [];
    const consumed = attempts.some((attempt) => {
      const response = responseByParent.get(attempt.id);
      if (!response || ["pending", "streaming"].includes(response.status)) return true;
      if (["failed", "cancelled"].includes(response.status)) return false;
      return (artifactsByMessage.get(response.id) ?? []).some((artifact) => (
        artifact.artifactType === "rpg" && ["candidate", "approved"].includes(artifact.status)
      ));
    });
    if (!consumed) return { messageId: choiceMessage.id, placement: "choices" as const };
  }
  const approved = [...artifacts].reverse().find((artifact) => (
    artifact.artifactType === "rpg" && artifact.status === "approved"
  ));
  return approved
    ? { messageId: approved.sourceMessageId, placement: "afterCandidate" as const }
    : null;
}

function readDashboardTarget(
  messages: ConversationMessage[],
  artifacts: ConversationArtifact[],
  artifactsByMessage: Map<string, ConversationArtifact[]>,
): DashboardTarget {
  let byArtifacts = dashboardTargetCache.get(messages);
  if (!byArtifacts) {
    byArtifacts = new WeakMap<ConversationArtifact[], DashboardTarget>();
    dashboardTargetCache.set(messages, byArtifacts);
  }
  if (byArtifacts.has(artifacts)) return byArtifacts.get(artifacts) ?? null;
  const target = findDashboardTarget(messages, artifacts, artifactsByMessage);
  byArtifacts.set(artifacts, target);
  return target;
}

function PlayModeDashboard({
  projectId,
  playMode,
  storyState,
}: {
  projectId: string;
  playMode: StoryPlayModeId;
  storyState: StoryState;
}) {
  const progression = useMemo(
    () => readRpgProgression(storyState, projectId, progressionMode(playMode)),
    [playMode, projectId, storyState],
  );
  const relationship = (key: string, fallback = 10) => Math.round(storyState.relationships[key] ?? fallback);
  const resource = (key: string, fallback: number) => Math.round(storyState.resources[key] ?? fallback);
  const activeQuests = Object.values(storyState.questStates).filter((value) => Number(value) > 0).length;
  const equipped = progression.inventory.filter((item) => item.equipped && item.quantity > 0);
  const metrics: Array<{
    label: string;
    value: string;
    progress: number | null;
    note: string;
  }> = playMode === "management"
    ? [
        { label: "資金", value: `$${progression.management.cash.toLocaleString("zh-TW")}`, progress: null, note: "可用營運資源" },
        { label: "人力", value: `${progression.management.staff} 人`, progress: null, note: `士氣 ${progression.management.morale}` },
        { label: "品質", value: `${resource("management.quality", 70)} / 100`, progress: resource("management.quality", 70), note: "交付與口碑基礎" },
        { label: "聲望", value: `${progression.management.reputation} / 100`, progress: progression.management.reputation, note: "影響合作門檻" },
        { label: "風險", value: `${progression.management.risk} / 100`, progress: progression.management.risk, note: "愈低愈穩定" },
      ]
    : playMode === "romance"
      ? [
          { label: "關係", value: `${relationship("romance.affection")} / 100`, progress: relationship("romance.affection"), note: "目前情感距離" },
          { label: "信任", value: `${relationship("romance.trust")} / 100`, progress: relationship("romance.trust"), note: "決定坦白與合作" },
          { label: "事件進度", value: `${resource("romance.eventProgress", 0)} / 100`, progress: resource("romance.eventProgress", 0), note: "共同事件推進" },
          { label: "人物成長", value: `${resource("romance.personalGrowth", 0)} / 100`, progress: resource("romance.personalGrowth", 0), note: `個人界線與承擔・Lv.${progression.level}` },
          { label: "行動點", value: `${progression.status.actionPoints} / 3`, progress: progression.status.actionPoints / 3 * 100, note: "本回合可用" },
        ]
      : [
          { label: "綜合能力", value: `${progression.powerScore}`, progress: progression.powerScore, note: `等級 Lv.${progression.level}` },
          { label: "目前裝備", value: equipped[0]?.name ?? "基礎裝備", progress: null, note: `${equipped.length} 件已裝備` },
          { label: "任務", value: `${activeQuests} 項進行中`, progress: progression.journey.mainlineProgress, note: `主線 ${progression.journey.mainlineProgress}%` },
          { label: "體力", value: `${progression.status.stamina} / 100`, progress: progression.status.stamina, note: `HP ${progression.status.hp}` },
          { label: "行動點", value: `${progression.status.actionPoints} / 3`, progress: progression.status.actionPoints / 3 * 100, note: "本回合可用" },
        ];
  const detail = playMode === "management"
    ? `第 ${progression.day} 日・士氣 ${progression.management.morale}・滿意度 ${progression.management.satisfaction}・預估淨利 ${progression.management.expectedNetProfit.toLocaleString("zh-TW")}`
    : playMode === "romance"
      ? `第 ${progression.turn + 1} 回合・情緒 ${progression.status.mood}・壓力 ${progression.status.stress}・共同成長事件會在選擇後同步更新。`
      : `第 ${progression.turn + 1} 回合・等級 ${progression.level}・HP ${progression.status.hp}・背包 ${progression.inventory.filter((item) => item.quantity > 0).length} 類。`;
  return (
    <section className={styles.playDashboard} data-play-mode={playMode} aria-label={`${STORY_PLAY_MODE_LABELS[playMode]}狀態儀表板`}>
      <div className={styles.playDashboardHeading}>
        <div className={styles.playDashboardIdentity}>
          <b aria-hidden="true">{playMode === "management" ? "營" : playMode === "romance" ? "戀" : "冒"}</b>
          <div><span>PLAY STATUS · 更新後狀態</span><strong>{STORY_PLAY_MODE_LABELS[playMode]}</strong><small>{playMode === "management" ? `第 ${progression.day} 日` : `第 ${progression.turn + 1} 回合`} · 選擇後自動同步</small></div>
        </div>
        <div className={styles.playDashboardSync}><i />正式 StoryState</div>
      </div>
      <div className={styles.playDashboardGoal}><span>目前主線</span><strong>{progression.journey.mainlineGoal}</strong></div>
      <div className={styles.playMetricGrid}>
        {metrics.map((metric, index) => (
          <div className={styles.playMetric} key={metric.label} data-metric-index={index + 1}>
            <div><span>{metric.label}</span><em>{String(index + 1).padStart(2, "0")}</em></div>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
            {metric.progress !== null ? <progress max={100} value={Math.max(0, Math.min(100, metric.progress))} /> : null}
          </div>
        ))}
      </div>
      <details className={styles.playDashboardDetails}>
        <summary>查看完整狀態與本回合脈絡</summary>
        <p>{detail}</p>
      </details>
    </section>
  );
}

export function MessageTimeline({
  projectId,
  sessionId,
  messages,
  artifacts,
  invocations,
  attachments,
  loading,
  busy,
  regenerationReady,
  canStop,
  progress,
  safeError,
  retryAvailable,
  retryLabel,
  branchPendingMessageIds,
  fixedPlayMode,
  storyState,
  actions,
  onStarter,
  onRetry,
}: {
  projectId: string;
  sessionId: string;
  messages: ConversationMessage[];
  artifacts: ConversationArtifact[];
  invocations: ConversationToolInvocation[];
  attachments: ConversationAttachment[];
  loading: boolean;
  busy: boolean;
  regenerationReady: boolean;
  canStop: boolean;
  progress: string;
  safeError: { code: string; message: string } | null;
  retryAvailable: boolean;
  retryLabel: string;
  branchPendingMessageIds: ReadonlySet<string>;
  fixedPlayMode: StoryPlayModeId | null;
  storyState: StoryState | null;
  actions: ConversationMessageActions;
  onStarter: (starter: string) => void;
  onRetry: () => void;
}) {
  const gameStory = fixedPlayMode ? isGameStoryPlayMode(fixedPlayMode) : false;
  const starters = gameStory
    ? [
        "繼續目前故事。",
        "檢查目前作品的設定矛盾。",
        "查看目前狀態與資源。",
        "建立一名能推動主線的新角色。",
      ]
    : [
        "接續目前章節，寫出一個有後果的新場景。",
        "檢查目前作品的設定矛盾。",
        "建立一名能推動主線的新角色。",
        "規劃下一章大綱。",
      ];
  const { artifactsByMessage } = useConversationApproval(artifacts);
  const { attachmentsById } = useConversationAttachments(attachments);
  const { lineageByMessageId } = useConversationBranch(messages);
  const invocationsByMessage = useMemo(() => new Map(
    invocations.map((invocation) => [invocation.messageId, invocation]),
  ), [invocations]);
  const dashboardTarget = readDashboardTarget(messages, artifacts, artifactsByMessage);
  const {
    containerRef,
    visibleMessages,
    hiddenMessageCount,
    renderedMessageCount,
    loadEarlier,
    onScroll,
    cancelSessionRestoreForInteraction,
  } = useConversationTimelineWindow({
    projectId,
    sessionId,
    messages,
    updateToken: `${artifacts.length}:${invocations.length}:${busy}:${progress}`,
  });

  return (
    <div
      className={styles.thread}
      aria-live="polite"
      ref={containerRef}
      onScroll={onScroll}
      onWheel={cancelSessionRestoreForInteraction}
      onTouchStart={cancelSessionRestoreForInteraction}
      onPointerDown={cancelSessionRestoreForInteraction}
      onKeyDown={cancelSessionRestoreForInteraction}
      data-testid="conversation-message-timeline"
      data-total-messages={messages.length}
      data-rendered-messages={renderedMessageCount}
    >
      <div className={styles.threadInner}>
        {gameStory && fixedPlayMode && storyState && !dashboardTarget ? (
          <PlayModeDashboard projectId={projectId} playMode={fixedPlayMode} storyState={storyState} />
        ) : null}
        {!messages.length && !loading ? (
          <section className={styles.welcome}>
            <h2>{!fixedPlayMode ? "正在確認作品玩法" : gameStory ? `繼續${STORY_PLAY_MODE_LABELS[fixedPlayMode]}` : "把這部小說當成一個長期專案"}</h2>
            <p>{!fixedPlayMode
              ? "玩法資料確認完成前不會啟動續寫，避免把原本的三選一存檔誤當成一般小說。"
              : gameStory
              ? "玩法已跟隨作品存檔。按下繼續後，系統會自動建立下一回合與可選路線；不必再次指定玩法。"
              : "直接說你要續寫、改寫、建立角色、檢查矛盾或分析檔案。AI 只建立候選；按下採用前，正式正文不會改變。"}</p>
            {fixedPlayMode ? <div className={styles.starterGrid}>
              {starters.map((starter) => (
                <button type="button" key={starter} onClick={() => onStarter(starter)}>{starter}</button>
              ))}
            </div> : null}
          </section>
        ) : null}

        {hiddenMessageCount ? (
          <div className={styles.historyWindowNotice} role="status">
            <button type="button" className={styles.quietButton} onClick={loadEarlier}>
              載入較早訊息（尚有 {hiddenMessageCount} 則）
            </button>
          </div>
        ) : null}

        {visibleMessages.map((message) => {
          const showDashboard = gameStory
            && fixedPlayMode
            && storyState
            && dashboardTarget?.messageId === message.id;
          return <MessageRow
            key={message.id}
            message={message}
            allMessages={messages}
            allInvocations={invocations}
            artifactsByMessage={artifactsByMessage}
            invocationsByMessage={invocationsByMessage}
            attachmentsById={attachmentsById}
            busy={busy}
            regenerationReady={regenerationReady}
            canStop={canStop}
            progress={progress}
            branchPending={branchPendingMessageIds.has(message.id)}
            actions={actions}
            lineage={lineageByMessageId.get(message.id) ?? { rootId: message.id, depth: 0 }}
            playDashboard={showDashboard ? <PlayModeDashboard projectId={projectId} playMode={fixedPlayMode} storyState={storyState} /> : null}
            playDashboardPlacement={showDashboard ? dashboardTarget.placement : null}
          />;
        })}
        {busy ? <ToolProgressCard progress={progress} canStop={canStop} onStop={actions.stopGeneration} label="停止生成" /> : null}
        {safeError ? <section className={styles.resultCard} role="alert"><strong>{safeError.code}</strong><p>{safeError.message}</p>{retryAvailable ? <button type="button" disabled={busy} onClick={onRetry}>{retryLabel}</button> : null}</section> : null}
        <div data-testid="conversation-timeline-end" />
      </div>
    </div>
  );
}
