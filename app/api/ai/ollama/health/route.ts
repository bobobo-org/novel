import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    scope: "server-runtime",
    applicable: false,
    status: "client_probe_required",
    reason: "Local Ollama must be probed by the user's browser through Local Bridge.",
    localBridgeEndpoint: "http://127.0.0.1:3217",
    directClientOllamaAccess: false,
  }, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Novel-Runtime-Surface": "server-ollama-semantics",
    },
  });
}
