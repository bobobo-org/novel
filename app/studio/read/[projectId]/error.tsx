"use client";

import Link from "next/link";

export default function ReaderError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="p2ProjectShell"><h1>閱讀內容暫時無法載入</h1><p>閱讀位置與作品正文沒有被修改。你可以重新載入，或先回到創作中心。</p><div><button onClick={reset}>重新載入</button><Link href="/studio">返回創作中心</Link></div><details><summary>查看技術詳細資料</summary><p>錯誤識別碼：READER_RENDER_FAILED</p></details></main>;
}
