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
    throw Object.assign(new Error("作品身分格式不正確。"), {
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
    /NOT_CONFIGURED|MIGRATION|PGRST|HTTP_404/iu.test(String((error as Error)?.message))
      ? 503
      : 500
  ));
  const messages: Record<string, string> = {
    CLOUD_SYNC_AUTH_REQUIRED: "請先在作品儲存頁開啟雲端同步。",
    CLOUD_SYNC_PROJECT_ID_INVALID: "作品身分格式不正確。",
    CLOUD_SYNC_PROJECT_NOT_FOUND: "雲端找不到這部作品。",
    CLOUD_SYNC_ENVELOPE_INVALID: "雲端同步密文格式不正確。",
    CLOUD_SYNC_OPERATION_INVALID: "同步操作身分不正確。",
    CLOUD_SYNC_REVISION_INVALID: "同步版本不正確。",
  };
  return NextResponse.json({
    errorCode: code,
    message: messages[code] ?? "雲端同步服務尚未就緒，作品仍安全保留在本機。",
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
      throw Object.assign(new Error("同步快照超過單次上傳上限。"), {
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
