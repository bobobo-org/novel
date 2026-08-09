import {
  extractManualLearningFile,
  splitManualLearningDocumentSemantically,
} from "./manual-learning-file";
import type {
  ManualLearningFilePreparer,
  ManualLearningPreparedFile,
} from "./manual-learning-import-preparation";

/**
 * Direct parser adapter for non-browser fixtures and the dedicated Learning
 * workspace. Chat must inject the isolated Worker implementation instead.
 */
export const prepareManualLearningFileLocally: ManualLearningFilePreparer = async (
  file,
  options = {},
): Promise<ManualLearningPreparedFile> => {
  const extraction = await extractManualLearningFile(file, {
    signal: options.signal,
    onProgress: (progress) => {
      if (progress.phase !== "completed") options.onProgress?.(progress);
    },
  });
  options.onProgress?.({
    fileName: file.name,
    phase: "chunking",
    current: 0,
    total: 1,
    pageNumber: null,
    pageCount: extraction.pageCount,
  });
  try {
    const chunks = await splitManualLearningDocumentSemantically(
      extraction.text,
      options.maximumChunkCharacters,
    );
    const { text: _text, ...metadata } = extraction;
    void _text;
    options.onProgress?.({
      fileName: file.name,
      phase: "chunking",
      current: 1,
      total: 1,
      pageNumber: null,
      pageCount: extraction.pageCount,
    });
    return {
      extraction: metadata,
      chunks,
      semanticChunkingAlgorithm: "semantic-chunking-v1",
      rawContentRetained: false,
      dataLeftDevice: false,
    };
  } finally {
    extraction.text = "";
  }
};
