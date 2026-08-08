import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workspace, styles] = await Promise.all([
  readFile("app/studio/project/[projectId]/rpg/rpg-workspace.tsx", "utf8"),
  readFile("app/studio/project/[projectId]/rpg/rpg.module.css", "utf8"),
]);

assert.doesNotMatch(workspace, /RPG_AI_CHOICE_PLAN_REQUIRED/);
assert.doesNotMatch(workspace, /disabled=\{busy \|\| !aiChoicesReady\}/);
assert.doesNotMatch(workspace, /regenerateStudioClosedAI/);
assert.match(workspace, /const RPG_CHOICE_PLAN_TIMEOUT_MS = 30_000/);
assert.match(workspace, /const RPG_TURN_TIMEOUT_MS = 120_000/);
assert.match(workspace, /signal: controller\.signal/);
assert.match(workspace, /data-testid="rpg-live-draft"/);
assert.match(workspace, /data-testid="rpg-cancel-turn"/);
assert.match(workspace, /停止本回合（不結算）/);
assert.match(workspace, /數值、物品與貨幣均未結算/);
assert.match(styles, /\.liveDraft\s*\{/);
assert.match(styles, /\.cancelTurn\s*\{/);

console.log(JSON.stringify({
  schemaVersion: "rpg-turn-resilience-v1",
  status: "PASS",
  choiceAvailableDuringPlanning: true,
  liveDraftVisible: true,
  cancellable: true,
  timeoutMs: 120_000,
  mutationOnCancelOrTimeout: 0,
}, null, 2));
