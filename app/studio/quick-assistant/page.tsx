import { redirect } from "next/navigation";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value) ? value : "";
}

/** Historical links now hand their task to the project-scoped conversation. */
export default async function QuickAssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const projectId = safeProjectId(first(params.projectId));
  const prompt = first(params.objective || params.prompt || params.task)
    .trim()
    .slice(0, 8_000);
  const query = new URLSearchParams();
  if (prompt) query.set("prompt", prompt);
  redirect(projectId
    ? `/studio/project/${encodeURIComponent(projectId)}/chat${query.size ? `?${query.toString()}` : ""}`
    : "/professional?intent=chat");
}
