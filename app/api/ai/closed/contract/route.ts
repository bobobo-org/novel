import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CLOSED_AI_CONTRACT = Object.freeze({
  browserAI: {
    scope: "client",
    taskModel: {
      label: "瀏覽器本機分析器",
      generative: false,
      runtimeStatus: "client_probe_required",
    },
    nativeSummarizer: {
      label: "瀏覽器摘要模型",
      generative: false,
      runtimeStatus: "client_probe_required",
    },
    nativeLanguageModel: {
      label: "瀏覽器裝置內生成模型",
      generative: true,
      maximumComplexity: "standard",
      runtimeStatus: "client_probe_required",
    },
  },
  localOllama: {
    scope: "client-loopback",
    path: "Browser -> Local Bridge 127.0.0.1:3217 -> Ollama 127.0.0.1:11434",
    runtimeStatus: "client_probe_required",
  },
  privateHub: {
    scope: "client-loopback-private-node",
    runtimeStatus: "client_probe_required",
  },
  closedAgentOS: {
    candidateOnlyBeforeApproval: true,
    canonicalMutationBeforeApproval: 0,
    runtimeStatus: "client_runtime",
  },
  noSilentExternalFallback: true,
});

export async function GET() {
  return NextResponse.json(CLOSED_AI_CONTRACT, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Novel-Runtime-Surface": "closed-ai-contract",
    },
  });
}
