export const DRAMA_PROVIDER_CONTRACT_VERSION = "drama-provider-v1" as const;

export const DRAMA_PROVIDER_TASK_POLICY = {
  "browser-ai": ["chapter-classification", "scene-classification", "character-presence", "emotion-draft", "short-summary", "light-beat-suggestion"],
  "local-ollama": ["episode-planning", "scene-planning", "dialogue", "branch-candidate", "ending", "continuity-critique"],
  "private-ai-hub": [],
} as const;
