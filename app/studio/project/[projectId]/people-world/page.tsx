import CharacterAgentWorkspace from "../character-ai/character-agent-workspace";
import StoryStageSelectionPage from "../story-stage-selection-page";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const requestedView = Array.isArray(query.view) ? query.view[0] : query.view;
  if (requestedView === "character-ai") {
    return <CharacterAgentWorkspace projectId={projectId} />;
  }
  const view = requestedView === "world" ? "world" : "characters";
  return <StoryStageSelectionPage projectId={projectId} focus={view} />;
}
