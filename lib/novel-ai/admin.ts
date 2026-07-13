import { jsonError } from "./http";

export function requireAdmin(req: Request): Response | null {
  const token = process.env.ADMIN_TOKEN || "";
  if (!token && process.env.NODE_ENV === "production") {
    return jsonError("管理員權限尚未設定，無法執行後台資料查詢。", 503, "ADMIN_TOKEN_NOT_CONFIGURED");
  }
  if (!token) return null;
  const provided = req.headers.get("x-admin-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (provided !== token) {
    return jsonError("沒有權限使用 AI 訓練資料管理功能。", 401, "UNAUTHORIZED");
  }
  return null;
}
