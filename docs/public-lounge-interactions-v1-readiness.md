# 交誼廳互動 v1：安全部署與待啟用驗證

應用層已具備 Supabase magic-link／PKCE 登入、逐請求 `auth.getUser(accessToken)`、
same-origin 互動 API、作品 owner lifecycle，以及不使用假計數的 reader UI。這不代表
Production 已啟用；缺少 migration、Auth redirect 或實際雙帳號驗證時一律 fail closed。

## 已實作邊界

- `prisma/migrations/027_public_lounge_interactions_v1.sql`：唯一推薦、留言、檢舉、軟刪稽核、
  原子 rate RPC、`(created_at,id)` 分頁、viewer `selected`／`canDelete`，以及 active owner registry。
- 所有公開讀取先讀權威 Storage head，再要求 DB 的 `current_version_id` 相同；舊版留言、
  stale owner row 與已撤回作品不會被公開。
- browser 只取得 Supabase URL 與 anon key。`SUPABASE_SERVICE_ROLE_KEY` 只存在 server gateway，
  且 owner bind/assert/sync/deactivate/status RPC 只授權 `service_role`。
- API 不接受 `userId`。推薦、留言、刪除與檢舉的 RPC 都使用已驗證 JWT 所得到的 `auth.uid()`。
- 發布成功後 bind owner；覆寫先確認 owner、Storage 成功後同步單調版本；撤回成功後 deactivate。
  Storage 與 Postgres 無法形成跨系統單一交易，因此讀取永遠以 Storage head 為權威，版本不一致
  會 503；bind/sync 失敗也會停用或補償撤回，不會以 DB row 推測公開內容仍存在。

## API

- `GET /api/lounge/interactions/health`
- `GET /api/lounge/interactions/:publicId?limit=&cursor=&chapter=`
- `PUT /api/lounge/interactions/:publicId/vote`
- `POST /api/lounge/interactions/:publicId/comments`
- `DELETE /api/lounge/interactions/:publicId/comments/:commentId`
- `POST /api/lounge/interactions/:publicId/reports`
- `GET /auth/callback` 完成 PKCE code exchange；`next` 僅允許同 origin 相對路徑。

所有 mutation 都要求同 origin；authenticated operation 的 server gateway 每次都重新呼叫
Supabase `auth.getUser`。作品管理另用 `X-Public-Lounge-Management-Token`，不與 Auth bearer 混用。

## Migration apply/check

靜態 contract：

```powershell
node scripts/apply-public-lounge-interactions-migration.mjs --self-test
```

有 Supabase management channel 時：

```powershell
$env:SUPABASE_ACCESS_TOKEN = '<management token>'
$env:SUPABASE_PROJECT_REF = '<project ref>'
node scripts/apply-public-lounge-interactions-migration.mjs --check --required
node scripts/apply-public-lounge-interactions-migration.mjs --required
```

腳本會在套用後再次檢查 marker 與所有 RPC signature。Production deploy 必須先把 runtime
固定為 fail closed，再執行 apply 與 `--check --required`；缺任一步驟時不得建立 staged
deployment 或切 alias。

兩個真實帳號與專用測試作品準備完成後，可執行非 fixture RPC contract：

```powershell
$env:PUBLIC_LOUNGE_INTERACTIONS_TEST_PUBLIC_ID = '<owner A 的測試作品>'
$env:PUBLIC_LOUNGE_INTERACTIONS_TEST_VERSION_ID = '<目前權威 version id>'
$env:PUBLIC_LOUNGE_INTERACTIONS_TEST_USER_A_ACCESS_TOKEN = '<owner A access token>'
$env:PUBLIC_LOUNGE_INTERACTIONS_TEST_USER_B_ACCESS_TOKEN = '<reader B access token>'
node scripts/run-public-lounge-interactions-rpc.mjs --required
```

這個測試會真的投票、建立一筆測試留言，再由 owner 軟刪並清回票數；不是 mock，也不應
對一般讀者作品執行。若另給 `PUBLIC_LOUNGE_INTERACTIONS_TEST_RETRACTED_PUBLIC_ID`，也會確認
已撤回作品的 summary RPC 拒絕存取。

