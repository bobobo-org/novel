export type OptionalFieldStatus = "unset" | "not_applicable" | "user_defined" | "rule_suggested" | "ai_suggested" | "ai_accepted" | "inferred" | "deferred";
export type OptionalField<T = string> = { value: T | null; status: OptionalFieldStatus; source: "user" | "local-rule" | "ollama" | "migration" | null; updatedAt: string | null };
export type StoryTopic = { topicId:string; name:string; description:string; consumerGroupId:string; packId:string; packIds:string[]; subCategories:string[]; tags:string[]; supportedPlayModes:string[]; recommendedProtagonists:string[]; recommendedWorlds:string[]; recommendedConflicts:string[]; recommendedStyles:string[]; adultOnly:boolean; enabled:boolean; classic:boolean; sourceVersion:string; legacyAliases:string[] };
export type StoryLibrary = { schemaVersion:string; generatedFrom:string; staleCountExplanation:string; consumerGroups:Array<{groupId:string;name:string;description:string;enabled:boolean;order:number}>; packs:Array<{packId:string;name:string;description:string;enabled:boolean;order:number}>; playModes:Array<{playModeId:string;name:string;description:string;defaultStats:string[];enabled:boolean;adultOnly:boolean;order:number}>; storyStats:Array<{statId:string;name:string;enabledByDefault:boolean;order:number}>; topics:StoryTopic[] };

export function blankOptional<T = string>(status: OptionalFieldStatus = "unset"): OptionalField<T> {
  return { value: null, status, source: null, updatedAt: null };
}

export function setOptional<T>(value: T, status: OptionalFieldStatus, source: OptionalField<T>["source"]): OptionalField<T> {
  return { value, status, source, updatedAt: new Date().toISOString() };
}
