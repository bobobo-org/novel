import { NextResponse } from "next/server";
import {
  listCloudProjects,
  pullCloudProject,
  pushCloudProject,
  readCloudSyncOwnerId,
} from "@/lib/novel-ai/cloud-sync/server";
import type { CloudSyncPushRequest } from "@/lib/novel-ai/cloud-sync/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeProjectId(value: string | null) {
  const projectId = value?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{1,160}$/u.test(projectId)) {
    throw Object.assign(new Error("作品識別碼格式不正確。"), {
      code: "CLOUD_SYNC_PROJECT_ID_INVALID",
      status: 400,
      retryable: false,
    });
  }
  return projectId;
}

function errorResponse(error: unknown) {
  const candidate = error as {
    code?: string;
    status?: number;
    retryable?: boolean;
  };
  const code = String(candidate?.code || "CLOUD_SYNC_SERVER_ERROR");
  const status = Number(candidate?.status || (
    /NOT_CONFIGURED|MIGRATION|STORAGE_HTTP_404/iu.test(String((error as Error)?.message))
      ? 503
      : 500
  ));
  const messages: Record<string, string> = {
    CLOUD_SYNC_AUTH_REQUIRED: "請先設定有效的雲端同步復原金鑰。",
    CLOUD_SYNC_PROJECT_ID_INVALID: "作品識別碼格式不正確。",
    CLOUD_SYNC_PROJECT_NOT_FOUND: "雲端找不到這部作品。",
    CLOUD_SYNC_ENVELOPE_INVALID: "雲端同步加密封包格式不正確。",
    CLOUD_SYNC_OPERATION_INVALID: "雲端同步操作識別碼不正確。",
    CLOUD_SYNC_REVISION_INVALID: "雲端同步版本號不正確。",
    CLOUD_SYNC_WRITE_IN_PROGRESS: "另一個雲端同步操作正在完成，稍後會自動重試。",
    CLOUD_SYNC_STORAGE_CORRUPT: "雲端同步資料完整性檢查失敗。",
  };
  return NextResponse.json({
    errorCode: code,
    message: messages[code] ?? "雲端同步暫時無法完成，系統會保留本機資料。",
    retryable: Boolean(candidate?.retryable ?? status >= 500),
  }, {
    status: Math.max(400, Math.min(599, status)),
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Novel-Runtime-Surface": "cloud-sync",
    },
  });
}

export async function GET(request: Request) {
  try {
    const ownerId = readCloudSyncOwnerId(request);
    const url = new URL(request.url);
    const rawProjectId = url.searchParams.get("projectId");
    if (!rawProjectId) {
      return NextResponse.json({ projects: await listCloudProjects(ownerId) }, {
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }
    return NextResponse.json(await pullCloudProject(ownerId, safeProjectId(rawProjectId)), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ownerId = readCloudSyncOwnerId(request);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 4_200_000) {
      throw Object.assign(new Error("雲端同步資料超過大小限制。"), {
        code: "CLOUD_SYNC_PAYLOAD_TOO_LARGE",
        status: 413,
        retryable: false,
      });
    }
    const body = await request.json() as CloudSyncPushRequest;
    body.projectId = safeProjectId(body.projectId);
    return NextResponse.json(await pushCloudProject(ownerId, body), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
