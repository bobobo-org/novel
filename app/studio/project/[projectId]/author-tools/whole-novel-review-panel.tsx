"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClosedAIProgressEvent, ClosedAgentExecutionResult } from "@/lib/novel-ai/closed-agent-os";
import type { AuthorToolSnapshot } from "@/lib/novel-ai/author-tools";
import {
  WHOLE_NOVEL_LOUNGE_THRESHOLD,
  WHOLE_NOVEL_REVIEW_RUBRIC,
  buildWholeNovelChunkContext,
  buildWholeNovelChunkReviewObjective,
  buildWholeNovelCompletionFingerprint,
  buildWholeNovelSynthesisContext,
  buildWholeNovelSynthesisObjective,
  createWholeNovelCompletionDeclaration,
  createWholeNovelReviewContract,
  evaluateWholeNovelCompletionReadiness,
  loadWholeNovelCompletionDeclaration,
  loadWholeNovelReview,
  parseWholeNovelChunkAnalysis,
  parseWholeNovelModelReview,
  planWholeNovelReviewChunks,
  removeWholeNovelReview,
  removeWholeNovelCompletionDeclaration,
  saveWholeNovelCompletionDeclaration,
  saveWholeNovelReview,
  verifiedWholeNovelReviewExecution,
  type WholeNovelChunkAnalysis,
  type WholeNovelCompletionDeclaration,
  type WholeNovelReviewContract,
  type WholeNovelReviewBackendId,
  type WholeNovelReviewExecutionProvenance,
} from "@/lib/novel-ai/whole-novel-review";
import {
  executeStudioClosedAgent,
  rejectStudioClosedAgentCandidate,
} from "@/lib/novel-ai/web/closed-agent-os-service";
import PublicLoungePublicationPanel from "./public-lounge-publication-panel";
import styles from "./author-tools.module.css";

type ReviewBackend = WholeNovelReviewBackendId;

const BACKEND_CAPACITY: Record<ReviewBackend, {
  maximumChunkCharacters: number;
  maximumChunks: number;
  maximumSynthesisCharacters: number;
  chunkContextTokenBudget: number;
  synthesisContextTokenBudget: number;
}> = {
  "browser-ai": {
    maximumChunkCharacters: 2_400,
    maximumChunks: 18,
    maximumSynthesisCharacters: 6_400,
    chunkContextTokenBudget: 2_200,
    synthesisContextTokenBudget: 3_800,
  },
  "local-ollama": {
    maximumChunkCharacters: 4_200,
    maximumChunks: 18,
    maximumSynthesisCharacters: 10_500,
    chunkContextTokenBudget: 3_200,
    synthesisContextTokenBudget: 6_000,
  },
  "private-ai-hub": {
    maximumChunkCharacters: 12_000,
    maximumChunks: 72,
    maximumSynthesisCharacters: 52_000,
    chunkContextTokenBudget: 10_000,
    synthesisContextTokenBudget: 30_000,
  },
};

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/gu, "-").slice(0, 80) || "作品";
}

function reviewErrorMessage(cause: unknown) {
  const code = String((cause as { code?: unknown })?.code ?? "");
  if ([
    "CLOSED_AI_BROWSER_UNSUPPORTED_SETUP_REQUIRED",
    "CLOSED_AI_SETUP_REQUIRED",
    "CLOSED_AI_SELECTED_BACKEND_NOT_READY",
    "CLOSED_AI_REQUIRED_BACKEND_NOT_READY",
    "NO_PROVIDER_AVAILABLE",
    "PROVIDER_RUNTIME_NOT_CONNECTED",
  ].includes(code)) {
    return "選定的真實閉端 AI 尚未就緒。審查已停止，沒有規則 fallback、沒有品質分，也沒有公開作品。";
  }
  if (code === "CLOSED_AGENT_TASK_CANCELLED" || code === "OLLAMA_CANCELLED") {
    return "全書審查已取消；未完成的覆蓋不會被保存成全書結果。";
  }
  if (code === "WHOLE_NOVEL_REVIEW_BACKEND_CAPACITY") {
    return "這個完稿版本超過所選後端可誠實完整覆蓋的容量。請改用私有 AI Hub，或先把作品分卷；系統不會略讀後假稱完成。";
  }
  if (code === "WHOLE_NOVEL_SYNTHESIS_CAPACITY") {
    return "逐段閱讀已完成，但彙整包超過所選後端的完整輸入容量，因此沒有產生總分。請改用私有 AI Hub；系統不會截斷後評分。";
  }
  if (code.startsWith("WHOLE_NOVEL_")) {
    return "閉端模型輸出缺欄、截斷或無法證明完整覆蓋；這次沒有保存全書評分，也沒有用固定模板補齊。";
  }
  return cause instanceof Error
    ? `全書審查失敗：${cause.message}。沒有規則 fallback，也沒有自動公開。`
    : "全書審查失敗；沒有規則 fallback，也沒有自動公開。";
}

