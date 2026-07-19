"use client";

import Link from "next/link";

export default function WriterError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="p2ProjectShell"><h1>寫作區暫時無法載入</h1><p>這個畫面錯誤不會覆寫作品內容；請重新載入後確認草稿。</p><div><button onClick={reset}>重新載入</button><Link href="/studio">返回作品列表</Link></div><details><summary>查看技術詳細資料</summary><p>錯誤識別碼：WRITER_RENDER_FAILED</p></details></main>;
}
