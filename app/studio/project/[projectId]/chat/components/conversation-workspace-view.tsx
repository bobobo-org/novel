"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, Dispatch, MutableRefObject, SetStateAction } from "react";
import { STORY_PLAY_MODE_LABELS } from "@/lib/novel-ai/domain/play-mode";
import type { StoryState } from "@/lib/novel-ai/domain";
import StoryStageSelector from "../../story-stage-selector";
import { ConversationShell } from "./conversation-shell";
import { EditMessageCopyDialog } from "./edit-message-copy-dialog";
import { MessageComposer } from "./message-composer";
import { MessageTimeline } from "./message-timeline";
import { SessionSidebar } from "./session-sidebar";
import styles from "../conversation.module.css";

const ArtifactDrawer = dynamic(() => import("./artifact-drawer"), {
  loading: () => <p className={styles.emptyNote} role="status">正在載入作品結果……</p>,
});

type SidebarProps = ComponentProps<typeof SessionSidebar>;
type TimelineProps = ComponentProps<typeof MessageTimeline>;
type ComposerProps = ComponentProps<typeof MessageComposer>;
type DrawerProps = ComponentProps<typeof ArtifactDrawer>;
type EditDialogProps = ComponentProps<typeof EditMessageCopyDialog>;

export type ConversationWorkspaceViewProps = {
  projectId: string;
  project: SidebarProps["project"];
  activeSession: SidebarProps["sessions"][number] | null;
  currentChapterTitle: string | null;
  fixedPlayMode: TimelineProps["fixedPlayMode"];
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  artifactOpen: boolean;
  setArtifactOpen: Dispatch<SetStateAction<boolean>>;
  loading: boolean;
  visibleSessions: SidebarProps["sessions"];
  activeSessionId: SidebarProps["activeSessionId"];
  switchingSessionId: SidebarProps["switchingSessionId"];
  queuedSessionId: SidebarProps["queuedSessionId"];
  search: SidebarProps["search"];
  setSearch: SidebarProps["onSearchChange"];
  showArchived: SidebarProps["showArchived"];
  setShowArchived: Dispatch<SetStateAction<boolean>>;
  busy: boolean;
  cancellable: boolean;
  rpgChoicePlanning: boolean;
  closeSidebar: SidebarProps["onClose"];
  newSession: SidebarProps["onNewSession"];
  chooseSession: SidebarProps["onChooseSession"];
  renameSession: SidebarProps["onRenameSession"];
  archiveSession: SidebarProps["onArchiveSession"];
  deleteSession: SidebarProps["onDeleteSession"];
  exportActiveConversationSummary: SidebarProps["onExportSummary"];
  messages: TimelineProps["messages"];
  artifacts: TimelineProps["artifacts"];
  invocations: TimelineProps["invocations"];
  attachments: TimelineProps["attachments"];
  closedAiRegenerationReady: TimelineProps["regenerationReady"];
  progress: TimelineProps["progress"];
  safeError: TimelineProps["safeError"];
  retryAvailable: TimelineProps["retryAvailable"];
  retryLabel: TimelineProps["retryLabel"];
  branchPendingMessageIds: TimelineProps["branchPendingMessageIds"];
  dashboardOpenRequest: TimelineProps["dashboardOpenRequest"];
  storyState: TimelineProps["storyState"];
  onStoryStateChanged: (storyState: StoryState) => void;
  worlds: TimelineProps["worlds"];
  characters: TimelineProps["characters"];
  relationships: TimelineProps["relationships"];
  messageActions: TimelineProps["actions"];
  retryActionRef: MutableRefObject<(() => void) | null>;
  draft: ComposerProps["draft"];
  setDraft: ComposerProps["onDraftChange"];
  localAttachments: ComposerProps["localAttachments"];
  rightsConfirmed: ComposerProps["rightsConfirmed"];
  setRightsConfirmed: ComposerProps["onRightsConfirmedChange"];
  closedAiSetup: ComposerProps["closedAiSetup"];
  closedAiSetupProgress: ComposerProps["closedAiSetupProgress"];
  closedAiSetupBusy: ComposerProps["closedAiSetupBusy"];
  closedAiSetupError: ComposerProps["closedAiSetupError"];
  closedAiSetupLifecycle: ComposerProps["closedAiSetupLifecycle"];
  onFilesSelected: ComposerProps["onFilesSelected"];
  retryLocalAttachment: ComposerProps["onRetryAttachment"];
  removeLocalAttachment: ComposerProps["onRemoveAttachment"];
  stopGeneration: ComposerProps["onStop"];
  sendRequest: ComposerProps["onSend"];
  prepareClosedAi: ComposerProps["onPrepareClosedAi"];
  cancelClosedAiSetup: ComposerProps["onCancelClosedAiSetup"];
  drawer: DrawerProps["drawer"];
  artifactView: DrawerProps["artifactView"];
  artifactBefore: DrawerProps["artifactBefore"];
  artifactDraft: DrawerProps["artifactDraft"];
  setArtifactDraft: DrawerProps["onDraftChange"];
  openArtifact: DrawerProps["onOpenArtifact"];
  approveArtifact: DrawerProps["onApprove"];
  rejectArtifact: DrawerProps["onReject"];
  editDialog: null | Pick<EditDialogProps, "value" | "sourceContent" | "confirming">;
  updateEditDraft: EditDialogProps["onChange"];
  cancelEditMessage: EditDialogProps["onCancel"];
  confirmEditMessage: EditDialogProps["onConfirm"];
};

