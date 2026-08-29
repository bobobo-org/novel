import type { Metadata } from "next";
import Link from "next/link";
import { PublicLoungeError } from "@/lib/novel-ai/public-lounge/contract";
import { getPublicLoungeServerService } from "@/lib/novel-ai/public-lounge/runtime.server";
import type { PublicLoungeListPage } from "@/lib/novel-ai/public-lounge/types";
import LoungeClient from "./lounge-client";
import styles from "./lounge.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "小說交誼廳｜諸天萬界",
  description: "閱讀作者明確選擇公開、已完稿且品質評分達標的正式小說作品。",
};

export default async function PublicLoungePage() {
  let connectionError: string | null = null;
  let initialPage: PublicLoungeListPage = {
    items: [],
    nextCursor: null,
    totalCount: 0,
    categories: [],
  };
  try {
    initialPage = await getPublicLoungeServerService().list({ completedOnly: true, limit: 24 });
  } catch (error) {
    connectionError = error instanceof PublicLoungeError
      ? error.code
      : "PUBLIC_LOUNGE_NOT_CONNECTED";
  }

  return (
    <main className={styles.pageShell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark}>諸</span>
          <span>
            <strong>諸天萬界</strong>
            <small>小說交誼廳</small>
          </span>
        </Link>
        <nav className={styles.topnav} aria-label="交誼廳導覽">
          <Link href="/">回首頁</Link>
          <Link href="/professional">專業作者工具</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>PUBLIC FICTION LOUNGE</p>
          <h1>讀完一個世界，再遇見下一位作者</h1>
          <p>
            這裡只陳列作者主動同意公開、聲明擁有發布權利、已完稿，且全書品質總分達 80 分以上的作品。
          </p>
        </div>
        <aside className={styles.heroRule}>
          <strong>公開邊界</strong>
          <span>作者自行填寫署名，本系統目前不驗證真實身分。</span>
          <span>私人 Canon、提示詞、模型紀錄與備份永不公開。</span>
        </aside>
      </section>

      <LoungeClient initialPage={initialPage} connectionError={connectionError} />
    </main>
  );
}
