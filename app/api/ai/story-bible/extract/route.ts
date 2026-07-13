import { jsonError } from "@/lib/novel-ai/http";
import {
  extractStoryBibleCandidates,
  StoryBibleExtractionInputSchema,
} from "@/lib/novel-ai/story-bible";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const input = StoryBibleExtractionInputSchema.parse(body);
    const result = await extractStoryBibleCandidates(input);
    return Response.json({
      candidates: result.candidates,
      candidateFacts: result.candidateFacts,
      candidateUpdates: result.candidateUpdates,
      candidateDeletions: result.candidateDeletions,
      candidateConflicts: result.candidateConflicts,
      chapterSummaryCandidate: result.chapterSummaryCandidate,
      extractionWarnings: result.extractionWarnings,
      sourceRefs: result.sourceRefs,
      modelId: result.modelId,
      promptVersion: result.promptVersion,
      schemaVersion: result.schemaVersion,
      confidence: result.confidence,
      traceId: result.traceId,
      extractionRunId: result.extractionRunId,
      fallbackLevel: result.fallbackLevel,
      trace: result.trace,
      elapsedMs: result.elapsedMs,
      persistence: {
        status: "written",
        canonicalUpdated: false,
        candidateStatus: "pending-review",
      },
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Story Bible 候選抽取失敗，正式記憶未被修改。",
      400,
      "STORY_BIBLE_EXTRACT_ERROR",
    );
  }
}
