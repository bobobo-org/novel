import {
  PERSONA_PROFILE_SCHEMA_VERSION,
  PERSONA_PROFILES,
  validatePersonaProfile,
  type PersonaProfile,
  type PersonaProfileId,
} from "./persona-profile";

export const PERSONA_REGISTRY_VERSION = "p22a-persona-registry-v1" as const;

export function migratePersonaProfile(value: unknown, fallback: PersonaProfileId = "fiction_writer"): PersonaProfile {
  if (!value || typeof value !== "object") return PERSONA_PROFILES[fallback];
  const row = value as Partial<PersonaProfile>;
  const base = PERSONA_PROFILES[row.id && row.id in PERSONA_PROFILES ? row.id as PersonaProfileId : fallback];
  const migrated = { ...base, ...row, schemaVersion: PERSONA_PROFILE_SCHEMA_VERSION };
  return validatePersonaProfile(migrated).valid ? migrated : base;
}

export function personaRegistrySnapshot() {
  return {
    registryVersion: PERSONA_REGISTRY_VERSION,
    schemaVersion: PERSONA_PROFILE_SCHEMA_VERSION,
    profiles: Object.values(PERSONA_PROFILES),
  };
}
