import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  chatController,
  rpgService,
  compatibilityRedirect,
  chatPage,
  playMode,
  studio,
  conversationView,
] = await Promise.all([
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", "utf8"),
  readFile("lib/novel-ai/web/rpg-chat-turn.ts", "utf8"),
  readFile("app/studio/project/[projectId]/rpg/page.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/page.tsx", "utf8"),
  readFile("lib/novel-ai/domain/play-mode.ts", "utf8"),
  readFile("app/studio/page.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/components/conversation-workspace-view.tsx", "utf8"),
]);

// The production RPG entry is Conversation. Every round asks the verified
// closed AI for A/B/C first, waits at most 180 seconds, and lets the reader
// explicitly switch to the deterministic continuity fallback without
// cancelling the whole conversation operation.
assert.match(chatController, /import\("@\/lib\/novel-ai\/web\/rpg-chat-turn"\)/u);
assert.match(chatController, /plan = await runtime\.planRpgChatChoices\(\{/u);
assert.match(chatController, /fallbackReason: "USER_REQUESTED_RULE_FALLBACK"/u);
assert.match(chatController, /requestRpgChoiceFallback/u);
assert.match(conversationView, /不等了，改用後備選項/u);
assert.doesNotMatch(chatController, /RPG_CHOICE_RULE_PLAN_IMMEDIATE/u);
assert.match(chatController, /serializeRpgChoices\(envelope\)/u);
assert.match(chatController, /rpgRuntime\.generateRpgChatTurnCandidate\(/u);
assert.match(chatController, /故事與數值均未寫入/u);

const snapshotAt = chatController.indexOf("const snapshot = await loadSnapshot");
const aiPlanAt = chatController.indexOf("plan = await runtime.planRpgChatChoices", snapshotAt);
const completedMessageAt = chatController.indexOf("serializeRpgChoices(envelope)", aiPlanAt);
assert(snapshotAt >= 0, "the active chat controller must load the canonical RPG snapshot");
assert(aiPlanAt > snapshotAt, "the active chat controller must ask closed AI for choices after loading the snapshot");
assert(completedMessageAt > aiPlanAt, "the exact A/B/C envelope must be committed after AI or explicit fallback planning");

assert.match(rpgService, /export const RPG_CHAT_CHOICE_AI_TIMEOUT_MS = 180_000/u);
assert.match(rpgService, /enhancementController\.abort\("RPG_CHOICE_AI_ENHANCEMENT_TIMEOUT"\)/u);
assert.match(rpgService, /signal: enhancementController\.signal/u);
assert.match(rpgService, /clearTimeout\(enhancementTimeout\)/u);
assert.match(rpgService, /choices\.length !== 3/u);
assert.match(rpgService, /keys\.join\(""\) !== "ABC"/u);

assert.match(compatibilityRedirect, /redirect\(`\/studio\/project\/\$\{encodeURIComponent\(projectId\)\}\/chat\?mode=play`\)/u);
assert.match(chatPage, /first\(query\.mode\) === "play"/u);
assert.match(chatPage, /開始目前玩法的第一回合。/u);
assert.doesNotMatch(chatPage, /目前狀態/u);
assert.match(playMode, /const storyWorkspace = `\/studio\/project\/\$\{encodeURIComponent\(projectId\)\}\/chat`/u);
assert.doesNotMatch(playMode, /\/rpg/u);
assert.doesNotMatch(studio, /StudioClient/u);
assert.match(studio, /requestedScreen === "write"/u);
assert.match(studio, /chat\?mode=play/u);
assert.match(studio, /\["choice", "interactive", "rpg"\]/u);

console.log(JSON.stringify({
  schemaVersion: "rpg-turn-resilience-v2",
  status: "PASS",
  canonicalStoryEntry: "/chat",
  compatibilityRedirect: "/rpg -> /chat?mode=play",
  choicePlanner: "closed-ai-first-with-explicit-rule-fallback",
  exactChoiceKeys: ["A", "B", "C"],
  modelAttemptedBeforeChoices: true,
  enhancementTimeoutMs: 180_000,
  mutationBeforeApproval: 0,
}, null, 2));
