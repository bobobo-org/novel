import { createHarness } from "./h1-test-utils.mjs";
import { checkOllamaHealth } from "../lib/novel-ai/providers/ollama/ollama-health.ts";

const h = createHarness("H1 Ollama Local Integration");
const health = await checkOllamaHealth();
if (health.status !== "configured") {
  const summary = h.summary({ notRun: true, reason: "No local Ollama model detected; bridge must not be marked ready from this run." });
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
h.assert("local ollama configured", health.modelCount > 0);
console.log(JSON.stringify(h.summary({ notRun: false }), null, 2));
