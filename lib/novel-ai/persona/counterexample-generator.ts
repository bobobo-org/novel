import type { StoryContext } from "../story-intelligence";

export function generateStoryCounterexamples(context: StoryContext) {
  return [
    context.worldContext.length ? "若候選改寫既有世界規則，必須拒絕。" : "世界規則資料不足，不得自行補成硬設定。",
    context.characterContext.length ? "若角色行為缺少既有動機支持，需標示風險。" : "角色資料不足，需保留不確定性。",
    context.foreshadowingContext.length ? "不得回收未被檢索到或已失效的伏筆。" : "沒有可用伏筆時，不得假造既有伏筆。",
  ];
}
