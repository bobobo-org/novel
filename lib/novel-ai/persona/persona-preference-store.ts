import { resolvePersonaProfile, type PersonaProfile, type PersonaProfileId } from "./persona-profile";

export const PERSONA_PREFERENCE_SCHEMA_VERSION = "p23a-persona-preference-v1" as const;

export type PersonaPreferenceSource =
  | "user_defined"
  | "ai_proposed"
  | "learned_preference";

export type PersonaPreferenceVersion = {
  schemaVersion: typeof PERSONA_PREFERENCE_SCHEMA_VERSION;
  versionId: string;
  projectId: string;
  profile: PersonaProfile;
  source: PersonaPreferenceSource;
  enabled: boolean;
  reason: string;
  createdAt: string;
  supersedesVersionId: string | null;
};

export class PersonaPreferenceStore {
  private readonly versions = new Map<string, PersonaPreferenceVersion[]>();

  list(projectId: string) {
    return [...(this.versions.get(projectId) ?? [])];
  }

  current(projectId: string) {
    return this.list(projectId).at(-1) ?? null;
  }

  save(input: {
    projectId: string;
    profile: PersonaProfile | PersonaProfileId;
    source: PersonaPreferenceSource;
    reason: string;
    enabled?: boolean;
  }) {
    if (!input.reason.trim()) {
      throw Object.assign(new Error("人格偏好變更必須說明原因。"), {
        code: "PERSONA_PREFERENCE_REASON_REQUIRED",
      });
    }
    const previous = this.current(input.projectId);
    const version: PersonaPreferenceVersion = {
      schemaVersion: PERSONA_PREFERENCE_SCHEMA_VERSION,
      versionId: `persona_pref_${crypto.randomUUID()}`,
      projectId: input.projectId,
      profile: structuredClone(resolvePersonaProfile(input.profile)),
      source: input.source,
      enabled: input.enabled ?? true,
      reason: input.reason.trim(),
      createdAt: new Date().toISOString(),
      supersedesVersionId: previous?.versionId ?? null,
    };
    this.versions.set(input.projectId, [...this.list(input.projectId), version]);
    return structuredClone(version);
  }

  disable(projectId: string, reason: string) {
    const current = this.current(projectId);
    if (!current) {
      throw Object.assign(new Error("找不到可停用的人格偏好。"), {
        code: "PERSONA_PREFERENCE_NOT_FOUND",
      });
    }
    return this.save({
      projectId,
      profile: current.profile,
      source: "user_defined",
      reason,
      enabled: false,
    });
  }

  revert(projectId: string, versionId: string, reason: string) {
    const target = this.list(projectId).find((version) => version.versionId === versionId);
    if (!target) {
      throw Object.assign(new Error("找不到要回復的人格偏好版本。"), {
        code: "PERSONA_PREFERENCE_VERSION_NOT_FOUND",
      });
    }
    return this.save({
      projectId,
      profile: target.profile,
      source: "user_defined",
      reason,
      enabled: target.enabled,
    });
  }

  delete(projectId: string) {
    const deleted = this.list(projectId).length;
    this.versions.delete(projectId);
    return { projectId, deleted };
  }
}
