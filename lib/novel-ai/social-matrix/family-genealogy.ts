export const FAMILY_GENEALOGY_VERSION = "family-genealogy-v1" as const;
export const FAMILY_GENEALOGY_CHILDREN_PER_COUPLE = 3 as const;
export const FAMILY_GENEALOGY_PAGE_MAX = 50 as const;
export const FAMILY_GENEALOGY_SEARCH_SCAN_MAX = 240 as const;

export type FamilyGenealogyLineageRole = "bloodline" | "spouse";

export type FamilyGenealogyPosition = {
  schemaVersion: typeof FAMILY_GENEALOGY_VERSION;
  personId: string;
  memberOffset: number;
  coupleIndex: number;
  lineageRole: FamilyGenealogyLineageRole;
  generation: number;
  generationId: string;
  generationLabel: string;
  branchId: string;
  branchLabel: string;
  parentageId: string | null;
  marriageId: string | null;
  siblingSetId: string | null;
  parentMemberOffsets: number[];
  spouseMemberOffset: number | null;
  siblingMemberOffsets: number[];
  childMemberOffsets: number[];
};

export type FamilyGenealogyPage = {
  generation: number;
  generationId: string;
  branchId: string | null;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  positions: FamilyGenealogyPosition[];
};

export type FamilyGenealogyBranch = {
  branchCoupleIndex: 1 | 2 | 3;
  branchId: string;
  label: "長房" | "二房" | "三房";
  founderMemberOffset: number;
};

const BRANCH_LABELS = ["本家", "長房", "二房", "三房"] as const;

function requireMemberCount(memberCount: number) {
  if (!Number.isSafeInteger(memberCount) || memberCount < 1 || memberCount > 10_000) {
    throw new RangeError(`FAMILY_GENEALOGY_MEMBER_COUNT_INVALID:${memberCount}`);
  }
}

function requireMemberOffset(memberOffset: number, memberCount: number) {
  requireMemberCount(memberCount);
  if (!Number.isSafeInteger(memberOffset) || memberOffset < 0 || memberOffset >= memberCount) {
    throw new RangeError(`FAMILY_GENEALOGY_MEMBER_OFFSET_INVALID:${memberOffset}`);
  }
}

function encodeIndex(value: number) {
  return value.toString(36).padStart(3, "0");
}

function parentCoupleIndex(coupleIndex: number) {
  return coupleIndex === 0
    ? null
    : Math.floor((coupleIndex - 1) / FAMILY_GENEALOGY_CHILDREN_PER_COUPLE);
}

function generationForCouple(coupleIndex: number) {
  let generation = 0;
  let cursor = coupleIndex;
  while (cursor > 0) {
    cursor = parentCoupleIndex(cursor)!;
    generation += 1;
  }
  return generation;
}

function rootBranchCoupleIndex(coupleIndex: number) {
  let cursor = coupleIndex;
  while (cursor > FAMILY_GENEALOGY_CHILDREN_PER_COUPLE) {
    cursor = parentCoupleIndex(cursor)!;
  }
  return cursor;
}

function generationCoupleRange(generation: number) {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new RangeError(`FAMILY_GENEALOGY_GENERATION_INVALID:${generation}`);
  }
  let low = 0;
  let high = 0;
  for (let current = 0; current < generation; current += 1) {
    low = low * FAMILY_GENEALOGY_CHILDREN_PER_COUPLE + 1;
    high = high * FAMILY_GENEALOGY_CHILDREN_PER_COUPLE
      + FAMILY_GENEALOGY_CHILDREN_PER_COUPLE;
  }
  return { low, high };
}

function branchGenerationCoupleRange(
  branchCoupleIndex: 1 | 2 | 3,
  generation: number,
) {
  if (generation < 1) return null;
  let low = branchCoupleIndex;
  let high = branchCoupleIndex;
  for (let current = 1; current < generation; current += 1) {
    low = low * FAMILY_GENEALOGY_CHILDREN_PER_COUPLE + 1;
    high = high * FAMILY_GENEALOGY_CHILDREN_PER_COUPLE
      + FAMILY_GENEALOGY_CHILDREN_PER_COUPLE;
  }
  return { low, high };
}

