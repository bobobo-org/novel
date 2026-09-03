# 小說交誼廳 producer 錯誤碼與發布面板對照 v1

狀態：`CONTRACT_FROZEN`

基準：`e20baa0366cfe0fd494c3808ac04ddaef3144131`

原則：每個 producer 錯誤都表示「沒有簽發 attestation、沒有取得 eligibility ticket、沒有寫入公開列、沒有寫 Canon」。面板不得把本機評分、規則後備、空字串或舊簽章當成成功。

## 1. producer 回應 envelope

成功：

```json
{
  "ok": true,
  "attestation": "<public-lounge-server-review-attestation-v4 object>",
  "producer": {
    "status": "ready",
    "keyId": "<public key id>",
    "publicKeyFingerprint": "<sha256 hex>",
    "version": "<private hub producer version>"
  }
}
```

失敗：

```json
{
  "ok": false,
  "error": {
    "code": "<stable code>",
    "retryable": false
  }
}
```

失敗 response 不得回傳 stack、prompt、正文、私鑰、私鑰路徑、原始 model output、access token、management token 或可重放的內部憑證。

## 2. producer 專用錯誤碼

| Producer code | HTTP | retryable | 發布面板文字 | 必要行為 |
| --- | ---: | :---: | --- | --- |
| `PRODUCER_UNAVAILABLE` | 503 | 是 | `Private AI Hub 的可信簽章服務目前不可用；沒有發布。請確認本機 Hub 與簽章金鑰。` | 停止，不呼叫 eligibility API |
| `PRODUCER_KEY_NOT_CONFIGURED` | 503 | 否 | `此 Private AI Hub 尚未配置受信任簽章金鑰；沒有發布。` | health=`unavailable`，不得自建未受信任金鑰 |
| `PRODUCER_KEY_ID_MISMATCH` | 503 | 否 | `本機 producer 與目前部署的信任金鑰不一致；沒有發布。` | 要求重新配置 Preview/Production trust root |
| `PRODUCER_REVIEW_UNVERIFIED` | 422 | 否 | `全書評鑑無法由 Private AI Hub 驗證；本機顯示的分數不具公開資格。` | 不相信瀏覽器提供的分數或 flags |
| `AUTHOR_DEVICE_NOT_ELIGIBLE` | 403 | 否 | `作者裝置資格尚未完成驗收；此狀態與可信簽章服務分開。` | 不得把 producer ready 改寫成 device accepted |
| `PUBLIC_BUNDLE_FIELD_NOT_WHITELISTED` | 422 | 否 | `公開包包含未允許欄位；沒有發布，也沒有送出私人資料。` | 拒絕多餘欄位，不自動丟棄後繼續 |
| `SCORE_BELOW_80` | 422 | 否 | `可信評鑑總分未達 80 分；不能發布到小說交誼廳。` | 不簽發 |
| `TAG_LIMIT_EXCEEDED` | 422 | 否 | `公開標籤最多三個；沒有發布。` | 不簽發 |
| `SHELF_INVALID` | 422 | 否 | `請從八個正式書架中選擇一個；沒有發布。` | 不簽發 |
| `RIGHTS_OR_CONSENT_MISSING` | 422 | 否 | `作者公開同意或權利聲明不完整；沒有發布。` | 不簽發 |
| `WORK_NOT_COMPLETED` | 422 | 否 | `作品尚未全部完稿；沒有發布。` | 不簽發 |
| `HIDDEN_DRAFT_RESIDUE_DETECTED` | 422 | 否 | `全書評鑑偵測到未清除的內部草稿殘留；沒有發布。` | 不簽發 |
| `STORY_STATE_CHARACTER_ERA_INCOMPATIBLE` | 422 | 否 | `人物與故事時代設定不相容；Canon 安全門檻未通過，沒有發布。` | 保留既有安全門檻，不放寬 |
| `ATTESTATION_INVALID` | 403 | 否 | `可信簽章內容或格式無效；沒有發布。` | 清除本輪記憶體中的 attestation |
| `ATTESTATION_EXPIRED` | 410 | 是 | `可信簽章已逾時；請重新執行本輪簽章。` | 重新評鑑／簽發，不重用舊票 |
| `ATTESTATION_WRONG_ENV` | 403 | 否 | `可信簽章不屬於目前環境；沒有發布。` | Preview/Production 金鑰隔離 |
| `ATTESTATION_WRONG_REVISION` | 409 | 否 | `作品在評鑑後已改動；請針對目前版本重新評鑑。` | 重算 completion fingerprint |
| `ATTESTATION_REPLAY` | 409 | 否 | `這份一次性資格已使用；公開內容未重複寫入。` | 目標行為；既有 v4 尚無 attestation nonce ledger，不得誤報已具備 |
| `PRODUCER_TIMEOUT` | 504 | 是 | `Private AI Hub 評鑑或簽章逾時；沒有發布。` | 可明確重試，不得降級為假簽章 |
| `PRODUCER_INTERNAL_ERROR` | 500 | 是 | `Private AI Hub 無法完成可信簽章；沒有發布。` | 對 UI 隱藏內部細節，伺服器 log 也不得含正文／私鑰 |

