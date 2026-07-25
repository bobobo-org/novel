import type { GenerationTaskType } from "../generation-loop/types";

export function decomposeStoryProblem(input: {
  taskType: GenerationTaskType;
  instruction: string;
  constraints: string[];
}) {
  return {
    objective: input.instruction.trim(),
    subproblems: [
      "確認作者要求與不可變限制",
      "找出必須承接的角色動機與未解事件",
      "建立因果可追蹤的情節推進",
      "檢查世界規則、時間線與敘事視角",
      "形成只供作者核准的候選",
    ],
    constraints: input.constraints,
  };
}
