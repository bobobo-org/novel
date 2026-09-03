# 小說交誼廳可信簽章 canonical payload v1

狀態：`CONTRACT_FROZEN_WITH_BLOCKERS`

基準：`e20baa0366cfe0fd494c3808ac04ddaef3144131`

適用範圍：`trusted-attestation-producer` Preview；本文件不啟用正式站互動、不變更作者裝置資格，也不授權放寬既有 verifier。

## 1. 安全邊界

- producer 只能在 Private AI Hub 的 loopback server process 執行。瀏覽器只提交待評鑑資料並接收公開 attestation；不得取得、讀取或匯出私鑰。
- 私鑰由執行環境提供，缺失、格式錯誤、key ID 不符或無法讀取時，一律回傳 `PRODUCER_UNAVAILABLE`；不得臨時生成未受信任金鑰、使用固定字串或測試金鑰假裝成功。
- Vercel verifier 的 `PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY` 與 `PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID` 是信任根。Preview 與 Production 必須使用不同 key pair 與 key ID。
- producer 必須重算輸入內容的 `completionFingerprint` 與 `publicationDigest`，不得直接相信瀏覽器傳入的 digest、總分或通過旗標。
- producer 只簽發最長 30 分鐘的 Ed25519 attestation。任何錯誤皆 fail closed。
- producer 與作者裝置資格是兩個獨立狀態。取得可信簽章不會把 `authorDeviceEligibilityAccepted` 改成 `true`；後者仍須另案驗收。
- 發布流程不寫 Canon。撤回只改公開狀態並保留私人作品、revision、全書評鑑與 Canon。

## 2. 既有 verifier 的唯一 canonical bytes

為避免 producer 與 verifier 漂移，簽章 bytes 必須直接由既有
`publicLoungeServerReviewAttestationPayload(attestation)` 產生；不得另寫一份排序器。

編碼規則：

1. 依下列順序建構 JavaScript object。
2. `qualityBreakdown` 固定依七個 rubric keys 排序。
3. `multiJudgeSummary.judges` 保留已驗證的 judge 順序；每位 judge 的 `dimensionScores` 使用同一七欄順序。
4. 使用 `JSON.stringify`，不縮排、不加換行。
5. 以 UTF-8 編碼。
6. 使用 Ed25519 對 bytes 簽章。
7. `signature` 以 unpadded base64url 表示；64 bytes 的 Ed25519 signature 應為 86 字元。

欄位順序：

```text
schemaVersion
issuer
keyId
nonce
issuedAt
expiresAt
completionFingerprint
publicationDigest
qualityScore
qualityBreakdown
  plot_coherence
  character_arcs
  world_canon_consistency
  pacing
  prose_dialogue
  foreshadowing_payoff
  ending
workCompleted
fullCoverage
hardGatePassed
compliancePassed
criticalDimensionsPassed
hiddenDraftResidueDetected
multiJudgeSummary
  schemaVersion
  primaryJudgeRoles
  primaryJudgeCount
  judges[]
    judgeRole
    totalScore
    dimensionScores (同上七欄順序)
    fullCoverage
  aggregationMethod
  primaryScoreSpread
  selectedJudgeRoles
  arbitrationRequired
  arbitrationPerformed
  fullCoverageJudgeRoles
  reviewedChapterCount
  reviewedChunkCount
backendId
modelId
modelDigest
rawContentStored
```

固定值與格式：

- `schemaVersion = public-lounge-server-review-attestation-v4`
- `issuer = private-ai-hub`
- `backendId = private-ai-hub`
- `rawContentStored = false`
- `nonce`：使用 CSPRNG 產生至少 128 bits，base64url，22 至 128 字元。
- `issuedAt` / `expiresAt`：canonical ISO-8601 UTC；`expiresAt > issuedAt`，且差值不得超過 30 分鐘。
- `completionFingerprint` / `publicationDigest` / `modelDigest`：小寫 64 字元 SHA-256 hex。
- `workCompleted`、`fullCoverage`、`hardGatePassed`、`compliancePassed`、`criticalDimensionsPassed` 必須為 `true`。
- `hiddenDraftResidueDetected` 必須為 `false`。

## 3. `completionFingerprint`

producer 必須用既有 `buildWholeNovelCompletionFingerprint(snapshot)` 相同的 canonical 規則重算：

```text
SHA-256(UTF-8(JSON.stringify(stableFingerprintValue({
  projectId,
  project,
  substantiveChapters,
  storyBible,
  storyState,
  sortedCharacters,
  sortedRelationships,
  sortedWorldRules,
  sortedTimeline,
  sortedWorlds,
  sortedOffstageCharacterNames
}))))
```

這個 fingerprint 直接綁定 work/project ID、project metadata、章節 ID、章節 revision、正式正文、Story Bible、狀態、人物、關係、世界規則與時間線。正文或上述資料任一改變，舊全書評鑑與舊 attestation 都不再適用。

在既有 v4 schema 下，`completionFingerprint` 同時是 content-addressed revision identity；沒有另一個可由 verifier 讀取的明文 `revisionId` 欄位。

## 4. `publicationDigest`

producer 必須先用現有 validation/canonicalization 規則建立不含 `eligibilityTicket` 的 `public-lounge-publication-request-v2`，再計算：

```text
SHA-256(UTF-8(JSON.stringify({
  schemaVersion: "public-lounge-eligibility-request-v3",
  completionFingerprint,
  publication: {
    schemaVersion,
    title,
    authorByline,
    storyLibrarySchemaVersion,
    shelfId,
    primaryTopicId,
    topicIds,
    completionStatus,
    chapterCount,
    wordCount,
    completedAt,
    qualityScore,
    qualityBreakdown,
    fullSynopsis,
    publicChapters,
    explicitConsent,
    authorRightsDeclaration,
    workCompleted
  }
})))
```

