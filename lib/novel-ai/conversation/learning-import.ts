import {
  NOVEL_DOMAIN_VERSION,
  type ConversationAttachment,
  type ConversationSession,
  type LearningImportSession,
  type NovelProject,
} from "../domain";
import type { NovelRepository } from "../repository/contracts";
import { createProjectBackup } from "../repository/backup";
import {
  MemorySovereignLearningRepository,
  type LearningImportStagingRecord,
  type SovereignLearningRepository,
} from "../sovereign-learning/repository";
import { sha256Hex, stableStringify } from "../sovereign-learning/hashing";
import {
  approveLearningRulesAtomically,
  ingestLearningSource,
} from "../sovereign-learning/service";
import type {
  DeepRuleExtractor,
  LearnedNarrativeRule,
  LearningRightsBasis,
  LearningSourceKind,
} from "../sovereign-learning/types";
import { validateManualLearningBatch } from "../web/manual-learning-file-validation";
import type {
  ManualLearningDocumentChunk,
  ManualLearningFilePreparer,
  ManualLearningFileProgress,
  ManualLearningPreparedExtraction,
  ManualLearningPreparedFile,
} from "../web/manual-learning-import-preparation";
import {
  assertConversationAttachmentScope,
  createConversationAttachmentRecord,
} from "./attachments";

export const ATOMIC_LEARNING_IMPORT_VERSION = "atomic-document-import-v1" as const;

type ImportPart = { partIndex: number; file: File };

export type LearningImportProgress = {
  importSessionId: string;
  partIndex: number;
  partCount: number;
  attachmentId: string;
  phase: "validating" | "extracting" | "chunking" | "analyzing" | "staging" | "synthesizing";
  current: number;
  total: number;
  fileProgress?: ManualLearningFileProgress;
};

export type StartLearningImportInput = {
  projectId: string;
  sessionId: string;
  files: readonly File[];
  rightsBasis: LearningRightsBasis;
  rightsEvidence?: string;
  userConfirmedRights: boolean;
  mode?: "atomic_document" | "partial";
  signal?: AbortSignal;
};

export type ProcessLearningImportInput = {
  projectId: string;
  importSessionId: string;
  files: readonly File[];
  sourceKind: LearningSourceKind;
  rightsBasis: LearningRightsBasis;
  rightsEvidence?: string;
  userConfirmedRights: boolean;
  author?: string;
  deepExtractor?: DeepRuleExtractor;
  requireDeepExtractionSuccess?: boolean;
  maximumChunkCharacters?: number;
  signal?: AbortSignal;
  onProgress?: (progress: LearningImportProgress) => void;
};

export type LearningImportFaultPoint =
  | "after_file_extraction"
  | "before_part_staging_commit"
  | "before_global_synthesis"
  | "before_formal_commit"
  | "after_formal_commit";

function learningImportError(code: string, message = code) {
  return Object.assign(new Error(message), { code });
}

function assertPreparedManualLearningFile(
  value: ManualLearningPreparedFile,
): asserts value is ManualLearningPreparedFile {
  const extraction = value?.extraction;
  if (
    value?.rawContentRetained !== false
    || value?.dataLeftDevice !== false
    || value?.semanticChunkingAlgorithm !== "semantic-chunking-v1"
    || !extraction
    || "text" in extraction
    || extraction.rawContentRetained !== false
    || extraction.dataLeftDevice !== false
    || extraction.localAnalysisOnly !== true
    || extraction.parsingStatus !== "completed"
  ) {
    throw learningImportError("LEARNING_WORKER_PRIVACY_CONTRACT_INVALID");
  }
  if (
    !Number.isSafeInteger(extraction.byteLength)
    || extraction.byteLength < 0
    || !/^[a-f0-9]{64}$/u.test(extraction.contentHash)
    || !Array.isArray(extraction.warnings)
    || !Array.isArray(value.chunks)
    || value.chunks.some((chunk, index) => (
      chunk.chunkIndex !== index
      || typeof chunk.text !== "string"
      || typeof chunk.sourceSection !== "string"
      || !/^[a-f0-9]{64}$/u.test(chunk.contentHash)
      || (chunk.previousOverlapDigest !== null && !/^[a-f0-9]{64}$/u.test(chunk.previousOverlapDigest))
      || (chunk.nextOverlapDigest !== null && !/^[a-f0-9]{64}$/u.test(chunk.nextOverlapDigest))
    ))
  ) {
    throw learningImportError("LEARNING_WORKER_PREPARED_FILE_INVALID");
  }
}

