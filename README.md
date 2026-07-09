# 諸天萬界小說生成系統

這個 repo 已升級為 Next.js + Supabase + OpenAI 的互動小說生成系統。使用者登入後可以建立作品、用 AI 生成章節、選 A/B/C 或自訂路線續寫，並把作品保存到 Supabase。

## 目前內容

- `src/app`：Next.js app、登入頁與 API routes。
- `src/components/story/story-workspace.tsx`：手機優先的故事建立/生成工作台。
- `src/lib/story-data.ts`：從原 HTML 抽出的 16 類離線題材庫。
- `src/lib/ai`：prompt、解析與 quota 邏輯。
- `src/lib/supabase`：browser/server/admin Supabase clients。
- `supabase/migrations`：故事、章節、記憶與 generation events schema。
- `index.html`：舊靜態部署入口，Next.js 部署後不再作為主入口。
- `諸天萬界小說生成系統_v4精簡可用離線故事資料庫版_v2完成版/諸天萬界小說生成系統_v4豪華版_主題相容ChatGPT接力版.html`：舊版離線 app，保留作為素材來源。
- `諸天萬界小說生成系統_v4精簡可用離線故事資料庫版_v2完成版/使用說明_README.txt`：原始使用說明。
- `諸天萬界小說生成系統_v4精簡可用離線故事資料庫版_v2完成版/點我開啟.bat`：Windows 本機開啟用批次檔。

## 技術狀態

- Next.js app router。
- Supabase Auth + Postgres + RLS。
- Vercel API route `/api/generate` 呼叫 OpenAI Responses API。
- 手機優先 RWD：單欄表單、底部固定操作列、大型觸控按鈕、手機 E2E overflow 測試。

## 環境變數

參考 `.env.example`：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

不要把 `OPENAI_API_KEY` 或 `SUPABASE_SERVICE_ROLE_KEY` 放進前端、README 範例值或 Git。

## 本機開發

```bash
npm install
npm run dev
```

驗證：

```bash
npm run lint
npm test
npm run e2e
npm run build
```

## Vercel

Vercel project 需設定上述環境變數。若缺少 Supabase public env，首頁會顯示 setup guidance，而不會嘗試登入或生成。
