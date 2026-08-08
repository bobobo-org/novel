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
  const cloneFrom = rawCloneFrom && /^[A-Za-z0-9_-]{1,128}$/u.test(rawCloneFrom)
    ? rawCloneFrom
    : null;
  return <CreateProjectClient cloneFrom={cloneFrom} />;
}
