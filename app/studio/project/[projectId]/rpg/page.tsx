import RpgWorkspace from "./rpg-workspace";

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <RpgWorkspace projectId={projectId} />;
}
