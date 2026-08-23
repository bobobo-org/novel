import { AUTHOR_TOOL_IDS, type AuthorToolId } from "@/lib/novel-ai/author-tools";
import AuthorToolsWorkspace from "./author-tools-workspace";

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
  const requested = first(query.tool) as AuthorToolId;
  const initialTool = AUTHOR_TOOL_IDS.includes(requested) ? requested : "breakdown";
  return <AuthorToolsWorkspace key={`${projectId}:${initialTool}`} projectId={projectId} initialTool={initialTool} />;
}
