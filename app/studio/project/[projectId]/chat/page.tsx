import ConversationWorkspace from "./conversation-workspace";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safePrefill(value: string) {
  return value.replace(/\r\n?/gu, "\n").trim().slice(0, 8_000);
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  return (
    <ConversationWorkspace
      projectId={projectId}
      initialPrompt={safePrefill(first(query.prompt))}
    />
  );
}
