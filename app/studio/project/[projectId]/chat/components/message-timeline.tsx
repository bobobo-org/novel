"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  Chapter,
  ConversationArtifact,
  ConversationAttachment,
  ConversationMessage,
  ConversationToolInvocation,
  Character,
  CharacterRelationship,
  NovelProject,
  StoryBible,
  StoryState,
  World,
} from "@/lib/novel-ai/domain";
import { activeStoryWorlds } from "@/lib/novel-ai/domain/active-story-context";
import {
  isGameStoryPlayMode,
  STORY_PLAY_MODE_LABELS,
  type StoryPlayModeId,
} from "@/lib/novel-ai/domain/play-mode";
import {
  readRpgProgression,
  RPG_STAT_DEFINITIONS,
  type RpgMode,
} from "@/lib/novel-ai/game/progression/rpg-progression";
import { readLifeManagementSnapshot } from "@/lib/novel-ai/game/life-management-simulation";
import { useConversationTimelineWindow } from "../hooks/use-conversation-timeline-window";
import { useConversationApproval } from "../hooks/use-conversation-approval";
import { useConversationAttachments } from "../hooks/use-conversation-attachments";
import { useConversationBranch } from "../hooks/use-conversation-branch";
import { inspectRpgChoiceTurn } from "../hooks/use-conversation-rpg";
import { findRpgChoiceRecoveryTarget } from "../conversation-workspace-support";
import type { ConversationMessageActions } from "./conversation-types";
import { parseRpgChoices } from "./conversation-presentation";
import { MessageRow } from "./message-row";
import { ToolProgressCard } from "./tool-progress-card";
import { friendlyConversationExecutionError } from "./execution-trace-model";
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
  WeakMap<ConversationArtifact[], WeakMap<ConversationToolInvocation[], DashboardTarget>>
>();

