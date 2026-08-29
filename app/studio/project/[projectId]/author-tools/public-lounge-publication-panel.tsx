"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  createPublicLoungeEligibilityRequestFromWholeNovelReview,
  createPublicLoungePublicationFromWholeNovelReview,
  getPublicLoungePost,
  loadPublicLoungePublicationReference,
  overwritePublicLoungePost,
  publishPublicLoungePost,
  PublicLoungeClientError,
  requestPublicLoungeEligibilityProof,
  removePublicLoungePublicationReference,
  resolvePublicLoungeManagementRecovery,
  retractPublicLoungePost,
  savePublicLoungePublicationReference,
  type PublicLoungeManagementRecovery,
  type PublicLoungePublicationReference,
} from "@/lib/novel-ai/public-lounge/client";
import type { PublicLoungeServerReviewAttestation } from "@/lib/novel-ai/public-lounge/types";
import type { WholeNovelReviewContract } from "@/lib/novel-ai/whole-novel-review";
import styles from "./author-tools.module.css";

type PublishableChapter = {
  id: string;
  title: string;
  content: string;
};

function trustedAttestationForCurrentRelease(): PublicLoungeServerReviewAttestation | null {
  return null;
}

function publicationMessage(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  if (code === "PUBLIC_LOUNGE_NOT_CONNECTED") {
    return "小說交誼廳公開後端尚未連線；沒有發布，也沒有以本機資料假裝公開。";
  }
  if (code === "PUBLIC_LOUNGE_SCORE_NOT_QUALIFIED") return "品質總分未達 80 分，不能發布到小說交誼廳。";
  if (code === "PUBLIC_LOUNGE_CONSENT_REQUIRED") return "必須由作者明確勾選公開同意，系統不會自動發布。";
  if (code === "PUBLIC_LOUNGE_RIGHTS_DECLARATION_REQUIRED") return "必須聲明擁有公開所選章節的權利。";
  if (code === "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_REQUIRED") return "此裝置沒有這部公開作品的管理 token，不能覆寫或撤下。";
  if (code === "PUBLIC_LOUNGE_MANAGEMENT_TOKEN_INVALID") return "此裝置保存的管理 token 無效；公開內容未變更。";
  if (code === "PUBLIC_LOUNGE_ORIGIN_INVALID") return "發布請求未通過同源檢查；公開內容未變更。";
  if (code === "PUBLIC_LOUNGE_RATE_LIMITED") return "發布操作過於頻繁，請稍後再試。";
  if (code === "PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_UNAVAILABLE") {
    return "此作者裝置目前無法安全保存管理 token；尚未送出發布請求。請先允許網站儲存空間。";
  }
  if (code === "PUBLIC_LOUNGE_AUTHOR_DEVICE_STORAGE_WRITE_ROLLED_BACK") {
    return "公開後端已收到作品，但裝置無法保存管理權；系統已立即補償撤下，沒有留下無法管理的公開作品。";
  }
  if (code === "PUBLIC_LOUNGE_MANAGEMENT_RECOVERY_REQUIRED") {
    return "裝置無法保存管理權，且自動撤下未完成。請勿關閉本頁：可重試保存、補償撤下或匯出恢復檔。";
  }
  if (code === "PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED") {
    return "Private AI Hub 尚未提供伺服器可驗證的全書評鑑簽章，因此不能取得公開資格。";
  }
  if (["PUBLIC_LOUNGE_ELIGIBILITY_REQUIRED", "PUBLIC_LOUNGE_ELIGIBILITY_INVALID"].includes(code)) {
    return "伺服器無法驗證這次閉端 AI 評鑑或公開欄位綁定；沒有發布。";
  }
  if (code === "PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED") {
    return "這張一次性公開資格票據已使用，必須重新取得伺服器評鑑簽章。";
  }
  return code || (error instanceof Error ? error.message : "小說交誼廳操作失敗；公開內容未變更。");
}

