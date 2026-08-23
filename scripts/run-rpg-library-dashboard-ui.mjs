import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PROCEDURAL_CHARACTER_CAPACITY,
  PROCEDURAL_TREASURE_CAPACITY,
  proceduralCharacterAt,
  proceduralTreasureAt,
} from "../lib/novel-ai/game/procedural-story-library.ts";

const workspacePath = new URL("../app/studio/project/[projectId]/rpg/rpg-workspace.tsx", import.meta.url);
const stylesPath = new URL("../app/studio/project/[projectId]/rpg/rpg.module.css", import.meta.url);
const workspace = readFileSync(workspacePath, "utf8");
const styles = readFileSync(stylesPath, "utf8");

assert.equal(PROCEDURAL_CHARACTER_CAPACITY, 100_000, "人物庫容量必須維持 100,000");
assert.equal(PROCEDURAL_TREASURE_CAPACITY, 100_000, "寶物庫容量必須維持 100,000");

const context = {
  genre: "仙俠",
  playMode: "rpg",
  protagonist: "沈星河",
  location: "雨夜山門",
  conflict: "失蹤的盟友留下了一封密信",
};
const characters = Array.from({ length: 3 }, (_, ordinal) => proceduralCharacterAt({
  seed: "rpg-dashboard-focused-test",
  ordinal,
  context,
}));
const treasures = Array.from({ length: 3 }, (_, ordinal) => proceduralTreasureAt({
  seed: "rpg-dashboard-focused-test",
  ordinal,
  context,
}));
assert.equal(new Set(characters.map((candidate) => candidate.id)).size, 3, "人物候選需為三筆不同原創人物");
assert.ok(characters.every((candidate) => candidate.rpgArchetype), "人物候選需附帶可建立數值儀表板的 RPG 能力原型");
assert.equal(new Set(treasures.map((candidate) => candidate.id)).size, 3, "寶物候選需為三件不同原創寶物");

assert.match(workspace, /data-testid="rpg-dashboard-toggle"/u, "需保留隨時開啟儀表板的按鈕");
assert.match(workspace, /查看完整儀表板/u);
assert.match(workspace, /收合完整儀表板/u);
assert.match(workspace, /data-testid="rpg-detailed-dashboard"/u, "詳細儀表板不可被刪除");
assert.match(workspace, /data-testid="rpg-dashboard-details"/u, "背包、任務、關係與紀錄區不可被刪除");

for (const label of ["資金", "人力", "品質", "聲望", "風險"]) {
  assert.match(workspace, new RegExp(`${label} <b>`, "u"), `經營儀表板缺少「${label}」`);
}
assert.match(workspace, /RELATIONSHIP PULSE/u, "戀愛養成關係面板需保留");
assert.match(workspace, /WALLET & EXCHANGE/u, "RPG 貨幣與道具面板需保留");

assert.match(workspace, /data-testid="procedural-character-library"/u);
assert.match(workspace, /data-testid="procedural-treasure-library"/u);
assert.match(workspace, /換一組故事匹配人物/u);
assert.match(workspace, /換一組故事匹配寶物/u);
assert.match(workspace, /加入目前作品/u, "人物候選需可加入目前作品");
assert.match(workspace, /templateId:\s*candidate\.id,\s*rpgArchetype:\s*candidate\.rpgArchetype/u, "加入作品時需保留人物能力原型與數值");
assert.match(workspace, /尚未取得/u, "寶物候選需明確標示尚未取得");
assert.match(workspace, /核准相應選擇後，才會正式進入背包/u, "寶物不得在故事核准前假裝已取得");
assert.doesNotMatch(workspace, /length:\s*PROCEDURAL_(?:CHARACTER|TREASURE)_CAPACITY/u, "UI 不得一次物化十萬筆資料");
assert.doesNotMatch(workspace, /本回合選項尚未完成（\$\{String/u, "畫面不得直接顯示內部錯誤碼");

assert.match(styles, /\.proceduralLibrary\s*\{/u);
assert.match(styles, /\.proceduralCandidateGrid\s*\{/u);
assert.match(styles, /\.managementCoreMetrics\s*\{/u);

console.log("PASS rpg library dashboard ui");