export function familyGenealogyBranches(input: {
  organizationId: string;
  memberCount: number;
}): FamilyGenealogyBranch[] {
  requireMemberCount(input.memberCount);
  return ([1, 2, 3] as const)
    .filter((branchCoupleIndex) => branchCoupleIndex * 2 < input.memberCount)
    .map((branchCoupleIndex) => ({
      branchCoupleIndex,
      branchId: `${input.organizationId}:genealogy:branch:${branchCoupleIndex}`,
      label: BRANCH_LABELS[branchCoupleIndex],
      founderMemberOffset: branchCoupleIndex * 2,
    }));
}

export function familyGenealogyPositionAt(input: {
  organizationId: string;
  memberCount: number;
  memberOffset: number;
}): FamilyGenealogyPosition {
  requireMemberOffset(input.memberOffset, input.memberCount);
  const coupleIndex = Math.floor(input.memberOffset / 2);
  const lineageRole: FamilyGenealogyLineageRole = input.memberOffset % 2 === 0
    ? "bloodline"
    : "spouse";
  const generation = generationForCouple(coupleIndex);
  const branchCoupleIndex = rootBranchCoupleIndex(coupleIndex);
  const parentCouple = parentCoupleIndex(coupleIndex);
  const parentMemberOffsets = lineageRole === "bloodline" && parentCouple !== null
    ? [parentCouple * 2, parentCouple * 2 + 1].filter((offset) => offset < input.memberCount)
    : [];
  const spouseMemberOffset = input.memberOffset % 2 === 0
    ? input.memberOffset + 1 < input.memberCount ? input.memberOffset + 1 : null
    : input.memberOffset - 1;
  const siblingMemberOffsets = lineageRole === "bloodline" && parentCouple !== null
    ? Array.from({ length: FAMILY_GENEALOGY_CHILDREN_PER_COUPLE }, (_, childIndex) => (
        (parentCouple * FAMILY_GENEALOGY_CHILDREN_PER_COUPLE + childIndex + 1) * 2
      )).filter((offset) => offset < input.memberCount && offset !== input.memberOffset)
    : [];
  const childMemberOffsets = Array.from(
    { length: FAMILY_GENEALOGY_CHILDREN_PER_COUPLE },
    (_, childIndex) => (
      (coupleIndex * FAMILY_GENEALOGY_CHILDREN_PER_COUPLE + childIndex + 1) * 2
    ),
  ).filter((offset) => offset < input.memberCount);
  const branchId = `${input.organizationId}:genealogy:branch:${branchCoupleIndex}`;
  return {
    schemaVersion: FAMILY_GENEALOGY_VERSION,
    personId: `${input.organizationId}:genealogy:person:${encodeIndex(input.memberOffset)}`,
    memberOffset: input.memberOffset,
    coupleIndex,
    lineageRole,
    generation,
    generationId: `${input.organizationId}:genealogy:generation:${generation}`,
    generationLabel: generation === 0 ? "始祖" : `第 ${generation + 1} 代`,
    branchId,
    branchLabel: BRANCH_LABELS[branchCoupleIndex] ?? `第 ${branchCoupleIndex} 房`,
    parentageId: lineageRole === "bloodline" && parentCouple !== null
      ? `${input.organizationId}:genealogy:parentage:${encodeIndex(coupleIndex)}`
      : null,
    marriageId: spouseMemberOffset === null
      ? null
      : `${input.organizationId}:genealogy:marriage:${encodeIndex(coupleIndex)}`,
    siblingSetId: lineageRole === "bloodline" && parentCouple !== null
      ? `${input.organizationId}:genealogy:siblings:${encodeIndex(parentCouple)}`
      : null,
    parentMemberOffsets,
    spouseMemberOffset,
    siblingMemberOffsets,
    childMemberOffsets,
  };
}