export default function PublicLoungePublicationPanel({
  review,
  reviewCurrent,
  chapters,
}: {
  review: WholeNovelReviewContract;
  reviewCurrent: boolean;
  chapters: PublishableChapter[];
}) {
  const fingerprint = review.completion.completionFingerprint;
  // WholeNovelReviewContract currently contains no attestation issued by a trusted
  // Private AI Hub signer. Keep publication fail-closed instead of casting a local
  // browser receipt into a credential the public server would appear to trust.
  const serverAttestation = trustedAttestationForCurrentRelease();
  const [authorByline, setAuthorByline] = useState(review.publicMetadata.authorDisplayName ?? "");
  const [category, setCategory] = useState(review.publicMetadata.category ?? "");
  const [fullSynopsis, setFullSynopsis] = useState(review.publicMetadata.synopsis ?? "");
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(() => new Set());
  const [explicitConsent, setExplicitConsent] = useState(false);
  const [rightsDeclared, setRightsDeclared] = useState(false);
  const [working, setWorking] = useState(false);
  const [reference, setReference] = useState<PublicLoungePublicationReference | null>(null);
  const [managementRecovery, setManagementRecovery] = useState<PublicLoungeManagementRecovery | null>(null);
  const [status, setStatus] = useState(
    "本版小說交誼廳為唯讀公開書庫：可信 Private AI Hub 評鑑簽章產生器尚未交付，發布功能維持停用。",
  );

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const saved = loadPublicLoungePublicationReference(fingerprint, window.localStorage);
      if (!active || !saved) return;
      setReference(saved);
      setStatus("此作者裝置保存了這個完稿版本的管理 token；正在向公開後端確認目前狀態。 ");
      void getPublicLoungePost(saved.publicId).then((post) => {
        if (!active) return;
        setReference({ publicId: post.publicId, publishedAt: post.publishedAt, title: post.title });
        setStatus(`已發布於小說交誼廳：${post.publishedAt.slice(0, 10)}。可更新公開內容或以管理 token 撤下。`);
      }).catch((error) => {
        if (active) setStatus(publicationMessage(error));
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fingerprint]);

  const selectedChapters = useMemo(() => chapters
    .map((chapter, index) => ({ chapter, chapterNumber: index + 1 }))
    .filter(({ chapter }) => selectedChapterIds.has(chapter.id)), [chapters, selectedChapterIds]);
  const integerQualityScore = Math.round(review.totalScore);
  const trustedQualityScore = serverAttestation?.qualityScore ?? null;
  const eligible = reviewCurrent
    && review.loungeEligibility.completionFingerprint === fingerprint
    && serverAttestation?.completionFingerprint === fingerprint
    && trustedQualityScore !== null
    && trustedQualityScore >= review.loungeEligibility.threshold;
  const readyToPublish = eligible
    && Boolean(authorByline.trim() && category.trim() && fullSynopsis.trim())
    && selectedChapters.length > 0
    && explicitConsent
    && rightsDeclared
    && !managementRecovery
    && !working;

  function toggleChapter(chapterId: string, checked: boolean) {
    setSelectedChapterIds((current) => {
      const next = new Set(current);
      if (checked) next.add(chapterId);
      else next.delete(chapterId);
      return next;
    });
  }

  async function publishOrUpdate() {
    if (!readyToPublish) return;
    setWorking(true);
    setStatus(reference ? "正在以此裝置的管理 token 更新公開內容……" : "正在發布；完成前不會顯示為公開作品……");
    try {
      if (!serverAttestation) {
        throw new PublicLoungeClientError("PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED", 503);
      }
      const commonInput = {
        review,
        authorByline,
        category,
        fullSynopsis,
        selectedOfficialChapters: selectedChapters.map(({ chapter, chapterNumber }) => ({
          chapterNumber,
          title: chapter.title,
          body: chapter.content,
        })),
        explicitConsent,
        authorRightsDeclaration: rightsDeclared,
      };
      setStatus("正在驗證 Private AI Hub 的 Ed25519 全書評鑑簽章並取得一次性公開票據……");
      const eligibilityProof = await requestPublicLoungeEligibilityProof(
        createPublicLoungeEligibilityRequestFromWholeNovelReview({
          ...commonInput,
          serverAttestation,
        }),
      );
      const publication = createPublicLoungePublicationFromWholeNovelReview({
        ...commonInput,
        eligibilityProof,
      });
      const updating = Boolean(reference);
      const post = reference
        ? await overwritePublicLoungePost(reference.publicId, publication)
        : await publishPublicLoungePost(publication, {
          completionFingerprint: fingerprint,
          storage: window.localStorage,
        });
      const nextReference = { publicId: post.publicId, publishedAt: post.publishedAt, title: post.title };
      if (updating) savePublicLoungePublicationReference(fingerprint, nextReference, window.localStorage);
      setReference(nextReference);
      setStatus(`${reference ? "公開內容已更新" : "已發布到小說交誼廳"}；管理 token 只保存在此作者裝置。`);
    } catch (error) {
      if (error instanceof PublicLoungeClientError && error.recovery) {
        setManagementRecovery(error.recovery);
      }
      setStatus(publicationMessage(error));
    } finally {
      setWorking(false);
    }
  }

  async function resolveManagementRecovery(action: "persist" | "retract") {
    if (!managementRecovery || working) return;
    setWorking(true);
    setStatus(action === "persist" ? "正在重新保存管理權……" : "正在以恢復 token 補償撤下……");
    try {
      const recoveredReference = await resolvePublicLoungeManagementRecovery(
        managementRecovery,
        action,
        { storage: window.localStorage },
      );
      setManagementRecovery(null);
      setReference(recoveredReference);
      setStatus(action === "persist"
        ? "管理 token 與公開作品識別已安全保存於此作者裝置。"
        : "公開作品已補償撤下；沒有遺留無法管理的公開內容。");
    } catch (error) {
      setStatus(`${publicationMessage(error)} 恢復憑證仍保留在本頁，可再次操作或匯出。`);
    } finally {
      setWorking(false);
    }
  }

  function exportManagementRecovery() {
    if (!managementRecovery) return;
    const blob = new Blob([JSON.stringify(managementRecovery, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `小說交誼廳-管理權恢復-${managementRecovery.publicId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("已匯出管理權恢復檔。檔案內含管理 token，請私密保存，勿公開分享。 ");
  }

  async function retract() {
    if (!reference || working) return;
    if (!window.confirm("確定要把這部作品從小說交誼廳撤下？正式作品與本機評鑑不會刪除。")) return;
    setWorking(true);
    setStatus("正在以此裝置的管理 token 撤下公開作品……");
    try {
      await retractPublicLoungePost(reference.publicId, { storage: window.localStorage });
      removePublicLoungePublicationReference(fingerprint, window.localStorage);
      setReference(null);
      setExplicitConsent(false);
      setRightsDeclared(false);
      setStatus("已從小說交誼廳撤下；正式作品、私人 Canon 與本機評鑑均未變更。 ");
    } catch (error) {
      setStatus(publicationMessage(error));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className={styles.publicationPanel} aria-labelledby="public-lounge-publication-title">
      <header>
        <div>
          <small>EXPLICIT OPT-IN · AUTHOR-SELECTED CHAPTERS · NO PRIVATE CANON</small>
          <h4 id="public-lounge-publication-title">發布到小說交誼廳</h4>
          <p>本版僅開放閱讀公開書庫；不會自動發布，也不會把瀏覽器 AI、本機 Ollama 或作者自填分數當成公開資格。</p>
          <p>發布必須等可信 Private AI Hub 真正產生 Ed25519 全書評鑑簽章後才會開放；目前沒有這條 producer 路徑。</p>
        </div>
        <strong>{trustedQualityScore ?? integerQualityScore} / 100</strong>
      </header>

      <p className={styles.advisorStatus} role="status">{status}</p>

      {managementRecovery ? (
        <aside className={styles.publicationBlocked} aria-label="管理權恢復">
          <strong>公開管理權需要立即恢復</strong>
          <p>公開識別：{managementRecovery.publicId}</p>
          <p>恢復 token 目前只保留在這個頁面記憶體；關閉或重新整理前，請完成下列其中一項。</p>
          <div className={styles.advisorActions}>
            <button type="button" disabled={working} onClick={() => void resolveManagementRecovery("persist")}>重試保存管理權</button>
            <button type="button" disabled={working} onClick={() => void resolveManagementRecovery("retract")}>以恢復 token 撤下</button>
            <button type="button" disabled={working} onClick={exportManagementRecovery}>匯出私密恢復檔</button>
          </div>
        </aside>
      ) : null}

      {!eligible ? (
        <p className={styles.publicationBlocked}>
          {!reviewCurrent
            ? "正文或內容指紋已變更；此評分已失效，必須重新標記完稿並審查。"
            : !serverAttestation
              ? "本版沒有可信 Private AI Hub 評鑑簽章產生器，因此小說交誼廳維持唯讀；這份本機評鑑只能供作者參考，不能作為公開資格。"
              : `品質總分須達 ${review.loungeEligibility.threshold} 分；目前不可發布。`}
        </p>
      ) : null}

      <div className={styles.publicationFields}>
        <label>
          作者署名
          <input value={authorByline} maxLength={80} disabled={working || !serverAttestation} onChange={(event) => setAuthorByline(event.target.value)} />
          <small>作者自填；本系統目前不驗證真實身分。</small>
        </label>
        <label>
          小說分類
          <input value={category} maxLength={48} disabled={working || !serverAttestation} onChange={(event) => setCategory(event.target.value)} />
        </label>
        <label>
          全書大綱
          <textarea value={fullSynopsis} maxLength={50_000} disabled={working || !serverAttestation} onChange={(event) => setFullSynopsis(event.target.value)} />
        </label>
      </div>

      <fieldset className={styles.chapterSelection} disabled={!eligible || working}>
        <legend>選擇要公開的正式章節正文（{selectedChapters.length}／{chapters.length}）</legend>
        {chapters.map((chapter, index) => (
          <label key={chapter.id}>
            <input
              type="checkbox"
              checked={selectedChapterIds.has(chapter.id)}
              onChange={(event) => toggleChapter(chapter.id, event.target.checked)}
            />
            <span>第 {index + 1} 章　{chapter.title}</span>
            <small>{chapter.content.replace(/\s/gu, "").length.toLocaleString("zh-TW")} 字</small>
          </label>
        ))}
      </fieldset>

      <div className={styles.publicationAttestations}>
        <label>
          <input
            type="checkbox"
            checked={explicitConsent}
            disabled={!eligible || working}
            onChange={(event) => setExplicitConsent(event.target.checked)}
          />
          <span>我明確同意把上述資料與所選章節公開到小說交誼廳；我知道這不是本機匯出。</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={rightsDeclared}
            disabled={!eligible || working}
            onChange={(event) => setRightsDeclared(event.target.checked)}
          />
          <span>我聲明自己擁有公開上述作品與章節正文的權利。</span>
        </label>
      </div>

      <div className={styles.advisorActions}>
        <button type="button" className={styles.primary} disabled={!readyToPublish} onClick={() => void publishOrUpdate()}>
          {working ? "處理中……" : reference ? "以管理 token 更新公開內容" : "明確發布到小說交誼廳"}
        </button>
        {reference ? (
          <>
            <Link href={`/lounge/${encodeURIComponent(reference.publicId)}`}>查看公開作品</Link>
            <button type="button" disabled={working} onClick={() => void retract()}>撤下公開作品</button>
          </>
        ) : null}
        <Link href="/lounge">開啟小說交誼廳</Link>
      </div>

      <p className={styles.publicationPrivacy}>
        絕不送出：projectId、私人 Canon、提示詞、模型 trace、評鑑 receipt、備份。管理 token 僅保存在此作者裝置；伺服器只保存雜湊。
      </p>
    </section>
  );
}
