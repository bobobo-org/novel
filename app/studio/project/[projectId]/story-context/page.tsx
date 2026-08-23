import Client from "../project-section-client";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const requestedView = Array.isArray(query.view) ? query.view[0] : query.view;
  const view = requestedView === "story-bible" ? "story-bible" : "timeline";
  return <Client projectId={projectId} section={view} />;
}
