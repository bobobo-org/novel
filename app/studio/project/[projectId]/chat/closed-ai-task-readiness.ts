import type { ClosedAiBootstrapResult } from "@/lib/novel-ai/web/closed-ai-bootstrap-coordinator";

export const CHAPTER_CONTINUE_SETUP_REQUIRED_MESSAGE =
  "完整小說正文需要能執行 chapter.continue 的已驗證閉端模型。請先在自動協調器設定連接並實測 Local Ollama；在路由器選出可執行後端以前，目前不會執行 AI，也不會把其他已就緒但不適用此任務的後端冒充為可用。";

export function isClosedAiTaskRoutable(
  setup: Pick<ClosedAiBootstrapResult, "runtime"> | null | undefined,
) {
  return Boolean(
    setup?.runtime.route.executionStatus === "routable"
    && setup.runtime.plannedBackend,
  );
}
