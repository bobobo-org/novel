import { legacyExternalAIRouteDisabled } from "../legacy-external-route-disabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return legacyExternalAIRouteDisabled("/api/ai/analyze");
}
