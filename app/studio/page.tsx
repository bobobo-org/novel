import { RELEASE_MANIFEST } from "@/lib/release-manifest";
import { redirect } from "next/navigation";
import StudioClient from "./studio-client";

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

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedScreen = first(params.screen);
  const projectId = safeProjectId(first(params.projectId));
  if (requestedScreen === "create") {
    redirect("/studio/create");
  }
  // Old consumer URLs used the monolithic StudioClient. Keep those links
  // compatible, but always land authors in the canonical single-purpose
  // workspace so chapters and AI candidates cannot be split across two UIs.
  if (requestedScreen === "write") {
    redirect(projectId
      ? `/studio/project/${encodeURIComponent(projectId)}/chat`
      : "/professional?intent=chat");
  }
  if (requestedScreen === "library") {
    redirect(projectId
      ? `/professional?intent=library&projectId=${encodeURIComponent(projectId)}`
      : "/professional?intent=library");
  }
  if (requestedScreen === "choice" || requestedScreen === "interactive") {
    redirect(projectId
      ? `/studio/project/${encodeURIComponent(projectId)}/chat?mode=play`
      : "/professional?intent=play");
  }
  if (requestedScreen === "world" && projectId) {
    redirect(`/studio/project/${encodeURIComponent(projectId)}/story-bible`);
  }
  const initialScreen = requestedScreen === "interactive"
    ? "choice"
    : SCREENS.has(requestedScreen)
      ? requestedScreen
      : "home";
  const migrationAction = first(params.legacyMigration) === "import"
    ? "import"
    : "";

  return (
    <StudioClient
      initialScreen={initialScreen}
      initialTask={first(params.task)}
      initialProjectId={projectId}
      initialLegacyMigrationAction={migrationAction}
      release={RELEASE_MANIFEST}
    />
  );
}
