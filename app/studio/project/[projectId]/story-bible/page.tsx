import StoryStageSelectionPage from "../story-stage-selection-page";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <StoryStageSelectionPage projectId={projectId} focus="story-bible" />;
}
