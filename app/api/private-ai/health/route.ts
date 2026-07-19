import { privateHubEnabled } from "@/lib/novel-ai/providers/private-ai-hub/job-store";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json({ status: privateHubEnabled() ? "ready" : "contract_ready_runtime_not_connected", authenticationBoundary: "ready", ownershipCheck: "ready", cancellation: "ready", runtimeConnected: privateHubEnabled() }, { headers: { "Cache-Control": "no-store, max-age=0" } }); }
