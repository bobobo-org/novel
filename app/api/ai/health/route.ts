import { NextResponse } from "next/server";
import { providerMeta } from "@/lib/novel-ai/provider";

export const runtime = "nodejs";

export async function GET() {
  const meta = providerMeta();
  return NextResponse.json({
    status: meta.configured ? "ok" : "needs_configuration",
    provider: meta.provider,
    model: meta.model,
    database: process.env.DATABASE_URL ? "configured" : "memory",
    key: "server-only",
  });
}
