import type { ChapterInput } from "../../lib/novel-ai/story-intelligence";

export const SHORT_URBAN_STORY: ChapterInput[] = [
  {
    projectId: "fixture-urban",
    chapterId: "urban-1",
    sourceRevision: "urban-1-r1",
    title: "雨夜",
    order: 1,
    content: "林昭今年二十八歲，目前身在臺北車站。世界規則：任何監視器影像都會保留七天。林昭必須在午夜前找到失蹤的妹妹。他看見置物櫃上有一道異樣的紅色刮痕。",
  },
  {
    projectId: "fixture-urban",
    chapterId: "urban-2",
    sourceRevision: "urban-2-r1",
    title: "錯置",
    order: 2,
    content: "隔天，林昭來到舊醫院。林昭目前身在舊醫院，並答應警方不會單獨行動。",
  },
];

export const LONG_FANTASY_STORY: ChapterInput[] = [
  {
    projectId: "fixture-fantasy",
    chapterId: "fantasy-1",
    sourceRevision: "fantasy-1-r1",
    title: "禁律",
    order: 1,
    content: "世界規則：死者不可復生。沈墨已經身亡。沈墨目前身在葬龍谷。伏筆：他的斷劍仍在夜裡發出心跳般的震動。",
  },
  {
    projectId: "fixture-fantasy",
    chapterId: "fantasy-2",
    sourceRevision: "fantasy-2-r1",
    title: "逆律",
    order: 2,
    content: "三天後，沈墨重新活了過來，並抵達皇城。眾人決定隱瞞此事。",
  },
];

export const MULTI_CHARACTER_MYSTERY: ChapterInput[] = [
  {
    projectId: "fixture-mystery",
    chapterId: "mystery-1",
    sourceRevision: "mystery-1-r1",
    title: "證詞",
    order: 1,
    content: "周寧是方可的盟友。方可目前位於檔案室。當晚，方可帶走唯一的門禁紀錄。線索：她的證詞刻意漏掉了停電前的十分鐘。",
  },
  {
    projectId: "fixture-mystery",
    chapterId: "mystery-2",
    sourceRevision: "mystery-2-r1",
    title: "雙重地點",
    order: 2,
    content: "方可目前位於檔案室。方可目前位於碼頭。周寧仍未說明自己為何持有備份鑰匙。",
  },
];
