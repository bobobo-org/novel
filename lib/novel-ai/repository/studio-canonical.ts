import { buildProjectBundle, createDraft } from "../domain/creation";
import { makeRecord, optionalValue, type AcceptedChoice, type Chapter, type ChoiceCandidate, type NovelProject, type StoryBranch, type StoryChoiceEffect, type StoryState } from "../domain";
import type { AcceptChoiceTransactionResult, NovelRepository } from "./contracts";

export type StudioProjectSeed = {
  id: string;
  title: string;
  chapterTitle: string;
  draft: string;
  packId?: string | null;
  topicId?: string | null;
  subCategory?: string | null;
  coreIdea?: string | null;
  protagonist?: string | null;
  goal?: string | null;
  world?: string | null;
  worldRule?: string | null;
  conflict?: string | null;
  style?: string | null;
  enabledStats?: string[];
};

export type StudioCanonicalSnapshot = {
  project: NovelProject;
  chapter: Chapter;
  storyState: StoryState;
  acceptedChoices: AcceptedChoice[];
  branches: StoryBranch[];
};

const value = (input?: string | null) => optionalValue(input?.trim() || null, input?.trim() ? "user_defined" : "deferred");

export async function ensureStudioCanonicalProject(repository: NovelRepository, input: StudioProjectSeed): Promise<StudioCanonicalSnapshot> {
  let project = await repository.get<NovelProject>("projects", input.id);
  if (!project) {
    const draft = createDraft("legacy");
    draft.id = `studio-migration-${input.id}`;
    draft.projectId = input.id;
    draft.title = input.title;
    draft.genrePackId = input.packId ?? null;
    draft.genreId = input.topicId ?? null;
    draft.subgenreId = input.subCategory ?? null;
    draft.coreIdea = value(input.coreIdea);
    draft.protagonist = value(input.protagonist);
    draft.style = value(input.style);
    draft.answers.goal = value(input.goal);
    draft.answers.worldRule = value(input.worldRule || input.world);
    draft.answers.obstacle = value(input.conflict);
    const bundle = buildProjectBundle(draft);
    await repository.createProject(bundle, `studio-project:${input.id}`);
    project = bundle.project;
  }
  let chapter = project.activeChapterId ? await repository.get<Chapter>("chapters", project.activeChapterId) : null;
  if (!chapter) {
    chapter = { ...makeRecord(input.id, "migration"), title: input.chapterTitle || "第一章", order: 1, content: input.draft || "", summary: null, status: "draft" };
    chapter = await repository.put("chapters", chapter);
    project = await repository.put("projects", { ...project, activeChapterId: chapter.id }, project.revision);
  }
  const storyState = (await repository.list<StoryState>("storyStates", input.id))[0];
  if (!storyState) throw new Error("STORY_STATE_MISSING");
  if (input.enabledStats?.length && Object.keys(storyState.protagonistStats).length === 0) {
    const protagonistStats = Object.fromEntries(input.enabledStats.map((stat) => [stat, stat === "stamina" ? 100 : stat === "level" ? 1 : 0]));
    const updated = await repository.put("storyStates", { ...storyState, protagonistStats }, storyState.revision);
    return { project, chapter, storyState: updated, acceptedChoices: await repository.listAcceptedChoices(input.id), branches: await repository.listStoryBranches(input.id) };
  }
  return { project, chapter, storyState, acceptedChoices: await repository.listAcceptedChoices(input.id), branches: await repository.listStoryBranches(input.id) };
}

export async function saveStudioChapter(repository: NovelRepository, input: StudioProjectSeed) {
  const current = await ensureStudioCanonicalProject(repository, input);
  const chapter = await repository.put("chapters", { ...current.chapter, title: input.chapterTitle, content: input.draft }, current.chapter.revision);
  return { ...current, chapter };
}

export async function persistStudioChoiceCandidate(repository: NovelRepository, input: StudioProjectSeed, candidate: {
  optionKey: "A" | "B" | "C" | "custom";
  text: string;
  consequence: string;
  effect: StoryChoiceEffect;
  providerId: string;
  modelId: string | null;
}) {
  const current = await ensureStudioCanonicalProject(repository, input);
  const base = makeRecord(input.id, "ai_candidate");
  const record: ChoiceCandidate = {
    ...base,
    prompt: "主角接下來要怎麼做？",
    optionKey: candidate.optionKey,
    text: candidate.text,
    consequence: candidate.consequence,
    effect: candidate.effect,
    status: "pending",
    chapterId: current.chapter.id,
    sceneId: null,
    inputRevision: current.project.revision,
    chapterRevision: current.chapter.revision,
    storyStateRevision: current.storyState.revision,
    provenance: { ...base.provenance, actor: candidate.providerId === "ollama" ? "local-ollama" : "local-rule", requestId: base.id, providerId: candidate.providerId, modelId: candidate.modelId, taskType: "interactive_choice", externalRequest: false, dataLeftDevice: false, contextSources: ["project", "chapter", "story_state"], elapsedMs: null },
  };
  const saved = await repository.put("candidates", record);
  return { candidate: saved, current };
}

export async function acceptStudioChoice(repository: NovelRepository, candidateId: string, acceptedText: string, choiceLabel?: string | null): Promise<AcceptChoiceTransactionResult> {
  const candidate = await repository.get<ChoiceCandidate>("candidates", candidateId);
  if (!candidate) throw new Error("CANDIDATE_NOT_FOUND");
  const project = await repository.get<NovelProject>("projects", candidate.projectId), chapter = await repository.get<Chapter>("chapters", candidate.chapterId), storyState = (await repository.list<StoryState>("storyStates", candidate.projectId))[0];
  if (!project || !chapter || !storyState) throw new Error("ACCEPT_CHOICE_RECORD_MISSING");
  const operationId = `accept:${candidate.id}`;
  return repository.acceptChoiceTransaction({
    operationId,
    idempotencyKey: `${candidate.projectId}:${candidate.id}:${candidate.inputRevision}`,
    projectId: candidate.projectId,
    chapterId: candidate.chapterId,
    candidateId: candidate.id,
    acceptedText,
    choiceLabel,
    expectedProjectRevision: candidate.inputRevision,
    expectedChapterRevision: candidate.chapterRevision,
    expectedCandidateRevision: candidate.revision,
    expectedStoryStateRevision: candidate.storyStateRevision,
  });
}

export function auditLegacyStudioInteractions(input: unknown) {
  const state = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const branches = Array.isArray(state.branches) ? state.branches : [];
  const candidate = state.candidate && typeof state.candidate === "object" ? state.candidate : null;
  return {
    found: branches.length + (candidate ? 1 : 0),
    valid: 0,
    invalid: 0,
    ambiguous: branches.length + (candidate ? 1 : 0),
    migratable: 0,
    disposition: branches.length || candidate ? "manual_review" : "not_applicable",
    reason: branches.length || candidate ? "Legacy interaction rows do not contain stable candidate, chapter, revision, and effect operation identifiers." : null,
  };
}
