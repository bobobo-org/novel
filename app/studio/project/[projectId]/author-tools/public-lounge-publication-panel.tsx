"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicLoungeAttestationPublicationFromWholeNovelReview,
  createPublicLoungePublicationFromWholeNovelReview,
  createPublicLoungeServerEligibilityRequestV5,
  getPublicLoungePost,
  loadPublicLoungePublicationReference,
  loadPublicLoungeWorkPublicationReference,
  overwritePublicLoungePost,
  publishPublicLoungePost,
  PublicLoungeClientError,
  requestPublicLoungeEligibilityProofV5,
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
} from "@/lib/novel-ai/public-lounge/types";
import {
  PRIVATE_HUB_PUBLIC_LOUNGE_ATTESTATION_REQUEST_SCHEMA_VERSION,
  type PrivateHubPublicLoungeAttestationRequest,
} from "@/lib/novel-ai/providers/private-ai-hub/private-hub-client";
import { sha256Hex, stableStringify } from "@/lib/novel-ai/closed-ai-cache/hashing";
import { getStudioClosedAIRuntimeCoordinator } from "@/lib/novel-ai/web/closed-agent-os-service";
import {
  listPublicLoungeTopics,
  migrateLegacyPublicLoungeCategory,
} from "@/lib/novel-ai/public-lounge/taxonomy";
import type { WholeNovelReviewContract } from "@/lib/novel-ai/whole-novel-review";
import type { AuthorToolSnapshot } from "@/lib/novel-ai/author-tools";
import styles from "./author-tools.module.css";

type PublishableChapter = {
  id: string;
  title: string;
  content: string;
};

const OFFICIAL_PUBLIC_LOUNGE_TOPICS = listPublicLoungeTopics();

type ProducerState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "signing" }
  | { status: "ready"; keyId: string; version: string }
  | { status: "unavailable"; code: string };

