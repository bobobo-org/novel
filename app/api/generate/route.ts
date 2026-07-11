import { generateText } from "ai";
import { google } from "@ai-sdk/google";

export const runtime = "nodejs";
export const maxDuration = 60;

// Validated against this Gemini account (2026-07): older ids like gemini-2.0/2.5-flash
// return "no longer available"; the `-latest` alias stays valid.
const MODEL = "gemini-flash-latest";

const SYSTEM_PROMPT =
  "你是一位擅長長篇小說續寫的華文作家。請務必用繁體中文創作，" +
  "延續使用者提供的原創設定與上一章，寫出可直接閱讀的正文（含本章標題、衝突、人物行動與章尾鉤子），" +
  "不要只給大綱或提示詞，不要加「以下是續寫」之類的前言。";

export async function POST(req: Request): Promise<Response> {
  let body: { prompt?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "無效的請求內容。" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ error: "缺少 prompt。" }, { status: 400 });
  }
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json(
      { error: "伺服器尚未設定 Gemini 金鑰（GOOGLE_GENERATIVE_AI_API_KEY）。" },
      { status: 503 },
    );
  }

  try {
    const { text } = await generateText({
      model: google(MODEL),
      system: SYSTEM_PROMPT,
      prompt,
    });
    return Response.json({ text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成失敗。";
    return Response.json({ error: message }, { status: 502 });
  }
}
