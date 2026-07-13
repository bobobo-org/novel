import { z } from "zod";
import { confirmMemoryUpdate, getNovelMemory, proposeMemoryUpdate, saveNovelMemory } from "@/lib/novel-ai/memory";
import { jsonError } from "@/lib/novel-ai/http";
import { MemoryUpdateCandidateSchema, NovelMemorySchema } from "@/lib/novel-ai/schemas";
import { getStoryMemoryFromDb, persistenceHealth, writeMemoryCandidate, writeStoryMemory } from "@/lib/novel-ai/persistence";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId") || "";
  if (!projectId) return jsonError("缺少 projectId。", 400, "MISSING_PROJECT_ID");

  const persistence = await persistenceHealth();
  if (persistence.persistenceStatus === "ok") {
    try {
      const memory = await getStoryMemoryFromDb(projectId);
      if (memory) {
        return Response.json({
          memory,
          metadata: { dataSource: "database", persistenceMode: "db-first", cacheHit: false, recoveredFromDatabase: true },
        });
      }
      return Response.json({
        memory: getNovelMemory(projectId),
        metadata: { dataSource: "not-found", persistenceMode: "db-first", cacheHit: false, recoveredFromDatabase: false },
      });
    } catch (error) {
      return Response.json({
        memory: getNovelMemory(projectId),
        metadata: {
          dataSource: "memory-fallback",
          persistenceMode: "db-first",
          cacheHit: true,
          recoveredFromDatabase: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return Response.json({
    memory: getNovelMemory(projectId),
    metadata: { dataSource: "memory-fallback", persistenceMode: "memory", cacheHit: true, recoveredFromDatabase: false },
  });
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
      const memory = confirmMemoryUpdate(candidate);
      await writeStoryMemory(memory);
      return Response.json({ memory });
    }
    const input = CandidateInputSchema.parse(body);
    const candidate = proposeMemoryUpdate(input);
    await writeMemoryCandidate(candidate);
    return Response.json({ candidate });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "記憶候選建立失敗。", 400, "MEMORY_CANDIDATE_ERROR");
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (body?.mode === "replace") {
      const memory = saveNovelMemory(NovelMemorySchema.parse(body.memory));
      await writeStoryMemory(memory);
      return Response.json({ memory });
    }
    const candidate = MemoryUpdateCandidateSchema.parse(body.candidate);
    const memory = confirmMemoryUpdate(candidate);
    await writeStoryMemory(memory);
    return Response.json({ memory });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "記憶確認失敗，原有作品資料仍然安全。", 400, "MEMORY_CONFIRM_ERROR");
  }
}