function exactLegacyTopicSuggestion(category: string | null | undefined) {
  const migration = migrateLegacyPublicLoungeCategory(category);
  return migration.status === "migrated" ? migration.selection.primaryTopicId : "";
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
  if ([
    "PRODUCER_UNAVAILABLE",
    "PUBLIC_LOUNGE_PRODUCER_UNAVAILABLE",
    "PUBLIC_LOUNGE_PRODUCER_MODEL_UNAVAILABLE",
    "BRIDGE_PROCESS_UNREACHABLE",
    "LOCAL_PROVIDER_NOT_READY",
  ].includes(code)) {
    return "Private AI Hub 的可信簽章服務目前不可用；沒有發布。請確認本機 Hub 與簽章金鑰。";
  }
  if (code === "PRODUCER_KEY_NOT_CONFIGURED") {
    return "此 Private AI Hub 尚未配置受信任簽章金鑰；沒有發布。";
  }
  if (code === "PRODUCER_KEY_ID_MISMATCH") {
    return "本機 producer 與目前部署的信任金鑰不一致；沒有發布。";
  }
  if (code === "PRODUCER_REVIEW_UNVERIFIED") {
    return "全書評鑑無法由 Private AI Hub 驗證；本機顯示的分數不具公開資格。";
  }
  if (code === "PUBLIC_LOUNGE_PRODUCER_FULL_COVERAGE_REQUIRED") {
    return "可信 producer 必須覆核完整正式正文；目前章節不是全書完整覆蓋，因此沒有發布。";
  }
  if (code === "PUBLIC_LOUNGE_PRODUCER_CAPACITY_EXCEEDED") {
    return "完整正文超出可信 producer 的單次安全容量；沒有發布。";
  }
  if (code === "PUBLIC_LOUNGE_PRODUCER_REQUEST_INVALID") {
    return "送往可信 producer 的公開包欄位不一致；沒有簽章或發布。";
  }
  if (code === "PUBLIC_LOUNGE_PRODUCER_COMPLETION_STATE_INVALID") {
    return "Private AI Hub 重算的完稿狀態與目前正文或公開包不一致；沒有簽章或發布。請重新完成全書審查。";
  }
  if (code === "PUBLIC_LOUNGE_PRODUCER_TARGET_INVALID") {
    return "目前公開版本已變更或覆寫目標不一致；沒有簽章或修改公開內容。請重新載入後再明確重試。";
  }
  if (code === "PUBLIC_LOUNGE_TRUSTED_REVIEW_INVALID") {
    return "Private AI Hub 無法把全書覆核結果安全綁定到這個公開包；沒有簽章或發布。";
  }
  if (code === "PUBLIC_LOUNGE_REVIEW_HARD_GATE_FAILED") {
    return "全書覆核未通過內容安全或品質硬閘；沒有簽章或發布。";
  }
  if (code === "PRODUCER_TIMEOUT" || code === "PUBLIC_LOUNGE_PRODUCER_TIMEOUT") {
    return "Private AI Hub 評鑑或簽章逾時；沒有發布。可由你明確重試，但系統不會自動重送舊簽章。";
  }
  if (code === "AI_PROVIDER_INVALID_RESPONSE") {
    return "Private AI Hub 回傳的簽章封包格式無效；沒有換票或發布。";
  }
  if (code === "PUBLIC_LOUNGE_ATTESTATION_VERSION_UNSUPPORTED") {
    return "這份可信簽章版本不能用於公開發布；沒有降級使用舊版簽章。";
  }
  if (code === "PUBLIC_LOUNGE_ATTESTATION_REPLAYED") {
    return "這份一次性簽章已使用；系統沒有自動重送，也沒有重複發布。請明確重試以取得全新簽章。";
  }
  if (code === "PUBLIC_LOUNGE_ATTESTATION_STATE_UNKNOWN") {
    return "一次性簽章的資料庫結果不明；系統已停止且不會自動重送。公開內容維持原狀。";
  }
  if (code === "PUBLIC_LOUNGE_ELIGIBILITY_EXPIRED") {
    return "可信簽章或公開資格已逾時；請明確重試以重新簽發。";
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
  snapshot,
  review,
  reviewCurrent,
  chapters,
}: {
  projectId: string;
  snapshot: AuthorToolSnapshot;
  review: WholeNovelReviewContract;
  reviewCurrent: boolean;
  chapters: PublishableChapter[];
}) {
  const fingerprint = review.completion.completionFingerprint;
  const [authorByline, setAuthorByline] = useState(review.publicMetadata.authorDisplayName ?? "");
  const [primaryTopicId, setPrimaryTopicId] = useState(() => exactLegacyTopicSuggestion(review.publicMetadata.category));
  const [secondaryTopicId, setSecondaryTopicId] = useState("");
  const [tertiaryTopicId, setTertiaryTopicId] = useState("");
  const [fullSynopsis, setFullSynopsis] = useState(
    (review.publicMetadata.synopsis ?? "").slice(0, PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS),
  );
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(
    () => new Set(chapters.map((chapter) => chapter.id)),
  );
  const [explicitConsent, setExplicitConsent] = useState(false);
  const [rightsDeclared, setRightsDeclared] = useState(false);
  const [working, setWorking] = useState(false);
  const transactionInFlight = useRef(false);
  const [producer, setProducer] = useState<ProducerState>({ status: "idle" });
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
  // This only unlocks author input. The score remains untrusted until the
  // loopback producer reviews the exact release and returns a valid v5 proof.
  const eligible = reviewCurrent && review.eligibleForPublicLounge;
  const readyToPublish = eligible
    && Boolean(
      authorByline.trim()
      && selectedTopicIds.length
      && fullSynopsis.trim()
      && fullSynopsis.trim().length <= PUBLIC_LOUNGE_MAX_SYNOPSIS_CHARACTERS
    )
    && chapters.length === review.publicMetadata.chapterCount
    && selectedChapters.length === review.publicMetadata.chapterCount
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
    if (!readyToPublish || transactionInFlight.current) return;
    transactionInFlight.current = true;
    setWorking(true);
    const updatingReference = reference;
    let stage: "producer" | "eligibility" | "publication" = "producer";
    try {
      const commonInput = {
        review,
        authorByline: authorByline.trim(),
        topicIds: selectedTopicIds,
        fullSynopsis: fullSynopsis.trim(),
        selectedOfficialChapters: selectedChapters.map(({ chapter, chapterNumber }) => ({
          chapterNumber,
          title: chapter.title.trim(),
          body: chapter.content.trim(),
        })),
        explicitConsent,
        authorRightsDeclaration: rightsDeclared,
      };
      const attestationPublication = createPublicLoungeAttestationPublicationFromWholeNovelReview(
        commonInput,
      );
      let producerRequest: PrivateHubPublicLoungeAttestationRequest;
      if (updatingReference) {
        setStatus("正在重新讀取目前公開版本，建立不可挪用的覆寫綁定……");
        const currentTarget = await getPublicLoungePost(updatingReference.publicId);
        if (currentTarget.publicId !== updatingReference.publicId) {
          throw new PublicLoungeClientError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
        }
        producerRequest = {
          schemaVersion: PRIVATE_HUB_PUBLIC_LOUNGE_ATTESTATION_REQUEST_SCHEMA_VERSION,
          workId: projectId,
          revisionId: fingerprint,
          completionFingerprint: fingerprint,
          completionSnapshot: snapshot,
          intent: "overwrite",
          targetPublicationId: currentTarget.publicId,
          expectedTargetVersionId: currentTarget.versionId,
          expectedTargetPublicationDigest: await sha256Hex(stableStringify(currentTarget)),
          publication: attestationPublication,
        };
      } else {
        producerRequest = {
          schemaVersion: PRIVATE_HUB_PUBLIC_LOUNGE_ATTESTATION_REQUEST_SCHEMA_VERSION,
          workId: projectId,
          revisionId: fingerprint,
          completionFingerprint: fingerprint,
          completionSnapshot: snapshot,
          intent: "publish",
          targetPublicationId: null,
          expectedTargetVersionId: null,
          expectedTargetPublicationDigest: null,
          publication: attestationPublication,
        };
      }
      setProducer({ status: "connecting" });
      setStatus("正在連接本機 Private AI Hub 的可信簽章服務……");
      const coordinator = getStudioClosedAIRuntimeCoordinator();
      await coordinator.connectPrivateHubAutomatically();
      setProducer({ status: "signing" });
      setStatus("Private AI Hub 正在覆核這個公開包並簽發一次性 v5 證明……");
      const producerResult = await coordinator.privateHubClient.issuePublicLoungeAttestationV5(
        producerRequest,
      );
      setProducer({
        status: "ready",
        keyId: producerResult.producer.keyId,
        version: producerResult.producer.version,
      });

      stage = "eligibility";
      setStatus("正在將這份 v5 簽章換成一次性公開票據；此步驟不會自動重試……");
      const eligibilityRequest = producerRequest.intent === "publish"
        ? (() => {
          if (producerResult.attestation.intent !== "publish") {
            throw new PublicLoungeClientError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
          }
          return createPublicLoungeServerEligibilityRequestV5({
            projectId,
            completionFingerprint: fingerprint,
            publication: attestationPublication,
            intent: "publish",
            targetPublicationId: null,
            expectedTargetVersionId: null,
            expectedTargetPublicationDigest: null,
            serverAttestation: producerResult.attestation,
          });
        })()
        : (() => {
          if (producerResult.attestation.intent !== "overwrite") {
            throw new PublicLoungeClientError("PUBLIC_LOUNGE_ELIGIBILITY_INVALID", 403);
          }
          return createPublicLoungeServerEligibilityRequestV5({
            projectId,
            completionFingerprint: fingerprint,
            publication: attestationPublication,
            intent: "overwrite",
            targetPublicationId: producerRequest.targetPublicationId,
            expectedTargetVersionId: producerRequest.expectedTargetVersionId,
            expectedTargetPublicationDigest: producerRequest.expectedTargetPublicationDigest,
            serverAttestation: producerResult.attestation,
          });
        })();
      const eligibilityProof = await requestPublicLoungeEligibilityProofV5(eligibilityRequest);
      const publication = createPublicLoungePublicationFromWholeNovelReview({
        ...commonInput,
        eligibilityProof,
      });
      stage = "publication";
      setStatus(updatingReference
        ? "正在以此裝置的管理 token 更新公開內容……"
        : "正在發布；完成前不會顯示為公開作品……");
      const post = updatingReference
        ? await overwritePublicLoungePost(updatingReference.publicId, publication)
        : await publishPublicLoungePost(publication, {
          completionFingerprint: fingerprint,
          workId: projectId,
          storage: window.localStorage,
        });
      const nextReference = { publicId: post.publicId, publishedAt: post.publishedAt, title: post.title };
      if (updatingReference) savePublicLoungePublicationReference(fingerprint, nextReference, window.localStorage);
      savePublicLoungeWorkPublicationReference(projectId, nextReference, window.localStorage);
      setReference(nextReference);
      setStatus(`${updatingReference ? "公開內容已更新" : "已發布到小說交誼廳"}；Private AI Hub 已簽章驗證；管理 token 只保存在此作者裝置。`);
    } catch (error) {
      if (stage === "producer") {
        setProducer({
          status: "unavailable",
          code: String((error as { code?: unknown } | null)?.code ?? "PRODUCER_UNAVAILABLE"),
        });
      }
      if (error instanceof PublicLoungeClientError && error.recovery) {
        setManagementRecovery(error.recovery);
      }
      setStatus(publicationMessage(error));
    } finally {
      transactionInFlight.current = false;
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
          <p>{producer.status === "ready"
            ? `可信 producer 可用（${producer.version}／${producer.keyId}）；只會在你明確送出時為當下公開包簽章。`
            : producer.status === "connecting"
              ? "正在連接可信 producer；尚未簽發或發布。"
              : producer.status === "signing"
                ? "可信 producer 正在覆核並簽章；尚未換票或發布。"
                : producer.status === "unavailable"
                  ? `可信 producer 不可用（${producer.code}）；沒有發布。`
                  : "本機分數無法自行解鎖公開，只供發布前預檢；送出時仍須由 Private AI Hub 重新覆核並簽發 v5 證明。"}</p>
        </div>
        <strong>{integerQualityScore} / 100</strong>
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
        <legend>公開完整正式正文（{selectedChapters.length}／{chapters.length}）</legend>
        <p>可信 producer 必須覆核全書；取消任何章節都會停止發布，不會改用部分內容冒充完整評鑑。</p>
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