function now() {
  return new Date().toISOString();
}

function uniqueById<T extends { id: string }>(values: readonly T[]) {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function createImportSession(input: {
  projectId: string;
  sessionId: string;
  attachmentIds: string[];
  manifestDigest: string;
  mode: "atomic_document" | "partial";
}): LearningImportSession {
  const createdAt = now();
  const importSessionId = globalThis.crypto.randomUUID();
  return {
    schemaVersion: NOVEL_DOMAIN_VERSION,
    learningImportSchemaVersion: "learning-import-session-v1",
    id: importSessionId,
    importSessionId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    attachmentIds: input.attachmentIds,
    totalParts: input.attachmentIds.length,
    completedParts: 0,
    failedParts: 0,
    status: "staging",
    mode: input.mode,
    manifestDigest: input.manifestDigest,
    startedAt: createdAt,
    completedAt: null,
    stagingNamespace: `learning-import-staging:${importSessionId}`,
    retryablePartIndexes: [],
    createdAt,
    updatedAt: createdAt,
    revision: 1,
    source: "system",
    provenance: { source: "system", actor: "local-rule", createdAt },
    deletedAt: null,
    parentRevision: null,
    migrationVersion: null,
  };
}

function createEmptyStaging(session: LearningImportSession): LearningImportStagingRecord {
  const createdAt = now();
  return {
    id: session.importSessionId,
    projectId: session.projectId,
    manifestDigest: session.manifestDigest,
    completedPartIndexes: [],
    sources: [],
    rules: [],
    audit: [],
    chunkManifest: [],
    globalSynthesis: null,
    formalCommit: null,
    rawContentRetained: false,
    createdAt,
    updatedAt: createdAt,
    revision: 1,
  };
}

function chunkMetrics(text: string) {
  const paragraphs = text.split(/\n{2,}/u).map((value) => value.trim()).filter(Boolean);
  return {
    volumeCount: (text.match(/^(?:第\s*[〇零一二三四五六七八九十百千兩\d]+\s*[卷部篇]|[卷部篇]\s*[〇零一二三四五六七八九十百千兩\d]+)/gmu) ?? []).length,
    chapterCount: (text.match(/^(?:第\s*[〇零一二三四五六七八九十百千兩\d]+\s*[章回節幕]|chapter\s+\d+)/gimu) ?? []).length,
    paragraphCount: paragraphs.length,
    dialogueParagraphCount: paragraphs.filter((value) => /^(?:[「『“"]|[^：:\n]{1,24}[：:][「『“"]?)/u.test(value)).length,
    characterCount: text.length,
  };
}

function ruleDeduplicationKey(rule: LearnedNarrativeRule) {
  return [rule.family, rule.dimension, rule.statement.normalize("NFKC").toLocaleLowerCase("zh-Hant")].join("|");
}

export function synthesizeLearningImportStaging(
  input: LearningImportStagingRecord,
): LearningImportStagingRecord {
  const uniqueChunks = [...new Map(input.chunkManifest.map((chunk) => [chunk.contentHash, chunk])).values()];
  const rejected = input.rules.filter((rule) =>
    rule.longestSourceMatch >= 18
    || rule.sourceOverlapScore >= 0.14
    || rule.abstractionScore < 0.55);
  const safeRules = input.rules.filter((rule) => !rejected.some((candidate) => candidate.id === rule.id));
  const candidateRules = [...new Map(
    [...safeRules]
      .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id))
      .map((rule) => [ruleDeduplicationKey(rule), rule]),
  ).values()];
  const candidateIds = new Set(candidateRules.map((rule) => rule.id));
  const normalizedRules = candidateRules.map((rule) => ({
    ...rule,
    conflictRuleIds: rule.conflictRuleIds.filter((id) => candidateIds.has(id)),
  }));
  const conflicts = new Map<string, Set<string>>();
  for (const rule of normalizedRules) {
    if (!rule.conflictKey) continue;
    const statements = conflicts.get(rule.conflictKey) ?? new Set<string>();
    statements.add(rule.statement.normalize("NFKC"));
    conflicts.set(rule.conflictKey, statements);
  }
  const paragraphCount = uniqueChunks.reduce((total, chunk) => total + chunk.paragraphCount, 0);
  const dialogueParagraphCount = uniqueChunks.reduce(
    (total, chunk) => total + chunk.dialogueParagraphCount,
    0,
  );
  const characterCount = uniqueChunks.reduce((total, chunk) => total + chunk.characterCount, 0);
  return {
    ...input,
    rules: normalizedRules,
    sources: uniqueById(input.sources),
    audit: uniqueById(input.audit),
    globalSynthesis: {
      uniqueChunkCount: uniqueChunks.length,
      duplicateChunkCount: input.chunkManifest.length - uniqueChunks.length,
      candidateRuleIds: normalizedRules.map((rule) => rule.id),
      rejectedSourceOverlapRuleIds: rejected.map((rule) => rule.id),
      conflictKeys: [...conflicts.entries()]
        .filter(([, statements]) => statements.size > 1)
        .map(([key]) => key)
        .sort(),
      narrativeDna: {
        volumeCount: uniqueChunks.reduce((total, chunk) => total + chunk.volumeCount, 0),
        chapterCount: uniqueChunks.reduce((total, chunk) => total + chunk.chapterCount, 0),
        paragraphCount,
        dialogueParagraphRatio: paragraphCount
          ? Math.round((dialogueParagraphCount / paragraphCount) * 10_000) / 10_000
          : 0,
        averageParagraphCharacters: paragraphCount
          ? Math.round((characterCount / paragraphCount) * 100) / 100
          : 0,
      },
    },
    rawContentRetained: false,
    updatedAt: now(),
    revision: input.revision + 1,
  };
}

