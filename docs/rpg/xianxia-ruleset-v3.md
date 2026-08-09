# 修仙三選一與資源帳本規則集 v3

本文記錄 `novel-rpg-unified-v3` 與內容規則集 `xianxia-cultivation-v3` 的正式行為。v3 是既有 `novel-rpg-unified-v2` 的相容擴充，不是第二套 RPG 或 Canon 系統。

## 資料模型

`StoryState` 保留既有欄位，另加可選且有版本的 `rpgState?: RpgStateV3`：

```ts
type RpgStateV3 = {
  schemaVersion: "rpg-state-v3";
  formulaVersion: "novel-rpg-unified-v3";
  rulesetId: string;
  presetId: string | null;
  difficulty: "story" | "standard" | "hard" | "extreme";
  realm: CultivationRealmState | null;
  meters: NarrativeMeterState;
  strategicAssets: StrategicAssetState[];
  pendingConsequences: DelayedConsequence[];
  lastTurnReceiptId: string | null;
  customActionEnabled: boolean;
  presetInitialization: RpgPresetInitialization | null;
};
```

九個敘事量表與合法範圍如下：

| 量表 | 範圍 | 用途 |
| --- | ---: | --- |
| `daoHeart` 道心 | 0–100 | 穩定突破與抵抗心魔 |
| `mindDemon` 心魔 | 0–100 | 提高天劫與失控風險 |
| `karma` 業力 | -100–100 | 因果負擔或善業抵銷 |
| `merit` 功德 | 0–100 | 長期善行與界域支持 |
| `fate` 氣運 | 0–100 | 有限機會修正，不保證成功 |
| `pursuit` 追殺壓力 | 0–100 | 通緝、追查與勢力反制 |
| `injury` 傷勢 | 0–100 | 成功率、渡劫與根基負擔 |
| `sectReputation` 宗門聲望 | -100–100 | 招募、交易與勢力態度 |
| `worldAttention` 上界關注 | 0–100 | 天道與高階勢力介入風險 |

每次讀取、migration 與結算都經 `clampNarrativeMeters`。六項基礎能力保留原 key 並限制於 0–100；境界、裝備、傷勢與衍生戰力不會反向覆寫基礎能力。

## 一回合三選一流程

1. `loadRpgChatSnapshot` 讀取章節、Story Bible、StoryState、最近三張回合收據、境界、資源與延遲後果。
2. 規則引擎固定建立三個合法 base choices：`steady`、`resource`、`bold` 各一。
3. A／B／C 的策略位置由 `runSeed + turn + storyStateRevision` 選擇六種排列之一；同狀態重載相同，但位置不永久固定。
4. 閉端 AI 只能回傳 `key`、`title`、`description`、`consequenceTeaser`。merge 不接受 AI 的機率、需求、成本或 effect。
5. 玩家選一項後，規則引擎先建立 `RpgTurnSettlement`；AI 再依已鎖定 outcome 撰寫候選正文。
6. 產生候選時 Canon mutation 為 0。拒絕不寫入任何正式資料。
7. 核准後只執行一次原子交易，再建立下一組三選一。

選項界線為：標題 8–18 字、說明 30–80 字、後果提示 12–40 字。已知成本、缺少的硬性需求、風險 1–5、機率區間與不可逆警告均由規則資料顯示。`partial` 預覽不顯示精確擲骰或隱藏後果。

資源不足時，引擎優先選同策略的可負擔候選；若候選池都不可負擔，就建立不透支資源的 deterministic fallback，仍維持恰好三個有效選項。

## 成功率與 outcome

公式版本是 `novel-rpg-unified-v3`：

```text
chance = clamp(round(
  24
  + primary × 0.48
  + secondary × 0.18
  + level × 1.2
  + temporaryModifier + equipmentBonus + teamBonus
  + realmLevel × 0.65
  - injury × 0.16 - fatigue × 0.10
  + (daoHeart - 50) × 0.08
  - mindDemon × 0.08
  + (fate - 50) × 0.05
  + informationBonus + terrainModifier
  - oppositionGap - difficultyPenalty - risk × 8
), 5, 95)
```

