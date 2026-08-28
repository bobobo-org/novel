import {
  NOVEL_DOMAIN_VERSION,
  type ConversationAttachment,
} from "../domain";
import { sha256Hex } from "../sovereign-learning/hashing";
import {
  hashManualLearningFile,
  safeManualLearningSourceAlias,
  type ManualLearningDocumentFormat,
} from "../web/manual-learning-file-validation";

export const CONVERSATION_ATTACHMENT_SCHEMA_VERSION = "conversation-attachment-v1" as const;
export const CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_SCHEMA_VERSION =
  "conversation-attachment-rights-confirmation-v1" as const;

function now() {
  return new Date().toISOString();
}

function formatFromFileName(fileName: string): ManualLearningDocumentFormat {
  const extension = fileName.toLowerCase().match(/\.([^.]+)$/u)?.[1] ?? "";
  if (extension === "txt") return "txt";
  if (["md", "markdown"].includes(extension)) return "markdown";
  if (["html", "htm"].includes(extension)) return "html";
  if (extension === "json") return "json";
  if (extension === "srt") return "srt";
  if (extension === "vtt") return "vtt";
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  throw Object.assign(new Error("Unsupported conversation attachment format."), {
    code: "LEARNING_FILE_FORMAT_UNSUPPORTED",
  });
}

export async function createConversationAttachmentRecord(input: {
  projectId: string;
  sessionId: string;
  file: File;
  rightsBasis: string;
  rightsEvidence?: string;
  userConfirmedRights: true;
  signal?: AbortSignal;
  attachmentId?: string;
}): Promise<ConversationAttachment> {
  if (!input.projectId.trim() || !input.sessionId.trim()) {
    throw Object.assign(new Error("Attachment project and session scope are required."), {
      code: "CONVERSATION_ATTACHMENT_SCOPE_REQUIRED",
    });
  }
  if (!input.rightsBasis.trim()) {
    throw Object.assign(new Error("Attachment rights basis is required."), {
      code: "CONVERSATION_ATTACHMENT_RIGHTS_REQUIRED",
    });
  }
  if (input.userConfirmedRights !== true) {
    throw Object.assign(new Error("Attachment rights confirmation is required."), {
      code: "CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_REQUIRED",
    });
  }
  const createdAt = now();
  const [contentHash, rightsEvidenceHash] = await Promise.all([
    hashManualLearningFile(input.file, input.signal),
    sha256Hex(input.rightsEvidence?.trim() || `${input.rightsBasis}:user-confirmed`),
  ]);
  return {
    schemaVersion: NOVEL_DOMAIN_VERSION,
    conversationSchemaVersion: CONVERSATION_ATTACHMENT_SCHEMA_VERSION,
    id: input.attachmentId ?? globalThis.crypto.randomUUID(),
    projectId: input.projectId,
    sessionId: input.sessionId,
    displayName: safeManualLearningSourceAlias(input.file.name),
    safeSourceAlias: safeManualLearningSourceAlias(input.file.name),
    format: formatFromFileName(input.file.name),
    byteLength: input.file.size,
    contentHash,
    rightsBasis: input.rightsBasis.trim().slice(0, 120),
    rightsEvidenceHash,
    userConfirmedRights: true,
    rightsConfirmationSchemaVersion:
      CONVERSATION_ATTACHMENT_RIGHTS_CONFIRMATION_SCHEMA_VERSION,
    localAnalysisOnly: true,
    rawContentRetained: false,
    parsingStatus: "pending",
    warnings: [],
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    source: "user",
    provenance: { source: "user", actor: "author", createdAt },
    deletedAt: null,
    parentRevision: null,
    migrationVersion: null,
  };
}

export function assertConversationAttachmentScope(
  attachment: ConversationAttachment,
  projectId: string,
  sessionId?: string,
) {
  if (
    attachment.projectId !== projectId
    || (sessionId !== undefined && attachment.sessionId !== sessionId)
    || attachment.localAnalysisOnly !== true
    || attachment.rawContentRetained !== false
  ) {
    throw Object.assign(new Error("Conversation attachment scope mismatch."), {
      code: "CONVERSATION_ATTACHMENT_SCOPE_MISMATCH",
    });
  }
  return attachment;
}
