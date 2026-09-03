# 小說交誼廳可信簽章 canonical payload v1

狀態：`V5_SCOPE_APPROVED`

基準：`e20baa0366cfe0fd494c3808ac04ddaef3144131`

適用範圍：`trusted-attestation-producer` Preview；本文件不啟用正式站互動、不變更作者裝置資格，也不授權放寬既有 v4 verifier。v4 程式碼保留，但公開發布／覆寫換票只接受下列獨立 v5 路徑，不得 fallback。

## 1. 安全邊界

- producer 只能在 Private AI Hub 的 loopback server process 執行。瀏覽器只提交待評鑑資料並接收公開 attestation；不得取得、讀取或匯出私鑰。
- 私鑰由執行環境提供，缺失、格式錯誤、key ID 不符或無法讀取時，一律回傳 `PRODUCER_UNAVAILABLE`；不得臨時生成未受信任金鑰、使用固定字串或測試金鑰假裝成功。
- Vercel verifier 的 `PUBLIC_LOUNGE_ELIGIBILITY_ED25519_PUBLIC_KEY` 與 `PUBLIC_LOUNGE_ELIGIBILITY_KEY_ID` 是信任根。Preview 與 Production 必須使用不同 key pair 與 key ID。
- producer 必須重算輸入內容的 `completionFingerprint` 與 `publicationDigest`，不得直接相信瀏覽器傳入的 digest、總分或通過旗標。
- producer 只簽發最長 30 分鐘的 Ed25519 attestation。任何錯誤皆 fail closed。
- producer 與作者裝置資格是兩個獨立狀態。取得可信簽章不會把 `authorDeviceEligibilityAccepted` 改成 `true`；後者仍須另案驗收。
- 發布流程不寫 Canon。撤回只改公開狀態並保留私人作品、revision、全書評鑑與 Canon。

## 2. v4 保留原狀與 v5 禁止 downgrade

- `public-lounge-server-review-attestation-v4` 的 type、parser、canonical payload 與 reviewer 保留，既有直接單元測試不得刪除或改成放寬版本。
- `/api/lounge/eligibility` 的正式 server-attestation 路徑只接受 `public-lounge-server-review-attestation-v5`；收到 v4 必須回 `PUBLIC_LOUNGE_ATTESTATION_VERSION_UNSUPPORTED`，不得轉走 author-device 或其他 fallback。
- v5 驗證失敗時不得嘗試 v4 verifier。
- author-device review 繼續是獨立、未被正式接受的能力；`authorDeviceEligibilityAccepted` 保持 `false`。

## 3. v5 canonical bytes

producer 與 verifier 必須共用同一個
`publicLoungeServerReviewAttestationV5Payload(attestation)` 函式；不得在 Private AI Hub 複製另一份排序器。Private AI Hub companion 的 producer 模組使用由同一原始碼產生／匯出的 canonical helper，parity test 必須逐 byte 相等。

編碼規則：

1. 依下列順序建構 JavaScript object。
2. `qualityBreakdown` 固定依七個 rubric keys 排序。
3. `multiJudgeSummary.judges` 保留已驗證的 judge 順序；每位 judge 的 `dimensionScores` 使用同一七欄順序。
4. 使用 `JSON.stringify`，不縮排、不加換行。
5. 使用 UTF-8 編碼。
6. 使用 Ed25519 對 bytes 簽章。
7. `signature` 以 unpadded base64url 表示；64 bytes 的 Ed25519 signature 應為 86 字元。

欄位順序：

