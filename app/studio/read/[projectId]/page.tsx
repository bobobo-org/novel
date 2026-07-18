import ReaderClient from "./reader-client";

export default async function ReaderPage({ params }:{ params:Promise<{projectId:string}> }) {
  const { projectId } = await params;
  return <ReaderClient projectId={projectId}/>;
}