難度 penalty：`story=-5`、`standard=0`、`hard=7`、`extreme=14`。硬性需求不成立時不擲骰；核准前會再次驗證。

結算支援 `critical_success`、`success`、`partial_success`、`failure`。部分成功必定有實質收益與實質成本、量表負擔或未完成後果；普通失敗不默認死亡。同 seed、choice、turn 與 revision 會得到相同 roll 與 outcome。

## 境界與突破

境界 catalog 位於規則層，不在 React UI 硬編碼。正式範圍包括鍛體／凡俗、煉氣、築基、金丹／結丹、元嬰、化神、煉虛、合體、大乘、渡劫與真仙，並保留玄仙、金仙、太乙金仙、大羅金仙與神界擴充槽。

每個 realm definition 記錄等級範圍、壽元、敘事力量範圍、修煉品質倍率、前置需求、資源、量表門檻、典型風險、天劫 profile、失敗 profile 與解鎖能力。

只有專門突破 choice 能改變正式境界。一次核准最多前進 catalog 中一個境界；部分成功最多把當前境界進度推到 99%。傷勢、根基、道心與心魔分別存在，境界高不等於必然健康或穩定。

## 天劫、心魔與因果

天劫版本為 `xianxia-tribulation-v1`：

```text
tribulationPower = baseRealmTribulation
  × mindDemonCoefficient
  × karmaCoefficient
  × interventionCoefficient
  × worldAuraCoefficient
  × difficultyCoefficient
```

- `mindDemonCoefficient = clamp(0.8 + mindDemon / 125, 0.8, 1.6)`
- `karmaCoefficient = clamp(1 + positiveKarma / 180 - negativeKarma / 500, 0.8, 1.6)`
- `interventionCoefficient = clamp(1 + intervention / 100, 1, 1.8)`
- `worldAuraCoefficient = clamp(worldAura, 0.75, 1.5)`
- 難度係數：`story=0.82`、`standard=1`、`hard=1.18`、`extreme=1.38`

外力協助會提高 intervention coefficient。陣法、符籙與法寶可影響承受力或傷害，但不會抹除公式。最近回合、未履行承諾、恩怨、背叛、恐懼及量表會成為後續心魔與天劫的正式輸入。

## 資源與經濟循環

`RPG_RESOURCE_CATALOG_V3` 使用穩定 ID，涵蓋 `currency`、`consumable`、`material`、`equipment`、`strategic_asset`、`quest`、`knowledge` 與 `social_capital`：

```text
靈脈／秘境／靈田／礦脈
→ 靈草、靈礦、符紙、靈墨、胚料與道痕
→ 煉丹、製符、煉器與布陣
→ 修煉、戰鬥、任務、突破與渡劫
→ 耐久下降、報廢、拆解、回收與傳承
```

正式節點包含宗門任務堂、坊市、公會懸賞、拍賣場、黑市、秘境、靈脈、靈田、煉丹、製符、煉器、布陣、宗門維護與渡劫。黑市 choice 同時建立暴露資源和延遲危機，不是便宜商店。靈脈與秘境以 `StrategicAssetState` 記錄產出、維護、風險、位置、爭奪勢力與 modifier。

所有正式資源取得、消耗、交易、使用與換裝都經 `StoryChoiceEffect` 和 `RpgTurnReceipt`；RPG React 元件沒有回合外的直接資源 mutation 按鈕。

## 延遲後果

`DelayedConsequence` 保存來源收據、觸發條件、可見度、狀態、正式 effect 與敘事提示。支援 `exact_turn`、`turn_range`、`resource_threshold`、`meter_threshold`、`location_entered`、`faction_encountered`、`realm_breakthrough`、`quest_state`、`random_with_seed`。

每回合開始時規則引擎以 seed 檢查。觸發項與本回合 settlement 一起進入同一 Canon transaction；AI 只能敘述結果，不能自行暗扣資源。

