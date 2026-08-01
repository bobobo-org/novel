import { sha256Hex, stableStringify } from "../closed-ai-cache";
import { learningPlannerStrategy } from "../controlled-learning-os";
import type {
  ClosedAgentPlan,
  ClosedAgentRole,
  ClosedAgentTaskRequest,
  ClosedAITaskComplexity,
  ClosedAIBackendId,
  ClosedAIQualityMode,
} from "./types";

const rolesByComplexity: Record<ClosedAITaskComplexity, ClosedAgentRole[]> = {
  light: ["planner", "actor", "evaluator"],
  standard: ["planner", "story-architect", "actor", "continuity-agent", "evaluator"],
  heavy: [
    "planner",
    "story-architect",
    "character-agent",
    "world-agent",
    "actor",
    "critic",
    "evaluator",
  ],
};

export async function createClosedAgentPlan(input: {
  request: ClosedAgentTaskRequest;
  backendId: ClosedAIBackendId;
  complexity: ClosedAITaskComplexity;
}): Promise<ClosedAgentPlan> {
  const plannerStrategy = learningPlannerStrategy(
    input.request.learningConfiguration,
  );
  const roles = learnedRoles(rolesByComplexity[input.complexity], plannerStrategy);
  const qualityMode = resolveQualityMode(
    input.request.qualityMode,
    input.backendId,
    input.complexity,
  );
  for (const role of taskSpecialists(input.request.taskType, qualityMode)) {
    if (!roles.includes(role)) {
      const evaluatorIndex = roles.indexOf("evaluator");
      roles.splice(evaluatorIndex < 0 ? roles.length : evaluatorIndex, 0, role);
    }
  }
  const steps = roles.map((role, index) => ({
    index,
    role,
    objective: roleObjective(role, input.request.objective),
    allowedToolIds: role === "evaluator" ? [] : [...input.request.allowedToolIds],
    inputVisibility: role === "evaluator"
      ? ["evaluator", "both"] as const
      : ["actor", "both"] as const,
  }));
  const body = {
    schemaVersion: "closed-agent-os-v1" as const,
    taskId: input.request.taskId,
    complexity: input.complexity,
    qualityMode,
    backendId: input.backendId,
    plannerStrategy,
    roles,
    steps,
    candidateOnly: true as const,
  };
  return {
    ...body,
    steps: steps.map((step) => ({
      ...step,
      inputVisibility: [...step.inputVisibility],
    })),
    planDigest: await sha256Hex(stableStringify(body)),
  };
}

function taskSpecialists(
  taskType: ClosedAgentTaskRequest["taskType"],
  qualityMode: ClosedAIQualityMode,
): ClosedAgentRole[] {
  const roles: ClosedAgentRole[] = [];
  if (taskType.startsWith("character.")) roles.push("character-agent");
  if (taskType.startsWith("world.")) roles.push("world-agent");
  if (
    taskType.includes("consistency")
    || taskType.includes("timeline")
    || taskType.includes("foreshadow")
    || taskType.includes("Review")
  ) roles.push("continuity-agent");
  if (
    taskType.startsWith("chapter.")
    || taskType.includes("plot")
    || taskType.includes("ending")
    || taskType.includes("pacing")
  ) roles.push("story-architect");
  if (qualityMode === "deep") roles.push("critic");
  return [...new Set(roles)];
}

export function resolveQualityMode(
  requested: ClosedAIQualityMode | undefined,
  backendId: ClosedAIBackendId,
  complexity: ClosedAITaskComplexity,
): ClosedAIQualityMode {
  if (backendId === "browser-ai") return "fast";
  if (requested) return requested;
  if (complexity === "heavy") return "deep";
  if (complexity === "standard") return "balanced";
  return "fast";
}

function learnedRoles(base: ClosedAgentRole[], strategy: string) {
  const roles = [...base];
  const required = strategy === "continuity-first"
    ? "continuity-agent"
    : strategy === "critical-review"
      ? "critic"
      : strategy === "character-depth"
        ? "character-agent"
        : null;
  if (required && !roles.includes(required)) {
    const evaluatorIndex = roles.indexOf("evaluator");
    roles.splice(evaluatorIndex < 0 ? roles.length : evaluatorIndex, 0, required);
  }
  return roles;
}

function roleObjective(role: ClosedAgentRole, objective: string) {
  const prefix: Record<ClosedAgentRole, string> = {
    planner: "拆解任務、列出可驗證完成條件並安排最小必要工具",
    "story-architect": "檢查敘事結構與故事聖經",
    actor: "依核准脈絡產生候選內容，不把推測寫成 Canon",
    "character-agent": "維持角色知識與動機邊界",
    "world-agent": "維持世界規則一致",
    "continuity-agent": "檢查時間線與前後連續性",
    critic: "以反方視角找出遺漏、重複、矛盾、廉價轉折與不可逆風險",
    evaluator: "依核准事實、完成條件、安全邊界與結構品質評估候選",
  };
  return `${prefix[role]}：${objective}`;
}