export function familyGenealogyGenerationPage(input: {
  organizationId: string;
  memberCount: number;
  generation: number;
  branchCoupleIndex?: 1 | 2 | 3 | null;
  page?: number;
  pageSize?: number;
}): FamilyGenealogyPage {
  requireMemberCount(input.memberCount);
  const page = Math.max(0, Math.floor(input.page ?? 0));
  const pageSize = Math.min(
    FAMILY_GENEALOGY_PAGE_MAX,
    Math.max(1, Math.floor(input.pageSize ?? 12)),
  );
  const range = input.branchCoupleIndex
    ? branchGenerationCoupleRange(input.branchCoupleIndex, input.generation)
    : generationCoupleRange(input.generation);
  if (!range) {
    return {
      generation: input.generation,
      generationId: `${input.organizationId}:genealogy:generation:${input.generation}`,
      branchId: input.branchCoupleIndex
        ? `${input.organizationId}:genealogy:branch:${input.branchCoupleIndex}`
        : null,
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      positions: [],
    };
  }
  const firstOffset = range.low * 2;
  const exclusiveEnd = Math.min(input.memberCount, (range.high + 1) * 2);
  const total = Math.max(0, exclusiveEnd - firstOffset);
  const pageStart = firstOffset + page * pageSize;
  const pageEnd = Math.min(exclusiveEnd, pageStart + pageSize);
  const positions = pageStart >= exclusiveEnd
    ? []
    : Array.from({ length: pageEnd - pageStart }, (_, index) => (
        familyGenealogyPositionAt({
          organizationId: input.organizationId,
          memberCount: input.memberCount,
          memberOffset: pageStart + index,
        })
      ));
  return {
    generation: input.generation,
    generationId: `${input.organizationId}:genealogy:generation:${input.generation}`,
    branchId: input.branchCoupleIndex
      ? `${input.organizationId}:genealogy:branch:${input.branchCoupleIndex}`
      : null,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    positions,
  };
}

/**
 * Searches one bounded slice only. The caller can pass nextCursor to continue;
 * no invocation resolves more than 240 people from a ten-thousand-person clan.
 */
export function familyGenealogySearchPage<T>(input: {
  organizationId: string;
  memberCount: number;
  query: string;
  resolve: (memberOffset: number) => { text: string; value: T };
  cursor?: number;
  resultLimit?: number;
  scanLimit?: number;
}) {
  requireMemberCount(input.memberCount);
  const query = input.query.normalize("NFKC").trim().toLocaleLowerCase("zh-TW");
  const start = Math.min(input.memberCount, Math.max(0, Math.floor(input.cursor ?? 0)));
  const resultLimit = Math.min(30, Math.max(1, Math.floor(input.resultLimit ?? 12)));
  const scanLimit = Math.min(
    FAMILY_GENEALOGY_SEARCH_SCAN_MAX,
    Math.max(resultLimit, Math.floor(input.scanLimit ?? 120)),
  );
  const end = Math.min(input.memberCount, start + scanLimit);
  const items: Array<{ position: FamilyGenealogyPosition; value: T }> = [];
  let cursor = start;
  while (cursor < end && items.length < resultLimit) {
    const resolved = input.resolve(cursor);
    if (!query || resolved.text.normalize("NFKC").toLocaleLowerCase("zh-TW").includes(query)) {
      items.push({
        position: familyGenealogyPositionAt({
          organizationId: input.organizationId,
          memberCount: input.memberCount,
          memberOffset: cursor,
        }),
        value: resolved.value,
      });
    }
    cursor += 1;
  }
  return {
    items,
    scanned: cursor - start,
    nextCursor: cursor < input.memberCount ? cursor : null,
    materializationBound: FAMILY_GENEALOGY_SEARCH_SCAN_MAX,
  };
}
