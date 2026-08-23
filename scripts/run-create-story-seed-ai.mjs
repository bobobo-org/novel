import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDraft } from "../lib/novel-ai/domain/creation.ts";
import { optionalValue } from "../lib/novel-ai/domain/index.ts";
import {
  creationStorySeedPrompt,
  mergeCreationStorySeed,
  parseCreationStorySeed,
} from "../lib/novel-ai/web/creation-story-seed.ts";

const validModelOutput = `\`\`\`json
{
  "story": "失蹤者留下的鐘，逼一名修復師在月蝕前查出城市遺忘的名字。",
  "protagonist": {
    "name": "顧遙",
    "goal": "在月蝕前找回被抹除的妹妹",
    "weakness": "習慣獨自承擔而拒絕求助"
  },
  "world": {
    "setting": "一座每到午夜就交換居民記憶的山城",
    "rule": "取回一段記憶，必須交出另一段同等重要的記憶"
  },
  "conflict": {
    "main": "顧遙愈接近妹妹，愈可能忘記自己為何要救她",
    "opposition": "靠販賣記憶維持秩序的守鐘人"
  },
  "opening": "顧遙收到一只仍在走動、內側刻著妹妹名字的舊鐘。"
}
\`\`\``;

const parsed = parseCreationStorySeed(validModelOutput);
assert.ok(parsed, "JSON in a model fence should parse");
assert.equal(parsed.protagonist, "顧遙");
assert.match(parsed.worldRule, /取回一段記憶/u);
assert.equal(parseCreationStorySeed('{"story":"不完整"}'), null, "all five semantic groups are required");

const draft = createDraft("quick");
draft.title = "作者保留值";
draft.coreIdea = optionalValue("作者自己寫的一句話故事", "user_defined");
draft.protagonist = optionalValue("作者命名的主角", "user_defined");
draft.answers = {
  language: optionalValue("zh-TW", "user_defined"),
  playMode: optionalValue("general", "user_defined"),
  conflict: optionalValue("作者自己寫的衝突", "user_defined"),
};

const merged = mergeCreationStorySeed(draft, parsed, "closed-ai");
assert.equal(merged.coreIdea.value, "作者自己寫的一句話故事", "AI must preserve authored core idea");
assert.equal(merged.protagonist.value, "作者命名的主角", "AI must preserve authored protagonist");
assert.equal(merged.answers.conflict?.value, "作者自己寫的衝突", "AI must preserve authored conflict");
assert.equal(merged.answers.opening?.value, parsed.opening, "AI fills empty fields");
assert.equal(merged.seedCandidate?.opening.status, "ai_suggested");
assert.equal(merged.seedCandidate?.opening.source, "ai_candidate");

const fallbackDraft = createDraft("quick");
const fallback = mergeCreationStorySeed(fallbackDraft, parsed, "device-fallback");
assert.equal(fallback.seedCandidate?.opening.status, "inferred");
assert.equal(fallback.seedCandidate?.opening.source, "system");

const prompt = creationStorySeedPrompt({
  title: "測試作品",
  language: "zh-TW",
  playModeLabel: "一般章節寫作",
  topic: "懸疑",
  existing: merged.seedCandidate,
});
assert.match(prompt, /五個頂層欄位/u);
assert.match(prompt, /不得覆寫/u);

const client = await readFile(new URL("../app/studio/create/create-project-client.tsx", import.meta.url), "utf8");
assert.match(client, /CREATION_AI_DEADLINE_MS = 24_000/u, "creation AI has a hard deadline");
assert.match(client, /runStudioClosedAI\(\{/u, "the single button calls the Closed AI coordinator");
assert.match(client, /browserComputePolicy: "balanced"/u, "backend routing remains automatic");
assert.match(client, /data-testid="cancel-create-ai-story-seed"/u, "generation is cancellable");
assert.match(client, /mergeCreationStorySeed\(current, suggestion, "closed-ai"\)/u);
assert.match(client, /mergeCreationStorySeed\([\s\S]*"device-fallback"/u, "device template is only an explicit fallback");
assert.doesNotMatch(client, /立即產生裝置亂數雛形/u, "the old non-AI primary action is removed");
assert.doesNotMatch(client, /await finish\(\)/u, "AI assistance must not auto-create the project");

console.log(JSON.stringify({
  suite: "create-story-seed-ai",
  passed: 18,
  coordinator: "unified-automatic",
  hardDeadlineMs: 24_000,
  authoredValuesPreserved: true,
  automaticProjectCreation: false,
}, null, 2));
