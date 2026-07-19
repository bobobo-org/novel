import WriteWorkspace from "./write-workspace";
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) { const { projectId } = await params; return <WriteWorkspace projectId={projectId} />; }
