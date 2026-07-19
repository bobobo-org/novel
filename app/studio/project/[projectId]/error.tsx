"use client";

import Link from "next/link";

export default function ProjectError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="p2ProjectShell"><h1>作品載入發生問題</h1><p>原有作品資料沒有被修改。請重新載入，或返回作品列表。</p><div><button onClick={reset}>重新載入</button><Link href="/studio">返回作品列表</Link></div><details><summary>查看技術詳細資料</summary><p>錯誤識別碼：PROJECT_RENDER_FAILED</p></details></main>;
}
