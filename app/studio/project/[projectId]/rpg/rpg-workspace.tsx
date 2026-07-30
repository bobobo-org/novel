"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  makeRecord,
  optionalValue,
  type Chapter,
  type Character,
  type NovelProject,
  type StoryBible,
  type StoryState,
} from "@/lib/novel-ai/domain";
import {
  RPG_CHARACTER_LIBRARY_STORAGE_KEY,
  createRpgCharacterTemplate,
  mergeCharacterLibrary,
  parseRpgCharacterLibrary,
  type RpgCharacterTemplate,
} from "@/lib/novel-ai/game/character-library";
import {
  RPG_STAT_DEFINITIONS,
  buildRpgChoices,
  initialRpgStats,
  readRpgProgression,
  rpgFormulaExplanation,
  type RpgChoice,
} from "@/lib/novel-ai/game/progression/rpg-progression";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  acceptStudioChoice,
  persistStudioChoiceCandidate,
  type StudioProjectSeed,
} from "@/lib/novel-ai/repository/studio-canonical";
import ProjectNavigation from "../project-navigation";
import styles from "./rpg.module.css";

type WorkspaceData = {
  project: NovelProject;
  chapter: Chapter;
  storyState: StoryState;
  storyBible: StoryBible;
  characters: Character[];
};

const FORMULA = rpgFormulaExplanation();

