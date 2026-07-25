import AiWorkspace from "./ai-workspace";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <AiWorkspace projectId={projectId} />;
}
