"use client";

import { useEffect, useState } from "react";
import {
  getPublicLoungePost,
  PublicLoungeClientError,
} from "@/lib/novel-ai/public-lounge/client";
import type { PublicLoungePost, PublicLoungeQualityAssurance } from "@/lib/novel-ai/public-lounge/types";
import { publicLoungeTopicDisplayNames } from "@/lib/novel-ai/public-lounge/taxonomy";
import { ReaderInteractions } from "./reader-interactions";
import styles from "../lounge.module.css";

type DetailState =
  | { status: "loading" }
  | { status: "ready"; post: PublicLoungePost }
  | { status: "error"; code: string };

function qualityAssuranceLabel(value: PublicLoungeQualityAssurance) {
  return value === "private_ai_hub_verified"
    ? "Private AI Hub 已簽章驗證"
    : "作者裝置閉端 AI 評分，平台未簽章驗證";
}

function detailErrorCopy(code: string) {
  if (code === "PUBLIC_LOUNGE_NOT_FOUND") {
    return {
      title: "找不到這個公開作品",
      body: "作品可能已由作者撤回，或網址並非目前有效的公開版本。",
    };
  }
  if (code === "PUBLIC_LOUNGE_RATE_LIMITED") {
    return {
      title: "讀取次數暫時過多",
      body: "公開書庫正在保護讀取額度，請稍候再試；不會顯示快取或虛構的章節內容。",
    };
  }
  return {
    title: "目前無法讀取這部作品",
    body: "此頁沒有從作者本機資料或示範資料建立替代內容。服務恢復後才會呈現正式公開版本。",
  };
}

export function LoungeDetailClient({ publicId }: { publicId: string }) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void getPublicLoungePost(publicId)
      .then((post) => {
        if (active) setState({ status: "ready", post });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          code: cause instanceof PublicLoungeClientError
            ? cause.code
            : "PUBLIC_LOUNGE_NOT_CONNECTED",
        });
      });
    return () => {
      active = false;
    };
  }, [publicId, requestVersion]);

  if (state.status === "loading") {
    return (
      <div className={styles.loadingState} role="status" aria-live="polite">
        <strong>正在讀取正式公開版本</strong>
        <span>章節會經由公開 API 與讀取額度檢查，不會由作者本機資料補入。</span>
      </div>
    );
  }

  if (state.status === "error") {
    const copy = detailErrorCopy(state.code);
    return (
      <div className={styles.connectionNotice} role="status">
        <strong>{copy.title}</strong>
        <p>{copy.body}</p>
        <code>{state.code}</code>
        <button
          className={styles.noticeAction}
          onClick={() => {
            setState({ status: "loading" });
            setRequestVersion((value) => value + 1);
          }}
          type="button"
        >
          重新讀取
        </button>
      </div>
    );
  }

  const { post } = state;
  return (
    <article>
      <header className={styles.detailHeader}>
        <div>
          <div className={styles.badges}>
            {publicLoungeTopicDisplayNames(post.topicIds).map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
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
          <small>{qualityAssuranceLabel(post.qualityAssurance)}</small>
        </div>
      </header>

      <dl className={styles.detailMetadata}>
        <div><dt>完結狀態</dt><dd>已完本</dd></div>
        <div><dt>全書章數</dt><dd>{post.chapterCount.toLocaleString("zh-TW")} 章</dd></div>
        <div><dt>全書字數</dt><dd>{post.wordCount.toLocaleString("zh-TW")} 字</dd></div>
        <div><dt>完成日期</dt><dd>{post.completedAt.slice(0, 10)}</dd></div>
        <div><dt>發布日期</dt><dd>{post.publishedAt.slice(0, 10)}</dd></div>
        <div><dt>目前公開版本</dt><dd>第 {post.versionNumber} 版</dd></div>
        <div><dt>版本識別碼</dt><dd>{post.versionId}</dd></div>
        <div><dt>版本發布日期</dt><dd>{post.versionPublishedAt.slice(0, 10)}</dd></div>
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
      <ReaderInteractions
        publicId={post.publicId}
        title={post.title}
        chapterCount={post.chapterCount}
      />
    </article>
  );
}