export class AtomicLearningImportCoordinator {
  private readonly controllers = new Map<string, AbortController>();
  private readonly completions = new Map<string, Promise<void>>();
  private readonly resolveCompletions = new Map<string, () => void>();

  constructor(
    private readonly conversationRepository: NovelRepository,
    private readonly learningRepository: SovereignLearningRepository,
    private readonly options: {
      faultInjector?: (point: LearningImportFaultPoint, partIndex: number | null) => void;
      prepareFile: ManualLearningFilePreparer;
    },
  ) {}

  private inject(point: LearningImportFaultPoint, partIndex: number | null = null) {
    this.options.faultInjector?.(point, partIndex);
  }

  private async requireSession(projectId: string, importSessionId: string) {
    const session = await this.conversationRepository.get<LearningImportSession>(
      "learningImportSessions",
      importSessionId,
    );
    if (!session || session.projectId !== projectId || session.importSessionId !== importSessionId) {
      throw learningImportError("LEARNING_IMPORT_SESSION_NOT_FOUND");
    }
    return session;
  }

  private async saveSession(
    session: LearningImportSession,
    patch: Partial<LearningImportSession>,
  ) {
    return this.conversationRepository.put<LearningImportSession>(
      "learningImportSessions",
      { ...session, ...patch },
      session.revision,
    );
  }

  private async setAttachmentStatus(
    attachment: ConversationAttachment,
    parsingStatus: ConversationAttachment["parsingStatus"],
    warnings: string[] = attachment.warnings ?? [],
  ) {
    return this.conversationRepository.put<ConversationAttachment>(
      "conversationAttachments",
      { ...attachment, parsingStatus, warnings },
      attachment.revision,
    );
  }

