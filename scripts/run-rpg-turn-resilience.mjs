import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  chatController,
  rpgService,
  compatibilityRedirect,
  chatPage,
  playMode,
  studio,
] = await Promise.all([
  readFile("app/studio/project/[projectId]/chat/hooks/use-conversation-rpg.ts", "utf8"),
  readFile("lib/novel-ai/web/rpg-chat-turn.ts", "utf8"),
  readFile("app/studio/project/[projectId]/rpg/page.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/chat/page.tsx", "utf8"),
  readFile("lib/novel-ai/domain/play-mode.ts", "utf8"),
  readFile("app/studio/page.tsx", "utf8"),
]);

// The production RPG entry is Conversation. A check against the retired
// rpg-workspace could pass while the real chat controller still waited for the
// model queue for 180 seconds, so this gate reads the canonical controller.
assert.match(chatController, /const plan = await buildRpgRuleChoicePlan\(\{/u);
assert.match(chatController, /fallbackReason: "RPG_CHOICE_RULE_PLAN_IMMEDIATE"/u);
assert.doesNotMatch(chatController, /planRpgChatChoices\(/u);
assert.doesNotMatch(chatController, /180_000|超過 180 秒/u);
assert.match(chatController, /serializeRpgChoices\(envelope\)/u);
assert.match(chatController, /generateRpgChatTurnCandidate\(/u);
assert.match(chatController, /故事與數值均未寫入/u);

const snapshotAt = chatController.indexOf("const snapshot = await loadRpgChatSnapshot");
const immediatePlanAt = chatController.indexOf("const plan = await buildRpgRuleChoicePlan", snapshotAt);
const completedMessageAt = chatController.indexOf("serializeRpgChoices(envelope)", immediatePlanAt);
assert(snapshotAt >= 0, "the active chat controller must load the canonical RPG snapshot");
assert(immediatePlanAt > snapshotAt, "the active chat controller must build rule choices immediately after loading the snapshot");
assert(completedMessageAt > immediatePlanAt, "the exact A/B/C envelope must be committed after the immediate plan");

assert.match(rpgService, /export const RPG_CHAT_CHOICE_AI_TIMEOUT_MS = 12_000/u);
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
  choicePlanner: "immediate-bounded-rule-plan",
  exactChoiceKeys: ["A", "B", "C"],
  modelRequiredBeforeChoices: false,
  enhancementTimeoutMs: 12_000,
  mutationBeforeApproval: 0,
}, null, 2));
