# 諸天萬界小說生成系統

這個 repo 是「諸天萬界小說生成系統」的部署版專案。首頁使用 Next.js，完整離線平台版放在 `public/legacy/novel-system.html`，可直接由網站入口開啟。

## 目前版本

- 版本：v5.9.1 閉端 AI 多章批量操作章節號修正版
- 入口：`/legacy/novel-system.html`
- 已合併功能：Explore、快速創作、互動故事、ChatGPT 接力、小型閉端 AI、章節草稿生成、草稿迭代、長程一致性守護、版本分支、多章批量操作

## 本地開發

```bash
npm install
npm run dev
```

開啟 `http://localhost:3000`，再點「開啟 v5.9.1 完整系統」。

## 建置檢查

```bash
npm run build
```

每次修改後建議先跑建置，再 commit 到 `main`。

## 部署

`.github/workflows/deploy.yml` 會在 push 到 `main` 時執行 Vercel 部署。GitHub repository secrets 需要設定：

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

若之後要接 Supabase 管理流程，可另外設定：

- `SUPABASE_ACCESS_TOKEN`

請不要把任何 token、API key、密碼或 service role key commit 進 repo。若密鑰曾經貼在聊天或公開地方，建議到 Vercel / Supabase 後台重新產生並撤銷舊密鑰。

## 維護流程

1. 在本地修改功能。
2. 執行 `npm run build`。
3. `git add`、`git commit`。
4. push 到 `main`。
5. GitHub Actions 自動部署到 Vercel。
