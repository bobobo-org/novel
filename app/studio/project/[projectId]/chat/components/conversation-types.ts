import type {
  ConversationAttachment,
  ConversationArtifact,
  ConversationMessage,
  ConversationToolInvocation,
} from "@/lib/novel-ai/domain";
import type {
  ManualLearningFileExtraction,
  ManualLearningFileProgress,
} from "@/lib/novel-ai/web/manual-learning-import-preparation";
import type { RpgChatChoicePlan } from "@/lib/novel-ai/web/rpg-chat-turn";

export type LocalAttachment = {
  localId: string;
  file: File;
  record: ConversationAttachment | null;
  extraction: ManualLearningFileExtraction | null;
  progress: ManualLearningFileProgress | null;
  status: "queued" | "parsing" | "completed" | "failed" | "cancelled" | "ocr_required";
  errorCode: string | null;
};

export type RpgChoiceEnvelope = {
  schemaVersion: "conversation-rpg-choices-v1";
  chapterId: string;
  chapterRevision: number;
  storyStateRevision: number;
  plan: RpgChatChoicePlan;
};

export type RpgChoiceKey = "A" | "B" | "C";

export type RpgDisplayChoice = {
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

export type ParsedRpgChoices = {
  envelope: RpgChoiceEnvelope | null;
  choices: RpgDisplayChoice[];
};

export type DrawerPayload =
  | { kind: "artifact"; artifactId: string }
  | { kind: "status"; title: string; content: string }
  | { kind: "attachments"; title: string; content: string }
  | null;

export type ArtifactView = "candidate" | "diff" | "comparison";

export type ConversationMessageActions = {
  chooseRpgOption: (envelope: RpgChoiceEnvelope, messageId: string, key: RpgChoiceKey) => void;
  openArtifact: (artifact: ConversationArtifact, view?: ArtifactView) => void;
  approveArtifact: (artifact: ConversationArtifact) => void;
  rejectArtifact: (artifact: ConversationArtifact) => void;
  regenerateMessage: (message: ConversationMessage) => void;
  editMessage: (message: ConversationMessage) => void;
  retryMessage: (content: string) => void;
  stopGeneration: () => void;
};

export type MessagePresentationMaps = {
  artifactsByMessage: Map<string, ConversationArtifact[]>;
  invocationsByMessage: Map<string, ConversationToolInvocation>;
  attachmentsById: Map<string, ConversationAttachment>;
};