  async start(input: StartLearningImportInput) {
    if (!input.projectId.trim() || !input.sessionId.trim()) {
      throw learningImportError("LEARNING_IMPORT_SCOPE_REQUIRED");
    }
    if (!input.userConfirmedRights) {
      throw learningImportError("LEARNING_RIGHTS_CONFIRMATION_REQUIRED");
    }
    const [project, conversationSession] = await Promise.all([
      this.conversationRepository.get<NovelProject>("projects", input.projectId),
      this.conversationRepository.get<ConversationSession>("conversationSessions", input.sessionId),
    ]);
    if (!project || project.deletedAt) {
      throw learningImportError("LEARNING_IMPORT_PROJECT_NOT_FOUND");
    }
    if (
      !conversationSession
      || conversationSession.projectId !== input.projectId
      || conversationSession.status === "deleted"
      || conversationSession.deletedAt
    ) {
      throw learningImportError("LEARNING_IMPORT_SESSION_SCOPE_MISMATCH");
    }
    validateManualLearningBatch(input.files);
    const attachments: ConversationAttachment[] = [];
    let session: LearningImportSession | null = null;
    try {
      for (const file of input.files) {
        const attachment = await createConversationAttachmentRecord({
          projectId: input.projectId,
          sessionId: input.sessionId,
          file,
          rightsBasis: input.rightsBasis,
          rightsEvidence: input.rightsEvidence,
          signal: input.signal,
        });
        attachments.push(await this.conversationRepository.put(
          "conversationAttachments",
          attachment,
        ));
      }
      const manifestDigest = await sha256Hex(stableStringify(attachments.map((attachment) => ({
        attachmentId: attachment.id,
        contentHash: attachment.contentHash,
        byteLength: attachment.byteLength,
        format: attachment.format,
      }))));
      session = createImportSession({
        projectId: input.projectId,
        sessionId: input.sessionId,
        attachmentIds: attachments.map((attachment) => attachment.id),
        manifestDigest,
        mode: input.mode ?? "atomic_document",
      });
      session = await this.conversationRepository.put("learningImportSessions", session);
      await this.learningRepository.commit({ staging: [createEmptyStaging(session)] });
      return { session, attachments };
    } catch (error) {
      if (session) await this.conversationRepository.remove("learningImportSessions", session.id);
      for (const attachment of attachments) {
        await this.conversationRepository.remove("conversationAttachments", attachment.id);
      }
      throw error;
    }
  }