export function ConversationWorkspaceView(props: ConversationWorkspaceViewProps) {
  const selectedArtifactId = props.drawer?.kind === "artifact" ? props.drawer.artifactId : null;
  const selectedArtifact = selectedArtifactId
    ? props.artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null
    : null;
  const latestInvocation = props.invocations.at(-1) ?? null;
  const canStop = props.busy && props.cancellable;
  const stopLabel = props.rpgChoicePlanning ? "不等了，改用後備選項" : "停止";
  const branchPending = props.branchPendingMessageIds.size > 0;
  return (
    <>
      <ConversationShell
        projectId={props.projectId}
        projectTitle={props.project?.title ?? "小說專案"}
        sessionTitle={props.activeSession?.title ?? "小說專案對話"}
        chapterTitle={props.currentChapterTitle}
        playModeLabel={props.fixedPlayMode ? STORY_PLAY_MODE_LABELS[props.fixedPlayMode] : "尚未確認"}
        sidebarOpen={props.sidebarOpen}
        artifactOpen={props.artifactOpen}
        loading={props.loading}
        onOpenSidebar={() => props.setSidebarOpen(true)}
        onToggleSidebar={() => props.setSidebarOpen((value) => !value)}
        onOpenArtifacts={() => props.setArtifactOpen(true)}
        onToggleArtifacts={() => props.setArtifactOpen((value) => !value)}
        onCloseDrawers={() => {
          props.setSidebarOpen(false);
          props.setArtifactOpen(false);
        }}
        sidebar={(
          <SessionSidebar
            projectId={props.projectId}
            project={props.project}
            sessions={props.visibleSessions}
            activeSessionId={props.activeSessionId}
            switchingSessionId={props.switchingSessionId}
            queuedSessionId={props.queuedSessionId}
            search={props.search}
            showArchived={props.showArchived}
            busy={props.busy}
            branchPending={branchPending}
            open={props.sidebarOpen}
            onClose={props.closeSidebar}
            onSearchChange={props.setSearch}
            onToggleArchived={() => props.setShowArchived((value) => !value)}
            onNewSession={() => { void props.newSession(); }}
            onChooseSession={(sessionId) => { void props.chooseSession(sessionId); }}
            onRenameSession={(session) => { void props.renameSession(session); }}
            onArchiveSession={(session) => { void props.archiveSession(session); }}
            onDeleteSession={(session) => { void props.deleteSession(session); }}
            onExportSummary={() => { void props.exportActiveConversationSummary(); }}
          />
        )}
        storyStage={(
          <details className={styles.storyStageDisclosure} data-testid="conversation-story-stage-selector">
            <summary>選擇上場人物、世界與記憶</summary>
            <StoryStageSelector
              projectId={props.projectId}
              compact
              onChanged={props.onStoryStateChanged}
            />
          </details>
        )}
        timeline={(
          <MessageTimeline
            project={props.project}
            projectId={props.projectId}
            sessionId={props.activeSessionId}
            messages={props.messages}
            artifacts={props.artifacts}
            invocations={props.invocations}
            attachments={props.attachments}
            loading={props.loading}
            busy={props.busy}
            regenerationReady={props.closedAiRegenerationReady}
            canStop={canStop}
            stopLabel={stopLabel}
            progress={props.progress}
            safeError={props.safeError}
            retryAvailable={props.retryAvailable}
            retryLabel={props.retryLabel}
            branchPendingMessageIds={props.branchPendingMessageIds}
            dashboardOpenRequest={props.dashboardOpenRequest}
            fixedPlayMode={props.fixedPlayMode}
            storyState={props.storyState}
            worlds={props.worlds}
            characters={props.characters}
            relationships={props.relationships}
            actions={props.messageActions}
            onStarter={props.setDraft}
            onRetry={() => props.retryActionRef.current?.()}
          />
        )}
        composer={(
          <MessageComposer
            active={Boolean(props.activeSession)}
            projectId={props.projectId}
            busy={props.busy}
            busyReason={branchPending ? "正在準備修改副本；訊息與附件操作已暫停。" : null}
            busyReasonTestId={branchPending ? "conversation-branch-global-status" : undefined}
            canStop={canStop}
            stopLabel={stopLabel}
            draft={props.draft}
            localAttachments={props.localAttachments}
            rightsConfirmed={props.rightsConfirmed}
            latestInvocation={latestInvocation}
            closedAiSetup={props.closedAiSetup}
            closedAiSetupProgress={props.closedAiSetupProgress}
            closedAiSetupBusy={props.closedAiSetupBusy}
            closedAiSetupError={props.closedAiSetupError}
            closedAiSetupLifecycle={props.closedAiSetupLifecycle}
            onDraftChange={props.setDraft}
            onFilesSelected={props.onFilesSelected}
            onRightsConfirmedChange={props.setRightsConfirmed}
            onRetryAttachment={props.retryLocalAttachment}
            onRemoveAttachment={props.removeLocalAttachment}
            onToggleArtifacts={() => props.setArtifactOpen((value) => !value)}
            onStop={props.stopGeneration}
            onSend={() => { void props.sendRequest(); }}
            onPrepareClosedAi={() => { void props.prepareClosedAi(); }}
            onCancelClosedAiSetup={props.cancelClosedAiSetup}
          />
        )}
        artifactDrawer={props.artifactOpen ? (
          <ArtifactDrawer
            projectId={props.projectId}
            selectedArtifact={selectedArtifact}
            drawer={props.drawer}
            artifacts={props.artifacts}
            artifactView={props.artifactView}
            artifactBefore={props.artifactBefore}
            artifactDraft={props.artifactDraft}
            invocations={props.invocations}
            busy={props.busy}
            onClose={() => props.setArtifactOpen(false)}
            onDraftChange={props.setArtifactDraft}
            onOpenArtifact={(artifact) => { void props.openArtifact(artifact); }}
            onApprove={(artifact, editedContent) => { void props.approveArtifact(artifact, editedContent); }}
            onReject={(artifact) => { void props.rejectArtifact(artifact); }}
          />
        ) : null}
      />
      <EditMessageCopyDialog
        open={Boolean(props.editDialog)}
        value={props.editDialog?.value ?? ""}
        sourceContent={props.editDialog?.sourceContent ?? ""}
        confirming={props.editDialog?.confirming ?? false}
        onChange={props.updateEditDraft}
        onCancel={props.cancelEditMessage}
        onConfirm={() => { void props.confirmEditMessage(); }}
      />
    </>
  );
}
