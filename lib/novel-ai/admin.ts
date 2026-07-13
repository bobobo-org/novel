import { jsonError } from "./http";

export function requireAdmin(req: Request): Response | null {
  const token = process.env.ADMIN_TOKEN || "";
  if (!token) return null;
  const provided = req.headers.get("x-admin-token") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (provided !== token) {
    return jsonError("未授權使用訓練資料管理功能。", 401, "UNAUTHORIZED");
  }
  return null;
}
