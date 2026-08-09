import ProfessionalClient from "./professional-client";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "";
}

function safeIntent(value: string) {
  return value === "chat" || value === "write" || value === "play" || value === "library"
    ? value
    : "library";
}

export default async function ProfessionalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <ProfessionalClient
      initialProjectId={safeProjectId(first(params.projectId))}
      intent={safeIntent(first(params.intent))}
    />
  );
}
