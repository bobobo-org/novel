import LearningWorkspace from "./learning-workspace";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <LearningWorkspace projectId={projectId} />;
}
