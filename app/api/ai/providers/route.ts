import { NextResponse } from "next/server";
import { defaultProviderCapabilities } from "@/lib/novel-ai/providers/default-providers";

export const runtime = "nodejs";

export async function GET() {
  const providers = await defaultProviderCapabilities();
  return NextResponse.json({
    providerContractStatus: "ready",
    providers: providers.map((provider) => ({
      provider: provider.provider,
      status: provider.status,
      modelCount: provider.models.length,
      supportsStreaming: provider.supportsStreaming,
      dataLeavesDevice: provider.dataLeavesDevice,
      capabilities: provider.capabilities,
    })),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