function maximumRevision(snapshot: AuthorToolSnapshot) {
  return Math.max(
    snapshot.project.revision,
    snapshot.storyBible?.revision ?? 0,
    snapshot.storyState?.revision ?? 0,
    ...snapshot.chapters.map((chapter) => chapter.revision),
    ...snapshot.characters.map((character) => character.revision),
    ...snapshot.worldRules.map((rule) => rule.revision),
    ...snapshot.timeline.map((event) => event.revision),
  );
}

export default function WholeNovelReviewPanel({
  projectId,
  snapshot,
}: {
  projectId: string;
  snapshot: AuthorToolSnapshot;
}) {
  const readiness = useMemo(
    () => evaluateWholeNovelCompletionReadiness(snapshot),
    [snapshot],
  );
  const orderedChapters = useMemo(() => [...snapshot.chapters]
    .filter((chapter) => chapter.content.trim())
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)), [snapshot]);
  const fingerprintSourceKey = useMemo(() => JSON.stringify({
    projectRevision: snapshot.project.revision,
    chapters: snapshot.chapters.map((chapter) => [
      chapter.id,
      chapter.revision,
      chapter.status,
      chapter.content.length,
    ]),
  }), [snapshot]);
  const [backend, setBackend] = useState<ReviewBackend>("browser-ai");
  const [authorDisplayName, setAuthorDisplayName] = useState("");
  const [publicCategory, setPublicCategory] = useState(
    snapshot.project.genreId ?? snapshot.project.genrePackId ?? "",
  );
  const [publicSynopsis, setPublicSynopsis] = useState(
    snapshot.project.coreIdea.value?.trim() ?? "",
  );
  const [fingerprintRecord, setFingerprintRecord] = useState({ sourceKey: "", value: "" });
  const [declaration, setDeclaration] = useState<WholeNovelCompletionDeclaration | null>(null);
  const [review, setReview] = useState<WholeNovelReviewContract | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("正在核對目前章節與完稿版本……");
  const [stage, setStage] = useState("");
  const [progress, setProgress] = useState<ClosedAIProgressEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const fingerprint = fingerprintRecord.sourceKey === fingerprintSourceKey
    ? fingerprintRecord.value
    : "";

  useEffect(() => {
    let active = true;
    void buildWholeNovelCompletionFingerprint(snapshot).then((nextFingerprint) => {
      if (!active) return;
      const savedDeclaration = loadWholeNovelCompletionDeclaration(projectId, window.localStorage);
      const savedReview = loadWholeNovelReview(projectId, window.localStorage);
      setFingerprintRecord({ sourceKey: fingerprintSourceKey, value: nextFingerprint });
      setDeclaration(savedDeclaration);
      setReview(savedReview);
      if (savedReview?.publicMetadata.authorDisplayName) {
        setAuthorDisplayName(savedReview.publicMetadata.authorDisplayName);
      }
      if (savedReview?.publicMetadata.category) setPublicCategory(savedReview.publicMetadata.category);
      if (savedReview?.publicMetadata.synopsis) setPublicSynopsis(savedReview.publicMetadata.synopsis);
      if (!readiness.readyToDeclare) {
        setStatus("目前仍有含正文的草稿章節，或尚無正文；不能標記為全書完稿。空白的下一章草稿不列入阻擋。 ");
      } else if (savedDeclaration?.completionFingerprint !== nextFingerprint) {
        setStatus(savedDeclaration
          ? "正文或章節版本已改變，舊完稿聲明與舊評分已失效；請核對後重新標記。"
          : "所有有正文的章節都已完成；請由作者明確標記這個版本為全書完稿，再啟動閉端 AI 審查。 ");
      } else if (savedReview?.completion.completionFingerprint === nextFingerprint) {
        setStatus("已載入目前完稿版本的本機私有審查；作品仍未公開。 ");
      } else {
        setStatus("目前版本已由作者標記完稿，可開始真實閉端 AI 全書審查。 ");
      }
    }).catch((cause) => {
      if (active) setStatus(cause instanceof Error ? `完稿指紋建立失敗：${cause.message}` : "完稿指紋建立失敗");
    });
    return () => { active = false; };
  }, [fingerprintSourceKey, projectId, readiness.readyToDeclare, snapshot]);

  const declarationCurrent = Boolean(
    fingerprint
    && declaration?.completionFingerprint === fingerprint
    && readiness.readyToDeclare,
  );
  const reviewCurrent = Boolean(
    declarationCurrent
    && review?.completion.completionFingerprint === fingerprint,
  );

  function declareComplete() {
    if (!fingerprint || !readiness.readyToDeclare || running) return;
    try {
      const next = createWholeNovelCompletionDeclaration({
        project: snapshot.project,
        readiness,
        completionFingerprint: fingerprint,
      });
      saveWholeNovelCompletionDeclaration(next, window.localStorage);
      removeWholeNovelReview(projectId, window.localStorage);
      setDeclaration(next);
      setReview(null);
      setStatus("這個內容指紋已由作者標記為全書完稿。此動作沒有公開作品，也沒有產生品質分。 ");
    } catch (cause) {
      setStatus(reviewErrorMessage(cause));
    }
  }

  function revokeCompletion() {
    if (running || !window.confirm("確定撤回這個版本的完稿標記？本機保存的全書評分也會一併移除。")) return;
    removeWholeNovelCompletionDeclaration(projectId, window.localStorage);
    setDeclaration(null);
    setReview(null);
    setStatus("已撤回本機完稿標記與審查結果；正式章節與 Canon 沒有變更。 ");
  }

  async function rejectCandidate(result: ClosedAgentExecutionResult | null) {
    if (!result) return;
    await rejectStudioClosedAgentCandidate(result.candidate.id).catch(() => undefined);
  }

  async function runWholeNovelReview() {
    if (!declarationCurrent || !declaration || running || !fingerprint) return;
    const capacity = BACKEND_CAPACITY[backend];
    const chunks = planWholeNovelReviewChunks({
      snapshot,
      maximumChunkCharacters: capacity.maximumChunkCharacters,
    });
    if (!chunks.length || chunks.length > capacity.maximumChunks) {
      setStatus(reviewErrorMessage(Object.assign(new Error("capacity"), {
        code: "WHOLE_NOVEL_REVIEW_BACKEND_CAPACITY",
      })));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setReview(null);
    setProgress([]);
    setStatus("正在逐段交給真實閉端模型閱讀；所有片段覆蓋成功前，不會顯示總分。 ");
    const packets: WholeNovelChunkAnalysis[] = [];
    const executions: WholeNovelReviewExecutionProvenance[] = [];
    try {
      for (const [index, chunk] of chunks.entries()) {
        setStage(`完整覆蓋 ${index + 1}/${chunks.length}：${chunk.chapterTitle}（片段 ${chunk.chunkIndex}/${chunk.chunkCount}）`);
        let result: ClosedAgentExecutionResult | null = null;
        try {
          result = await executeStudioClosedAgent({
            projectId,
            taskType: "story.chapterReview",
            objective: buildWholeNovelChunkReviewObjective(snapshot.project.title, chunk),
            context: [{
              id: `whole-novel-source:${chunk.id}`,
              kind: "author-note",
              text: buildWholeNovelChunkContext(chunk),
              visibility: "both",
            }],
            preferredBackend: backend === "browser-ai" ? undefined : backend,
            qualityMode: "balanced",
            browserComputePolicy: backend === "browser-ai" ? "browser-first" : "manual",
            sourceChapterId: chunk.chapterId,
            sourceRevision: chunk.chapterRevision,
            storyBibleRevision: snapshot.storyBible?.revision ?? "current",
            knowledgeScopeRevision: maximumRevision(snapshot),
            promptProfileVersion: "whole-novel-chunk-review-v1",
            contextTokenBudget: capacity.chunkContextTokenBudget,
            generationOptions: {
              temperature: 0.2,
              topP: 0.85,
              maxTokens: 1_200,
              repetitionPenalty: 1.08,
            },
            signal: controller.signal,
            onProgress: (event) => setProgress((items) => [...items, event].slice(-12)),
          });
          const proof = verifiedWholeNovelReviewExecution({
            result,
            expectedBackend: backend,
            stage: "chunk-analysis",
            chunkId: chunk.id,
          });
          if (!proof) {
            throw Object.assign(new Error("WHOLE_NOVEL_MODEL_PROOF_INVALID"), {
              code: "WHOLE_NOVEL_MODEL_PROOF_INVALID",
            });
          }
          packets.push(parseWholeNovelChunkAnalysis(result.candidate.content, chunk));
          executions.push(proof);
        } finally {
          await rejectCandidate(result);
        }
      }

      const synthesisContext = buildWholeNovelSynthesisContext({
        project: snapshot.project,
        completionFingerprint: fingerprint,
        chunks,
        packets,
      });
      if (synthesisContext.length > capacity.maximumSynthesisCharacters) {
        throw Object.assign(new Error("WHOLE_NOVEL_SYNTHESIS_CAPACITY"), {
          code: "WHOLE_NOVEL_SYNTHESIS_CAPACITY",
        });
      }

      setStage("正在彙整全書大綱、七項評鑑與加權分數……");
      let synthesis: ClosedAgentExecutionResult | null = null;
      try {
        synthesis = await executeStudioClosedAgent({
          projectId,
          taskType: "story.plotAnalysis",
          objective: buildWholeNovelSynthesisObjective({
            projectTitle: snapshot.project.title,
            completionFingerprint: fingerprint,
            chapterIds: orderedChapters.map((chapter) => chapter.id),
          }),
          context: [{
            id: `whole-novel-synthesis:${fingerprint}`,
            kind: "evaluator-note",
            text: synthesisContext,
            visibility: "both",
          }],
          preferredBackend: backend === "browser-ai" ? undefined : backend,
          qualityMode: "balanced",
          browserComputePolicy: backend === "browser-ai" ? "browser-first" : "manual",
          storyBibleRevision: snapshot.storyBible?.revision ?? "current",
          knowledgeScopeRevision: maximumRevision(snapshot),
          promptProfileVersion: "whole-novel-synthesis-review-v1",
          contextTokenBudget: capacity.synthesisContextTokenBudget,
          generationOptions: {
            temperature: 0.25,
            topP: 0.88,
            maxTokens: 4_000,
            repetitionPenalty: 1.08,
          },
          signal: controller.signal,
          onProgress: (event) => setProgress((items) => [...items, event].slice(-12)),
        });
        const proof = verifiedWholeNovelReviewExecution({
          result: synthesis,
          expectedBackend: backend,
          stage: "whole-book-synthesis",
        });
        if (!proof) {
          throw Object.assign(new Error("WHOLE_NOVEL_MODEL_PROOF_INVALID"), {
            code: "WHOLE_NOVEL_MODEL_PROOF_INVALID",
          });
        }
        const modelReview = parseWholeNovelModelReview(synthesis.candidate.content, orderedChapters);
        executions.push(proof);
        const nextReview = createWholeNovelReviewContract({
          reviewId: `whole-novel-review:${crypto.randomUUID()}`,
          snapshot,
          declaration,
          currentCompletionFingerprint: fingerprint,
          chunks,
          packets,
          modelReview,
          executions,
          backendId: backend,
          publicMetadata: {
            authorDisplayName,
            category: publicCategory,
            synopsis: publicSynopsis,
          },
        });
        saveWholeNovelReview(nextReview, window.localStorage);
        setReview(nextReview);
        setStatus(nextReview.eligibleForPublicLounge
          ? `全書審查完成：${nextReview.totalScore} 分，達到 ${WHOLE_NOVEL_LOUNGE_THRESHOLD} 分小說交誼廳品質門檻；仍未公開，必須由作者另行 opt-in。`
          : `全書審查完成：${nextReview.totalScore} 分，尚未達到 ${WHOLE_NOVEL_LOUNGE_THRESHOLD} 分小說交誼廳品質門檻；作品仍未公開。`);
      } finally {
        await rejectCandidate(synthesis);
      }
    } catch (cause) {
      setStatus(reviewErrorMessage(cause));
    } finally {
      abortRef.current = null;
      setRunning(false);
      setStage("");
    }
  }

  function downloadReview() {
    if (!reviewCurrent || !review) return;
    const blob = new Blob([JSON.stringify(review, null, 2)], { type: "application/json;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${safeFilename(snapshot.project.title)}-whole-novel-review.json`;
    anchor.click();
    URL.revokeObjectURL(href);
    setStatus("已匯出本機審查契約；這不是公開動作，也沒有連接小說交誼廳後端。 ");
  }

  return (
    <section className={styles.completionReview} aria-labelledby="whole-novel-review-title">
      <header>
        <div>
          <small>TRUE CLOSED AI · FULL COVERAGE · NO AUTO-PUBLISH</small>
          <h2 id="whole-novel-review-title">全書完稿審查</h2>
          <p>先由作者標記固定完稿版本，再逐段覆蓋全部正文並彙整全書。品質分不等於人氣；固定規則只負責 Gate、加權與驗證，從不冒充閉端 AI 閱讀。</p>
        </div>
        <strong>{reviewCurrent && review ? `${review.totalScore} / 100` : "尚未評分"}</strong>
      </header>

      <p className={styles.advisorStatus} role="status">{status}</p>

      <div className={styles.completionGate}>
        <div><small>有正文章節</small><b>{readiness.substantiveChapterCount}</b></div>
        <div><small>已完成章節</small><b>{readiness.completedChapterCount}</b></div>
        <div><small>完整輸入字元</small><b>{readiness.totalInputCharacters.toLocaleString("zh-TW")}</b></div>
        <div><small>忽略空白下一章</small><b>{readiness.ignoredEmptyDraftCount}</b></div>
      </div>

      <div className={styles.advisorActions}>
        {!declarationCurrent ? (
          <button
            type="button"
            className={styles.primary}
            disabled={!readiness.readyToDeclare || !fingerprint || running}
            onClick={declareComplete}
          >
            標記此內容指紋為全書完稿
          </button>
        ) : (
          <button type="button" disabled={running} onClick={revokeCompletion}>撤回完稿標記</button>
        )}
      </div>

      {declarationCurrent ? (
        <div className={styles.reviewControls}>
          <div className={styles.publicMetadataInputs}>
            <label>
              公開作者名（不從專案 ID 猜測）
              <input
                value={authorDisplayName}
                maxLength={80}
                disabled={running}
                onChange={(event) => setAuthorDisplayName(event.target.value)}
                placeholder="公開前必填；可先留白完成私有審查"
              />
            </label>
            <label>
              公開分類
              <input value={publicCategory} maxLength={120} disabled={running} onChange={(event) => setPublicCategory(event.target.value)} />
            </label>
            <label>
              公開簡介
              <textarea value={publicSynopsis} maxLength={1_200} disabled={running} onChange={(event) => setPublicSynopsis(event.target.value)} />
            </label>
          </div>
          <label>
            真實閉端執行者
            <select value={backend} disabled={running} onChange={(event) => setBackend(event.target.value as ReviewBackend)}>
              <option value="browser-ai">瀏覽器內 WebLLM（免本機 Bridge；最多 18 個覆蓋片段）</option>
              <option value="local-ollama">個人本機 Ollama（最多 18 個覆蓋片段）</option>
              <option value="private-ai-hub">私有 AI Hub（最多 72 個覆蓋片段）</option>
            </select>
          </label>
          <div className={styles.advisorActions}>
            <button type="button" className={styles.primary} disabled={running} onClick={() => void runWholeNovelReview()}>
              {running ? "閉端 AI 正在閱讀全書……" : "開始全書完稿審查"}
            </button>
            {running ? <button type="button" onClick={() => abortRef.current?.abort()}>取消</button> : null}
            <Link href={`/studio/project/${encodeURIComponent(projectId)}/closed-ai`}>啟動／配對／實測閉端 AI</Link>
          </div>
        </div>
      ) : null}

      {stage ? <p className={styles.reviewStage}>{stage}</p> : null}
      {progress.length ? (
        <ol className={styles.progress} aria-label="全書閉端 AI 執行進度">
          {progress.map((event, index) => (
            <li key={`${event.taskId}-${event.occurredAt}-${index}`}>
              <strong>{event.percent}%</strong><span>{event.label}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <details className={styles.rubric} open>
        <summary>公開權重（合計 100）</summary>
        <div>
          {WHOLE_NOVEL_REVIEW_RUBRIC.map((item) => (
            <article key={item.key}>
              <b>{item.label} · {item.weight}%</b>
              <p>{item.criteria}</p>
            </article>
          ))}
        </div>
      </details>

      {review ? (
        <article className={`${styles.reviewResult} ${reviewCurrent ? "" : styles.staleReview}`} data-testid="whole-novel-review-result">
          <header>
            <div>
              <small>{reviewCurrent ? "目前完稿版本" : "舊版本 · 已失效"}</small>
              <h3>{review.eligibleForPublicLounge ? "達到小說交誼廳品質門檻" : "尚未達到小說交誼廳品質門檻"}</h3>
              <p>品質分 {review.totalScore}／100；門檻 {review.loungeEligibility.threshold}。作品目前狀態：未公開，仍需作者 opt-in。</p>
            </div>
            <button type="button" disabled={!reviewCurrent} onClick={downloadReview}>匯出審查 JSON</button>
          </header>

          <section className={styles.publicMetadata} aria-label="公開書庫資訊欄位">
            <h4>小說交誼廳公開欄位預覽</h4>
            <dl>
              <div><dt>標題</dt><dd>{review.publicMetadata.title}</dd></div>
              <div><dt>作者</dt><dd>{review.publicMetadata.authorDisplayName ?? "未設定（公開前必填）"}</dd></div>
              <div><dt>分類</dt><dd>{review.publicMetadata.category ?? "未設定"}</dd></div>
              <div><dt>完結狀態</dt><dd>作者已標記完稿</dd></div>
              <div><dt>字數／章數</dt><dd>{review.publicMetadata.nonWhitespaceCharacters.toLocaleString("zh-TW")} 字／{review.publicMetadata.chapterCount} 章</dd></div>
              <div><dt>完成／更新</dt><dd>{new Date(review.publicMetadata.completedAt).toLocaleDateString("zh-TW")}／{new Date(review.publicMetadata.updatedAt).toLocaleDateString("zh-TW")}</dd></div>
            </dl>
            <p>簡介：{review.publicMetadata.synopsis ?? "未設定（公開前必填）"}</p>
          </section>

          <PublicLoungePublicationPanel
            key={review.reviewId}
            review={review}
            reviewCurrent={reviewCurrent}
            chapters={orderedChapters.map((chapter) => ({
              id: chapter.id,
              title: chapter.title,
              content: chapter.content,
            }))}
          />

          <section>
            <h4>全書逐章大綱</h4>
            <ol className={styles.outline}>
              {review.outline.map((item) => (
                <li key={item.chapterId}>
                  <b>{item.title}</b>
                  <p>{item.summary}</p>
                  <span>關鍵轉折：{item.keyTurn}</span>
                  <span>章末狀態：{item.endingState}</span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h4>七項評鑑</h4>
            <div className={styles.dimensionGrid}>
              {WHOLE_NOVEL_REVIEW_RUBRIC.map((rubric) => {
                const item = review.dimensions[rubric.key];
                return (
                  <article key={rubric.key}>
                    <header><b>{item.label}</b><strong>{item.score} × {item.weight}% = {item.weightedPoints}</strong></header>
                    <p><b>證據：</b>{item.evidence.join("；") || "模型未列短證據"}</p>
                    <p><b>優點：</b>{item.strengths.join("；") || "未列"}</p>
                    <p><b>問題：</b>{item.issues.join("；") || "未見重大問題"}</p>
                    <p><b>修訂：</b>{item.recommendations.join("；") || "未列"}</p>
                  </article>
                );
              })}
            </div>
          </section>

          <section className={styles.verdict}>
            <h4>總編結論</h4>
            <p>{review.editorialVerdict}</p>
            <ol>{review.priorityRevisions.map((item) => <li key={item}>{item}</li>)}</ol>
          </section>

          <details>
            <summary>完整覆蓋與模型證明</summary>
            <p>
              覆蓋 {review.coverage.substantiveChapterCount} 章、{review.coverage.chunkCount} 片、
              {review.coverage.inputCharacters.toLocaleString("zh-TW")} 個輸入字元；
              {review.provenance.executions.length} 份 verified receipt；後端 {review.provenance.backendId}；
              deterministic fallback：未使用；Canon 寫入：0；資料離開裝置：否。
            </p>
            <p>內容指紋：{review.completion.completionFingerprint}</p>
            <p>模型：{[...new Set(review.provenance.executions.map((item) => `${item.modelId} (${item.modelDigest})`))].join("；")}</p>
          </details>
        </article>
      ) : null}
    </section>
  );
}
