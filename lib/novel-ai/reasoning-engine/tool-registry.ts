import type { SovereignToolDefinition } from "./types";

const forbidden = /(?:shell|powershell|cmd|filesystem|environment|database\.raw|network\.unrestricted)/i;

export class SovereignToolRegistry {
  private tools = new Map<string, SovereignToolDefinition>();

  register(tool: SovereignToolDefinition) {
    if (!tool.localOnly || !tool.projectBound || forbidden.test(tool.toolId)) {
      throw Object.assign(new Error("工具違反主權 Permission Gateway。"), { code: "REASONING_TOOL_FORBIDDEN" });
    }
    if (!tool.scopes.length) throw Object.assign(new Error("工具缺少權限 scope。"), { code: "REASONING_TOOL_SCOPE_REQUIRED" });
    this.tools.set(tool.toolId, tool);
    return this;
  }

  get(toolId: string) { return this.tools.get(toolId) ?? null; }
  list() { return [...this.tools.values()].map(({ execute: _execute, ...tool }) => tool); }
}
