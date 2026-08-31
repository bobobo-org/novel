"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  createPublicLoungeEligibilityRequestFromWholeNovelReview,
  createPublicLoungePublicationFromWholeNovelReview,
  getPublicLoungePost,
  loadPublicLoungePublicationReference,
  loadPublicLoungeWorkPublicationReference,
  overwritePublicLoungePost,
  publishPublicLoungePost,
  PublicLoungeClientError,
  requestPublicLoungeEligibilityProof,
  removePublicLoungePublicationReference,
  removePublicLoungeWorkPublicationReference,
  resolvePublicLoungeManagementRecovery,
  retractPublicLoungePost,
  savePublicLoungePublicationReference,
  savePublicLoungeWorkPublicationReference,
  type PublicLoungeManagementRecovery,
  type PublicLoungePublicationReference,
} from "@/lib/novel-ai/public-lounge/client";
import {
  PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS,
  type PublicLoungeServerReviewAttestation,
} from "@/lib/novel-ai/public-lounge/types";
import {
  listPublicLoungeTopics,
  migrateLegacyPublicLoungeCategory,
} from "@/lib/novel-ai/public-lounge/taxonomy";
import type { WholeNovelReviewContract } from "@/lib/novel-ai/whole-novel-review";
import styles from "./author-tools.module.css";

type PublishableChapter = {
  id: string;
  title: string;
  content: string;
};

const OFFICIAL_PUBLIC_LOUNGE_TOPICS = listPublicLoungeTopics();

function exactLegacyTopicSuggestion(category: string | null | undefined) {
  const migration = migrateLegacyPublicLoungeCategory(category);
  return migration.status === "migrated" ? migration.selection.primaryTopicId : "";
}

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
    return "Private AI Hub 尚未提供伺服器可驗證的全書評鑑簽章；本機評分只能作為修稿建議，不能解鎖公開資格。";
  }
  if (["PUBLIC_LOUNGE_ELIGIBILITY_REQUIRED", "PUBLIC_LOUNGE_ELIGIBILITY_INVALID"].includes(code)) {
    return "伺服器無法驗證這次閉端 AI 評鑑或公開欄位綁定；沒有發布。";
  }
  if (code === "PUBLIC_LOUNGE_ELIGIBILITY_REPLAYED") {
    return "這張一次性公開資格已使用；請重新送出以建立新的作者裝置聲明或取得新的伺服器簽章。";
  }
  return code || (error instanceof Error ? error.message : "小說交誼廳操作失敗；公開內容未變更。");
}

