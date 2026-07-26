import { CharacterAgentError } from "./errors";
import { sha256, stableStringify } from "./record-factory";
import type { CharacterCanonContext, CharacterCanonType } from "./types";

export async function createCharacterCanonContext(input: {
  projectId: string;
  canonType: CharacterCanonType;
  novelRevision: number;
  storyBibleVersion: number;
  dramaAdaptationRevision?: number | null;
  privateSimulationSessionId?: string | null;
  sourceCanonContextId?: string | null;
  branchId?: string | null;
  timelinePosition: string;
  sourceCharacterRevisions: Record<string, number>;
}): Promise<CharacterCanonContext> {
  if (input.novelRevision < 1 || input.storyBibleVersion < 0) {
    throw new CharacterAgentError("CANON_CONTEXT_REVISION_INVALID", "Canon Context 版本無效。");
  }
  if (input.canonType === "NOVEL_CANON" && (input.dramaAdaptationRevision != null || input.privateSimulationSessionId)) {
    throw new CharacterAgentError("CANON_CONTEXT_LAYER_MIXED", "小說 Canon Context 不得混入短劇或私人模擬版本。");
  }
  if (input.canonType === "DRAMA_ADAPTATION_CANON" && (input.dramaAdaptationRevision == null || input.privateSimulationSessionId)) {
    throw new CharacterAgentError("DRAMA_CANON_CONTEXT_INCOMPLETE", "短劇 Context 必須綁定唯一改編版本。");
  }
  if (input.canonType === "PRIVATE_SIMULATION" && !input.privateSimulationSessionId) {
    throw new CharacterAgentError("PRIVATE_CANON_CONTEXT_SESSION_REQUIRED", "私人模擬 Context 必須綁定 Session。");
  }
  if (input.canonType === "PRIVATE_SIMULATION" && !input.sourceCanonContextId) {
    throw new CharacterAgentError("PRIVATE_CANON_CONTEXT_SOURCE_REQUIRED", "私人模擬必須綁定唯一來源 Canon Context。");
  }
  const identity = {
    projectId: input.projectId,
    canonType: input.canonType,
    novelRevision: input.novelRevision,
    storyBibleVersion: input.storyBibleVersion,
    dramaAdaptationRevision: input.dramaAdaptationRevision ?? null,
    privateSimulationSessionId: input.privateSimulationSessionId ?? null,
    sourceCanonContextId: input.sourceCanonContextId ?? null,
    branchId: input.branchId ?? null,
    timelinePosition: input.timelinePosition,
    sourceCharacterRevisions: input.sourceCharacterRevisions,
  };
  return {
    canonContextId: await sha256(stableStringify(identity)),
    ...identity,
    createdAt: new Date().toISOString(),
  };
}

export function assertCanonContextCurrent(input: {
  expected: CharacterCanonContext;
  currentNovelRevision: number;
  currentStoryBibleVersion: number;
  currentDramaAdaptationRevision?: number | null;
  currentCharacterRevisions: Record<string, number>;
}) {
  const expected = input.expected;
  if (expected.novelRevision !== input.currentNovelRevision) {
    throw new CharacterAgentError("CANON_CONTEXT_NOVEL_STALE", "小說版本已更新，請重新產生角色候選。");
  }
  if (expected.storyBibleVersion !== input.currentStoryBibleVersion) {
    throw new CharacterAgentError("CANON_CONTEXT_STORY_BIBLE_STALE", "Story Bible 已更新，請重新產生角色候選。");
  }
  if (expected.canonType === "DRAMA_ADAPTATION_CANON" && expected.dramaAdaptationRevision !== input.currentDramaAdaptationRevision) {
    throw new CharacterAgentError("CANON_CONTEXT_DRAMA_STALE", "短劇改編版本已更新，請重新產生角色候選。");
  }
  for (const [characterId, revision] of Object.entries(expected.sourceCharacterRevisions)) {
    if (input.currentCharacterRevisions[characterId] !== revision) {
      throw new CharacterAgentError("CANON_CONTEXT_CHARACTER_STALE", "角色版本已更新，請重新產生候選。");
    }
  }
  return true;
}

export function assertSameCanonContext(expectedId: string, actualId: string) {
  if (!expectedId || expectedId !== actualId) {
    throw new CharacterAgentError("CROSS_CANON_RETRIEVAL_BLOCKED", "資料不屬於目前唯一 Canon Context。");
  }
}

export function canonContextFingerprint(context: CharacterCanonContext) {
  return stableStringify({
    projectId: context.projectId,
    canonType: context.canonType,
    novelRevision: context.novelRevision,
    storyBibleVersion: context.storyBibleVersion,
    dramaAdaptationRevision: context.dramaAdaptationRevision,
    privateSimulationSessionId: context.privateSimulationSessionId,
    sourceCanonContextId: context.sourceCanonContextId,
    branchId: context.branchId,
    timelinePosition: context.timelinePosition,
    sourceCharacterRevisions: context.sourceCharacterRevisions,
  });
}
