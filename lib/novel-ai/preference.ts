export const AUTHOR_PREFERENCE_VERSION = "author-preference-v2";

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
    version: 2,
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

function normalize(profile: AuthorPreferenceProfile): AuthorPreferenceProfile {
  return { ...emptyPreference(profile.projectId), ...profile, version: 2 };
}

export function getAuthorPreference(projectId: string): AuthorPreferenceProfile {
  const existing = db().profiles[projectId];
  return existing ? normalize(existing) : emptyPreference(projectId);
}

export function preferenceStats() {
  const profiles = Object.values(db().profiles).map(normalize);
  return {
    projectsWithPreference: profiles.length,
    preferredStrategyPatterns: profiles.reduce((sum, x) => sum + x.preferredStrategyPatterns.length, 0),
    rejectedStrategyPatterns: profiles.reduce((sum, x) => sum + x.rejectedStrategyPatterns.length, 0),
    preferredCharacterBehaviors: profiles.reduce((sum, x) => sum + x.preferredCharacterBehaviors.length, 0),
    forbiddenCharacterBehaviors: profiles.reduce((sum, x) => sum + x.forbiddenCharacterBehaviors.length, 0),
    repeatedRejectionReasons: profiles.reduce((sum, x) => sum + x.repeatedRejectionReasons.length, 0),
  };
}

function addUnique(list: string[], value?: string, limit = 30): string[] {
  const clean = (value || "").replace(/\s+/g, " ").trim();
  if (!clean) return list;
  return [clean, ...list.filter((x) => x !== clean)].slice(0, limit);
}

function addReason(profile: AuthorPreferenceProfile, reason: string) {
  const clean = reason.replace(/\s+/g, " ").trim();
  if (!clean) return;
  const existing = profile.repeatedRejectionReasons.find((x) => x.reason === clean);
  if (existing) existing.count += 1;
  else profile.repeatedRejectionReasons.unshift({ reason: clean, count: 1 });
  profile.repeatedRejectionReasons.sort((a, b) => b.count - a.count);
  profile.repeatedRejectionReasons = profile.repeatedRejectionReasons.slice(0, 40);
}

function optionText(value: unknown): Array<{ label?: string; action?: string; strategyType?: string; risk?: string; possibleCost?: string; expectedEffect?: string }> {
  const output = value as { options?: Array<{ label?: string; action?: string; strategyType?: string; risk?: string; possibleCost?: string; expectedEffect?: string }> };
  return Array.isArray(output?.options) ? output.options : [];
}

function selectedOption(output: unknown, selected?: "A" | "B" | "C") {
  const options = optionText(output);
  return options.find((x) => x.label === selected) || options[0];
}

function outputHook(value: unknown, fallback?: string): string | undefined {
  const output = value as { chapterPlan?: Record<string, string>; endingHook?: string; expectedEffect?: string };
  return output?.chapterPlan?.endingHook || output?.endingHook || output?.expectedEffect || fallback;
}

function pacingFromRisk(risk?: string): string {
  if (risk === "高") return "高張力、快速推進、明確代價";
  if (risk === "低") return "穩定鋪陳、低風險調查、慢熱推進";
  return "中等節奏、推進與資訊並重";
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
  const finalOutput = input.decision === "edited" && input.editedOutput ? input.editedOutput : input.originalOutput;
  const chosen = selectedOption(finalOutput, input.selectedOption);
  const originalChosen = selectedOption(input.originalOutput, input.selectedOption);

  if (input.decision === "accepted" || input.decision === "edited") {
    profile.preferredStrategyPatterns = addUnique(profile.preferredStrategyPatterns, chosen?.strategyType);
    profile.preferredCharacterBehaviors = addUnique(profile.preferredCharacterBehaviors, chosen?.action);
    profile.preferredPacing = addUnique(profile.preferredPacing, pacingFromRisk(chosen?.risk));
    profile.preferredEndingHooks = addUnique(profile.preferredEndingHooks, outputHook(finalOutput, chosen?.expectedEffect));
    if (input.decision === "edited" && originalChosen?.action && chosen?.action && originalChosen.action !== chosen.action) {
      profile.rejectedStrategyPatterns = addUnique(profile.rejectedStrategyPatterns, originalChosen.strategyType);
      profile.forbiddenCharacterBehaviors = addUnique(profile.forbiddenCharacterBehaviors, originalChosen.action);
      addReason(profile, "作者修改了 AI 原稿，代表原始行動不完全符合偏好");
    }
  } else {
    for (const reason of input.rejectionReasons || []) addReason(profile, reason);
    profile.rejectedStrategyPatterns = addUnique(profile.rejectedStrategyPatterns, chosen?.strategyType);
    profile.forbiddenCharacterBehaviors = addUnique(profile.forbiddenCharacterBehaviors, chosen?.action);
    profile.dislikedPacing = addUnique(profile.dislikedPacing, pacingFromRisk(chosen?.risk));
    if (chosen?.possibleCost) profile.forbiddenCharacterBehaviors = addUnique(profile.forbiddenCharacterBehaviors, `避免這類代價：${chosen.possibleCost}`);
  }

  if (input.authorNote) {
    const note = input.authorNote.slice(0, 120);
    if (input.decision === "rejected") addReason(profile, `作者備註：${note}`);
    else profile.preferredStrategyPatterns = addUnique(profile.preferredStrategyPatterns, `作者偏好：${note}`);
  }

  profile.updatedAt = new Date().toISOString();
  db().profiles[input.projectId] = profile;
  return profile;
}