function findDashboardTarget(
  messages: ConversationMessage[],
  artifacts: ConversationArtifact[],
  invocations: ConversationToolInvocation[],
): DashboardTarget {
  const choiceMessages: ConversationMessage[] = [];
  for (const message of messages) {
    if (parseRpgChoices(message.content)) choiceMessages.push(message);
  }
  for (let index = choiceMessages.length - 1; index >= 0; index -= 1) {
    const choiceMessage = choiceMessages[index];
    if (!inspectRpgChoiceTurn(
      messages,
      artifacts,
      choiceMessage.id,
      invocations,
    ).closed) {
      return { messageId: choiceMessage.id, placement: "choices" as const };
    }
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
  invocations: ConversationToolInvocation[],
): DashboardTarget {
  let byArtifacts = dashboardTargetCache.get(messages);
  if (!byArtifacts) {
    byArtifacts = new WeakMap<ConversationArtifact[], WeakMap<ConversationToolInvocation[], DashboardTarget>>();
    dashboardTargetCache.set(messages, byArtifacts);
  }
  let byInvocations = byArtifacts.get(artifacts);
  if (!byInvocations) {
    byInvocations = new WeakMap<ConversationToolInvocation[], DashboardTarget>();
    byArtifacts.set(artifacts, byInvocations);
  }
  if (byInvocations.has(invocations)) return byInvocations.get(invocations) ?? null;
  const target = findDashboardTarget(messages, artifacts, invocations);
  byInvocations.set(invocations, target);
  return target;
}

type DashboardFact = {
  label: string;
  value: string;
  tone?: "normal" | "warning";
};

const DASHBOARD_STATE_LABELS: Record<string, string> = {
  "rpg.partyTrust": "隊伍信任",
  "romance.affection": "關係",
  "romance.trust": "信任",
  "romance.eventProgress": "事件進度",
  "romance.personalGrowth": "人物成長",
  "career.skillGrowth": "專業成長",
  "career.popularity": "人氣",
  "career.publicImage": "公眾形象",
  "career.portfolio": "作品履歷",
  "career.auditions": "試鏡紀錄",
  "career.income": "演藝收入",
  "career.contractRisk": "合約風險",
  "career.scandalRisk": "輿情風險",
  "career.industryTrust": "業界信任",
  "career.scheduleControl": "檔期掌控",
  "management.cash": "資金",
  "management.staff": "人力",
  "management.morale": "士氣",
  "management.quality": "品質",
  "management.reputation": "聲望",
  "management.risk": "風險",
  "management.satisfaction": "滿意度",
  "management.technology": "技術",
  "management.marketShare": "市占",
  "management.inventory": "庫存",
  "management.capacity": "產能",
  "management.lastRevenue": "最近收入",
  "management.lastProfit": "最近淨利",
  "currency.spiritStone": "靈石",
  "currency.guildToken": "公會代幣",
  "status.hp": "生命",
  "status.stamina": "體力",
  "status.spirit": "精神",
  "status.fatigue": "疲勞",
  "status.stress": "壓力",
  "status.mood": "心情",
  "status.health": "健康",
  "status.focus": "專注",
  "game.actionPoints": "行動點",
  "rpg.mainArc": "世界危機主線",
  "growth.main": "人物成長主線",
  "management.survive90": "組織生存主線",
};

const RECENT_OUTCOME_LABELS: Record<string, string> = {
  critical_success: "大成功",
  success: "成功",
  partial_success: "部分成功",
  failure: "受挫但故事繼續",
};

function ownFiniteNumber(record: Record<string, number>, key: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return null;
  const value = record[key];
  return Number.isFinite(value) ? Math.round(value) : null;
}

function readableStateLabel(key: string, fallbackPrefix: string, index: number) {
  if (DASHBOARD_STATE_LABELS[key]) return DASHBOARD_STATE_LABELS[key];
  const tail = key.split(/[.]/u).at(-1)?.replace(/([a-z])([A-Z])/gu, "$1 $2").trim();
  if (tail && /[\u3400-\u9fff]/u.test(tail)) return tail;
  return `${fallbackPrefix} ${index + 1}`;
}

function dashboardValue(value: string | number, suffix = "") {
  if (typeof value === "number") return `${value.toLocaleString("zh-TW")}${suffix}`;
  const numeric = Number(value);
  return Number.isFinite(numeric) && String(value).trim() !== ""
    ? `${numeric.toLocaleString("zh-TW")}${suffix}`
    : String(value);
}

function DashboardFactGrid({ facts }: { facts: DashboardFact[] }) {
  if (!facts.length) return <p className={styles.playDashboardEmpty}>目前尚無已寫入的資料。</p>;
  return (
    <dl className={styles.playDashboardFactGrid}>
      {facts.map((fact, index) => (
        <div key={`${fact.label}:${index}`} data-tone={fact.tone ?? "normal"}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PlayModeDashboard({
  projectId,
  playMode,
  storyState,
  openRequest,
}: {
  projectId: string;
  playMode: StoryPlayModeId;
  storyState: StoryState;
  openRequest: number;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailPanelId = useId();
  const dashboardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (openRequest <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      setDetailsOpen(true);
      dashboardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openRequest]);
  const progression = useMemo(
    () => readRpgProgression(storyState, projectId, progressionMode(playMode)),
    [playMode, projectId, storyState],
  );
  const lifeManagement = useMemo(
    () => playMode === "management" ? readLifeManagementSnapshot(storyState) : null,
    [playMode, storyState],
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
  const managementFacts: DashboardFact[] = playMode === "management"
    ? [
        { label: "人生階段", value: `Lv.${lifeManagement?.phase.level ?? 1} ${lifeManagement?.phase.name ?? "新人"}` },
        { label: "每日時間", value: `${lifeManagement?.dailyTimeBudget ?? 12} 點` },
        { label: "授權容量", value: `${lifeManagement?.delegationCapacity ?? 0} 人／項` },
        { label: "資金", value: dashboardValue(progression.management.cash) },
        { label: "人力", value: dashboardValue(progression.management.staff, " 人") },
        { label: "士氣", value: dashboardValue(progression.management.morale, " / 100") },
        { label: "品質", value: dashboardValue(resource("management.quality", 70), " / 100") },
        { label: "聲望", value: dashboardValue(progression.management.reputation, " / 100") },
        {
          label: "風險",
          value: dashboardValue(progression.management.risk, " / 100"),
          tone: progression.management.risk >= 60 ? "warning" : "normal",
        },
        { label: "滿意度", value: dashboardValue(progression.management.satisfaction, " / 100") },
        { label: "技術", value: dashboardValue(progression.management.technology, " / 100") },
        { label: "市占", value: dashboardValue(progression.management.marketShare, " / 100") },
        { label: "庫存", value: dashboardValue(resource("management.inventory", 100)) },
        { label: "產能", value: dashboardValue(resource("management.capacity", 90)) },
        { label: "家庭", value: dashboardValue(lifeManagement?.dimensions.家庭 ?? 55, " / 100") },
        { label: "健康", value: dashboardValue(lifeManagement?.dimensions.健康 ?? 80, " / 100") },
        { label: "傳承", value: dashboardValue(lifeManagement?.dimensions.傳承 ?? 0, " / 100") },
        {
          label: "人才流失風險",
          value: dashboardValue(lifeManagement?.retentionRisk ?? 20, " / 100"),
          tone: (lifeManagement?.retentionRisk ?? 0) >= 60 ? "warning" : "normal",
        },
      ]
    : [];
  if (playMode === "management") {
    const storedRevenue = ownFiniteNumber(storyState.resources, "management.lastRevenue");
    const storedProfit = ownFiniteNumber(storyState.resources, "management.lastProfit");
    const revenue = storedRevenue ?? progression.management.expectedRevenue;
    const profit = storedProfit ?? progression.management.expectedNetProfit;
    managementFacts.push(
      { label: storedRevenue === null ? "預估收入" : "最近收入", value: dashboardValue(revenue) },
      { label: storedRevenue === null || storedProfit === null ? "預估成本" : "最近成本", value: dashboardValue(revenue - profit) },
      { label: storedProfit === null ? "預估淨利" : "最近淨利", value: dashboardValue(profit), tone: profit < 0 ? "warning" : "normal" },
    );
  }

  const rpgFacts: DashboardFact[] = playMode !== "management" && playMode !== "romance"
    ? RPG_STAT_DEFINITIONS.map((definition) => ({
        label: definition.labels.adventure,
        value: dashboardValue(progression.stats[definition.key], " / 100"),
      }))
    : [];
  if (playMode !== "management" && playMode !== "romance") {
    rpgFacts.push(
      { label: "生命", value: dashboardValue(progression.status.hp, " / 100") },
      { label: "體力", value: dashboardValue(progression.status.stamina, " / 100") },
      { label: "精神", value: dashboardValue(progression.status.spirit, " / 100") },
      { label: "行動點", value: dashboardValue(progression.status.actionPoints) },
    );
  }

  const romanceFacts: DashboardFact[] = playMode === "romance"
    ? [
        { label: "關係", value: dashboardValue(relationship("romance.affection"), " / 100") },
        { label: "信任", value: dashboardValue(relationship("romance.trust"), " / 100") },
        { label: "事件進度", value: dashboardValue(resource("romance.eventProgress", 0), " / 100") },
        { label: "人物成長", value: dashboardValue(resource("romance.personalGrowth", 0), " / 100") },
        { label: "專業成長", value: dashboardValue(resource("career.skillGrowth", 0), " / 100") },
        { label: "人氣", value: dashboardValue(resource("career.popularity", 0), " / 100") },
        { label: "公眾形象", value: dashboardValue(resource("career.publicImage", 0), " / 100") },
        { label: "作品履歷", value: dashboardValue(resource("career.portfolio", 0)) },
        { label: "心情", value: dashboardValue(progression.status.mood, " / 100") },
        { label: "壓力", value: dashboardValue(progression.status.stress, " / 100") },
        { label: "行動點", value: dashboardValue(progression.status.actionPoints) },
      ]
    : [];

  const relationshipFacts: DashboardFact[] = Object.entries(storyState.relationships).map(([key, value], index) => ({
    label: readableStateLabel(key, "人物關係", index),
    value: dashboardValue(value, " / 100"),
  }));
  const knownInventoryIds = new Set(progression.inventory.map((item) => item.itemId));
  const inventoryFacts: DashboardFact[] = [
    ...progression.inventory.map((item) => ({
      label: item.name,
      value: `${item.quantity.toLocaleString("zh-TW")} 件${item.equipped ? "・已裝備" : ""}`,
    })),
    ...storyState.inventory.filter((itemId) => !knownInventoryIds.has(itemId)).map((itemId) => ({
      label: "自訂物品",
      value: itemId,
    })),
  ];
  if (storyState.money !== null) inventoryFacts.unshift({ label: "金錢", value: dashboardValue(Math.round(storyState.money)) });
  for (const key of ["currency.spiritStone", "currency.guildToken"] as const) {
    const value = ownFiniteNumber(storyState.resources, key);
    if (value !== null) inventoryFacts.push({ label: DASHBOARD_STATE_LABELS[key], value: dashboardValue(value) });
  }

  const questFacts: DashboardFact[] = Object.entries(storyState.questStates).map(([key, value], index) => ({
    label: readableStateLabel(key, "任務", index),
    value: dashboardValue(value, Number.isFinite(Number(value)) ? "%" : ""),
  }));
  const milestoneFacts: DashboardFact[] = Object.entries(storyState.achievementStates)
    .filter(([, value]) => String(value).trim() !== "" && String(value) !== "0")
    .map(([key, value], index) => ({
      label: readableStateLabel(key, "里程碑", index),
      value: dashboardValue(value, Number.isFinite(Number(value)) ? "%" : ""),
    }));

  const contextualResourceKeys = playMode === "management"
    ? ["management.satisfaction", "management.technology", "management.marketShare", "management.inventory", "management.capacity"]
    : playMode === "romance"
      ? ["status.mood", "status.stress", "status.health", "status.focus", "career.contractRisk", "career.scandalRisk", "game.actionPoints"]
      : ["status.hp", "status.spirit", "status.fatigue", "status.stress", "status.health", "status.focus"];
  const resourceFacts: DashboardFact[] = contextualResourceKeys.flatMap((key) => {
    const value = ownFiniteNumber(storyState.resources, key);
    return value === null ? [] : [{ label: DASHBOARD_STATE_LABELS[key] ?? key, value: dashboardValue(value) }];
  });

  const recentFacts: DashboardFact[] = [];
  const day = ownFiniteNumber(storyState.resources, "game.day");
  const turn = ownFiniteNumber(storyState.resources, "game.turn");
  if (day !== null) recentFacts.push({ label: "目前日程", value: `第 ${day} 日` });
  if (turn !== null) recentFacts.push({ label: "已完成回合", value: `${turn} 回合` });
  if (storyState.timeState) recentFacts.push({ label: "故事時間", value: storyState.timeState });
  if (storyState.locationState) recentFacts.push({ label: "目前地點", value: storyState.locationState });
  if (storyState.riskState) recentFacts.push({ label: "風險狀態", value: storyState.riskState });
  const lastOutcome = storyState.worldFlags["rpg.lastOutcome"];
  if (typeof lastOutcome === "string" && RECENT_OUTCOME_LABELS[lastOutcome]) {
    recentFacts.push({ label: "最近結果", value: RECENT_OUTCOME_LABELS[lastOutcome] });
  }
  for (const consequence of storyState.rpgState?.pendingConsequences ?? []) {
    if (["pending", "triggered"].includes(consequence.status) && consequence.narrativeHint) {
      recentFacts.push({ label: consequence.status === "triggered" ? "已觸發後果" : "待回應後果", value: consequence.narrativeHint });
    }
  }
  return (
    <section
      ref={dashboardRef}
      className={styles.playDashboard}
      data-play-mode={playMode}
      data-dashboard-open-request={openRequest}
      aria-label={`${STORY_PLAY_MODE_LABELS[playMode]}狀態儀表板`}
    >
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
      <button
        type="button"
        className={styles.playDashboardToggle}
        data-testid="chat-play-dashboard-toggle"
        aria-expanded={detailsOpen}
        aria-controls={detailPanelId}
        onClick={() => setDetailsOpen((value) => !value)}
      >
        <span>{detailsOpen ? "收合詳細儀表板" : "查看完整儀表板"}</span>
        <small>{detailsOpen ? "回到正文優先閱讀" : "能力、關係、資源、任務與近期歷程"}</small>
      </button>
      {detailsOpen ? (
        <div
          id={detailPanelId}
          className={styles.playDashboardDetailPanel}
          data-testid="chat-detailed-dashboard"
        >
          <section className={styles.playDashboardDetailSection} data-dashboard-section="mode">
            <header><span>{playMode === "management" ? "營運全貌" : playMode === "romance" ? "關係與成長" : "能力與行動"}</span><small>依正式存檔與玩法起始值即時換算</small></header>
            <DashboardFactGrid facts={playMode === "management" ? managementFacts : playMode === "romance" ? romanceFacts : rpgFacts} />
          </section>
          <section className={styles.playDashboardDetailSection} data-dashboard-section="mainline">
            <header><span>主線與目前位置</span></header>
            <DashboardFactGrid facts={[
              { label: "目前主線", value: progression.journey.mainlineGoal },
              ...(Object.prototype.hasOwnProperty.call(storyState.questStates, progression.journey.mainlineQuestId)
                ? [{ label: "主線進度", value: dashboardValue(storyState.questStates[progression.journey.mainlineQuestId], "%") }]
                : []),
            ]} />
          </section>
          <section className={styles.playDashboardDetailSection} data-dashboard-section="relationships">
            <header><span>人物關係</span></header>
            <DashboardFactGrid facts={relationshipFacts} />
          </section>
          <section className={styles.playDashboardDetailSection} data-dashboard-section="inventory">
            <header><span>背包與可用資源</span></header>
            <DashboardFactGrid facts={[...inventoryFacts, ...resourceFacts]} />
          </section>
          <section className={styles.playDashboardDetailSection} data-dashboard-section="quests">
            <header><span>任務與里程碑</span></header>
            <DashboardFactGrid facts={[...questFacts, ...milestoneFacts]} />
          </section>
          <section className={styles.playDashboardDetailSection} data-dashboard-section="recent-history">
            <header><span>本回合與近期歷程</span></header>
            <DashboardFactGrid facts={recentFacts} />
          </section>
        </div>
      ) : null}
    </section>
  );
}

export function MessageTimeline({
  project,
  currentChapter,
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
  stopLabel,
  progress,
  safeError,
  retryAvailable,
  retryLabel,
  branchPendingMessageIds,
  dashboardOpenRequest,
  fixedPlayMode,
  storyBible,
  storyState,
  worlds,
  characters,
  relationships,
  actions,
  onStarter,
  onRetry,
  onRecoverRpgChoices,
}: {
  project: NovelProject | null;
  currentChapter: Pick<Chapter, "id" | "revision"> | null;
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
  stopLabel: string;
  progress: string;
  safeError: { code: string; message: string } | null;
  retryAvailable: boolean;
  retryLabel: string;
  branchPendingMessageIds: ReadonlySet<string>;
  dashboardOpenRequest: number;
  fixedPlayMode: StoryPlayModeId | null;
  storyBible: StoryBible | null;
  storyState: StoryState | null;
  worlds: World[];
  characters: Character[];
  relationships: CharacterRelationship[];
  actions: ConversationMessageActions;
  onStarter: (starter: string) => void;
  onRetry: () => void;
  onRecoverRpgChoices: () => void;
}) {
  const gameStory = fixedPlayMode ? isGameStoryPlayMode(fixedPlayMode) : false;
  const portraitWorlds = useMemo(
    () => activeStoryWorlds(worlds, storyState, storyBible),
    [storyBible, storyState, worlds],
  );
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
  const dashboardTarget = readDashboardTarget(messages, artifacts, invocations);
  const rpgChoiceRecoveryTarget = gameStory
    ? findRpgChoiceRecoveryTarget(messages, artifacts, {
        chapter: currentChapter,
        storyState,
      }, invocations)
    : null;
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
          <PlayModeDashboard projectId={projectId} playMode={fixedPlayMode} storyState={storyState} openRequest={dashboardOpenRequest} />
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
            playDashboard={showDashboard ? <PlayModeDashboard projectId={projectId} playMode={fixedPlayMode} storyState={storyState} openRequest={dashboardOpenRequest} /> : null}
            playDashboardPlacement={showDashboard ? dashboardTarget.placement : null}
            project={project}
            worlds={portraitWorlds}
            characters={characters}
            relationships={relationships}
          />;
        })}
        {rpgChoiceRecoveryTarget ? (
          <section className={styles.resultCard} data-testid="rpg-next-choice-recovery" role="status">
            <strong>{rpgChoiceRecoveryTarget.reason === "stale_choice_card"
              ? "原三選一已因版本變更而封存"
              : "下一輪三選一尚未建立"}</strong>
            <p>{rpgChoiceRecoveryTarget.reason === "stale_choice_card"
              ? "系統會依目前人物、世界、章節與狀態重新建立三條路線，不會重試失效的舊分支。"
              : "上一回合正文、數值與 Canon 已安全保留。你可以只重建下一組選項，不會再次採用或重複寫入上一回合。"}</p>
            <button type="button" disabled={busy} onClick={onRecoverRpgChoices}>
              繼續下一輪／重新建立三選一
            </button>
          </section>
        ) : null}
        {busy ? <ToolProgressCard progress={progress} canStop={canStop} onStop={actions.stopGeneration} label={stopLabel} /> : null}
        {safeError ? (() => {
          const friendly = friendlyConversationExecutionError(safeError.code, safeError.message);
          return <section className={styles.resultCard} role="alert"><strong>{friendly.title}</strong><p>{friendly.message}</p>{retryAvailable ? <button type="button" disabled={busy} onClick={onRetry}>{retryLabel}</button> : null}</section>;
        })() : null}
        <div data-testid="conversation-timeline-end" />
      </div>
    </div>
  );
}
