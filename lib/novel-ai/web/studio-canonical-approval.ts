import type { Chapter } from "../domain";
import { sha256Hex } from "../closed-ai-cache";
import type { NovelRepository } from "../repository";
import { mirrorChapterToLegacyStudio } from "../repository/migration/legacy-studio-migration";

export type StudioCanonicalApplyMode = "append" | "replace";

export type StudioCanonicalApplyInput = {
  repository: NovelRepository;
  projectId: string;
  chapterId: string;
  sourceRevision: number;
  taskId: string;
  content: string;
  mode: StudioCanonicalApplyMode;
};

export type StudioCanonicalApplyResult = {
  chapter: Chapter;
  commitId: string;
  contentDigest: string;
  sourceRevision: number;
  resultingRevision: number;
};

function staleRevision(expected: number, actual: number | null) {
  return Object.assign(
    new Error("候選內容建立後，來源章節已變更；請重新產生候選再核准。"),
    {
      code: "GENERATION_SOURCE_REVISION_STALE",
      expectedRevision: expected,
      actualRevision: actual,
    },
  );
}

export async function commitStudioCandidateToChapter(
  input: StudioCanonicalApplyInput,
): Promise<StudioCanonicalApplyResult> {
  const acceptedContent = input.content.trim();
  if (!acceptedContent) {
    throw Object.assign(new Error("不能核准空白內容。"), {
      code: "STUDIO_CANDIDATE_CONTENT_EMPTY",
    });
  }
  const current = await input.repository.get<Chapter>(
    "chapters",
    input.chapterId,
  );
  if (!current || current.projectId !== input.projectId) {
    throw Object.assign(new Error("找不到候選所屬的來源章節。"), {
      code: "STUDIO_CANDIDATE_SOURCE_CHAPTER_NOT_FOUND",
    });
  }
  if (current.revision !== input.sourceRevision) {
    throw staleRevision(input.sourceRevision, current.revision);
  }
  const nextContent = input.mode === "replace"
    ? acceptedContent
    : `${current.content.trim()}${current.content.trim() ? "\n\n" : ""}${acceptedContent}`;
  const contentDigest = await sha256Hex(nextContent);
  const saved = await input.repository.put<Chapter>(
    "chapters",
    {
      ...current,
      content: nextContent,
    },
    current.revision,
  );
  mirrorChapterToLegacyStudio(
    input.projectId,
    saved.title,
    saved.content,
  );
  return {
    chapter: saved,
    commitId: [
      "studio-chapter",
      saved.id,
      `revision-${saved.revision}`,
      `task-${input.taskId}`,
      contentDigest,
    ].join(":"),
    contentDigest,
    sourceRevision: input.sourceRevision,
    resultingRevision: saved.revision,
  };
}

export async function applyWritingAidTransaction(
  input: StudioCanonicalApplyInput,
) {
  const committed = await commitStudioCandidateToChapter(input);
  return {
    ...committed,
    provenance: {
      sourceType: "local-writing-aid" as const,
      aiGenerated: false as const,
      modelId: null,
      modelDigest: null,
      modelProof: null,
    },
  };
}
