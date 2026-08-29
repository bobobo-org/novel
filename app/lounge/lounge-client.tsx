"use client";

import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import {
  listPublicLoungePosts,
  PublicLoungeClientError,
} from "@/lib/novel-ai/public-lounge/client";
import type { PublicLoungeListPage } from "@/lib/novel-ai/public-lounge/types";
import styles from "./lounge.module.css";

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-TW").format(value);
}

export default function LoungeClient({
  initialPage,
  connectionError,
}: {
  initialPage: PublicLoungeListPage;
  connectionError: string | null;
}) {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [category, setCategory] = useState("全部分類");
  const [completedOnly, setCompletedOnly] = useState(true);
  const [items, setItems] = useState(initialPage.items);
  const [categories, setCategories] = useState(initialPage.categories);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [totalCount, setTotalCount] = useState(initialPage.totalCount);
  const [error, setError] = useState(connectionError);
  const [loading, setLoading] = useState(false);
  const requestSequence = useRef(0);

  const runQuery = async (options: {
    query: string;
    category: string;
    completedOnly: boolean;
    cursor?: string;
    append?: boolean;
  }) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setLoading(true);
    setError(null);
    try {
      const page = await listPublicLoungePosts({
        search: options.query,
        category: options.category === "全部分類" ? undefined : options.category,
        completedOnly: options.completedOnly,
        cursor: options.cursor,
        limit: 24,
      });
      if (requestSequence.current !== sequence) return;
      setItems((current) => options.append
        ? [...new Map([...current, ...page.items].map((item) => [item.publicId, item])).values()]
        : page.items);
      setCategories(page.categories);
      setNextCursor(page.nextCursor);
      setTotalCount(page.totalCount);
    } catch (cause) {
      if (requestSequence.current !== sequence) return;
      setError(cause instanceof PublicLoungeClientError
        ? cause.code
        : "PUBLIC_LOUNGE_NOT_CONNECTED");
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = queryInput.trim();
    setActiveQuery(nextQuery);
    void runQuery({ query: nextQuery, category, completedOnly });
  };

  const selectCategory = (nextCategory: string) => {
    setCategory(nextCategory);
    void runQuery({ query: activeQuery, category: nextCategory, completedOnly });
  };

  const toggleCompleted = (nextCompletedOnly: boolean) => {
    setCompletedOnly(nextCompletedOnly);
    void runQuery({ query: activeQuery, category, completedOnly: nextCompletedOnly });
  };

  return (
    <section className={styles.library} aria-labelledby="lounge-library-title">
      <form className={styles.searchPanel} onSubmit={submitSearch}>
        <div className={styles.searchField}>
          <label htmlFor="lounge-search">搜尋公開作品</label>
          <input
            id="lounge-search"
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="輸入書名、作者署名、分類或大綱關鍵字"
            type="search"
            value={queryInput}
          />
        </div>
        <button className={styles.searchButton} disabled={loading} type="submit">
          {loading ? "搜尋中…" : "搜尋"}
        </button>
        <label className={styles.completeToggle}>
          <input
            checked={completedOnly}
            onChange={(event) => toggleCompleted(event.target.checked)}
            type="checkbox"
          />
          只看完本
        </label>
      </form>

      <div className={styles.categoryRail} aria-label="小說分類">
        {["全部分類", ...categories].map((item) => (
          <button
            aria-pressed={category === item}
            className={category === item ? styles.categoryActive : undefined}
            key={item}
            onClick={() => selectCategory(item)}
            type="button"
          >
            {item}
          </button>
        ))}
      </div>

      <div className={styles.libraryHeading}>
        <div>
          <p className={styles.eyebrow}>COMPLETED SELECTION</p>
          <h2 id="lounge-library-title">公開完本書庫</h2>
        </div>
        <span>已顯示 {items.length} / {totalCount} 部作品</span>
      </div>

      {error ? (
        <div className={styles.connectionNotice} role="status">
          <strong>公開書庫後端尚未連線</strong>
          <p>
            目前沒有以本機資料假裝公開內容。部署端完成私有 Storage bucket 設定後，作品才會在此顯示。
          </p>
          <code>{error}</code>
        </div>
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>{totalCount === 0 && !activeQuery && category === "全部分類" ? "尚無作者公開作品" : "找不到符合條件的作品"}</strong>
          <span>你可以更換分類或搜尋詞，再看看其他已完稿小說。</span>
        </div>
      ) : null}

      <div className={styles.bookGrid}>
        {items.map((item) => (
          <article className={styles.bookCard} key={item.publicId}>
            <div className={styles.bookScore}>
              <strong>{item.quality.totalScore}</strong>
              <span>品質總分</span>
            </div>
            <div className={styles.bookBody}>
              <div className={styles.badges}>
                <span>{item.category}</span>
                <span className={styles.completeBadge}>已完本</span>
              </div>
              <h3>
                <Link href={`/lounge/${encodeURIComponent(item.publicId)}`}>{item.title}</Link>
              </h3>
              <p className={styles.byline}>
                {item.authorByline}
                <small>作者自填・未驗證身分</small>
              </p>
              <p className={styles.synopsis}>{item.synopsisExcerpt}</p>
              <dl className={styles.metadataGrid}>
                <div><dt>全書章數</dt><dd>{formatCount(item.chapterCount)} 章</dd></div>
                <div><dt>全書字數</dt><dd>{formatCount(item.wordCount)} 字</dd></div>
                <div><dt>公開正文</dt><dd>{formatCount(item.publicChapterCount)} 章</dd></div>
                <div><dt>發布日期</dt><dd>{item.publishedAt.slice(0, 10)}</dd></div>
              </dl>
              <Link className={styles.readLink} href={`/lounge/${encodeURIComponent(item.publicId)}`}>
                閱讀作品與評分 <span aria-hidden="true">→</span>
              </Link>
            </div>
          </article>
        ))}
      </div>
      {!error && nextCursor ? (
        <div className={styles.loadMoreRow}>
          <button
            className={styles.loadMoreButton}
            disabled={loading}
            onClick={() => void runQuery({
              query: activeQuery,
              category,
              completedOnly,
              cursor: nextCursor,
              append: true,
            })}
            type="button"
          >
            {loading ? "載入中…" : "載入更多作品"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