目前自動部署只做安全的 Production runtime preparation，不會修改 Supabase Auth，也不會把
reader interactions 啟用：

```powershell
$env:PRODUCTION_MAIN_HEAD_CAS_REQUIRED = 'true'
$env:EXPECTED_MAIN_HEAD_COMMIT = '<exact remote main commit>'
$env:PUBLIC_LOUNGE_RUNTIME_PREPARATION_RECEIPT_PATH = '<runner temp>/public-lounge-runtime-preparation.json'
node scripts/prepare-public-lounge-runtime-production.mjs --required
```

workflow 從 GitHub Actions repository secrets 取得兩把固定 32-byte base64url key，並在每次
main 部署把同一值同步為 Vercel Production `sensitive` variables。GitHub secrets 是穩定 escrow；
因此 Vercel 的 write-only record 被重建時也不會輪替用來解開既有 management-token receipt 的
idempotency key。preparation 會先讀 Vercel Production env metadata，確保
`PUBLIC_LOUNGE_IDEMPOTENCY_ENCRYPTION_KEY` 與
`PUBLIC_LOUNGE_RATE_IDENTITY_HMAC_KEY` 各只有一筆、只屬於 Production 且型別為
`sensitive`，再明確寫入並回讀 `PUBLIC_LOUNGE_INTERACTIONS_ENABLED=0`。每一個外部 mutation
前都重驗 remote main head。sanitized receipt 不保存 secret 值或 hash，只能從 runner temp
上傳，不得放進 repository 或 `artifacts/`。

`activate-public-lounge-interactions-production.mjs --required` 目前刻意拒絕執行並回報
`PUBLIC_LOUNGE_MAGIC_LINK_PKCE_BROWSER_E2E_REQUIRED`。管理 API 建立且已確認 email 的臨時帳號
加 password grant，不能證明真實 magic-link 郵件送達與 `/auth/callback` PKCE 流程；也不能在
多個 workflow job 間提供可證明的 Auth/env transaction rollback。未補齊前不得自動啟用。

## Production 外部設定

以下仍是啟用前的外部待辦，不是本次 fail-closed 部署已完成事項：

1. Supabase Auth 啟用 email OTP，Site URL 設為正式 origin，Redirect URL 明確加入
   `https://<production-origin>/auth/callback`。不得使用萬用 redirect，並以真實收件信箱證明
   magic-link delivery 與 callback PKCE exchange。
2. 設定 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、server-only
   `SUPABASE_SERVICE_ROLE_KEY`，並確認 anon key 與 service-role key 不相同；兩把
   Public Lounge runtime key 由 GitHub Actions stable escrow 同步為 Vercel sensitive records，
   migration 028 durable quota control plane 也必須已套用。
3. 先套用並 check migration；正式啟用前保持：

   ```text
   PUBLIC_LOUNGE_INTERACTIONS_ENABLED=0
   PUBLIC_LOUNGE_INTERACTIONS_MIGRATION_VERSION=public_lounge_interactions_v1_027
   ```

4. 以兩個真實 Auth 帳號完成 magic link、同帳號不重複計票、第二帳號另計一票、取消、
   留言分頁、章節留言、重複檢舉、留言者刪除、作者刪除、overwrite 舊留言不曝光、retract 404。
5. 完成上述實測，且 activation 能以 resource-level ownership/CAS 安全補償 Auth 與 env mutation
   後，才可在另一次明確審核的變更中設定
   `PUBLIC_LOUNGE_INTERACTIONS_ACTIVATION_VERSION=public_lounge_interactions_runtime_v1` 與
   `PUBLIC_LOUNGE_INTERACTIONS_ENABLED=1`。

即使 activation env 已設定，health 與每個 interaction request 仍會即時呼叫 service-role-only
status RPC，並先經 server-secret HMAC IP identity 與 durable read quota；migration marker／RPC
不可達時仍回 HTTP 503。UA 或語言變更不會取得新 quota。health 的 `counts` 保持 `null`，不以
健康檢查偽造人氣。Production 憑證、Auth redirect、magic-link/PKCE 與雙帳號實測不在
repository 內；目前正式站預期 health 為 fail closed，必須完成上述外部證據後才可宣稱互動已啟用。
