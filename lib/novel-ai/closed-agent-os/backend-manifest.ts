import type { PlatformTaskType } from "../router/platform-types";
import type {
  ClosedAIBackendId,
  ClosedAITaskComplexity,
} from "./types";

export const BROWSER_AI_LIGHT_TASKS: PlatformTaskType[] = [
  "story.summary",
  "drama.chapterClassify",
  "drama.sceneClassify",
  "drama.characterPresence",
  "drama.emotionCurve",
  "drama.shortSummary",
  "drama.beatSuggestion",
  "character.nameExtract",
  "character.traitClassify",
  "character.voiceClassify",
  "character.emotionClassify",
  "character.relationshipEventClassify",
  "character.dialogueConsistency",
];

export const HEAVY_TASKS = new Set<PlatformTaskType>([
  "character.multiAgentSimulation",
  "character.privateArc",
  "drama.episodePlan",
  "drama.ending",
  "story.storyBibleCandidate",
]);

export const LIGHT_TASKS = new Set<PlatformTaskType>(BROWSER_AI_LIGHT_TASKS);

export function taskComplexity(taskType: PlatformTaskType): ClosedAITaskComplexity {
  if (HEAVY_TASKS.has(taskType)) return "heavy";
  if (LIGHT_TASKS.has(taskType)) return "light";
  return "standard";
}

export const BACKEND_TRUTH = {
  "browser-ai": {
    label: "瀏覽器 AI",
    maximumComplexity: "light",
    dataBoundary: "device",
    description: "免安裝、裝置內的輕量摘要、分類與格式工作。",
  },
  "local-ollama": {
    label: "個人本機 Ollama",
    maximumComplexity: "standard",
    dataBoundary: "device",
    description: "透過本機 Bridge 執行對話、續寫、檢索與一般角色工作。",
  },
  "private-ai-hub": {
    label: "私有 AI Hub",
    maximumComplexity: "heavy",
    dataBoundary: "private-infrastructure",
    description: "經身分、權限、配額與工作佇列執行長上下文及多代理任務。",
  },
} as const satisfies Record<ClosedAIBackendId, {
  label: string;
  maximumComplexity: ClosedAITaskComplexity;
  dataBoundary: "device" | "private-infrastructure";
  description: string;
}>;