```text
schemaVersion
issuer
keyId
attestationId
intent
workId
revisionId
targetPublicationId
expectedTargetVersionId
expectedTargetPublicationDigest
environment
audience
producerVersion
rubricVersion
issuedAt
expiresAt
completionFingerprint
contentDigest
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

- `schemaVersion = public-lounge-server-review-attestation-v5`
- `issuer = private-ai-hub`
- `backendId = private-ai-hub`
- `environment = preview | production`
- `intent = publish | overwrite`
- `audience` 必須與 verifier 部署的精確設定值相同，不接受 wildcard。
- `producerVersion` 必須與 verifier 允許的版本完全相同。
- `rubricVersion = public-lounge-rubric-v1`
- `rawContentStored = false`
- `attestationId`：使用 CSPRNG 產生至少 128 bits，base64url，22 至 128 字元；ledger 以其 SHA-256 作唯一主鍵。
- `workId`：目前作品的 project ID。
- `revisionId`：目前定義為 content-addressed revision ID，值必須等於 `completionFingerprint`。
- `targetPublicationId`、`expectedTargetVersionId`、`expectedTargetPublicationDigest`：`publish` 時必須全部為 `null`；`overwrite` 時必須全部是非空、由目前公開版本取得的精確值。
- `issuedAt` / `expiresAt`：canonical ISO-8601 UTC；`expiresAt > issuedAt`，且差值不得超過 30 分鐘。
- `completionFingerprint` / `contentDigest` / `publicationDigest` / `modelDigest` / `expectedTargetPublicationDigest`（非 null 時）：小寫 64 字元 SHA-256 hex。
- `workCompleted`、`fullCoverage`、`hardGatePassed`、`compliancePassed`、`criticalDimensionsPassed` 必須為 `true`。
- `hiddenDraftResidueDetected` 必須為 `false`。

## 4. v4 canonical bytes（只供既有獨立 verifier 測試）

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

## 5. `completionFingerprint` 與 `revisionId`

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

## 6. `contentDigest` 與 `publicationDigest`

`contentDigest` 是公開正式正文的獨立承諾：

```text
SHA-256(UTF-8(JSON.stringify(publicChapters)))
```

`publicChapters` 必須先經既有 exact-shape validation，且每章只含 `chapterNumber`、`title`、`body`、`official: true`。producer 與 verifier 都要重算並比對。

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

## 7. 評分與 rubric 身分

- 評分規格為 `PUBLIC_LOUNGE_QUALITY_RUBRIC` 的七維權重與 `WHOLE_NOVEL_REVIEW_RUBRIC` 的對應 criteria。
- producer 必須獨立驗證三位 primary judges、必要時的 arbitrator、逐維中位數、總分、80 分門檻、關鍵維度 60 分門檻、full coverage、hard gate、compliance 與 HiddenDraft residue。
- 瀏覽器送來的 `qualityScore`、`qualityBreakdown`、judge summaries 或通過布林值只能作為待驗證輸入，不能直接成為已信任結果。
- v5 以獨立 `rubricVersion` 欄位簽住評分規格。verifier 必須精確比對支援版本，不得只檢查非空字串。

## 8. 環境、audience、producer 版本與金鑰

- Preview 與 Production 分開產生、保存與輪替 key pair，絕不共用私鑰。
- `environment`、`audience`、`producerVersion` 與 `keyId` 都是獨立簽章欄位，且 verifier 必須與部署設定精確比對。
- `keyId` 必須包含環境與 key generation；它不能取代上述獨立欄位。
- 私鑰只可從 Private AI Hub server 的受限檔案或 OS secret source 載入。不得寫入 repo、前端 bundle、API response、access log、測試 artifact 或 Vercel。
- 公鑰可匯出供部署者寫入相應 Preview/Production verifier secret；export endpoint 只能回公鑰、key ID 與 fingerprint。
- 金鑰不存在時 health 顯示 `unavailable`；不得將 `not-available-in-this-release` 改成假 `ready`。

## 9. attestation replay、ticket idempotency 與撤回

- producer 必須為每份 attestation 產生唯一 `attestationId`。
- verifier 完整驗證 v5 簽章、欄位、時間、環境、audience、版本、內容、intent 與 overwrite target 後，才能呼叫資料庫原子 consume RPC。
- ledger 以 `SHA-256(attestationId)` 的 unique/primary key 阻止重放；不保存原始 attestationId、完整簽章、正文或私鑰。
- RPC 結果只允許 `consumed`。unique conflict 回 `ATTESTATION_REPLAY`；資料庫錯誤、timeout、結果不明或回傳格式錯誤一律 fail closed，且前端不得自動重送同一 attestation。
- nonce consume 成功而 eligibility ticket 儲存失敗時，該 attestation 仍視為已用；UI 必須請 producer 產生新的 attestation，不得自動重試舊值。
- Vercel 既有 stored eligibility 與 single-use consumption 繼續防止「同一 eligibility ticket」被消費兩次；這是第二層保護。
- 同一 publication digest、同一 eligibility ticket、同一 idempotency key 的重試，只能得到同一公開結果；不得新增第二筆。
- 覆寫必須取得針對新 `publicationDigest` 的新 attestation 與 ticket。
- 撤回不是刪庫，也不使用 publication eligibility attestation。它使用既有 owner-bound management token 進行狀態轉移：`published -> retracted`；私人作品、completion fingerprint、revision 與 Canon 保留。

## 10. v5 與核准要求的欄位對照

| 要求 | v5 綁定方式 | 結論 |
| --- | --- | --- |
| book / work ID | 獨立 `workId` + `completionFingerprint` 內的 project ID | 直接及間接綁定 |
| revision ID | 獨立 `revisionId`，且必須等於目前 `completionFingerprint` | 直接綁定 |
| 正文 content hash | 獨立 `contentDigest` + `completionFingerprint` + `publicationDigest.publicChapters` | 已綁定 |
| 分數與七維評分 | attestation 本體 + `publicationDigest` | 已綁定 |
| 評分規格版本 | 獨立 `rubricVersion` | 已綁定 |
| 完稿／正式正文／同意／權利 | attestation gates + `publicationDigest` | 已綁定 |
| 8 書架與最多 3 標籤 | `publicationDigest` | 已綁定 |
| `issuedAt`、expiry、attestationId | attestation 本體 | 已綁定 |
| 同一 attestation 防重放 | SHA-256 ID 的資料庫唯一約束與原子 consume RPC | 已決策，待實作與 migration 驗證 |
| environment / audience | 獨立欄位 + 環境專用 trust root | 已綁定 |
| producerVersion / keyId | 獨立欄位 | 已綁定 |
| intent: publish / overwrite | 獨立欄位；overwrite 額外簽 target ID/version/digest | 已綁定 |
| withdraw | management token + tombstone | 明確排除 AI attestation，確保可安全下架 |

## 11. 實作閘門

核准後的閘門為：

```text
GO: 新增獨立 v5 schema/canonical/reviewer、原子 nonce ledger、v5-only 換票、producer 與 Preview trust root
RETAIN: v4 verifier 原始邏輯與測試
REJECT: v4 進入正式 publish/overwrite eligibility path；任何 v5 -> v4 fallback
EXCLUDE: withdraw attestation、interaction activation、生成流程三缺口、Canon/時代門檻變更
```