## 3. 對應既有 public-lounge API 錯誤碼

Producer code 在跨入現有 Vercel eligibility/publication API 後，依下表正規化；不得更改現有 verifier 的安全語意。

| Producer / UI 分類 | 現有 API code | 面板結果 |
| --- | --- | --- |
| producer 沒有可驗證 trust root | `PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED` | 不可發布；明示 producer unavailable |
| attestation 格式、簽章、key ID、內容 digest、錯環境或錯 revision | `PUBLIC_LOUNGE_ELIGIBILITY_INVALID` | 不可發布；公開列不變 |
| attestation 或 ticket 已逾時 | `PUBLIC_LOUNGE_ELIGIBILITY_EXPIRED` | 不可發布；要求重簽 |
| eligibility ticket 重放或衝突 | `PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED` | 不新增第二筆；這不是 attestation 本身的重放保護 |
| 分數未達門檻 | `PUBLIC_LOUNGE_SCORE_NOT_QUALIFIED` | 不可發布 |
| 公開同意缺失 | `PUBLIC_LOUNGE_CONSENT_REQUIRED` | 不可發布 |
| 權利聲明缺失 | `PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED` | 不可發布 |
| 作品未完稿 | `PUBLIC_LOUNGE_WORK_NOT_COMPLETED` | 不可發布 |
| 欄位、書架、標籤或白名單錯誤 | `PUBLIC_LOUNGE_PAYLOAD_INVALID` | 不可發布；不得靜默刪欄位後重送 |
| actor 未登入 | `PUBLIC_LOUNGE_AUTH_REQUIRED` | 不可發布；不把 producer 問題混成登入問題 |
| owner／management token 不符 | `PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED` / `PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID` | 不覆寫、不撤回 |
| 公開 storage/control plane 未連線 | `PUBLIC_LOUNGE_NOT_CONNECTED` | 不可發布；不建立本機假公開結果 |

## 4. 面板狀態機

```text
idle
  -> checking-producer
      -> unavailable (fail closed)
      -> reviewing-and-signing
          -> rejected (stable producer code)
          -> attested
              -> requesting-single-use-ticket
                  -> rejected/expired/replayed
                  -> publishing-or-overwriting
                      -> published
                      -> recovery-required

published
  -> retracting-with-management-token
      -> retracted (public count decreases; private work/revision/Canon remain)
      -> retract-failed (published state remains)
```

UI 不得只顯示模糊的「不可用」。至少分開顯示：

- `可信 producer：檢查中 / 可用 / 不可用`
- `作者裝置資格：未驗收 / 已驗收`
- `公開後端：未連線 / 可用`
- `互動功能：維持關閉`

## 5. 寫入與收據不變式

每次動作都要留下可解釋的結果，但驗收證據不得含 secret：

| 動作 | 公開列 | 私人 work/revision | Canon mutation | eligibility consumption |
| --- | --- | --- | ---: | --- |
| producer 拒絕 | 不變 | 保留 | 0 | 0 |
| 首次發布成功 | 0 -> 1 | 保留 | 0 | 1 |
| 同一請求重試 | 維持 1，回同一結果 | 保留 | 0 | 不新增 |
| 覆寫成功 | 維持 1，version +1 | 保留 | 0 | 1 個新 ticket |
| 撤回成功 | 1 -> 0（狀態為 retracted/tombstone） | 保留 | 0 | 不使用 publish ticket |
| 撤回失敗 | 維持 1 | 保留 | 0 | 0 |

## 6. 日誌與證據紅線

允許記錄：穩定錯誤碼、時間、key ID、公鑰 fingerprint、attestation digest、publication digest、completion fingerprint、模型 ID/digest、HTTP 狀態與 latency。

禁止記錄：私鑰、原始簽章輸入正文、完整公開包、prompt、raw model output、Supabase/GitHub/Vercel token、management token、eligibility ticket、Authorization header。

自動化測試只可使用每次測試即時產生的 ephemeral key pair；測試公鑰不得配置成 Preview 或 Production 信任根，測試通過也不得把 health 寫成正式 ready。
