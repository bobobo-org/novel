import { decideAiProvider } from "../lib/novel-ai/router/ai-router";
import { LocalRuleProvider } from "../lib/novel-ai/providers/local-rule-provider";
import { OllamaProvider } from "../lib/novel-ai/providers/ollama/ollama-provider";
import { defaultProviderCapabilities } from "../lib/novel-ai/providers/default-providers";
import type { AiTaskType } from "../lib/novel-ai/providers/provider-types";
import { AiTaskSQLiteStore } from "./ai-task-store";

export type RuntimeTaskInput = {
  projectId: string;
  taskType: AiTaskType;
  input: string;
  storageDir?: string;
  targetLength?: number;
};

export type RuntimeTaskResult = {
  taskId: string;
  status: string;
  provider: string;
  model: string;
  content: string;
  dataLeftDevice: boolean;
  warnings: string[];
};

const runningControllers = new Map<string, AbortController>();

export async function runRuntimeTask(input: RuntimeTaskInput): Promise<RuntimeTaskResult> {
  const providers = await defaultProviderCapabilities();
  const decision = decideAiProvider({
    taskType: input.taskType,
    storageMode: "SQLITE_LOCAL",
    fullOfflineRequired: true,
    allowExternalProvider: false,
    internetAvailable: false,
    availableProviders: providers,
    contextCharacters: { recent: input.input.length },
  });
  const selectedProvider = decision.selectedProvider || "local-rule";
  const selectedModel = decision.selectedModel || "local-rule-v1";
  const store = await AiTaskSQLiteStore.open(input.projectId, input.storageDir);
  const taskId = store.createTask({
    projectId: input.projectId,
    taskType: input.taskType,
    provider: selectedProvider,
    model: selectedModel,
    status: "running",
    dataLeftDevice: decision.dataMayLeaveDevice,
    row: { contextPlan: decision.contextPlan, routerDecision: decision.decisionReason },
  });
  const controller = new AbortController();
  runningControllers.set(taskId, controller);
  try {
    const provider = selectedProvider === "ollama-local" ? new OllamaProvider({ model: selectedModel }) : new LocalRuleProvider();
    const request = {
      requestId: taskId,
      projectId: input.projectId,
      taskType: input.taskType,
      input: input.input,
      privacyMode: "local_only" as const,
      allowExternalProvider: false,
      abortSignal: controller.signal,
      constraints: { targetLength: input.targetLength },
    };
    const result = input.taskType === "story_bible_extraction"
      ? await provider.extractStoryBible(request)
      : input.taskType === "consistency_check"
        ? await provider.checkConsistency(request)
        : input.taskType === "continue_writing"
          ? await provider.continueWriting(request)
          : input.taskType === "rewrite"
            ? await provider.rewriteText(request)
            : input.taskType === "plot_brainstorm"
              ? await provider.brainstormPlot(request)
              : await provider.summarizeChapter(request);
    store.addResult(taskId, input.projectId, {
      provider: result.provider,
      model: result.model,
      contentLength: result.content.length,
      structuredOutput: result.structuredOutput,
      dataLeftDevice: result.dataLeftDevice,
      latencyMs: result.latencyMs,
    });
    if (["continue_writing", "rewrite", "plot_brainstorm"].includes(input.taskType)) {
      store.addDraft(taskId, input.projectId, result.content, {
        provider: result.provider,
        model: result.model,
        taskType: input.taskType,
        dataLeftDevice: result.dataLeftDevice,
      });
    }
    store.addAudit(taskId, input.projectId, {
      provider: result.provider,
      model: result.model,
      dataLeftDevice: result.dataLeftDevice,
      fallbackUsed: result.fallbackUsed,
      warnings: result.warnings,
    });
    store.updateStatus(taskId, input.projectId, "completed", { completedAt: new Date().toISOString() });
    return {
      taskId,
      status: "completed",
      provider: result.provider,
      model: result.model,
      content: result.content,
      dataLeftDevice: result.dataLeftDevice,
      warnings: result.warnings,
    };
  } catch (error) {
    store.updateStatus(taskId, input.projectId, controller.signal.aborted ? "cancelled" : "failed", {
      errorCode: error instanceof Error ? error.name : "TASK_FAILED",
    });
    throw error;
  } finally {
    runningControllers.delete(taskId);
    store.close();
  }
}

export function cancelRuntimeTask(taskId: string) {
  const controller = runningControllers.get(taskId);
  if (!controller) return false;
  controller.abort();
  runningControllers.delete(taskId);
  return true;
}