  private async processParts(
    input: Omit<ProcessLearningImportInput, "files">,
    parts: readonly ImportPart[],
  ) {
    let session = await this.requireSession(input.projectId, input.importSessionId);
    if (["committed", "rolled_back"].includes(session.status)) {
      throw learningImportError("LEARNING_IMPORT_SESSION_TERMINAL");
    }
    if (this.controllers.has(session.id)) {
      throw learningImportError("LEARNING_IMPORT_ALREADY_RUNNING");
    }
    if (!input.userConfirmedRights) throw learningImportError("LEARNING_RIGHTS_CONFIRMATION_REQUIRED");
    const rightsEvidenceHash = await sha256Hex(
      input.rightsEvidence?.trim() || `${input.rightsBasis}:user-confirmed`,
    );
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      session = await this.saveSession(session, { status: "processing", completedAt: null });
    } catch (error) {
      input.signal?.removeEventListener("abort", abortFromCaller);
      throw error;
    }
    this.controllers.set(session.id, controller);
    let staging = await this.learningRepository.getImportStaging(session.id)
      ?? createEmptyStaging(session);
    if (staging.projectId !== input.projectId || staging.manifestDigest !== session.manifestDigest) {
      input.signal?.removeEventListener("abort", abortFromCaller);
      this.controllers.delete(session.id);
      throw learningImportError("LEARNING_IMPORT_STAGING_MANIFEST_MISMATCH");
    }
    this.completions.set(session.id, new Promise<void>((resolve) => {
      this.resolveCompletions.set(session.id, resolve);
    }));
    const failed = new Set(session.retryablePartIndexes);
    const completed = new Set(staging.completedPartIndexes);
    const errors: Array<{ partIndex: number; errorCode: string }> = [];
    try {
      for (const { partIndex, file } of parts) {
        if (partIndex < 0 || partIndex >= session.totalParts) {
          errors.push({ partIndex, errorCode: "LEARNING_IMPORT_PART_INDEX_INVALID" });
          continue;
        }
        if (completed.has(partIndex) && !failed.has(partIndex)) continue;
        const attachmentId = session.attachmentIds[partIndex];
        let attachment = await this.conversationRepository.get<ConversationAttachment>(
          "conversationAttachments",
          attachmentId,
        );
        if (!attachment) {
          errors.push({ partIndex, errorCode: "LEARNING_IMPORT_ATTACHMENT_MISSING" });
          failed.add(partIndex);
          continue;
        }
        assertConversationAttachmentScope(attachment, input.projectId, session.sessionId);
        input.onProgress?.({
          importSessionId: session.id,
          partIndex,
          partCount: session.totalParts,
          attachmentId,
          phase: "validating",
          current: 0,
          total: 1,
        });
        let extraction: ManualLearningPreparedExtraction | null = null;
        let chunks: ManualLearningDocumentChunk[] = [];
        try {
          if (attachment.rightsBasis !== input.rightsBasis || attachment.rightsEvidenceHash !== rightsEvidenceHash) {
            throw learningImportError("LEARNING_IMPORT_RIGHTS_MANIFEST_MISMATCH");
          }
          if (file.size !== attachment.byteLength) {
            throw learningImportError("LEARNING_IMPORT_FILE_MANIFEST_MISMATCH");
          }
          attachment = await this.setAttachmentStatus(attachment, "parsing");
          const prepared = await this.options.prepareFile(file, {
            signal: controller.signal,
            maximumChunkCharacters: input.maximumChunkCharacters ?? 285_000,
            onProgress: (fileProgress) => input.onProgress?.({
              importSessionId: session.id,
              partIndex,
              partCount: session.totalParts,
              attachmentId,
              phase: fileProgress.phase === "chunking" ? "chunking" : "extracting",
              current: fileProgress.current,
              total: fileProgress.total,
              fileProgress,
            }),
          });
          if (controller.signal.aborted) throw learningImportError("LEARNING_FILE_CANCELLED");
          assertPreparedManualLearningFile(prepared);
          extraction = prepared.extraction;
          chunks = prepared.chunks;
          if (
            extraction.contentHash !== attachment.contentHash
            || extraction.byteLength !== attachment.byteLength
          ) {
            throw learningImportError("LEARNING_IMPORT_FILE_MANIFEST_MISMATCH");
          }
          this.inject("after_file_extraction", partIndex);
          if (!chunks.length) throw learningImportError("LEARNING_IMPORT_NO_VALID_CHUNKS");
          const partRepository = new MemorySovereignLearningRepository();
          for (const [chunkPosition, chunk] of chunks.entries()) {
            if (controller.signal.aborted) throw learningImportError("LEARNING_FILE_CANCELLED");
            input.onProgress?.({
              importSessionId: session.id,
              partIndex,
              partCount: session.totalParts,
              attachmentId,
              phase: "analyzing",
              current: chunkPosition + 1,
              total: chunks.length,
            });
            const result = await ingestLearningSource(partRepository, {
              projectId: input.projectId,
              title: `${attachment.safeSourceAlias} — ${chunk.sourceSection}`,
              author: input.author,
              sourceReference: `local-attachment:${attachment.id}#chunk-${chunk.chunkIndex + 1}`,
              sourceKind: input.sourceKind,
              rightsBasis: input.rightsBasis,
              rightsEvidence: input.rightsEvidence,
              userConfirmedRights: true,
              content: chunk.text,
              deepExtractor: input.deepExtractor,
            });
            if (
              input.deepExtractor
              && (input.requireDeepExtractionSuccess ?? true)
              && result.deepExtractionFailures > 0
            ) {
              throw learningImportError("LEARNING_IMPORT_DEEP_EXTRACTION_PART_FAILED");
            }
          }
          const [sources, rules, audit] = await Promise.all([
            partRepository.listSources(input.projectId),
            partRepository.listRules(input.projectId),
            partRepository.listAudit(input.projectId),
          ]);
          const nextStaging: LearningImportStagingRecord = {
            ...staging,
            sources: uniqueById([...staging.sources, ...sources]),
            rules: uniqueById([...staging.rules, ...rules]),
            audit: uniqueById([...staging.audit, ...audit]),
            completedPartIndexes: [...new Set([...staging.completedPartIndexes, partIndex])].sort((a, b) => a - b),
            chunkManifest: [
              ...staging.chunkManifest.filter((item) => item.attachmentId !== attachmentId),
              ...chunks.map((chunk) => ({
                attachmentId,
                chunkIndex: chunk.chunkIndex,
                sourceSection: chunk.sourceSection,
                contentHash: chunk.contentHash,
                previousOverlapDigest: chunk.previousOverlapDigest,
                nextOverlapDigest: chunk.nextOverlapDigest,
                ...chunkMetrics(chunk.text),
              })),
            ],
            globalSynthesis: null,
            rawContentRetained: false,
            updatedAt: now(),
            revision: staging.revision + 1,
          };
          if (controller.signal.aborted) throw learningImportError("LEARNING_FILE_CANCELLED");
          this.inject("before_part_staging_commit", partIndex);
          input.onProgress?.({
            importSessionId: session.id,
            partIndex,
            partCount: session.totalParts,
            attachmentId,
            phase: "staging",
            current: 1,
            total: 1,
          });
          await this.learningRepository.commit({ staging: [nextStaging] });
          staging = nextStaging;
          completed.add(partIndex);
          failed.delete(partIndex);
          await this.setAttachmentStatus(attachment, "completed", extraction.warnings);
        } catch (error) {
          const errorCode = String((error as { code?: string })?.code ?? "LEARNING_IMPORT_PART_FAILED");
          failed.add(partIndex);
          completed.delete(partIndex);
          errors.push({ partIndex, errorCode });
          const status: ConversationAttachment["parsingStatus"] = errorCode === "OCR_REQUIRED"
            ? "ocr_required"
            : errorCode === "LEARNING_FILE_CANCELLED"
              ? "cancelled"
              : "failed";
          try {
            await this.setAttachmentStatus(attachment, status);
          } catch {
            // Preserve the original safe error code; retry will reconcile metadata.
          }
        } finally {
          for (const chunk of chunks) chunk.text = "";
          chunks.length = 0;
          extraction = null;
        }
      }

      const cancelled = controller.signal.aborted;
      const allCompleted = completed.size === session.totalParts;
      const canFinalizePartial = session.mode === "partial" && completed.size > 0 && !cancelled;
      if ((allCompleted || canFinalizePartial) && !cancelled) {
        this.inject("before_global_synthesis", null);
        input.onProgress?.({
          importSessionId: session.id,
          partIndex: -1,
          partCount: session.totalParts,
          attachmentId: "",
          phase: "synthesizing",
          current: 1,
          total: 1,
        });
        staging = synthesizeLearningImportStaging({
          ...staging,
          completedPartIndexes: [...completed].sort((a, b) => a - b),
        });
        await this.learningRepository.commit({ staging: [staging] });
      }
      session = await this.requireSession(input.projectId, input.importSessionId);
      session = await this.saveSession(session, {
        completedParts: completed.size,
        failedParts: failed.size,
        retryablePartIndexes: [...failed].sort((a, b) => a - b),
        status: cancelled
          ? "cancelled"
          : allCompleted || canFinalizePartial
            ? "ready_to_finalize"
            : "failed",
        completedAt: null,
      });
      return {
        session,
        errors,
        globalSynthesis: staging.globalSynthesis,
        rawContentRetained: false as const,
        dataLeftDevice: false as const,
      };
    } finally {
      input.signal?.removeEventListener("abort", abortFromCaller);
      this.controllers.delete(session.id);
      this.resolveCompletions.get(session.id)?.();
      this.resolveCompletions.delete(session.id);
      this.completions.delete(session.id);
    }
  }

  process(input: ProcessLearningImportInput) {
    validateManualLearningBatch(input.files);
    return this.processParts(
      input,
      input.files.map((file, partIndex) => ({ file, partIndex })),
    );
  }

  async retryFailedPart(
    input: Omit<ProcessLearningImportInput, "files"> & { partIndex: number; file: File },
  ) {
    const session = await this.requireSession(input.projectId, input.importSessionId);
    if (!session.retryablePartIndexes.includes(input.partIndex)) {
      throw learningImportError("LEARNING_IMPORT_PART_NOT_RETRYABLE");
    }
    return this.processParts(input, [{ partIndex: input.partIndex, file: input.file }]);
  }

  resume(input: ProcessLearningImportInput) {
    return this.process(input);
  }

  async cancel(projectId: string, importSessionId: string) {
    this.controllers.get(importSessionId)?.abort("user_cancelled");
    const session = await this.requireSession(projectId, importSessionId);
    if (["committed", "rolled_back"].includes(session.status)) return session;
    return this.saveSession(session, { status: "cancelled", completedAt: null });
  }

  async rollback(projectId: string, importSessionId: string) {
    this.controllers.get(importSessionId)?.abort("rollback");
    await this.completions.get(importSessionId);
    const session = await this.requireSession(projectId, importSessionId);
    if (session.status === "committed") {
      throw learningImportError("LEARNING_IMPORT_COMMITTED_CANNOT_ROLLBACK");
    }
    await this.learningRepository.commit({ remove: { staging: [importSessionId] } });
    return this.saveSession(session, {
      status: "rolled_back",
      completedParts: 0,
      failedParts: 0,
      retryablePartIndexes: [],
      completedAt: now(),
    });
  }

  async finalize(
    projectId: string,
    importSessionId: string,
    options: { retainStagingUntilApproval?: boolean } = {},
  ) {
    let session = await this.requireSession(projectId, importSessionId);
    let staging = await this.learningRepository.getImportStaging(importSessionId);
    if (session.status === "committed" && !staging) {
      return {
        replayed: true,
        session,
        canonicalMutationCount: 0,
        rawContentRetained: false as const,
      };
    }
    if (!staging || !["ready_to_finalize", "committed"].includes(session.status)) {
      throw learningImportError("LEARNING_IMPORT_NOT_READY_TO_FINALIZE");
    }
    if (
      staging.projectId !== projectId
      || staging.manifestDigest !== session.manifestDigest
      || !staging.globalSynthesis
      || (session.mode === "atomic_document" && staging.completedPartIndexes.length !== session.totalParts)
    ) {
      throw learningImportError("LEARNING_IMPORT_FINALIZE_MANIFEST_INVALID");
    }
    const [existingSources, existingRules, existingAudit] = await Promise.all([
      this.learningRepository.listSources(projectId),
      this.learningRepository.listRules(projectId),
      this.learningRepository.listAudit(projectId),
    ]);
    const sourceIds = new Set(existingSources.map((source) => source.id));
    const ruleIds = new Set(existingRules.map((rule) => rule.id));
    const auditIds = new Set(existingAudit.map((record) => record.id));
    const sources = staging.sources.filter((source) => !sourceIds.has(source.id));
    const rules = staging.rules.filter((rule) => !ruleIds.has(rule.id));
    const audit = staging.audit.filter((record) => !auditIds.has(record.id));
    this.inject("before_formal_commit", null);
    let formalCommitCompleted = false;
    try {
      const committedStaging: LearningImportStagingRecord = {
        ...staging,
        formalCommit: {
          sourceIds: [...new Set([
            ...(staging.formalCommit?.sourceIds ?? []),
            ...sources.map((source) => source.id),
          ])],
          ruleIds: [...new Set([
            ...(staging.formalCommit?.ruleIds ?? []),
            ...rules.map((rule) => rule.id),
          ])],
          auditIds: [...new Set([
            ...(staging.formalCommit?.auditIds ?? []),
            ...audit.map((record) => record.id),
          ])],
        },
        updatedAt: now(),
        revision: staging.revision + 1,
      };
      await this.learningRepository.commit({
        sources,
        rules,
        audit,
        staging: [committedStaging],
      });
      formalCommitCompleted = true;
      staging = committedStaging;
      this.inject("after_formal_commit", null);
      if (session.status !== "committed") {
        session = await this.saveSession(session, {
          status: "committed",
          completedAt: now(),
        });
      }
    } catch (error) {
      if (formalCommitCompleted) {
        try {
          await this.learningRepository.commit({
            remove: {
              sources: sources.map((source) => source.id),
              rules: rules.map((rule) => rule.id),
              audit: audit.map((record) => record.id),
            },
          });
        } catch (rollbackError) {
          throw Object.assign(
            new AggregateError([error, rollbackError], "Atomic learning import compensation failed."),
            { code: "LEARNING_IMPORT_COMPENSATION_FAILED" },
          );
        }
      }
      throw error;
    }
    if (!options.retainStagingUntilApproval) {
      await this.learningRepository.commit({ remove: { staging: [importSessionId] } });
    }
    return {
      replayed: sources.length + rules.length + audit.length === 0,
      session,
      sources,
      rules,
      audit,
      globalSynthesis: staging.globalSynthesis,
      canonicalMutationCount: sources.length + rules.length,
      rawContentRetained: false as const,
      dataLeftDevice: false as const,
    };
  }

  async approveFinalizedRules(projectId: string, importSessionId: string) {
    const session = await this.requireSession(projectId, importSessionId);
    const staging = await this.learningRepository.getImportStaging(importSessionId);
    if (
      session.status !== "committed"
      || !staging
      || staging.projectId !== projectId
      || !staging.formalCommit
    ) {
      throw learningImportError("LEARNING_IMPORT_APPROVAL_SOURCE_INVALID");
    }
    // Capture the last fully coherent pre-approval state across both stores.
    // If the subsequent Conversation marker fails, compensation removes the
    // formal Learning commit while this recovery point remains candidate-only.
    // Creating this backup before approval also means backup failure cannot
    // mutate Learning Canon.
    await createProjectBackup(this.conversationRepository, projectId, "safety", {
      sovereignLearningRepository: this.learningRepository,
    });
    const approved = await approveLearningRulesAtomically(
      this.learningRepository,
      projectId,
      staging.formalCommit.ruleIds,
      { staging },
    );
    return {
      session,
      rules: approved.rules,
      canonicalMutationCount: approved.audit.length,
      rawContentRetained: false as const,
      dataLeftDevice: false as const,
    };
  }

  async compensateFinalizedApproval(projectId: string, importSessionId: string) {
    const session = await this.requireSession(projectId, importSessionId);
    const staging = await this.learningRepository.getImportStaging(importSessionId);
    if (session.status !== "committed" || !staging || staging.projectId !== projectId) {
      throw learningImportError("LEARNING_IMPORT_COMPENSATION_SOURCE_INVALID");
    }
    if (!staging.formalCommit) {
      throw learningImportError("LEARNING_IMPORT_COMPENSATION_MARKER_MISSING");
    }
    const compensatedStaging: LearningImportStagingRecord = {
      ...staging,
      formalCommit: null,
      updatedAt: now(),
      revision: staging.revision + 1,
    };
    await this.learningRepository.commit({
      staging: [compensatedStaging],
      remove: {
        sources: staging.formalCommit.sourceIds,
        rules: staging.formalCommit.ruleIds,
        audit: staging.formalCommit.auditIds,
      },
    });
    return session;
  }

  async releaseFinalizedStaging(projectId: string, importSessionId: string) {
    const session = await this.requireSession(projectId, importSessionId);
    if (session.status !== "committed") {
      throw learningImportError("LEARNING_IMPORT_NOT_COMMITTED");
    }
    await this.learningRepository.commit({ remove: { staging: [importSessionId] } });
    return session;
  }

  async rollbackPendingApproval(projectId: string, importSessionId: string) {
    const session = await this.requireSession(projectId, importSessionId);
    if (session.status !== "committed") return this.rollback(projectId, importSessionId);
    await this.compensateFinalizedApproval(projectId, importSessionId);
    await this.learningRepository.commit({ remove: { staging: [importSessionId] } });
    return this.saveSession(session, {
      status: "rolled_back",
      completedParts: 0,
      failedParts: 0,
      retryablePartIndexes: [],
      completedAt: now(),
    });
  }
}
