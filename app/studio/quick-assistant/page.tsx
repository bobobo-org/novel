import { RELEASE_MANIFEST } from "@/lib/release-manifest";
import StudioClient from "../studio-client";

const SCREENS = new Set([
  "home",
  "create",
  "write",
  "choice",
  "inspect",
  "library",
  "world",
  "dashboard",
  "backup",
]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "";
}

export default async function QuickAssistantPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedScreen = first(params.screen);
  const initialScreen = requestedScreen === "interactive"
    ? "choice"
    : SCREENS.has(requestedScreen)
      ? requestedScreen
      : "write";

  return (
    <StudioClient
      initialScreen={initialScreen}
      initialTask={first(params.task)}
      initialProjectId={safeProjectId(first(params.projectId))}
      release={RELEASE_MANIFEST}
    />
  );
}
