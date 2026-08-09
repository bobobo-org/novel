import { redirect } from "next/navigation";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const objective = first(query.objective).trim().slice(0, 8_000);
  const destination = new URLSearchParams();
  if (objective) destination.set("prompt", objective);
  redirect(
    `/studio/project/${encodeURIComponent(projectId)}/chat${destination.size ? `?${destination.toString()}` : ""}`,
  );
}
