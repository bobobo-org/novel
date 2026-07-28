import ClosedAIWorkspace from "./closed-ai-workspace";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ClosedAIWorkspace projectId={projectId} />;
}
