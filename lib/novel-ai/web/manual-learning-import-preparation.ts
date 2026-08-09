import type {
  ManualLearningDocumentFormat,
  ManualLearningFileFormat,
} from "./manual-learning-file-validation";

export const MANUAL_LEARNING_WORKER_PROTOCOL_VERSION = "manual-learning-worker-protocol-v2" as const;

export type ManualLearningFileProgress = {
  fileName: string;
  phase: "validating" | "reading" | "parsing" | "page" | "chunking" | "completed";
  current: number;
  total: number;
  pageNumber: number | null;
  pageCount: number | null;
};

export type ManualLearningFileExtraction = {
  fileName: string;
  safeSourceAlias: string;
  format: ManualLearningFileFormat;
  documentFormat: ManualLearningDocumentFormat;
  mediaType: string;
  byteLength: number;
  contentHash: string;
  text: string;
  pageCount: number | null;
  warnings: string[];
  parsingStatus: "completed";
  localAnalysisOnly: true;
  rawContentRetained: false;
  dataLeftDevice: false;
};

export type ManualLearningFileExtractionOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ManualLearningFileProgress) => void;
};

export type ManualLearningBatchItem =
  | { fileName: string; fileIndex: number; status: "completed"; extraction: ManualLearningFileExtraction; errorCode: null }
  | { fileName: string; fileIndex: number; status: "failed" | "cancelled"; extraction: null; errorCode: string };

export type ManualLearningDocumentChunk = {
  chunkIndex: number;
  sourceSection: string;
  boundary: "volume" | "chapter" | "heading" | "paragraph" | "sentence" | "safe_character_limit";
  text: string;
  contentHash: string;
  previousOverlapDigest: string | null;
  nextOverlapDigest: string | null;
};

export type ManualLearningPreparedExtraction = Omit<ManualLearningFileExtraction, "text">;

export type ManualLearningPreparedFile = {
  extraction: ManualLearningPreparedExtraction;
  chunks: ManualLearningDocumentChunk[];
  semanticChunkingAlgorithm: "semantic-chunking-v1";
  rawContentRetained: false;
  dataLeftDevice: false;
};

export type ManualLearningPrepareFileOptions = {
  signal?: AbortSignal;
  maximumChunkCharacters?: number;
  onProgress?: (progress: ManualLearningFileProgress) => void;
};

export type ManualLearningFilePreparer = (
  file: File,
  options?: ManualLearningPrepareFileOptions,
) => Promise<ManualLearningPreparedFile>;

export type ManualLearningWorkerRequest = { protocolVersion: string; requestId: string } & (
  | { type: "extract_batch"; files: File[] }
  | {
      type: "prepare_import_file";
      file: File;
      maximumChunkCharacters?: number;
    }
  | { type: "cancel" }
);

export type ManualLearningWorkerResponse = { protocolVersion: string; requestId: string } & (
  | { type: "progress"; progress: ManualLearningFileProgress }
  | { type: "completed"; items: ManualLearningBatchItem[]; rawContentRetained: false; dataLeftDevice: false }
  | { type: "prepared"; prepared: ManualLearningPreparedFile; rawContentRetained: false; dataLeftDevice: false }
  | { type: "failed"; errorCode: string; rawContentRetained: false; dataLeftDevice: false }
  | { type: "cancelled"; rawContentRetained: false; dataLeftDevice: false }
);
