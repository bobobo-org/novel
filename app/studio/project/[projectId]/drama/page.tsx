import DramaWorkspace from "./drama-workspace";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <DramaWorkspace projectId={projectId} />;
}