因此下列任一變更都會讓舊簽章失效：公開正文、標題、作者署名、書架、主要分類、最多三個 topic IDs、簡介、章節數、字數、完稿時間、分數、七維評分、正式正文旗標、公開同意與權利聲明。

## 5. 評分與 rubric 身分

- 評分規格為 `PUBLIC_LOUNGE_QUALITY_RUBRIC` 的七維權重與 `WHOLE_NOVEL_REVIEW_RUBRIC` 的對應 criteria。
- producer 必須獨立驗證三位 primary judges、必要時的 arbitrator、逐維中位數、總分、80 分門檻、關鍵維度 60 分門檻、full coverage、hard gate、compliance 與 HiddenDraft residue。
- 瀏覽器送來的 `qualityScore`、`qualityBreakdown`、judge summaries 或通過布林值只能作為待驗證輸入，不能直接成為已信任結果。
- 既有 v4 payload 沒有獨立 `rubricVersion` 欄位。Preview key ID 必須採環境與規格分離的命名，例如 `pl.preview.ph-1_5.rubric-v1.k1`；verifier 必須精確比對該 key ID。這可鎖定該環境的信任根，但不是新增一個可解析的 rubric 欄位。

## 6. 環境、producer 版本與金鑰

- Preview 與 Production 分開產生、保存與輪替 key pair，絕不共用私鑰。
- `keyId` 必須包含環境、producer major/minor、rubric version 與 key generation；它本身位於簽章 payload，且 verifier 會與部署設定精確比對。
- 私鑰只可從 Private AI Hub server 的受限檔案或 OS secret source 載入。不得寫入 repo、前端 bundle、API response、access log、測試 artifact 或 Vercel。
- 公鑰可匯出供部署者寫入相應 Preview/Production verifier secret；export endpoint 只能回公鑰、key ID 與 fingerprint。
- 金鑰不存在時 health 顯示 `unavailable`；不得將 `not-available-in-this-release` 改成假 `ready`。

## 7. replay、idempotency 與撤回

- producer 必須為每份 attestation 產生唯一 nonce；但既有 v4 verifier 只驗格式與簽章，沒有 nonce consumption ledger。同一份仍在有效期內的 attestation 目前可再次換取另一張 eligibility ticket。
- Vercel 既有 stored eligibility 與 single-use consumption 只防止「同一 eligibility ticket」被消費兩次，不能宣稱已防止「同一 attestation」被重送。
- 同一 publication digest、同一 eligibility ticket、同一 idempotency key 的重試，只能得到同一公開結果；不得新增第二筆。
- 覆寫必須取得針對新 `publicationDigest` 的新 attestation 與 ticket。
- 撤回不是刪庫，也不使用 publication eligibility attestation。它使用既有 owner-bound management token 進行狀態轉移：`published -> retracted`；私人作品、completion fingerprint、revision 與 Canon 保留。

## 8. 與使用者要求的欄位對照

| 要求 | v4 綁定方式 | 結論 |
| --- | --- | --- |
| book / work ID | `projectId` 進入 `completionFingerprint` | 間接綁定，可由 producer 重算 |
| revision ID | 章節 revision 與內容進入 `completionFingerprint`；digest 本身作 content-addressed revision identity | 間接綁定，無明文 revision ID |
| 正文 content hash | `completionFingerprint` + `publicationDigest.publicChapters` | 已綁定 |
| 分數與七維評分 | attestation 本體 + `publicationDigest` | 已綁定 |
| 評分規格版本 | 只能由環境專用 `keyId`/trust policy 鎖定 | 無獨立欄位 |
| 完稿／正式正文／同意／權利 | attestation gates + `publicationDigest` | 已綁定 |
| 8 書架與最多 3 標籤 | `publicationDigest` | 已綁定 |
| `issuedAt`、expiry、nonce | attestation 本體 | 已綁定 |
| attestationId／同一 attestation 防重放 | nonce 可作識別，但 verifier 沒有 nonce ledger | **未完成** |
| environment | 環境專用 key pair + 精確 `keyId` | trust-root 層綁定，無獨立欄位 |
| producerVersion | `keyId` 命名及部署信任設定 | trust-root 層綁定，無獨立欄位 |
| intent: publish / overwrite / withdraw | v4 payload 沒有 intent；publish 與 overwrite 共用資格票，withdraw 使用 management token | **未被 v4 簽章直接綁定** |

## 9. 實作閘門

在「不得修改 verifier」限制下，producer 可以完整對接現有 v4 並安全簽發特定公開內容；但不能誠實宣稱 v4 已直接簽住 `intent`，也不能新增明文 `revisionId`、`environment`、`producerVersion`、`rubricVersion` 而不被 parser 拒絕。

因此目前閘門為：

```text
GO: 實作現有 v4 producer、內容／分數／權利／分類綁定、短效簽章、Preview trust root
BLOCKED: 宣稱 intent 已被簽章、宣稱 attestation 本身 single-use，或把額外欄位塞入 nonce/modelDigest 冒充 verifier 已驗證
```

若 `intent` 必須成為 verifier 強制執行的簽章欄位，或同一 attestation 必須只能換票一次，需另行核准一個只收緊、不放寬既有安全條件的 attestation schema／nonce ledger 升版；本分支在獲准前不得偷偷變更 verifier 或 service。
