"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NovelProject } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  approveLearningRule,
  buildApprovedLearningContext,
  clearLearningSourceQuarantine,
  createSovereignLearningRepository,
  createSovereignLearningSnapshot,
  generateNarrativeRecipes,
  getSovereignLearningDashboard,
  ingestLearningSource,
  rejectLearningRule,
  replaceLearningRule,
  restoreSovereignLearningSnapshot,
  revokeLearningSource,
  type LearningRightsBasis,
  type LearningSourceKind,
  type SovereignLearningSnapshot,
} from "@/lib/novel-ai/sovereign-learning";
import { runStudioClosedAI } from "@/lib/novel-ai/web/studio-closed-ai";
import ProjectNavigation from "../project-navigation";
import styles from "./learning.module.css";

type Dashboard = Awaited<ReturnType<typeof getSovereignLearningDashboard>>;
type RecipeResult = ReturnType<typeof generateNarrativeRecipes>;

const sourceKindOptions: Array<[LearningSourceKind, string]> = [
  ["article", "文章"],
  ["book_excerpt", "書籍節選"],
  ["ai_output", "其他 AI 的輸出"],
  ["personal_note", "自己的筆記"],
  ["public_domain_work", "公版作品"],
  ["licensed_material", "已授權資料"],
];

const rightsOptions: Array<[LearningRightsBasis, string]> = [
  ["lawful_private_reference", "合法取得，只供本機私人分析"],
  ["owned_by_user", "我擁有內容權利"],
  ["public_domain", "已確認為公版"],
  ["licensed_for_analysis", "已取得分析／衍生使用授權"],
  ["ai_output_authorized", "AI 輸出，已獲准供本機分析"],
];

const taskOptions = [
  ["continue_writing", "續寫"],
  ["rewrite", "改寫"],
  ["dialogue_generation", "對話"],
  ["scene_expansion", "擴寫場景"],
  ["outline_generation", "規劃大綱"],
] as const;

function errorMessage(error: unknown) {
  const code = String((error as { code?: string })?.code || "");
  if (code === "NO_CLOSED_PROVIDER_AVAILABLE" || code === "CLOSED_PROVIDER_UNAVAILABLE") {
    return "本機模型目前不可用；你可以取消「閉端 AI 深度抽象」，先使用本機統計規則分析。";
  }
  if (code === "LEARNING_CREDENTIAL_INPUT_BLOCKED") {
    return "內容中疑似含有登入權杖或 API 金鑰，已安全阻止匯入。請先移除敏感字串。";
  }
  return error instanceof Error ? error.message : "操作失敗，請稍後重試。";
}

