import { z } from "zod";
import { confirmMemoryUpdate, getNovelMemory, proposeMemoryUpdate, saveNovelMemory } from "@/lib/novel-ai/memory";
import { jsonError } from "@/lib/novel-ai/http";
import { MemoryUpdateCandidateSchema, NovelMemorySchema } from "@/lib/novel-ai/schemas";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") || "";
  if (!projectId) return jsonError("缺少 projectId。", 400, "MISSING_PROJECT_ID");
  return Response.json({ memory: getNovelMemory(projectId) });
}

const CandidateInputSchema = z.object({
  projectId: z.string().min(1).max(120),
  chapterId: z.string().max(120).optional(),
  chapterTitle: z.string().max(200).optional(),
  chapterText: z.string().max(12000).optional(),
  chapterPlan: z.unknown().optional(),
  abcChoice: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body?.candidate) {
      const candidate = MemoryUpdateCandidateSchema.parse(body.candidate);
      return Response.json({ memory: confirmMemoryUpdate(candidate) });
    }
    const input = CandidateInputSchema.parse(body);
    return Response.json({ candidate: proposeMemoryUpdate(input) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "建立記憶更新候選失敗。", 400, "MEMORY_CANDIDATE_ERROR");
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (body?.mode === "replace") return Response.json({ memory: saveNovelMemory(NovelMemorySchema.parse(body.memory)) });
    const candidate = MemoryUpdateCandidateSchema.parse(body.candidate);
    return Response.json({ memory: confirmMemoryUpdate(candidate) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "確認記憶更新失敗，原有記憶不會被刪除。", 400, "MEMORY_CONFIRM_ERROR");
  }
}
