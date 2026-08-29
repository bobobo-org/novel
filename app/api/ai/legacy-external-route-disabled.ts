import { NextResponse } from "next/server";

const SAFE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Old domain-specific cloud endpoints predate provider selection, one-time
 * consent and request budgets. Keep their URLs as fail-closed tombstones so a
 * stale client cannot export story text silently.
 */
export function legacyExternalAIRouteDisabled(route: string) {
  return NextResponse.json({
    error: "舊版外接 AI 入口已停用。請從新版 AI 設定或故事工作台明確選擇供應商，並在每次送出前同意資料外傳。",
    code: "LEGACY_EXTERNAL_AI_ROUTE_DISABLED",
    retiredRoute: route,
    replacement: "/api/ai/external/generate",
    retryable: false,
  }, { status: 410, headers: SAFE_HEADERS });
}
