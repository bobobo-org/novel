import { OllamaClient } from "./ollama-client";

export type OllamaBenchmarkResult = {
  model: string;
  promptChars: number;
  latencyMs: number;
  firstTokenMs?: number;
  outputChars: number;
  tokensPerSecondApprox?: number;
  ok: boolean;
  errorCode?: string;
};

export async function benchmarkOllamaGenerate(input: { model: string; prompt: string; endpoint?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<OllamaBenchmarkResult> {
  const started = Date.now();
  try {
    const client = new OllamaClient({ endpoint: input.endpoint, timeoutMs: input.timeoutMs ?? 30_000 });
    const result = await client.generate({
      model: input.model,
      prompt: input.prompt,
      stream: false,
      options: { temperature: 0.2 },
      signal: input.signal,
    });
    const latencyMs = Date.now() - started;
    const outputChars = result.response?.length ?? 0;
    const approxTokens = Math.max(1, Math.ceil(outputChars / 3.2));
    return {
      model: input.model,
      promptChars: input.prompt.length,
      latencyMs,
      outputChars,
      tokensPerSecondApprox: Math.round((approxTokens / Math.max(1, latencyMs / 1000)) * 10) / 10,
      ok: outputChars > 0,
    };
  } catch (error) {
    return {
      model: input.model,
      promptChars: input.prompt.length,
      latencyMs: Date.now() - started,
      outputChars: 0,
      ok: false,
      errorCode: error instanceof Error ? error.name : "OLLAMA_BENCHMARK_ERROR",
    };
  }
}
