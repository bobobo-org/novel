export const STORY_WORKSPACE_HANDOFF_SCHEMA_VERSION =
  "story-workspace-handoff-v1" as const;
export const STORY_WORKSPACE_HANDOFF_TTL_MS = 10 * 60 * 1_000;
export const STORY_WORKSPACE_HANDOFF_PROMPT_LIMIT = 8_000;

const STORAGE_PREFIX = "novel:story-workspace-handoff:v1:";
const HANDOFF_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/u;

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoryWorkspaceHandoff = {
  schemaVersion: typeof STORY_WORKSPACE_HANDOFF_SCHEMA_VERSION;
  handoffId: string;
  projectId: string;
  prompt: string;
  source: string;
  createdAt: string;
};

function checkedProjectId(value: string) {
  const projectId = value.trim();
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("STORY_WORKSPACE_HANDOFF_PROJECT_INVALID");
  }
  return projectId;
}

function checkedHandoffId(value: string) {
  const handoffId = value.trim();
  if (!HANDOFF_ID_PATTERN.test(handoffId)) {
    throw new Error("STORY_WORKSPACE_HANDOFF_ID_INVALID");
  }
  return handoffId;
}

function storageKey(handoffId: string) {
  return `${STORAGE_PREFIX}${checkedHandoffId(handoffId)}`;
}

function checkedPrompt(value: string) {
  const prompt = value.replace(/\r\n?/gu, "\n").trim();
  if (!prompt || prompt.length > STORY_WORKSPACE_HANDOFF_PROMPT_LIMIT) {
    throw new Error("STORY_WORKSPACE_HANDOFF_PROMPT_INVALID");
  }
  return prompt;
}

function checkedSource(value: string) {
  const source = value.trim();
  if (!/^[A-Za-z0-9:_-]{1,80}$/u.test(source)) {
    throw new Error("STORY_WORKSPACE_HANDOFF_SOURCE_INVALID");
  }
  return source;
}

export function stageStoryWorkspaceHandoff(input: {
  projectId: string;
  prompt: string;
  source: string;
  handoffId?: string;
  createdAt?: string;
}, store: SessionStore = window.sessionStorage) {
  const projectId = checkedProjectId(input.projectId);
  const handoffId = checkedHandoffId(input.handoffId ?? crypto.randomUUID());
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error("STORY_WORKSPACE_HANDOFF_TIME_INVALID");
  }
  const handoff: StoryWorkspaceHandoff = {
    schemaVersion: STORY_WORKSPACE_HANDOFF_SCHEMA_VERSION,
    handoffId,
    projectId,
    prompt: checkedPrompt(input.prompt),
    source: checkedSource(input.source),
    createdAt,
  };
  store.setItem(storageKey(handoffId), JSON.stringify(handoff));
  const query = new URLSearchParams({ handoff: handoffId });
  return {
    handoff,
    href: `/studio/project/${encodeURIComponent(projectId)}/chat?${query.toString()}`,
  };
}

export function consumeStoryWorkspaceHandoff(input: {
  projectId: string;
  handoffId: string;
  now?: number;
}, store: SessionStore = window.sessionStorage): StoryWorkspaceHandoff | null {
  let key: string;
  try {
    key = storageKey(input.handoffId);
  } catch {
    return null;
  }
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    store.removeItem(key);
    const value = JSON.parse(raw) as Partial<StoryWorkspaceHandoff>;
    const projectId = checkedProjectId(input.projectId);
    const createdAt = typeof value.createdAt === "string"
      ? Date.parse(value.createdAt)
      : Number.NaN;
    const age = (input.now ?? Date.now()) - createdAt;
    if (
      value.schemaVersion !== STORY_WORKSPACE_HANDOFF_SCHEMA_VERSION
      || value.handoffId !== input.handoffId
      || value.projectId !== projectId
      || typeof value.prompt !== "string"
      || typeof value.source !== "string"
      || !Number.isFinite(createdAt)
      || age < -30_000
      || age > STORY_WORKSPACE_HANDOFF_TTL_MS
    ) return null;
    return {
      schemaVersion: STORY_WORKSPACE_HANDOFF_SCHEMA_VERSION,
      handoffId: checkedHandoffId(value.handoffId),
      projectId,
      prompt: checkedPrompt(value.prompt),
      source: checkedSource(value.source),
      createdAt: new Date(createdAt).toISOString(),
    };
  } catch {
    try {
      store.removeItem(key);
    } catch {
      // A blocked session store is already a fail-closed handoff.
    }
    return null;
  }
}
