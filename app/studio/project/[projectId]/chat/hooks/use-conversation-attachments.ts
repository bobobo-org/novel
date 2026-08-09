"use client";

import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import type { ConversationAttachment } from "@/lib/novel-ai/domain";
import type { NovelRepository } from "@/lib/novel-ai/repository";
import { conversationContentDigest } from "@/lib/novel-ai/conversation/approval-transaction";
import { createConversationAttachmentRecord } from "@/lib/novel-ai/conversation/attachments";
import type { ConversationPlan } from "@/lib/novel-ai/conversation/planner";
import { CONVERSATION_LOCAL_TOOL_IDS } from "@/lib/novel-ai/conversation/tool-registry";
import type { ManualLearningFileExtraction } from "@/lib/novel-ai/web/manual-learning-import-preparation";
import type { LocalAttachment } from "../components/conversation-types";
import type { DeterministicConversationToolRunner } from "./use-conversation-operation";

function attachmentErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "CONVERSATION_ATTACHMENT_FAILED");
  }
  if ((error as { name?: string })?.name === "AbortError") return "CONVERSATION_CANCELLED";
  return "CONVERSATION_ATTACHMENT_FAILED";
}

function attachmentErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "附件處理沒有完成；正式作品維持原狀。";
}

export function useConversationAttachmentController({
  projectId,
  repository,
  runDeterministicConversationTool,
  onError,
}: {
  projectId: string;
  repository: NovelRepository;
  runDeterministicConversationTool: DeterministicConversationToolRunner;
  onError: (error: { code: string; message: string } | null) => void;
}) {
  const [localAttachments, setLocalAttachments] = useState<LocalAttachment[]>([]);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);

  const updateLocalAttachment = useCallback((localId: string, patch: Partial<LocalAttachment>) => {
    setLocalAttachments((current) => current.map((item) =>
      item.localId === localId ? { ...item, ...patch } : item));
  }, []);

  const clearTransientAttachments = useCallback(() => {
    setLocalAttachments((current) => current.map((item) => {
      if (item.extraction) item.extraction.text = "";
      return { ...item, extraction: null };
    }).filter((item) => item.status !== "completed"));
  }, []);

  const onFilesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    try {
      const { validateManualLearningBatch } = await import("@/lib/novel-ai/web/manual-learning-file-validation");
      validateManualLearningBatch(files);
      onError(null);
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
      onError({ code: attachmentErrorCode(error), message: attachmentErrorMessage(error) });
    }
  }, [onError]);

  const removeLocalAttachment = useCallback((localId: string) => {
    setLocalAttachments((current) => current.filter((row) => row.localId !== localId));
  }, []);

  const resetLocalAttachments = useCallback(() => {
    setLocalAttachments([]);
  }, []);

  const retryLocalAttachment = useCallback((localId: string) => {
    updateLocalAttachment(localId, { status: "queued", errorCode: null });
  }, [updateLocalAttachment]);

  const prepareLocalAttachments = useCallback(async (
    sessionId: string,
    plan: ConversationPlan,
    userMessageId: string,
    signal: AbortSignal,
  ) => {
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
      actualExecutor: "browser-worker",
      modelId: "manual-learning-local-parser-v1",
      modelDigest: parserModelDigest,
      runningMessage: "正在裝置內解析附件",
      completedMessage: "附件批次解析已完成，Canon 未修改",
      signal,
      execute: async () => {
        const { extractManualLearningFileInWorker } = await import(
          "@/lib/novel-ai/web/manual-learning-worker-client"
        );
        const prepared: Array<{
          record: ConversationAttachment;
          extraction: ManualLearningFileExtraction;
        }> = [];
        for (const item of localAttachments) {
          if (signal.aborted) {
            throw Object.assign(new Error("附件處理已停止。"), { code: "LEARNING_FILE_CANCELLED" });
          }
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
            const extraction = await extractManualLearningFileInWorker(item.file, {
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
            const code = attachmentErrorCode(error);
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
  }, [localAttachments, projectId, repository, runDeterministicConversationTool, updateLocalAttachment]);

  return {
    localAttachments,
    rightsConfirmed,
    setRightsConfirmed,
    onFilesSelected,
    updateLocalAttachment,
    retryLocalAttachment,
    removeLocalAttachment,
    resetLocalAttachments,
    clearTransientAttachments,
    prepareLocalAttachments,
  };
}

export function useConversationAttachments(attachments: ConversationAttachment[]) {
  const attachmentsById = useMemo(
    () => new Map(attachments.map((attachment) => [attachment.id, attachment])),
    [attachments],
  );
  const completedAttachmentIds = useMemo(
    () => new Set(attachments.filter((attachment) => attachment.parsingStatus === "completed").map((attachment) => attachment.id)),
    [attachments],
  );
  return { attachmentsById, completedAttachmentIds };
}