export default function PublicLoungePublicationPanel({
  projectId,
  review,
  reviewCurrent,
  chapters,
}: {
  projectId: string;
  review: WholeNovelReviewContract;
  reviewCurrent: boolean;
  chapters: PublishableChapter[];
}) {
  const fingerprint = review.completion.completionFingerprint;
  // Only a server-verifiable attestation may unlock public publication. A
  // browser/local score remains useful editorial advice but is not a trust root.
  const serverAttestation = trustedAttestationForCurrentRelease();
  const [authorByline, setAuthorByline] = useState(review.publicMetadata.authorDisplayName ?? "");
  const [primaryTopicId, setPrimaryTopicId] = useState(() => exactLegacyTopicSuggestion(review.publicMetadata.category));
  const [secondaryTopicId, setSecondaryTopicId] = useState("");
  const [tertiaryTopicId, setTertiaryTopicId] = useState("");
  const [fullSynopsis, setFullSynopsis] = useState(
    (review.publicMetadata.synopsis ?? "").slice(0, PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS),
  );
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(() => new Set());
  const [explicitConsent, setExplicitConsent] = useState(false);
  const [rightsDeclared, setRightsDeclared] = useState(false);
  const [working, setWorking] = useState(false);
  const [reference, setReference] = useState<PublicLoungePublicationReference | null>(null);
  const [managementRecovery, setManagementRecovery] = useState<PublicLoungeManagementRecovery | null>(null);
  const [status, setStatus] = useState(
    "本機閉端 AI 評分可協助修稿，但不能自行證明分數。公開前必須取得 Private AI Hub 的伺服器簽章。",
  );

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const saved = loadPublicLoungeWorkPublicationReference(projectId, window.localStorage)
        ?? loadPublicLoungePublicationReference(fingerprint, window.localStorage);
      if (!active || !saved) return;
      setReference(saved);
      setStatus("此作者裝置保存了這個完稿版本的管理 token；正在向公開後端確認目前狀態。 ");
      void getPublicLoungePost(saved.publicId).then((post) => {
        if (!active) return;
        setReference({ publicId: post.publicId, publishedAt: post.publishedAt, title: post.title });
        savePublicLoungeWorkPublicationReference(projectId, post, window.localStorage);
        setStatus(`已發布於小說交誼廳：${post.publishedAt.slice(0, 10)}；Private AI Hub 已簽章驗證。可更新公開內容或以管理 token 撤下。`);
      }).catch((error) => {
        if (active) setStatus(publicationMessage(error));
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [fingerprint, projectId]);

  const selectedChapters = useMemo(() => chapters
    .map((chapter, index) => ({ chapter, chapterNumber: index + 1 }))
    .filter(({ chapter }) => selectedChapterIds.has(chapter.id)), [chapters, selectedChapterIds]);
  const selectedTopicIds = useMemo(() => [primaryTopicId, secondaryTopicId, tertiaryTopicId]
    .filter((topicId): topicId is string => Boolean(topicId)), [primaryTopicId, secondaryTopicId, tertiaryTopicId]);
  const integerQualityScore = Math.round(review.totalScore);
  const trustedQualityScore = serverAttestation?.qualityScore ?? null;
  const serverEligible = reviewCurrent
    && serverAttestation?.completionFingerprint === fingerprint
    && trustedQualityScore !== null
    && trustedQualityScore >= review.loungeEligibility.threshold;
  const eligible = serverEligible;
  const readyToPublish = eligible
    && Boolean(
      authorByline.trim()
      && selectedTopicIds.length
      && fullSynopsis.trim()
      && fullSynopsis.trim().length <= PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS
    )
    && selectedChapters.length > 0
    && explicitConsent
    && rightsDeclared
    && serverEligible
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
      const commonInput = {
        review,
        authorByline,
        topicIds: selectedTopicIds,
        fullSynopsis,
        selectedOfficialChapters: selectedChapters.map(({ chapter, chapterNumber }) => ({
          chapterNumber,
          title: chapter.title,
          body: chapter.content,
        })),
        explicitConsent,
        authorRightsDeclaration: rightsDeclared,
      };
      if (!serverAttestation || !serverEligible) {
        throw new PublicLoungeClientError("PUBLIC_LOUNGE_TRUSTED_REVIEW_NOT_CONNECTED", 503);
      }
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
          workId: projectId,
          storage: window.localStorage,
        });
      const nextReference = { publicId: post.publicId, publishedAt: post.publishedAt, title: post.title };
      if (updating) savePublicLoungePublicationReference(fingerprint, nextReference, window.localStorage);
      savePublicLoungeWorkPublicationReference(projectId, nextReference, window.localStorage);
      setReference(nextReference);
      setStatus(`${reference ? "公開內容已更新" : "已發布到小說交誼廳"}；Private AI Hub 已簽章驗證；管理 token 只保存在此作者裝置。`);
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
        { storage: window.localStorage, workId: projectId },
      );
      setManagementRecovery(null);
      setReference(recoveredReference);
      if (recoveredReference) savePublicLoungeWorkPublicationReference(projectId, recoveredReference, window.localStorage);
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
      removePublicLoungeWorkPublicationReference(projectId, window.localStorage);
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
          <p>不會自動發布。只有通過完整覆蓋、內容安全、隱私版權與關鍵分項硬閘的全書評鑑，才可由作者明確選擇公開。</p>
          <p>{serverEligible ? "本次評鑑具 Private AI Hub Ed25519 簽章。" : "本機評分尚未經平台簽章，只能作為私人修稿建議，不能發布。"}</p>
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
            : serverAttestation === null
              ? "Private AI Hub 的簽章產生器尚未接通；本機分數無法自行解鎖公開，作品仍保持私密。"
              : `評鑑必須通過完整覆蓋、合規、關鍵分項與 ${review.loungeEligibility.threshold} 分門檻；目前不可發布。`}
        </p>
      ) : null}

      <div className={styles.publicationFields}>
        <label>
          作者署名
          <input value={authorByline} maxLength={80} disabled={working || !eligible} onChange={(event) => setAuthorByline(event.target.value)} />
          <small>作者自填；本系統目前不驗證真實身分。</small>
        </label>
        <label>
          主要題材（決定公開書架）
          <select value={primaryTopicId} disabled={working || !eligible} onChange={(event) => setPrimaryTopicId(event.target.value)}>
            <option value="">請從 218 個正式經典題材選擇</option>
            {OFFICIAL_PUBLIC_LOUNGE_TOPICS.map((topic) => (
              <option key={topic.topicId} value={topic.topicId} disabled={topic.topicId === secondaryTopicId || topic.topicId === tertiaryTopicId}>{topic.name}</option>
            ))}
          </select>
          <small>第一個題材會依正式資料庫自動決定八大書架，不能自行填寫書架。</small>
        </label>
        <label>
          次要題材（可選）
          <select value={secondaryTopicId} disabled={working || !eligible || !primaryTopicId} onChange={(event) => setSecondaryTopicId(event.target.value)}>
            <option value="">不選擇</option>
            {OFFICIAL_PUBLIC_LOUNGE_TOPICS.map((topic) => (
              <option key={topic.topicId} value={topic.topicId} disabled={topic.topicId === primaryTopicId || topic.topicId === tertiaryTopicId}>{topic.name}</option>
            ))}
          </select>
        </label>
        <label>
          第三題材（可選）
          <select value={tertiaryTopicId} disabled={working || !eligible || !primaryTopicId} onChange={(event) => setTertiaryTopicId(event.target.value)}>
            <option value="">不選擇</option>
            {OFFICIAL_PUBLIC_LOUNGE_TOPICS.map((topic) => (
              <option key={topic.topicId} value={topic.topicId} disabled={topic.topicId === primaryTopicId || topic.topicId === secondaryTopicId}>{topic.name}</option>
            ))}
          </select>
          <small>公開卡片最多顯示三個正式題材；不可輸入自由文字分類。</small>
        </label>
        <label>
          公開摘要（最多 {PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS} 字）
          <textarea
            value={fullSynopsis}
            maxLength={PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS}
            disabled={working || !eligible}
            onChange={(event) => setFullSynopsis(event.target.value)}
          />
          <small>{fullSynopsis.length}／{PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS} 字；請由作者自行撰寫，不會公開私有 Canon。</small>
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
        絕不送出：projectId、reviewId、正文以外的私人 Canon、提示詞、模型 trace、評鑑 receipt、備份或完整模型 provenance。公開聲明不含作品正文；管理 token 僅保存在此作者裝置，伺服器只保存雜湊。
      </p>
    </section>
  );
}
