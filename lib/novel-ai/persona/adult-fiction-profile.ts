export const SOVEREIGN_ADULT_FICTION_MODE = "sovereign-adult-fiction-v1" as const;

export type AdultFictionContext = {
  enabled: boolean;
  userAgeConfirmed: boolean;
  projectAdultMode: boolean;
  characters: Array<{ characterId: string; age: number | null; ageExplicit: boolean }>;
  consentState: "active" | "withdrawn" | "unspecified" | "invalid";
  isolatedIndex: boolean;
  excludeFromSharedLearning: boolean;
};

export function validateAdultFictionContext(context: AdultFictionContext) {
  const issues: string[] = [];
  if (!context.enabled || !context.projectAdultMode) issues.push("ADULT_MODE_NOT_ENABLED");
  if (!context.userAgeConfirmed) issues.push("ADULT_USER_AGE_NOT_CONFIRMED");
  if (!context.characters.length) issues.push("ADULT_CHARACTER_AGE_MISSING");
  for (const character of context.characters) {
    if (!character.ageExplicit || character.age == null) issues.push(`ADULT_CHARACTER_AGE_NOT_EXPLICIT:${character.characterId}`);
    else if (character.age < 18) issues.push(`ADULT_CHARACTER_NOT_ADULT:${character.characterId}`);
  }
  if (context.consentState !== "active") issues.push("ADULT_CONSENT_NOT_ACTIVE");
  if (!context.isolatedIndex) issues.push("ADULT_INDEX_NOT_ISOLATED");
  if (!context.excludeFromSharedLearning) issues.push("ADULT_SHARED_LEARNING_NOT_EXCLUDED");
  return {
    mode: SOVEREIGN_ADULT_FICTION_MODE,
    valid: issues.length === 0,
    issues,
    errorCode: issues.length ? "ADULT_FICTION_CONTEXT_REJECTED" : null,
  };
}