function readCustomLibrary() {
  try {
    return parseRpgCharacterLibrary(
      typeof window.localStorage === "undefined"
        ? null
        : window.localStorage.getItem(RPG_CHARACTER_LIBRARY_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

function studioSeed(data: WorkspaceData): StudioProjectSeed {
  const protagonist = data.characters.find((character) =>
    data.storyBible.protagonistIds.includes(character.id)) ?? data.characters[0];
  return {
    id: data.project.id,
    title: data.project.title,
    chapterTitle: data.chapter.title,
    draft: data.chapter.content,
    packId: data.project.genrePackId,
    topicId: data.project.genreId,
    subCategory: data.project.subgenreId,
    coreIdea: data.project.coreIdea.value,
    protagonist: protagonist?.name ?? null,
    style: data.project.narrativeStyle.value,
  };
}

function errorMessage(error: unknown) {
  const code = String((error as { code?: string })?.code ?? "");
  const labels: Record<string, string> = {
    PROJECT_REVISION_CONFLICT: "作品在你選擇時已有更新，請重新整理三選一。",
    CHAPTER_REVISION_CONFLICT: "章節內容已更新，請重新整理三選一。",
    STORY_STATE_REVISION_CONFLICT: "能力值已有新變化，請重新整理。",
    CANDIDATE_STALE: "這個選項已過期，請產生新一輪選擇。",
    RPG_CHARACTER_NAME_REQUIRED: "角色姓名不能空白。",
  };
  return labels[code] ?? (error instanceof Error ? error.message : "操作未完成，請再試一次。");
}

export default function RpgWorkspace({ projectId }: { projectId: string }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [customLibrary, setCustomLibrary] = useState<RpgCharacterTemplate[]>([]);
  const [status, setStatus] = useState("正在載入故事狀態與角色養成資料。");
  const [busy, setBusy] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<RpgChoice | null>(null);
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("");
  const [identity, setIdentity] = useState("");
  const [personality, setPersonality] = useState("");
  const [goal, setGoal] = useState("");

  const load = useCallback(async () => {
    const repository = createNovelRepository();
    const project = await repository.get<NovelProject>("projects", projectId);
    if (!project) throw new Error("找不到這個作品。");
    const [chapters, states, bibles, characters] = await Promise.all([
      repository.list<Chapter>("chapters", projectId),
      repository.list<StoryState>("storyStates", projectId),
      repository.list<StoryBible>("storyBibles", projectId),
      repository.list<Character>("characters", projectId),
    ]);
    const chapter = chapters.find((item) => item.id === project.activeChapterId)
      ?? [...chapters].sort((left, right) => left.order - right.order).at(-1);
    const storyState = states.find((item) => item.id === project.storyStateId) ?? states[0];
    const storyBible = bibles.find((item) => item.id === project.storyBibleId) ?? bibles[0];
    if (!chapter || !storyState || !storyBible) {
      throw new Error("作品缺少章節、故事狀態或 Story Bible，無法啟動 RPG。");
    }
    setData({ project, chapter, storyState, storyBible, characters });
    setStatus("RPG 三選一、養成公式與人物庫已就緒。");
  }, [projectId]);

  useEffect(() => {
    void Promise.resolve()
      .then(() => setCustomLibrary(readCustomLibrary()))
      .then(load)
      .catch((error) => setStatus(errorMessage(error)));
  }, [load]);

  const protagonist = data?.characters.find((character) =>
    data.storyBible.protagonistIds.includes(character.id)) ?? data?.characters[0] ?? null;
  const progression = useMemo(
    () => data
      ? readRpgProgression(data.storyState, `${data.project.title}|${protagonist?.name ?? ""}`)
      : null,
    [data, protagonist?.name],
  );
  const activated = Boolean(data?.storyState.protagonistStats["rpg.xp"] !== undefined);
  const choices = useMemo(
    () => data && progression
      ? buildRpgChoices({
        progression,
        protagonist: protagonist?.name ?? "主角",
        chapterTitle: data.chapter.title,
        conflict: data.project.coreIdea.value
          ?? data.chapter.summary
          ?? data.chapter.content.slice(-180)
          ?? "目前局勢",
      })
      : [],
    [data, progression, protagonist?.name],
  );
  const library = useMemo(
    () => mergeCharacterLibrary(customLibrary),
    [customLibrary],
  );

  function persistCustomLibrary(next: RpgCharacterTemplate[]) {
    setCustomLibrary(next);
    try {
      window.localStorage?.setItem(
        RPG_CHARACTER_LIBRARY_STORAGE_KEY,
        JSON.stringify(next.filter((template) => !template.builtin)),
      );
    } catch {
      setStatus("人物已保留在本次工作階段；目前瀏覽器封鎖本機儲存，重新開啟頁面後可能不會保留。");
    }
  }

  async function initializeProgression() {
    if (!data || busy) return;
    setBusy(true);
    try {
      const defaults = initialRpgStats(`${data.project.title}|${protagonist?.name ?? ""}`);
      await createNovelRepository().put<StoryState>("storyStates", {
        ...data.storyState,
        protagonistStats: {
          ...data.storyState.protagonistStats,
          ...defaults,
          "rpg.xp": 0,
        },
      }, data.storyState.revision);
      await load();
      setStatus("角色養成已啟用：初始能力依作品與主角種子計算，尚未改動正文。");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function acceptChoice(choice: RpgChoice) {
    if (!data || busy || !activated) return;
    setBusy(true);
    setStatus(`正在建立分支候選：${choice.key}｜${choice.title}`);
    try {
      const repository = createNovelRepository();
      const saved = await persistStudioChoiceCandidate(
        repository,
        studioSeed(data),
        {
          optionKey: choice.key,
          text: choice.title,
          consequence: `${choice.consequence}；預估成功率 ${choice.successChance}%`,
          effect: choice.effect,
          providerId: "deterministic-local",
          modelId: "novel-rpg-formula-v1",
        },
      );
      await acceptStudioChoice(
        repository,
        saved.candidate.id,
        choice.acceptedText,
        `${choice.key}｜${choice.title}`,
      );
      setSelectedChoice(null);
      await load();
      setStatus(`已接受 ${choice.key}｜${choice.title}：章節、能力、任務、成就與分支已在同一筆核准交易中更新。`);
    } catch (error) {
      setStatus(errorMessage(error));
      await load().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  function saveTemplate() {
    try {
      const template = createRpgCharacterTemplate({
        name,
        archetype,
        identity,
        personality,
        goal,
      });
      persistCustomLibrary([...customLibrary, template]);
      setName("");
      setArchetype("");
      setIdentity("");
      setPersonality("");
      setGoal("");
      setStatus(`「${template.name}」已加入你的本機人物庫，可放入任何作品。`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  }

  async function addCharacterToProject(template: RpgCharacterTemplate) {
    if (!data || busy) return;
    setBusy(true);
    try {
      const repository = createNovelRepository();
      const base = makeRecord(projectId, "user");
      const character: Character = {
        ...base,
        name: template.name,
        aliases: [],
        identity: optionalValue(template.identity || template.archetype, "user_defined"),
        personality: optionalValue(template.personality, template.personality ? "user_defined" : "deferred"),
        goal: optionalValue(template.goal, template.goal ? "user_defined" : "deferred"),
        lifeStatus: "alive",
        locationId: null,
        fears: template.fears,
        privateSecrets: [],
        factionIds: [],
        values: template.values,
        capabilities: template.capabilities,
        limitations: template.limitations,
        voiceStyle: {
          formality: 50,
          directness: 55,
          emotionalExpressiveness: 55,
          sentenceLength: "mixed",
          preferredAddressTerms: [],
        },
      };
      await repository.put("characters", character);
      await repository.put<StoryBible>("storyBibles", {
        ...data.storyBible,
        characterIds: [...new Set([...data.storyBible.characterIds, character.id])],
      }, data.storyBible.revision);
      await load();
      setStatus(`「${template.name}」已從人物庫加入目前作品；不會自動成為主角或改寫 Canon。`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function removeTemplate(template: RpgCharacterTemplate) {
    if (template.builtin) return;
    persistCustomLibrary(customLibrary.filter((item) => item.templateId !== template.templateId));
    setStatus(`「${template.name}」已從本機人物庫移除；作品內既有角色不受影響。`);
  }

  if (!data || !progression) {
    return (
      <main className={styles.shell}>
        <p className={styles.loading} role="status">{status}</p>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <small>INTERACTIVE STORY RPG · GROWTH ENGINE</small>
          <h1>命運三選一</h1>
          <p>每次決定都能推進正文、能力、任務、成就與分支；未按核准前不修改 Canon。</p>
        </div>
        <div className={styles.levelBadge}>
          <span>LV.</span>
          <strong>{progression.level}</strong>
          <small>戰力 {progression.powerScore}</small>
        </div>
      </header>

      <ProjectNavigation projectId={projectId} active="rpg" />
      <p className={styles.status} role="status" aria-live="polite">{status}</p>

      <section className={styles.hero}>
        <div>
          <span>目前冒險者</span>
          <h2>{protagonist?.name ?? "尚未指定主角"}</h2>
          <p>{data.project.title} · {data.chapter.title}</p>
        </div>
        <div className={styles.xpBlock}>
          <div><span>EXP {progression.xp}</span><b>{progression.levelProgress}%</b></div>
          <progress
            max={Math.max(1, progression.nextLevelXp - progression.currentLevelXp)}
            value={Math.max(0, progression.xp - progression.currentLevelXp)}
          />
          <small>下一級累積門檻 {progression.nextLevelXp} EXP</small>
        </div>
        <Link href={`/studio/project/${projectId}/closed-ai`}>
          交給閉端 AI 設計高階任務
        </Link>
      </section>

      <section className={styles.statGrid} aria-label="角色能力值">
        {RPG_STAT_DEFINITIONS.map((definition) => (
          <article key={definition.key}>
            <span>{definition.label}</span>
            <strong>{progression.stats[definition.key]}</strong>
            <progress max={100} value={progression.stats[definition.key]} />
            <small>{definition.description}</small>
          </article>
        ))}
      </section>

      {!activated ? (
        <section className={styles.activation}>
          <div>
            <small>尚未寫入任何 RPG 能力</small>
            <h2>啟用本作品的角色養成</h2>
            <p>只建立初始能力值與 0 EXP，不會改寫章節、角色設定或 Story Bible。</p>
          </div>
          <button type="button" disabled={busy} onClick={() => void initializeProgression()}>
            啟用養成系統
          </button>
        </section>
      ) : (
        <section className={styles.choiceSection}>
          <header>
            <div><small>ROUND CHOICE</small><h2>主角接下來要怎麼做？</h2></div>
            <button type="button" disabled={busy} onClick={() => setSelectedChoice(null)}>重新檢視</button>
          </header>
          <div className={styles.choiceGrid}>
            {choices.map((choice) => (
              <button
                key={choice.key}
                type="button"
                className={selectedChoice?.key === choice.key ? styles.selected : ""}
                onClick={() => setSelectedChoice(choice)}
                disabled={busy}
              >
                <span className={styles.choiceKey}>{choice.key}</span>
                <div>
                  <h3>{choice.title}</h3>
                  <p>{choice.description}</p>
                </div>
                <dl>
                  <div><dt>成功率</dt><dd>{choice.successChance}%</dd></div>
                  <div><dt>EXP</dt><dd>+{choice.xpGain}</dd></div>
                  <div><dt>風險</dt><dd>{"◆".repeat(choice.risk)}{"◇".repeat(3 - choice.risk)}</dd></div>
                </dl>
                <small>{choice.consequence}</small>
              </button>
            ))}
          </div>
          {selectedChoice ? (
            <aside className={styles.confirmChoice}>
              <div>
                <span>待核准分支</span>
                <h3>{selectedChoice.key}｜{selectedChoice.title}</h3>
                <p>{selectedChoice.acceptedText}</p>
              </div>
              <div>
                <b>能力變化</b>
                {Object.entries(selectedChoice.effect.statChanges).map(([key, value]) => (
                  <span key={key}>{RPG_STAT_DEFINITIONS.find((item) => item.key === key)?.label ?? key} +{value}</span>
                ))}
                <button type="button" disabled={busy} onClick={() => void acceptChoice(selectedChoice)}>
                  確認選擇並寫入故事
                </button>
              </div>
            </aside>
          ) : null}
        </section>
      )}

      <section className={styles.librarySection}>
        <header>
          <div><small>CHARACTER VAULT</small><h2>我喜歡的人物庫</h2></div>
          <p>內建角色可直接加入作品；自創角色保存在這台裝置，加入作品後才進入專案資料。</p>
        </header>
        <div className={styles.libraryLayout}>
          <form onSubmit={(event) => { event.preventDefault(); saveTemplate(); }}>
            <h3>創造自己的角色</h3>
            <label>姓名<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>角色原型<input value={archetype} onChange={(event) => setArchetype(event.target.value)} placeholder="例：被放逐的星艦領航員" /></label>
            <label>身分<input value={identity} onChange={(event) => setIdentity(event.target.value)} /></label>
            <label>性格<textarea rows={3} value={personality} onChange={(event) => setPersonality(event.target.value)} /></label>
            <label>目標<textarea rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
            <button type="submit">加入我的人物庫</button>
          </form>
          <div className={styles.characterGrid}>
            {library.map((template) => (
              <article key={template.templateId}>
                <div>
                  <span>{template.builtin ? "內建" : "我的角色"}</span>
                  <h3>{template.name}</h3>
                  <small>{template.archetype}</small>
                </div>
                <p>{template.personality || template.identity || "等待你補上更多角色設定。"}</p>
                <b>目標：{template.goal || "尚未設定"}</b>
                <footer>
                  <button type="button" disabled={busy} onClick={() => void addCharacterToProject(template)}>加入目前作品</button>
                  {!template.builtin ? <button type="button" className={styles.danger} onClick={() => removeTemplate(template)}>移除人物庫</button> : null}
                </footer>
              </article>
            ))}
          </div>
        </div>
        <p className={styles.projectCast}>目前作品角色：{data.characters.length
          ? data.characters.map((character) => character.name).join("、")
          : "尚未建立角色"}</p>
      </section>

      <details className={styles.formula}>
        <summary>能力值計算方法與完整公式</summary>
        <ul>
          <li>{FORMULA.level}</li>
          <li>{FORMULA.nextLevel}</li>
          <li>{FORMULA.power}</li>
          <li>{FORMULA.success}</li>
          <li>{FORMULA.growth}</li>
        </ul>
        <p>所有能力值以 0～100 表示；關係值限制在 -100～100，任務與成就進度限制在 0～100%。</p>
      </details>
    </main>
  );
}
