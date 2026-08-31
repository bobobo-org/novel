"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import {
  getPublicLoungeBrowserAuthClient,
  getPublicLoungeSession,
  PublicLoungeAuthError,
  sendPublicLoungeMagicLink,
  signOutPublicLoungeUser,
} from "@/lib/novel-ai/public-lounge/auth-browser";
import {
  addPublicLoungeComment,
  deletePublicLoungeComment,
  PublicLoungeInteractionClientError,
  readPublicLoungeInteractions,
  reportPublicLoungeContent,
  setPublicLoungeVote,
} from "@/lib/novel-ai/public-lounge/interactions-client";
import type {
  PublicLoungeInteractionSnapshot,
  PublicLoungeReportReasonCode,
} from "@/lib/novel-ai/public-lounge/interactions";
import styles from "../lounge.module.css";

const LOCAL_BOOKMARKS_KEY = "novel:public-lounge:local-bookmarks:v1";
const LOCAL_BOOKMARKS_CHANGED_EVENT = "novel:public-lounge:local-bookmarks-changed";

type LocalBookmarks = Record<string, { title: string; savedAt: string }>;

const REPORT_REASONS: Array<{ value: PublicLoungeReportReasonCode; label: string }> = [
  { value: "spam", label: "垃圾內容" },
  { value: "harassment", label: "騷擾" },
  { value: "hate", label: "仇恨內容" },
  { value: "sexual_content", label: "不當性內容" },
  { value: "violence", label: "不當暴力內容" },
  { value: "copyright", label: "著作權疑慮" },
  { value: "privacy", label: "隱私疑慮" },
  { value: "impersonation", label: "冒用身分" },
  { value: "other", label: "其他" },
];

function readBookmarks(): LocalBookmarks {
  const raw = window.localStorage.getItem(LOCAL_BOOKMARKS_KEY);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
    .filter((entry): entry is [string, { title: string; savedAt: string }] => {
      const [, value] = entry;
      return Boolean(
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && typeof (value as Record<string, unknown>).title === "string"
        && typeof (value as Record<string, unknown>).savedAt === "string",
      );
    }));
}

function subscribeToBookmarks(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(LOCAL_BOOKMARKS_CHANGED_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(LOCAL_BOOKMARKS_CHANGED_EVENT, onStoreChange);
  };
}

function bookmarkSnapshot(publicId: string) {
  try {
    return Boolean(readBookmarks()[publicId]);
  } catch {
    return false;
  }
}

function actionMessage(error: unknown) {
  if (error instanceof PublicLoungeAuthError) {
    return error.code === "PUBLIC_LOUNGE_AUTH_REQUIRED"
      ? "請先以電子郵件登入。"
      : "登入服務目前無法使用，請稍後再試。";
  }
  if (error instanceof PublicLoungeInteractionClientError) {
    if (error.status === 401) return "登入已失效，請重新登入。";
    if (error.status === 429) return "操作太頻繁，請稍後再試。";
    if (error.status === 409) return "這筆檢舉已送出，無需重複提交。";
    if (error.status === 404) return "作品或留言已撤回，互動未送出。";
  }
  return "互動服務目前無法完成這項操作；沒有寫入假資料。";
}

