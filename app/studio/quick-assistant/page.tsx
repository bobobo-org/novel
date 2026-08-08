import { redirect } from "next/navigation";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : "";
}

/**
 * Historical links opened a second, monolithic AI editor. That split the
 * author away from the active chapter. Keep the URL compatible while routing
 * every writing task into the canonical chapter workspace instead.
 */
export default async function QuickAssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const projectId = safeProjectId(first(params.projectId));
  redirect(projectId
    ? `/studio/project/${encodeURIComponent(projectId)}/write?assistant=advanced#writing-ai`
    : "/professional?intent=write");
}
