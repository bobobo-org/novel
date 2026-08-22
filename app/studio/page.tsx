import { redirect } from "next/navigation";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "";
}

function managementHref(projectId: string, section = "") {
  const query = new URLSearchParams({ intent: "library", projectId });
  return `/professional?${query.toString()}${section ? `#${section}` : ""}`;
}

function consistencyCheckHref(projectId: string) {
  const query = new URLSearchParams({
    prompt: "請檢查目前作品的角色、時間線、世界規則與章節因果，列出有證據的矛盾與可核准修正候選；不要直接修改 Canon。",
  });
  return `/studio/project/${encodeURIComponent(projectId)}/chat?${query.toString()}`;
}

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestedScreen = first(params.screen).trim().toLowerCase();
  const projectId = safeProjectId(first(params.projectId));

  // The former monolithic workspace is a migration source, never a second
  // consumer application. Historical URLs converge on canonical workspaces.
  if (first(params.legacyMigration) === "import") {
    redirect("/professional?intent=library&legacyMigration=import");
  }
  if (requestedScreen === "create") redirect("/studio/create");
  if (requestedScreen === "write") {
    redirect(projectId
      ? `/studio/project/${encodeURIComponent(projectId)}/chat`
      : "/professional?intent=chat");
  }
  if (["choice", "interactive", "rpg"].includes(requestedScreen)) {
    redirect(projectId
      ? `/studio/project/${encodeURIComponent(projectId)}/chat?mode=play`
      : "/professional?intent=play");
  }
  if (requestedScreen === "backup") {
    redirect(projectId
      ? `/studio/project/${encodeURIComponent(projectId)}/backups`
      : "/professional?intent=library");
  }
  if (requestedScreen === "inspect") {
    redirect(projectId ? consistencyCheckHref(projectId) : "/professional?intent=chat");
  }
  if (requestedScreen === "world") {
    redirect(projectId
      ? managementHref(projectId, "world-and-characters")
      : "/professional?intent=library");
  }
  if (requestedScreen === "dashboard") {
    redirect(projectId
      ? managementHref(projectId, "progress-and-review")
      : "/professional?intent=library");
  }
  if (requestedScreen === "library") {
    redirect(projectId ? managementHref(projectId) : "/professional?intent=library");
  }

  redirect(projectId ? managementHref(projectId) : "/");
}
