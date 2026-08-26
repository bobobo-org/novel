import ConversationHandoffWorkspace from "./conversation-handoff-workspace";

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
  const requestedPrompt = safePrefill(first(query.prompt));
  const handoffId = first(query.handoff).trim().slice(0, 128);
  const modePrompt = first(query.mode) === "play"
    ? "開始目前玩法的第一回合。"
    : "";
  return (
    <ConversationHandoffWorkspace
      projectId={projectId}
      initialPrompt={requestedPrompt || modePrompt}
      handoffId={handoffId}
    />
  );
}
