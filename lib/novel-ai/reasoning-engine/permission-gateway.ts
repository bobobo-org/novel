import type { ReasoningAgentRole, ReasoningEngineInput, SovereignToolDefinition } from "./types";

const roleScopes: Record<ReasoningAgentRole, string[]> = {
  planner: ["story:read"],
  researcher: ["knowledge:retrieve"],
  story_architect: ["story:read", "story-bible:read"],
  writer: ["story:read", "candidate:write"],
  character_agent: ["story-bible:read"],
  world_agent: ["story-bible:read"],
  continuity_agent: ["story:read", "story-bible:read"],
  critic: ["candidate:read"],
  adversarial_reviewer: ["candidate:read", "story-bible:read"],
  judge: ["candidate:read", "evaluation:read"],
};

export function assertReasoningToolPermission(input: {
  request: ReasoningEngineInput;
  role: ReasoningAgentRole;
  tool: SovereignToolDefinition;
}) {
  if (!input.request.allowedToolIds.includes(input.tool.toolId)) {
    throw Object.assign(new Error("此任務未授權該工具。"), { code: "REASONING_TOOL_NOT_ALLOWED" });
  }
  const granted = new Set(input.request.permissionScopes);
  for (const scope of [...input.tool.scopes, ...roleScopes[input.role]]) {
    if (!granted.has(scope)) throw Object.assign(new Error(`缺少權限：${scope}`), { code: "REASONING_PERMISSION_DENIED", scope });
  }
}

export function scopesForReasoningRole(role: ReasoningAgentRole) {
  return [...roleScopes[role]];
}