## 明檀 preset：附身、重生與有限系統

`xianxia.mingtan.v1` 是可選內容層，ruleset 為 `xianxia-cultivation-v3`、難度為 `extreme`，不污染其他作品。

它把《明檀篇》的三種機制統一為：Brendon 附身／轉生至已死亡的明檀肉身，曾經歷宗門毀滅的失敗時間線，再重回起點；「逆命殘卷系統」只是由失敗因果、殘缺記憶與瑤光月魄形成的有限備份。它可以評估、修正、推演與提出有限任務，但不能全知、憑空造物、保證未來、強制愛情或直接跨境界。

紫凝、洛青瑤、雪琪、婉心是四個命運錨點，各自有今世選擇；preset 不把前世關係當成今世忠誠。時間線偏差、前世情報可信度、天道暴露與系統依賴是正式資源輸入，可隨 effect 與 receipt 改變。

套用前先建立 safety backup。首次套用保留章節、角色、Story Bible 與世界資料，並初始化：

- `currency.spiritStone = 10000`（「𩆜石」）
- `item.feminization-charm-pill = 10`（「女體化媚心丹」）
- 重建合歡宗、四位命運錨點及跨界成長任務
- custom action 關閉、極高難度、同意與年齡保護保留

`presetInitialization` 以專案穩定 ID 記錄首次套用。重整或重複點擊會 replay，不重發資源，也不覆寫正文。

## Canon transaction 與回合收據

核准時，同一原子邊界寫入 AcceptedChoice、Chapter 正文與 revision、StoryState、StoryBibleDelta、ApprovalTransaction、OperationJournal、IdempotencyRecord、RpgTurnReceipt，以及 Conversation 來源的 Artifact／Approval Transaction。任何寫入失敗都 rollback。

核准前會重讀並比較完整 `RpgTurnSnapshot`、章節 revision、StoryState revision、規則集、preset、需求與 effect digest。資源不可為負，一次突破不可跳超過一個境界。相同候選的相同重送回傳原交易；不同 payload 使用相同 idempotency key 會被拒絕。

RPG Workspace 與 Conversation Workspace 共用 `loadRpgChatSnapshot`、`planRpgChatChoices`、`generateRpgChatTurnCandidate` 和 `approveRpgChatTurn`。Conversation 的 A／B／C、1／2／3、一／二／三、序數句及策略句都必須解析回目前候選 ID。

## 離線後備模式

本機模型不可用、proof 不完整或 AI schema 無效時，系統顯示 `deterministic-rule-fallback`／`rules-only`。規則 choice、settlement、候選正文、驗證與 approval 仍可工作；介面不假稱內容由真實模型產生。

AI 正文驗證會拒絕：未承接已選行動、outcome 語意矛盾、捏造正式數值變化、取得 effect 未授權物品、或宣稱未授權境界提升的候選。

## Migration、備份與復原

`readRpgStateV3`、`migrateLegacyRpgStateToV3` 與 `projectRpgStateV3ToLegacyMaps` 提供雙向相容層。舊專案從既有 resources／worldFlags 推導；未套用修仙 ruleset 的專案保持 generic realm `null`。

IndexedDB schema v8 加入 `rpgTurnReceipts`。Memory、Unavailable、匯出、完整與 safety backup、restore、import remap、semantic snapshot、專案刪除及既有 v2–v7 備份相容路徑使用同一 store catalog。舊備份沒有 receipt 時使用空集合；只有明確套用 preset 才發放內容資源。

## 已知限制

- 高階仙界／神界已有 catalog 擴充槽，完整事件池仍需按作品逐步增加。
- 戰略資產已有正式資料結構與回合 effect 邊界；複雜跨宗門市場仍是回合驅動，不是背景即時模擬器。
- deterministic fallback 追求一致性與可核准性，文學變化度低於通過 proof 的閉端模型。
- safety backup 在 preset 首次套用時建立；UI 尚未提供任意時間點的可視化差異合併器。
