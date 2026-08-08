import LegacyHandoffClient from "./legacy-handoff-client";

const TARGETS = new Set(["write", "read", "manage", "backups", "professional"]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "";
}

export default async function LegacyHandoffPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawTarget = first(params.target);
  const target = TARGETS.has(rawTarget) ? rawTarget : "write";
  return (
    <LegacyHandoffClient
      projectId={safeProjectId(first(params.projectId))}
      target={target as "write" | "read" | "manage" | "backups" | "professional"}
    />
  );
}
