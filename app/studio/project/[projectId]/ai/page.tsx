import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/studio/project/${encodeURIComponent(projectId)}/write?assistant=advanced#writing-ai`);
}