export default function LearningWorkspace({ projectId }: { projectId: string }) {
  const learningRepository = useMemo(() => createSovereignLearningRepository(), []);
  const projectRepository = useMemo(() => createNovelRepository(), []);
  const [projectTitle, setProjectTitle] = useState("目前作品");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [status, setStatus] = useState("正在讀取本機學習庫。");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [sourceKind, setSourceKind] = useState<LearningSourceKind>("article");
  const [rightsBasis, setRightsBasis] = useState<LearningRightsBasis>("lawful_private_reference");
  const [rightsEvidence, setRightsEvidence] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [deepExtraction, setDeepExtraction] = useState(true);
  const [content, setContent] = useState("");
  const [recipeTask, setRecipeTask] = useState("continue_writing");
  const [recipeSeed, setRecipeSeed] = useState("第一組");
  const [recipes, setRecipes] = useState<RecipeResult | null>(null);

  const load = useCallback(async (announce = true) => {
    const next = await getSovereignLearningDashboard(learningRepository, projectId);
    setDashboard(next);
    if (announce) setStatus("本機學習庫已就緒。");
  }, [learningRepository, projectId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getSovereignLearningDashboard(learningRepository, projectId),
      projectRepository.get<NovelProject>("projects", projectId),
    ]).then(([next, project]) => {
      if (cancelled) return;
      setDashboard(next);
      setStatus("本機學習庫已就緒。");
      if (project?.title) setProjectTitle(project.title);
    }).catch((error) => {
      if (!cancelled) setStatus(errorMessage(error));
    });
    return () => {
      cancelled = true;
    };
  }, [learningRepository, projectId, projectRepository]);

  async function analyze() {
    if (busy) return;
    setBusy(true);
    setStatus("正在檢查來源、授權與敏感資料。");
    try {
      const result = await ingestLearningSource(learningRepository, {
        projectId,
        title,
        author,
        sourceReference,
        sourceKind,
        rightsBasis,
        rightsEvidence,
        userConfirmedRights: rightsConfirmed,
        content,
        deepExtractor: deepExtraction
          ? async ({ prompt }) => {
            const result = await runStudioClosedAI({
              projectId,
              task: "knowledge_rule_extraction",
              input: prompt,
            });
            return {
              content: result.content,
              provider: result.provider,
              model: result.model,
              externalRequest: result.externalRequest,
              dataLeftDevice: result.dataLeftDevice,
            };
          }
          : undefined,
        onProgress: ({ phase, current, total }) => {
          const labels = {
            validating: "正在檢查來源與安全邊界",
            deterministic: "正在計算文章敘事 DNA",
            deep_extraction: "閉端 AI 正在抽象創作規則",
            persisting: "正在寫入本機候選規則",
          };
          setStatus(`${labels[phase]}${total > 1 ? `（${current}/${total}）` : ""}。`);
        },
      });
      setStatus(
        result.duplicate
          ? `這份來源已分析過，沿用 ${result.rules.length} 條既有規則。`
          : `分析完成：建立 ${result.rules.length} 條規則候選；原文未保存。${result.deepExtractionFailures ? ` 有 ${result.deepExtractionFailures} 段深度抽象失敗，已保留本機統計結果。` : ""}`,
      );
      setContent("");
      setRightsConfirmed(false);
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function approve(ruleId: string) {
    setBusy(true);
    try {
      await approveLearningRule(learningRepository, projectId, ruleId);
      setStatus("規則已核准，之後的閉端 AI 生成會把它列入可用規則。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function reject(ruleId: string) {
    setBusy(true);
    try {
      await rejectLearningRule(learningRepository, projectId, ruleId);
      setStatus("規則已拒絕，不會進入生成上下文。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function replace(ruleId: string) {
    setBusy(true);
    try {
      const result = await replaceLearningRule(learningRepository, projectId, ruleId);
      setStatus(`新規則已核准，並取代 ${result.superseded.length} 條衝突規則。`);
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function clearQuarantine(sourceId: string) {
    if (!window.confirm("你已人工檢查這份來源中的可疑指令，確定只把它當資料分析嗎？")) return;
    setBusy(true);
    try {
      await clearLearningSourceQuarantine(
        learningRepository,
        projectId,
        sourceId,
        true,
      );
      setStatus("來源已解除隔離；規則仍是候選，必須逐條核准。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(sourceId: string) {
    if (!window.confirm("撤銷後，這個來源的所有規則會立即停止影響 AI。確定繼續？")) return;
    setBusy(true);
    try {
      await revokeLearningSource(learningRepository, projectId, sourceId);
      setStatus("來源與其規則已撤銷，不再參與任何組合或生成。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function buildRecipes() {
    setBusy(true);
    try {
      const context = await buildApprovedLearningContext({
        repository: learningRepository,
        projectId,
        taskType: recipeTask,
        maximumRules: 12,
      });
      const result = generateNarrativeRecipes({
        rules: context.rules,
        taskType: recipeTask,
        count: 3,
        seed: recipeSeed,
      });
      setRecipes(result);
      setStatus(
        result.recipes.length
          ? `已從核准規則建立 ${result.recipes.length} 組原創配方。`
          : "目前沒有足夠的已核准規則；請先核准候選。",
      );
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportSnapshot() {
    setBusy(true);
    try {
      const snapshot = await createSovereignLearningSnapshot(
        learningRepository,
        projectId,
      );
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${projectTitle}-閉端AI學習庫.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("學習庫快照已匯出；快照不含來源原文。");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function importSnapshot(file: File) {
    if (!window.confirm("還原會取代這個作品目前的閉端 AI 學習庫。確定繼續？")) return;
    setBusy(true);
    try {
      const snapshot = JSON.parse(await file.text()) as SovereignLearningSnapshot;
      await restoreSovereignLearningSnapshot(
        learningRepository,
        snapshot,
        projectId,
      );
      setStatus("學習庫快照雜湊驗證通過，已完成還原。");
      await load(false);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const candidateRules = dashboard?.rules.filter((rule) =>
    rule.status === "candidate" || rule.status === "quarantined") ?? [];
  const approvedRules = dashboard?.rules.filter((rule) => rule.status === "approved") ?? [];

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/studio">返回作品</Link>
        <div>
          <small>{projectTitle}</small>
          <h1>閉端 AI 規則學習中心</h1>
          <p>吸收敘事機制，不保存原文、不模仿原句；所有規則先成為候選，經你核准才生效。</p>
        </div>
        <span className={styles.localBadge}>本機限定</span>
      </header>
      <ProjectNavigation projectId={projectId} active="learning" />

      <section className={styles.statusGrid} aria-label="學習狀態">
        <article><small>有效來源</small><strong>{dashboard?.counts.activeSources ?? 0}</strong></article>
        <article><small>待核准規則</small><strong>{dashboard?.counts.candidateRules ?? 0}</strong></article>
        <article><small>已核准規則</small><strong>{dashboard?.counts.approvedRules ?? 0}</strong></article>
        <article><small>有效組合空間</small><strong>{dashboard?.combinationSpace.display ?? "0"}</strong></article>
      </section>

      <p className={styles.status} role="status" aria-live="polite">{status}</p>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><small>步驟 1</small><h2>匯入並抽象規則</h2></div>
            <span>原文分析後丟棄</span>
          </div>
          <label>來源標題<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：某篇節奏分析文章" /></label>
          <div className={styles.twoColumns}>
            <label>來源類型
              <select value={sourceKind} onChange={(event) => {
                const kind = event.target.value as LearningSourceKind;
                setSourceKind(kind);
                if (kind === "ai_output") setRightsBasis("ai_output_authorized");
              }}>
                {sourceKindOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>權利依據
              <select value={rightsBasis} onChange={(event) => setRightsBasis(event.target.value as LearningRightsBasis)}>
                {rightsOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>
          <div className={styles.twoColumns}>
            <label>作者／提供者<input value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
            <label>來源網址或識別資料<input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} /></label>
          </div>
          <label>授權證據或備註<input value={rightsEvidence} onChange={(event) => setRightsEvidence(event.target.value)} placeholder="公版年份、授權條款或取得方式" /></label>
          <label>貼上文章或 AI 輸出
            <textarea rows={12} value={content} onChange={(event) => setContent(event.target.value)} placeholder="原文只用於這次本機分析，不會寫入學習庫。" />
          </label>
          <label className={styles.fileLabel}>或載入本機文字檔
            <input type="file" accept=".txt,.md,.html,.json,text/plain,text/markdown,text/html,application/json" onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                setContent(text);
                setTitle((current) => current || file.name);
              }).catch((error) => setStatus(errorMessage(error)));
            }} />
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={deepExtraction} onChange={(event) => setDeepExtraction(event.target.checked)} />
            若本機 Ollama／瀏覽器閉端 AI 可用，進行深度規則抽象
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
            我確認有權在自己的裝置上分析此內容，並了解來源文字不會被當成系統指令
          </label>
          <button type="button" disabled={busy || !content.trim() || !title.trim() || !rightsConfirmed} onClick={() => void analyze()}>
            {busy ? "處理中…" : "分析並建立規則候選"}
          </button>
          <p className={styles.note}>若偵測到密鑰、提示注入或隱藏指令，系統會阻擋或隔離；不會偷偷抓取網站，也不會把作品送到外部 AI。</p>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><small>步驟 2</small><h2>逐條核准候選</h2></div>
            <span>{candidateRules.length} 條</span>
          </div>
          <div className={styles.ruleList}>
            {candidateRules.length === 0 ? <p className={styles.empty}>目前沒有待處理候選。</p> : candidateRules.map((rule) => (
              <article className={styles.ruleCard} key={rule.id} data-status={rule.status}>
                <header>
                  <span>{rule.family} / {rule.dimension}</span>
                  <b>{rule.status === "quarantined" ? "隔離中" : `${Math.round(rule.confidence * 100)}%`}</b>
                </header>
                <h3>{rule.statement}</h3>
                <dl>
                  <div><dt>適用</dt><dd>{rule.recipe.when}</dd></div>
                  <div><dt>操作</dt><dd>{rule.recipe.operation}</dd></div>
                  <div><dt>限制</dt><dd>{rule.recipe.constraint}</dd></div>
                  <div><dt>檢查</dt><dd>{rule.recipe.evaluate}</dd></div>
                </dl>
                <p>抽象度 {Math.round(rule.abstractionScore * 100)}% · 來源連續比對 {rule.longestSourceMatch} 字 · {rule.extractorKind === "local_closed_ai" ? "閉端 AI" : "本機統計"}</p>
                {rule.status === "candidate" ? <div className={styles.actions}>
                  <button type="button" disabled={busy} onClick={() => void approve(rule.id)}>核准</button>
                  {rule.conflictRuleIds.length ? <button type="button" disabled={busy} onClick={() => void replace(rule.id)}>取代衝突規則</button> : null}
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => void reject(rule.id)}>拒絕</button>
                </div> : <p className={styles.warning}>來源仍在安全隔離；先到來源紀錄人工確認。</p>}
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div><small>步驟 3</small><h2>測試規則排列與組合</h2></div>
          <span>不窮舉無效組合</span>
        </div>
        <div className={styles.recipeToolbar}>
          <label>用途
            <select value={recipeTask} onChange={(event) => setRecipeTask(event.target.value)}>
              {taskOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>變化種子<input value={recipeSeed} onChange={(event) => setRecipeSeed(event.target.value)} /></label>
          <button type="button" disabled={busy || approvedRules.length === 0} onClick={() => void buildRecipes()}>建立三組配方</button>
        </div>
        <div className={styles.recipeGrid}>
          {recipes?.recipes.map((recipe) => (
            <article key={recipe.recipeId}>
              <h3>{recipe.recipeId}</h3>
              <ol>{recipe.steps.map((step, index) => <li key={`${recipe.recipeId}:step:${index}`}>{step}</li>)}</ol>
              <details><summary>限制與驗收</summary>
                <ul>{recipe.constraints.map((item, index) => <li key={`${recipe.recipeId}:constraint:${index}`}>{item}</li>)}</ul>
                <ul>{recipe.evaluation.map((item, index) => <li key={`${recipe.recipeId}:evaluation:${index}`}>{item}</li>)}</ul>
              </details>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><small>來源治理</small><h2>來源與撤銷</h2></div></div>
          <div className={styles.sourceList}>
            {dashboard?.sources.length ? dashboard.sources.map((source) => (
              <article key={source.id}>
                <div><strong>{source.title}</strong><span>{source.status} · {source.sourceKind}</span></div>
                <p>{source.language} · 信任分數 {Math.round(source.trustScore * 100)}% · 原文保存：否</p>
                {source.warningCodes.length ? <details><summary>{source.warningCodes.length} 項安全紀錄</summary><code>{source.warningCodes.join("\n")}</code></details> : null}
                <div className={styles.actions}>
                  {source.status === "quarantined" ? <button type="button" disabled={busy} onClick={() => void clearQuarantine(source.id)}>人工檢查後解除隔離</button> : null}
                  {source.status !== "revoked" ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void revoke(source.id)}>撤銷來源</button> : null}
                </div>
              </article>
            )) : <p className={styles.empty}>尚未匯入來源。</p>}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><small>復原與真相</small><h2>備份、還原與能力邊界</h2></div></div>
          <ul className={styles.truthList}>
            <li>已實作：本機規則抽象、候選核准、來源撤銷、規則組合、回饋偏好與防抄指紋。</li>
            <li>本機深度抽象：需 Ollama 或瀏覽器閉端 AI 可用；失敗時不會假裝成功。</li>
            <li>自我學習方式：核准規則＋本機 RAG／提示偏好，不會在背景偷偷改模型權重。</li>
            <li>尚未執行：LoRA／QLoRA、模型權重訓練與自動模型升級。</li>
            <li>來源原文與生成全文均不寫入學習紀錄，只保存雜湊、指紋與抽象規則。</li>
          </ul>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => void exportSnapshot()}>匯出學習庫快照</button>
            <label className={styles.importButton}>還原快照
              <input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importSnapshot(file);
                event.target.value = "";
              }} />
            </label>
          </div>
        </section>
      </div>
    </main>
  );
}
