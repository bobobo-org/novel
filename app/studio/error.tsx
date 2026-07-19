"use client";
import Link from "next/link";
export default function StudioError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="p2ProjectShell"><h1>創作中心暫時無法顯示</h1><p>已保存的內容不會因為這個畫面錯誤而被清除。你可以重新載入，或回到作品列表。</p><div><button onClick={reset}>重新載入</button><Link href="/studio">返回作品列表</Link></div><details><summary>查看技術詳細資料</summary><p>錯誤識別碼：STUDIO_RENDER_FAILED</p></details></main>; }
