export const STUDIO_TASK_HANDOFF_KEY = "novel:studio-task-handoff:v1";

export type StudioTaskHandoff = {
  schemaVersion: "studio-task-handoff-v1";
  projectId: string;
  sourceLabel: string;
  destinationLabel: string;
  destinationHref: string;
  chapterId: string | null;
  chapterTitle: string | null;
  savedAt: string;
};

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeProjectId(value: string) {
  const projectId = value.trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(projectId)) {
    throw new Error("STUDIO_TASK_HANDOFF_PROJECT_INVALID");
  }
  return projectId;
}

export function studioHomeHref(projectId: string) {
  return `/studio?screen=home&projectId=${encodeURIComponent(safeProjectId(projectId))}`;
}

export function validateStudioTaskDestination(projectId: string, href: string) {
  const cleanProjectId = safeProjectId(projectId);
  const value = href.trim();
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new Error("STUDIO_TASK_HANDOFF_DESTINATION_INVALID");
  }
  const parsed = new URL(value, "https://studio.invalid");
  const expectedProjectPrefix = `/studio/project/${encodeURIComponent(cleanProjectId)}/`;
  const sameStudioProject = parsed.pathname.startsWith(expectedProjectPrefix);
  const studioShell = parsed.pathname === "/studio"
    && parsed.searchParams.get("projectId") === cleanProjectId;
  const projectReader = parsed.pathname === `/studio/read/${encodeURIComponent(cleanProjectId)}`;
  const professional = parsed.pathname === "/professional"
    && parsed.searchParams.get("projectId") === cleanProjectId;
  if (!sameStudioProject && !studioShell && !projectReader && !professional) {
    throw new Error("STUDIO_TASK_HANDOFF_DESTINATION_OUT_OF_PROJECT");
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function makeStudioTaskHandoff(input: {
  projectId: string;
  sourceLabel: string;
  destinationLabel: string;
  destinationHref: string;
  chapterId?: string | null;
  chapterTitle?: string | null;
  savedAt?: string;
}): StudioTaskHandoff {
  const projectId = safeProjectId(input.projectId);
  return {
    schemaVersion: "studio-task-handoff-v1",
    projectId,
    sourceLabel: input.sourceLabel.trim() || "目前工作",
    destinationLabel: input.destinationLabel.trim() || "下一個功能",
    destinationHref: validateStudioTaskDestination(projectId, input.destinationHref),
    chapterId: input.chapterId?.trim() || null,
    chapterTitle: input.chapterTitle?.trim() || null,
    savedAt: input.savedAt ?? new Date().toISOString(),
  };
}

export function stageStudioTaskHandoff(
  input: Parameters<typeof makeStudioTaskHandoff>[0],
  store: SessionStore = window.sessionStorage,
) {
  const handoff = makeStudioTaskHandoff(input);
  store.setItem(STUDIO_TASK_HANDOFF_KEY, JSON.stringify(handoff));
  return handoff;
}

export function readStudioTaskHandoff(
  store: SessionStore = window.sessionStorage,
): StudioTaskHandoff | null {
  try {
    const raw = store.getItem(STUDIO_TASK_HANDOFF_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StudioTaskHandoff>;
    if (
      value.schemaVersion !== "studio-task-handoff-v1"
      || typeof value.projectId !== "string"
      || typeof value.sourceLabel !== "string"
      || typeof value.destinationLabel !== "string"
      || typeof value.destinationHref !== "string"
      || typeof value.savedAt !== "string"
    ) {
      store.removeItem(STUDIO_TASK_HANDOFF_KEY);
      return null;
    }
    return makeStudioTaskHandoff({
      projectId: value.projectId,
      sourceLabel: value.sourceLabel,
      destinationLabel: value.destinationLabel,
      destinationHref: value.destinationHref,
      chapterId: typeof value.chapterId === "string" ? value.chapterId : null,
      chapterTitle: typeof value.chapterTitle === "string" ? value.chapterTitle : null,
      savedAt: value.savedAt,
    });
  } catch {
    store.removeItem(STUDIO_TASK_HANDOFF_KEY);
    return null;
  }
}

export function clearStudioTaskHandoff(
  store: SessionStore = window.sessionStorage,
) {
  store.removeItem(STUDIO_TASK_HANDOFF_KEY);
}
