import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PublicLoungeError } from "@/lib/novel-ai/public-lounge/contract";
import { getPublicLoungeServerService } from "@/lib/novel-ai/public-lounge/runtime.server";
import styles from "../lounge.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "公開作品｜小說交誼廳",
  description: "閱讀作者選擇公開的正式小說章節、全書大綱與品質評分。",
};

export default async function PublicLoungeDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  let post;
  try {
    post = await getPublicLoungeServerService().get(publicId);
  } catch (error) {
    if (error instanceof PublicLoungeError && error.code === "PUBLIC_LOUNGE_NOT_FOUND") notFound();
    return (
      <main className={styles.detailShell}>
        <Link className={styles.backLink} href="/lounge">← 回小說交誼廳</Link>
        <div className={styles.connectionNotice} role="status">
          <strong>公開書庫後端尚未連線</strong>
          <p>此頁沒有從作者本機資料建立替代內容。</p>
          <code>PUBLIC_LOUNGE_NOT_CONNECTED</code>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.detailShell}>
      <Link className={styles.backLink} href="/lounge">← 回小說交誼廳</Link>
      <article>
        <header className={styles.detailHeader}>
          <div>
            <div className={styles.badges}>
              <span>{post.category}</span>
              <span className={styles.completeBadge}>已完本</span>
            </div>
            <h1>{post.title}</h1>
            <p className={styles.detailByline}>
              作者署名：{post.authorByline}
              <span>作者自填・本系統未驗證真實身分</span>
            </p>
          </div>
          <div className={styles.detailScore}>
            <strong>{post.quality.totalScore}</strong>
            <span>全書品質總分</span>
            <small>公開門檻 {post.quality.threshold}</small>
          </div>
        </header>

        <dl className={styles.detailMetadata}>
          <div><dt>完結狀態</dt><dd>已完本</dd></div>
          <div><dt>全書章數</dt><dd>{post.chapterCount.toLocaleString("zh-TW")} 章</dd></div>
          <div><dt>全書字數</dt><dd>{post.wordCount.toLocaleString("zh-TW")} 字</dd></div>
          <div><dt>完成日期</dt><dd>{post.completedAt.slice(0, 10)}</dd></div>
          <div><dt>發布日期</dt><dd>{post.publishedAt.slice(0, 10)}</dd></div>
          <div><dt>公開正文</dt><dd>{post.publicChapters.length} 章</dd></div>
        </dl>

        <section className={styles.detailSection}>
          <p className={styles.eyebrow}>FULL SYNOPSIS</p>
          <h2>全書大綱</h2>
          <p className={styles.proseText}>{post.fullSynopsis}</p>
        </section>

        <section className={styles.detailSection}>
          <p className={styles.eyebrow}>QUALITY BREAKDOWN</p>
          <h2>品質分項</h2>
          <div className={styles.scoreGrid}>
            {post.quality.breakdown.map((item) => (
              <div key={item.key}>
                <span>{item.label}</span>
                <strong>{item.score}</strong>
                <small>權重 {item.weight}% ・ 加權 {item.weightedPoints}</small>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.chapterShelf}>
          <div className={styles.chapterShelfHeader}>
            <div>
              <p className={styles.eyebrow}>AUTHOR-SELECTED OFFICIAL TEXT</p>
              <h2>作者選擇公開的正式章節</h2>
            </div>
            <span>{post.publicChapters.length} 章</span>
          </div>
          {post.publicChapters.map((chapter) => (
            <article className={styles.chapter} key={chapter.chapterNumber}>
              <header>
                <span>第 {chapter.chapterNumber} 章</span>
                <h3>{chapter.title}</h3>
              </header>
              <p>{chapter.body}</p>
            </article>
          ))}
        </section>
      </article>
    </main>
  );
}
