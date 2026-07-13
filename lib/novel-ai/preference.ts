export const AUTHOR_PREFERENCE_VERSION = "author-preference-v1";

export type AuthorPreferenceProfile = {
  projectId: string;
  version: number;
  preferredStrategyPatterns: string[];
  rejectedStrategyPatterns: string[];
  preferredPacing: string[];
  dislikedPacing: string[];
  preferredCharacterBehaviors: string[];
  forbiddenCharacterBehaviors: string[];
  preferredEndingHooks: string[];
  repeatedRejectionReasons: Array<{ reason: string; count: number }>;
  updatedAt: string;
};

type PreferenceStore = { profiles: Record<string, AuthorPreferenceProfile> };
const globalPreference = globalThis as typeof globalThis & { __novelPreferenceStore?: PreferenceStore };

function db(): PreferenceStore {
  if (!globalPreference.__novelPreferenceStore) globalPreference.__novelPreferenceStore = { profiles: {} };
  return globalPreference.__novelPreferenceStore;
}

export function emptyPreference(projectId: string): AuthorPreferenceProfile {
  return {
    projectId,
    version: 1,
    preferredStrategyPatterns: [],
    rejectedStrategyPatterns: [],
    preferredPacing: [],
    dislikedPacing: [],
    preferredCharacterBehaviors: [],
    forbiddenCharacterBehaviors: [],
    preferredEndingHooks: [],
    repeatedRejectionReasons: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getAuthorPreference(projectId: string): AuthorPreferenceProfile {
  return db().profiles[projectId] || emptyPreference(projectId);
}

function addUnique(list: string[], value?: string, limit = 20): string[] {
  const clean = (value || "").trim();
  if (!clean) return list;
  return [clean, ...list.filter((x) => x !== clean)].slice(0, limit);
}

function addReason(profile: AuthorPreferenceProfile, reason: string) {
  const clean = reason.trim();
  if (!clean) return;
  const existing = profile.repeatedRejectionReasons.find((x) => x.reason === clean);
  if (existing) existing.count += 1;
  else profile.repeatedRejectionReasons.unshift({ reason: clean, count: 1 });
  profile.repeatedRejectionReasons.sort((a, b) => b.count - a.count);
  profile.repeatedRejectionReasons = profile.repeatedRejectionReasons.slice(0, 30);
}

export function updateAuthorPreference(input: {
  projectId: string;
  decision: "accepted" | "edited" | "rejected";
  selectedOption?: "A" | "B" | "C";
  originalOutput?: unknown;
  editedOutput?: unknown;
  rejectionReasons?: string[];
  authorNote?: string;
}): AuthorPreferenceProfile {
  const profile = getAuthorPreference(input.projectId);
  const output = (input.decision === "edited" && input.editedOutput ? input.editedOutput : input.originalOutput) as {
    options?: Array<{ label?: string; action?: string; strategyType?: string; risk?: string; possibleCost?: string; expectedEffect?: string }>;
    chapterPlan?: Record<string, string>;
    endingHook?: string;
  };
  const selected = output?.options?.find((x) => x.label === input.selectedOption) || output?.options?.[0];

  if (input.decision === "accepted" || input.decision === "edited") {
    profile.preferredStrategyPatterns = addUnique(profile.preferredStrategyPatterns, selected?.strategyType);
    profile.preferredCharacterBehaviors = addUnique(profile.preferredCharacterBehaviors, selected?.action);
    profile.preferredEndingHooks = addUnique(profile.preferredEndingHooks, output?.chapterPlan?.endingHook || output?.endingHook || selected?.expectedEffect);
    if (selected?.risk === "高") profile.preferredPacing = addUnique(profile.preferredPacing, "高張力快速推進");
    if (selected?.risk === "低" || selected?.risk === "中") profile.preferredPacing = addUnique(profile.preferredPacing, "穩健鋪陳後推進");
  } else {
    for (const reason of input.rejectionReasons || []) addReason(profile, reason);
    profile.rejectedStrategyPatterns = addUnique(profile.rejectedStrategyPatterns, selected?.strategyType);
    profile.forbiddenCharacterBehaviors = addUnique(profile.forbiddenCharacterBehaviors, selected?.action);
    if ((input.rejectionReasons || []).some((x) => x.includes("保守") || x.includes("慢"))) profile.dislikedPacing = addUnique(profile.dislikedPacing, "過慢或過度保守");
    if ((input.rejectionReasons || []).some((x) => x.includes("激進") || x.includes("亂加"))) profile.dislikedPacing = addUnique(profile.dislikedPacing, "過度激進或突然跳轉");
  }

  if (input.authorNote) {
    if (input.decision === "rejected") addReason(profile, `作者備註：${input.authorNote.slice(0, 80)}`);
    else profile.preferredStrategyPatterns = addUnique(profile.preferredStrategyPatterns, `作者偏好：${input.authorNote.slice(0, 80)}`);
  }
  profile.updatedAt = new Date().toISOString();
  db().profiles[input.projectId] = profile;
  return profile;
}
