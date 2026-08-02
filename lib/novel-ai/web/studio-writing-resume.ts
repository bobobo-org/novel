const WRITING_RESUME_PREFIX = "novel:writing-resume:v1:";

export type StudioWritingResumeMarker = {
  schemaVersion: "studio-writing-resume-v1";
  projectId: string;
  chapterId: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  savedAt: string;
};

type ResumeStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeId(value: string) {
  const id = value.trim();
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("WRITING_RESUME_ID_INVALID");
  return id;
}

function key(projectId: string) {
  return `${WRITING_RESUME_PREFIX}${safeId(projectId)}`;
}

function position(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

export function writeStudioWritingResume(
  input: Omit<StudioWritingResumeMarker, "schemaVersion" | "savedAt"> & { savedAt?: string },
  store: ResumeStore = window.localStorage,
) {
  const marker: StudioWritingResumeMarker = {
    schemaVersion: "studio-writing-resume-v1",
    projectId: safeId(input.projectId),
    chapterId: safeId(input.chapterId),
    selectionStart: position(input.selectionStart),
    selectionEnd: Math.max(position(input.selectionStart), position(input.selectionEnd)),
    scrollTop: position(input.scrollTop),
    savedAt: input.savedAt ?? new Date().toISOString(),
  };
  store.setItem(key(marker.projectId), JSON.stringify(marker));
  return marker;
}

export function readStudioWritingResume(
  projectId: string,
  store: ResumeStore = window.localStorage,
): StudioWritingResumeMarker | null {
  try {
    const raw = store.getItem(key(projectId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StudioWritingResumeMarker>;
    if (
      value.schemaVersion !== "studio-writing-resume-v1"
      || value.projectId !== safeId(projectId)
      || typeof value.chapterId !== "string"
      || typeof value.savedAt !== "string"
    ) {
      store.removeItem(key(projectId));
      return null;
    }
    return writeStudioWritingResume({
      projectId: value.projectId,
      chapterId: value.chapterId,
      selectionStart: position(value.selectionStart),
      selectionEnd: position(value.selectionEnd),
      scrollTop: position(value.scrollTop),
      savedAt: value.savedAt,
    }, store);
  } catch {
    store.removeItem(key(projectId));
    return null;
  }
}

export function clearStudioWritingResume(
  projectId: string,
  store: ResumeStore = window.localStorage,
) {
  store.removeItem(key(projectId));
}
