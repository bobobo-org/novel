import CharacterAgentWorkspace from "./character-agent-workspace";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <CharacterAgentWorkspace projectId={projectId} />;
}
