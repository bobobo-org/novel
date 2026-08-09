import {
  makeRecord,
  optionalValue,
  type Character,
  type DomainRecord,
  type WorldRule,
} from "../domain";
import type { NovelRepository } from "../repository/contracts";

type MutableConversationStore = "characters" | "worldRules";

export type ResolvedConversationCanonicalTarget = {
  targetRecordId: string;
  sourceRevision: number;
  existing: boolean;
};

function candidateLabel(content: string, fallback: string) {
  return content
    .split(/\r?\n/gu)
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find(Boolean)
    ?.slice(0, 80) ?? fallback;
}

/**
 * Builds the exact record submitted to the approval transaction. Existing
 * Canon fields that the candidate did not explicitly model are retained; a
 * conversational edit must never erase identity, lifecycle, aliases, or an
 * immutable world-rule boundary as a side effect of `record_replace`.
 */
export function buildConversationCanonicalReplacement(input: {
  projectId: string;
  store: MutableConversationStore;
  targetRecordId: string;
  candidateContent: string;
  current: DomainRecord | null;
}): Character | WorldRule {
  if (
    input.current
    && (
      input.current.id !== input.targetRecordId
      || input.current.projectId !== input.projectId
    )
  ) {
    fail("CONVERSATION_CANON_TARGET_SCOPE_MISMATCH");
  }
  const base = input.current ?? makeRecord(input.projectId, "user");
  if (input.store === "characters") {
    const current = input.current as Character | null;
    return {
      ...base,
      id: input.targetRecordId,
      projectId: input.projectId,
      name: current?.name ?? candidateLabel(input.candidateContent, "新角色"),
      aliases: current?.aliases ?? [],
      identity: optionalValue(input.candidateContent, "ai_accepted"),
      personality: current?.personality ?? optionalValue<string>(null),
      goal: current?.goal ?? optionalValue<string>(null),
      lifeStatus: current?.lifeStatus ?? "unknown",
      locationId: current?.locationId ?? null,
    } as Character;
  }
  const current = input.current as WorldRule | null;
  return {
    ...base,
    id: input.targetRecordId,
    projectId: input.projectId,
    title: current?.title ?? candidateLabel(input.candidateContent, "新世界規則"),
    description: input.candidateContent,
    immutable: current?.immutable ?? false,
  } as WorldRule;
}

const MODIFICATION_PATTERN = /(?:修改|調整|更新|變更|改成|重新設定|edit|update|change)/iu;

function normalized(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-Hant");
}

function recordLabels(record: Character | WorldRule) {
  if ("name" in record) return [record.name, ...record.aliases];
  return [record.title];
}

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

export async function resolveConversationCanonicalTarget(input: {
  repository: NovelRepository;
  projectId: string;
  store: MutableConversationStore;
  objective: string;
  createId?: () => string;
}): Promise<ResolvedConversationCanonicalTarget> {
  if (!MODIFICATION_PATTERN.test(input.objective)) {
    return {
      targetRecordId: input.createId ? input.createId() : crypto.randomUUID(),
      sourceRevision: 0,
      existing: false,
    };
  }

  const objective = normalized(input.objective);
  const records = input.store === "characters"
    ? await input.repository.list<Character>("characters", input.projectId)
    : await input.repository.list<WorldRule>("worldRules", input.projectId);
  const matches = records.filter((record) => recordLabels(record).some((label) => {
    const candidate = normalized(label);
    return candidate.length > 0 && objective.includes(candidate);
  }));
  const selected = matches.length === 1 ? matches[0] : null;

  if (!selected) {
    fail(matches.length > 1
      ? "CONVERSATION_CANON_TARGET_AMBIGUOUS"
      : "CONVERSATION_CANON_TARGET_NOT_FOUND");
  }
  return {
    targetRecordId: selected.id,
    sourceRevision: selected.revision,
    existing: true,
  };
}
