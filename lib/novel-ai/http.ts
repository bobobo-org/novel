import { NextResponse } from "next/server";
import { inputHash, recordAiRun } from "./store";
import { providerMeta } from "./provider";

export function jsonError(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ error: message, code }, { status });
}

export async function timedRun<T>(
  taskType: "story_analysis" | "chapter_plan" | "continuity_review",
  projectId: string,
  chapterId: string | undefined,
  input: unknown,
  run: () => Promise<T>,
) {
  const started = Date.now();
  const meta = providerMeta();
  try {
    const result = await run();
    const aiRun = recordAiRun({
      projectId,
      chapterId,
      taskType,
      provider: meta.provider,
      model: meta.model,
      inputHash: inputHash(input),
      latencyMs: Date.now() - started,
      status: "success",
    });
    return { result, aiRun };
  } catch (error) {
    recordAiRun({
      projectId,
      chapterId,
      taskType,
      provider: meta.provider,
      model: meta.model,
      inputHash: inputHash(input),
      latencyMs: Date.now() - started,
      status: "error",
      errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
    throw error;
  }
}
