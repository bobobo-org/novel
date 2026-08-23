import type { Metadata } from "next";
import CreateProjectClient from "./create-project-client";

export const metadata: Metadata = { title: "建立新作品｜諸天萬界小說生成系統" };

export default async function CreateProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ cloneFrom?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawCloneFrom = Array.isArray(params.cloneFrom) ? params.cloneFrom[0] : params.cloneFrom;
  // Keep an invalid, bounded value long enough for the client to render a
  // truthful source error. Silently converting it to a normal create flow made
  // a broken "複製為其他玩法" link look as if it had done nothing.
  const cloneFrom = typeof rawCloneFrom === "string" && rawCloneFrom.length > 0
    ? rawCloneFrom.slice(0, 512)
    : null;
  return <CreateProjectClient cloneFrom={cloneFrom} />;
}