export function ReaderInteractions({
  publicId,
  title,
  chapterCount,
}: {
  publicId: string;
  title: string;
  chapterCount: number;
}) {
  const bookmarked = useSyncExternalStore(
    subscribeToBookmarks,
    () => bookmarkSnapshot(publicId),
    () => false,
  );
  const [snapshot, setSnapshot] = useState<PublicLoungeInteractionSnapshot | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [commentChapter, setCommentChapter] = useState("");
  const [reportTarget, setReportTarget] = useState<string | null | undefined>(undefined);
  const [reportReason, setReportReason] = useState<PublicLoungeReportReasonCode>("other");
  const [reportDetails, setReportDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("正在讀取已驗證的推薦與留言……");
  const refreshSequence = useRef(0);

  const refresh = useCallback(async (cursor?: string | null) => {
    const sequence = ++refreshSequence.current;
    try {
      const next = await readPublicLoungeInteractions({ publicId, cursor, limit: 20 });
      if (sequence !== refreshSequence.current) return;
      setSnapshot((current) => cursor && current
        ? { ...next, comments: [...current.comments, ...next.comments] }
        : next);
      setLoadState("ready");
      setStatus("互動資料已由伺服器確認。收藏仍只保存在本機。");
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      if (!cursor) setSnapshot(null);
      setLoadState("unavailable");
      setStatus(actionMessage(error));
    }
  }, [publicId]);

  useEffect(() => {
    let active = true;
    const initialRefresh = window.setTimeout(() => {
      if (active) void refresh();
    }, 0);
    try {
      const auth = getPublicLoungeBrowserAuthClient();
      void getPublicLoungeSession().then((session) => {
        if (active) {
          setUser(session?.user ?? null);
        }
      }).catch(() => {
        if (active) setUser(null);
      });
      const { data } = auth.auth.onAuthStateChange((event, session) => {
        if (!active) return;
        setUser(session?.user ?? null);
        if (event === "INITIAL_SESSION") return;
        window.setTimeout(() => {
          if (active) void refresh();
        }, 0);
      });
      return () => {
        active = false;
        window.clearTimeout(initialRefresh);
        data.subscription.unsubscribe();
      };
    } catch {
      return () => {
        active = false;
        window.clearTimeout(initialRefresh);
      };
    }
  }, [refresh]);

  function toggleBookmark() {
    try {
      const bookmarks = readBookmarks();
      if (bookmarks[publicId]) {
        delete bookmarks[publicId];
      } else {
        bookmarks[publicId] = { title, savedAt: new Date().toISOString() };
      }
      window.localStorage.setItem(LOCAL_BOOKMARKS_KEY, JSON.stringify(bookmarks));
      window.dispatchEvent(new Event(LOCAL_BOOKMARKS_CHANGED_EVENT));
      setStatus(bookmarks[publicId]
        ? "已收藏在這台裝置；沒有上傳讀者身分或瀏覽紀錄。"
        : "已從這台裝置的收藏移除。");
    } catch {
      setStatus("本機收藏失敗；瀏覽器可能封鎖或已用完儲存空間。");
    }
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setStatus(actionMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendMagicLink() {
    if (loadState !== "ready" || authenticated) return;
    await run(async () => {
      await sendPublicLoungeMagicLink(email, window.location.pathname);
      setStatus("登入連結已寄出。請在同一個瀏覽器完成登入。");
    });
  }

  async function toggleVote() {
    if (!snapshot || loadState !== "ready" || !authenticated) return;
    await run(async () => {
      await setPublicLoungeVote(publicId, !snapshot.selected);
      await refresh();
    });
  }

  async function submitComment() {
    if (!authenticated) return;
    await run(async () => {
      const chapterNumber = commentChapter ? Number(commentChapter) : null;
      await addPublicLoungeComment({ publicId, chapterNumber, displayName, body: commentBody });
      setCommentBody("");
      await refresh();
      setStatus("留言已送出並由伺服器保存。");
    });
  }

  async function removeComment(commentId: string) {
    const reason = window.prompt("請輸入刪除原因（至少 2 個字）", "由本人刪除");
    if (!reason) return;
    await run(async () => {
      await deletePublicLoungeComment({ publicId, commentId, reason });
      await refresh();
      setStatus("留言已刪除，稽核紀錄已保存。");
    });
  }

  async function submitReport() {
    if (!authenticated || reportTarget === undefined) return;
    await run(async () => {
      await reportPublicLoungeContent({
        publicId,
        targetCommentId: reportTarget,
        reasonCode: reportReason,
        details: reportDetails,
      });
      setReportTarget(undefined);
      setReportDetails("");
      setStatus("檢舉已送交審核；不會公開顯示檢舉者身分。");
    });
  }

  const authenticated = loadState === "ready" && Boolean(user && snapshot?.authenticated);

  return (
    <section
      className={styles.interactionPanel}
      aria-labelledby="reader-interactions-heading"
      data-interaction-state={loadState}
    >
      <div className={styles.interactionHeader}>
        <div>
          <p className={styles.eyebrow}>READER INTERACTIONS</p>
          <h2 id="reader-interactions-heading">讀者互動</h2>
        </div>
        <p className={styles.interactionBoundary}>
          推薦、留言與檢舉都以 Supabase 登入身分送出；伺服器會逐次驗證 session，
          不接受瀏覽器提供的 userId。服務未接通時不顯示虛構數字。
        </p>
      </div>
      <div className={styles.interactionActions}>
        <button
          type="button"
          className={styles.localBookmarkButton}
          aria-pressed={bookmarked}
          onClick={toggleBookmark}
        >
          {bookmarked ? "已收藏在本機" : "收藏到本機"}
        </button>
        {loadState === "ready" && snapshot ? (
          <button
            type="button"
            className={styles.serverInteractionButton}
            aria-pressed={snapshot.selected}
            data-like-count={snapshot.voteCount}
            disabled={!authenticated || busy}
            onClick={() => void toggleVote()}
          >
            {snapshot.selected ? "取消推薦" : "推薦作品"}｜{snapshot.voteCount.toLocaleString("zh-TW")}
          </button>
        ) : null}
        {authenticated ? (
          <button
            type="button"
            className={styles.secondaryInteractionButton}
            disabled={busy}
            onClick={() => setReportTarget(null)}
          >
            檢舉作品
          </button>
        ) : null}
        {loadState === "unavailable" ? (
          <>
            <button type="button" className={styles.serverInteractionButton} disabled>
              推薦｜等待登入服務
            </button>
            <button type="button" className={styles.secondaryInteractionButton} disabled>
              留言｜等待登入服務
            </button>
            <button type="button" className={styles.secondaryInteractionButton} disabled>
              檢舉｜等待審核服務
            </button>
          </>
        ) : null}
      </div>

      {loadState === "ready" && !authenticated ? (
        <form
          className={styles.interactionLogin}
          onSubmit={(event) => {
            event.preventDefault();
            void sendMagicLink();
          }}
        >
          <label htmlFor="public-lounge-login-email">以電子郵件登入後推薦、留言或檢舉</label>
          <div>
            <input
              id="public-lounge-login-email"
              type="email"
              autoComplete="email"
              required
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button type="submit" disabled={busy || loadState !== "ready"}>寄送登入連結</button>
          </div>
        </form>
      ) : authenticated && user ? (
        <div className={styles.interactionIdentity}>
          <span>已登入{user.email ? `：${user.email}` : ""}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => {
              await signOutPublicLoungeUser();
              setUser(null);
              await refresh();
            })}
          >
            登出
          </button>
        </div>
      ) : null}

      {authenticated ? (
        <form
          className={styles.commentComposer}
          onSubmit={(event) => {
            event.preventDefault();
            void submitComment();
          }}
        >
          <h3>留下已登入留言</h3>
          <div className={styles.commentComposerGrid}>
            <label>
              顯示名稱
              <input
                required
                minLength={1}
                maxLength={48}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              對應章節（可留空）
              <input
                type="number"
                min={1}
                max={chapterCount}
                value={commentChapter}
                onChange={(event) => setCommentChapter(event.target.value)}
              />
            </label>
          </div>
          <label>
            留言
            <textarea
              required
              minLength={1}
              maxLength={1200}
              rows={4}
              value={commentBody}
              onChange={(event) => setCommentBody(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>送出留言</button>
        </form>
      ) : null}

      {authenticated && reportTarget !== undefined ? (
        <form
          className={styles.reportComposer}
          onSubmit={(event) => {
            event.preventDefault();
            void submitReport();
          }}
        >
          <h3>{reportTarget ? "檢舉留言" : "檢舉作品"}</h3>
          <label>
            原因
            <select
              value={reportReason}
              onChange={(event) => setReportReason(event.target.value as PublicLoungeReportReasonCode)}
            >
              {REPORT_REASONS.map((reason) => (
                <option key={reason.value} value={reason.value}>{reason.label}</option>
              ))}
            </select>
          </label>
          <label>
            補充說明（選填）
            <textarea
              maxLength={800}
              rows={3}
              value={reportDetails}
              onChange={(event) => setReportDetails(event.target.value)}
            />
          </label>
          <div>
            <button type="submit" disabled={busy}>送出檢舉</button>
            <button type="button" disabled={busy} onClick={() => setReportTarget(undefined)}>取消</button>
          </div>
        </form>
      ) : null}

      {loadState === "ready" && snapshot ? (
        <div className={styles.commentList}>
          <h3 data-comment-count={snapshot.commentCount}>
            公開留言｜{snapshot.commentCount.toLocaleString("zh-TW")}
          </h3>
          {snapshot.comments.length === 0 ? <p>目前沒有留言。</p> : snapshot.comments.map((comment) => (
            <article key={comment.id} className={styles.commentCard}>
              <header>
                <strong>{comment.displayName}</strong>
                <span>{comment.chapterNumber ? `第 ${comment.chapterNumber} 章` : "全書"}</span>
                <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString("zh-TW")}</time>
              </header>
              <p>{comment.body}</p>
              {authenticated ? (
                <footer>
                  {comment.canDelete ? (
                    <button type="button" disabled={busy} onClick={() => void removeComment(comment.id)}>刪除</button>
                  ) : null}
                  <button type="button" disabled={busy} onClick={() => setReportTarget(comment.id)}>檢舉</button>
                </footer>
              ) : null}
            </article>
          ))}
          {snapshot.nextCursor ? (
            <button
              type="button"
              className={styles.loadMoreComments}
              disabled={busy}
              onClick={() => void run(() => refresh(snapshot.nextCursor))}
            >
              載入更多留言
            </button>
          ) : null}
        </div>
      ) : loadState === "loading" ? (
        <p className={styles.interactionPending}>正在讀取互動資料……</p>
      ) : null}
      <p className={styles.interactionStatus} role="status" aria-live="polite">{status}</p>
    </section>
  );
}
