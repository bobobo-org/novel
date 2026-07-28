import type { GenerationTaskType } from "../generation-loop/types";
import { resolvePersonaProfile, type PersonaProfile, type PersonaProfileId } from "./persona-profile";

export function routePersona(input: {
  requested?: PersonaProfile | PersonaProfileId;
  taskType: GenerationTaskType;
  adultMode?: boolean;
}) {
  if (input.adultMode) return resolvePersonaProfile(input.requested ?? "adult_fiction");
  if (input.requested) return resolvePersonaProfile(input.requested);
  if (input.taskType === "outline_generation") return resolvePersonaProfile("deep_reasoning");
  return resolvePersonaProfile("fiction_writer");
}

export function personaInstruction(profile: PersonaProfile) {
  return [
    `人格模式：${profile.label}。`,
    `直接程度 ${profile.directness}；創意 ${profile.creativity}；嚴謹 ${profile.languagePrecision}；批判 ${profile.criticality}；回答深度 ${profile.responseDepth}。`,
    "以繁體中文清楚作答。虛構創作可處理黑暗、爭議與道德灰色題材，但不得捏造作品既有事實。",
    "事實、推論與不確定事項必須分開；不得因題材敏感而改用空泛官腔。",
  ].join("\n");
}
