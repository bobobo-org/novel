import type { BrowserFabricContextItem, BrowserFabricTask } from "./types";

export const BROWSER_PROMPT_SECTIONS = [
  "SYSTEM_CONTRACT",
  "TASK_OBJECTIVE",
  "CANON_AUTHORITY",
  "CHARACTER_SCOPE",
  "WORLD_SCOPE",
  "RECENT_SCENE",
  "RETRIEVED_CONTEXT",
  "APPROVED_LEARNING_RULES",
  "USER_REQUEST",
  "OUTPUT_SCHEMA",
] as const;

function join(items: BrowserFabricContextItem[]) {
  return items.map((item) => item.text.trim()).filter(Boolean).join("\n\n");
}

export function assembleBrowserFabricPrompt(input: {
  task: BrowserFabricTask;
  context: BrowserFabricContextItem[];
}) {
  const context = input.context;
  const sections: Record<(typeof BROWSER_PROMPT_SECTIONS)[number], string> = {
    SYSTEM_CONTRACT: "只使用核准且符合可見性範圍的資料。輸出是候選稿，不得自行修改 Canon；不要輸出內部推理。",
    TASK_OBJECTIVE: input.task.objective,
    CANON_AUTHORITY: join(context.filter((item) => item.kind === "canon")),
    CHARACTER_SCOPE: join(context.filter((item) => item.metadata?.scope === "character")),
    WORLD_SCOPE: join(context.filter((item) => item.metadata?.scope === "world")),
    RECENT_SCENE: join(context.filter((item) => item.kind === "chapter").slice(-2)),
    RETRIEVED_CONTEXT: join(context.filter((item) => item.kind === "retrieval" || item.kind === "story-bible")),
    APPROVED_LEARNING_RULES: join(context.filter((item) => item.kind === "learning-rule" && item.approved)),
    USER_REQUEST: input.task.objective,
    OUTPUT_SCHEMA: input.task.requiresStructuredOutput
      ? JSON.stringify(input.task.outputSchema ?? { type: "object" })
      : "繁體中文純文字候選稿",
  };
  return {
    sections,
    prompt: BROWSER_PROMPT_SECTIONS.map((name) => `<${name}>\n${sections[name] || "（無）"}\n</${name}>`).join("\n\n"),
  };
}
