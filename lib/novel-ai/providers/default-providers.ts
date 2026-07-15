import { LocalRuleProvider } from "./local-rule-provider";
import type { AiProviderCapabilities } from "./provider-capabilities";
import { OllamaProvider } from "./ollama/ollama-provider";

export async function defaultProviderCapabilities(): Promise<AiProviderCapabilities[]> {
  const local = await new LocalRuleProvider().getCapabilities();
  const ollama = await new OllamaProvider().getCapabilities();
  return [
    local,
    ollama,
    {
      provider: "google-gemini",
      status: process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "configured" : "unavailable",
      models: [process.env.GEMINI_MODEL_ID || "gemini-2.5-flash"],
      capabilities: ["text", "structured_json", "story_bible", "generative_writing", "consistency_check"],
      maxContextTokens: 32768,
      supportsAbort: true,
      supportsStreaming: false,
      dataLeavesDevice: true,
    },
  ];
}
