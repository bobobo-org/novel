import type {
  ClosedAgentRole,
  ClosedAgentTaskRequest,
  ClosedAgentTool,
} from "./types";

const FORBIDDEN_TOOL_ID = /(?:shell|powershell|cmd|filesystem|raw[-_.]?db|database|network|http|fetch|environment|secret)/iu;
const ROLE_SCOPES: Record<ClosedAgentRole, string[]> = {
  planner: ["story:read"],
  "story-architect": ["story:read", "story-bible:read"],
  actor: ["story:read", "candidate:write"],
  "character-agent": ["story-bible:read", "character:read"],
  "world-agent": ["story-bible:read", "world:read"],
  "continuity-agent": ["story:read", "story-bible:read"],
  critic: ["candidate:read"],
  evaluator: ["candidate:read", "evaluation:write"],
};

export class ClosedAgentToolRegistry {
  private readonly tools = new Map<string, ClosedAgentTool>();

  register(tool: ClosedAgentTool) {
    if (
      FORBIDDEN_TOOL_ID.test(tool.id)
      || !tool.localOnly
      || !tool.projectBound
      || !tool.requiredScopes.length
    ) {
      throw Object.assign(new Error("Tool violates the Closed Agent OS permission boundary."), {
        code: "CLOSED_AGENT_TOOL_FORBIDDEN",
        toolId: tool.id,
      });
    }
    this.tools.set(tool.id, tool);
    return this;
  }

  get(toolId: string) {
    return this.tools.get(toolId) ?? null;
  }

  list() {
    return [...this.tools.values()].map((tool) => ({
      id: tool.id,
      label: tool.label,
      capability: tool.capability,
      requiredScopes: [...tool.requiredScopes],
      localOnly: tool.localOnly,
      projectBound: tool.projectBound,
    }));
  }
}

export function assertClosedAgentPermission(input: {
  request: ClosedAgentTaskRequest;
  role: ClosedAgentRole;
  tool?: ClosedAgentTool;
}) {
  const granted = new Set(input.request.permissionScopes);
  for (const scope of ROLE_SCOPES[input.role]) {
    if (!granted.has(scope)) {
      throw Object.assign(new Error(`Closed Agent role is missing scope: ${scope}`), {
        code: "CLOSED_AGENT_PERMISSION_DENIED",
        role: input.role,
        scope,
      });
    }
  }
  if (!input.tool) return;
  if (!input.request.allowedToolIds.includes(input.tool.id)) {
    throw Object.assign(new Error("Tool was not allowed for this task."), {
      code: "CLOSED_AGENT_TOOL_NOT_ALLOWED",
      toolId: input.tool.id,
    });
  }
  for (const scope of input.tool.requiredScopes) {
    if (!granted.has(scope)) {
      throw Object.assign(new Error(`Tool is missing scope: ${scope}`), {
        code: "CLOSED_AGENT_TOOL_PERMISSION_DENIED",
        toolId: input.tool.id,
        scope,
      });
    }
  }
}
