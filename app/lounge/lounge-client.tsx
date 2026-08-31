"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  listPublicLoungePosts,
  PublicLoungeClientError,
} from "@/lib/novel-ai/public-lounge/client";
import {
  listPublicLoungeShelves,
  publicLoungeShelfDisplayName,
  publicLoungeTopicDisplayNames,
} from "@/lib/novel-ai/public-lounge/taxonomy";
import type { PublicLoungeQualityAssurance } from "@/lib/novel-ai/public-lounge/types";
import styles from "./lounge.module.css";

function formatCount(value: number) {
  return new Intl.NumberFormat("zh-TW").format(value);
}

const INITIAL_SHELVES = listPublicLoungeShelves();

function qualityAssuranceLabel(value: PublicLoungeQualityAssurance) {
  return value === "private_ai_hub_verified"
    ? "Private AI Hub 已簽章驗證"
    : "作者裝置閉端 AI 評分，平台未簽章驗證";
}

function publicReadErrorCopy(code: string) {
  if (code === "PUBLIC_LOUNGE_RATE_LIMITED") {
    return {
      title: "讀取次數暫時過多",
      body: "公開書庫正在保護讀取額度，請稍候再試。畫面不會用快取或本機資料冒充最新公開內容。",
    };
  }
  return {
    title: "目前無法讀取公開書庫",
    body: "沒有以作者本機資料或示範數字建立替代內容。請稍後重試；服務恢復後才會顯示正式公開作品。",
  };
}

export default function LoungeClient() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [shelfId, setShelfId] = useState("all");
  const [completedOnly, setCompletedOnly] = useState(true);
  const [items, setItems] = useState<Awaited<ReturnType<typeof listPublicLoungePosts>>["items"]>([]);
  const [shelves, setShelves] = useState(INITIAL_SHELVES);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    void listPublicLoungePosts({ completedOnly: true, limit: 24 })
      .then((page) => {
        if (requestSequence.current !== sequence) return;
        setItems(page.items);
        setShelves(page.shelves);
        setNextCursor(page.nextCursor);
        setTotalCount(page.totalCount);
      })
      .catch((cause: unknown) => {
        if (requestSequence.current !== sequence) return;
        setError(cause instanceof PublicLoungeClientError
          ? cause.code
          : "PUBLIC_LOUNGE_NOT_CONNECTED");
      })
      .finally(() => {
        if (requestSequence.current === sequence) setLoading(false);
      });
    return () => {
      if (requestSequence.current === sequence) requestSequence.current += 1;
    };
  }, []);

  const runQuery = async (options: {
    query: string;
    shelfId: string;
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
        shelfId: options.shelfId === "all" ? undefined : options.shelfId,
        completedOnly: options.completedOnly,
        cursor: options.cursor,
        limit: 24,
      });
      if (requestSequence.current !== sequence) return;
      setItems((current) => options.append
        ? [...new Map([...current, ...page.items].map((item) => [item.publicId, item])).values()]
        : page.items);
      setShelves(page.shelves);
      setNextCursor(page.nextCursor);
      setTotalCount(page.totalCount);
    } catch (cause) {
      if (requestSequence.current !== sequence) return;
      // A failed query must not leave results from a different search or shelf
      // visible beneath the error notice. That would look like a successful,
      // current response even though the API failed closed.
      setItems([]);
      setNextCursor(null);
      setTotalCount(0);
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
    void runQuery({ query: nextQuery, shelfId, completedOnly });
  };

  const selectShelf = (nextShelfId: string) => {
    setShelfId(nextShelfId);
    void runQuery({ query: activeQuery, shelfId: nextShelfId, completedOnly });
  };

  const toggleCompleted = (nextCompletedOnly: boolean) => {
    setCompletedOnly(nextCompletedOnly);
    void runQuery({ query: activeQuery, shelfId, completedOnly: nextCompletedOnly });
  };

  const retryCurrentQuery = () => {
    void runQuery({ query: activeQuery, shelfId, completedOnly });
  };

  const errorCopy = error ? publicReadErrorCopy(error) : null;

  return (
    <section className={styles.library} aria-labelledby="lounge-library-title">
      <form className={styles.searchPanel} onSubmit={submitSearch}>
        <div className={styles.searchField}>
          <label htmlFor="lounge-search">搜尋公開作品</label>
          <input
            id="lounge-search"
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="輸入書名、作者署名、題材或大綱關鍵字"
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

      <div className={styles.categoryRail} aria-label="八大小說書架">
        {[{ shelfId: "all", name: "全部書架" }, ...shelves].map((item) => (
          <button
            aria-pressed={shelfId === item.shelfId}
            className={shelfId === item.shelfId ? styles.categoryActive : undefined}
            key={item.shelfId}
            onClick={() => selectShelf(item.shelfId)}
            type="button"
          >
            {item.name}
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

      {loading && items.length === 0 && !error ? (
        <div className={styles.loadingState} role="status" aria-live="polite">
          <strong>正在讀取正式公開書庫</strong>
          <span>資料會經由公開 API 與讀取額度檢查，不會從作者本機資料補畫面。</span>
        </div>
      ) : null}

      {error && errorCopy ? (
        <div className={styles.connectionNotice} role="status">
          <strong>{errorCopy.title}</strong>
          <p>{errorCopy.body}</p>
          <code>{error}</code>
          <button className={styles.noticeAction} disabled={loading} onClick={retryCurrentQuery} type="button">
            {loading ? "重新讀取中…" : "重新讀取"}
          </button>
        </div>
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <div className={styles.emptyState}>
          <strong>{totalCount === 0 && !activeQuery && shelfId === "all" ? "尚無作者公開作品" : "找不到符合條件的作品"}</strong>
          <span>你可以更換書架或搜尋詞，再看看其他已完稿小說。</span>
        </div>
      ) : null}

      <div className={styles.bookGrid}>
        {items.map((item) => (
          <article className={styles.bookCard} key={item.publicId}>
            <div className={styles.bookScore}>
              <strong>{item.quality.totalScore}</strong>
              <span>品質總分</span>
              <small>{qualityAssuranceLabel(item.qualityAssurance)}</small>
            </div>
            <div className={styles.bookBody}>
              <div className={styles.badges}>
                <span>書架：{publicLoungeShelfDisplayName(item.shelfId)}</span>
                {publicLoungeTopicDisplayNames(item.topicIds).map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
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
                <div><dt>完稿日期</dt><dd>{item.completedAt.slice(0, 10)}</dd></div>
                <div><dt>發布日期</dt><dd>{item.publishedAt.slice(0, 10)}</dd></div>
                <div><dt>目前公開版本</dt><dd>第 {item.versionNumber} 版</dd></div>
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
              shelfId,
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
