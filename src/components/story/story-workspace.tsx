'use client';

import { useMemo, useState, useTransition } from 'react';

import { STORY_DATABASE, THEME_RULES, type ThemeName, type ThemeRule } from '@/lib/story-data';
import type { ChapterRow, StoryRow } from '@/lib/stories/queries';
import type { StoryCreateInput } from '@/lib/stories/schema';

type Choice = {
  label: string;
  text: string;
};

export function StoryWorkspace({
  initialStories,
  userEmail,
}: {
  initialStories: StoryRow[];
  userEmail?: string;
}) {
  const themeNames = Object.keys(STORY_DATABASE.themes) as ThemeName[];
  const [stories, setStories] = useState<StoryRow[]>(initialStories);
  const [activeStory, setActiveStory] = useState<StoryRow | null>(initialStories[0] ?? null);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [draft, setDraft] = useState<StoryCreateInput>(() => createDefaultDraft(themeNames[0]));
  const [streamingText, setStreamingText] = useState('');
  const [status, setStatus] = useState('');
  const [isPending, startTransition] = useTransition();

  const compatibleOptions = useMemo(() => {
    const rule = getThemeRule(draft.themeMode as ThemeName);

    return {
      subThemes: STORY_DATABASE.themes[draft.themeMode as ThemeName] ?? [],
      engines: rule.engines ?? ['附身錯位流', '時間規則流', '豪門反擊流', '仙俠修真流'],
      heroTypes: filterByKeywords(STORY_DATABASE.heroTypes, rule.hero),
      hostTypes: filterByKeywords(STORY_DATABASE.hostTypes, rule.host),
      worldCores: filterByKeywords(STORY_DATABASE.worldCores, rule.world),
      powerCores: filterByKeywords(STORY_DATABASE.powerCores, rule.power),
      conflictCores: filterByKeywords(STORY_DATABASE.conflictCores, rule.conflict),
      villainCores: filterByKeywords(STORY_DATABASE.villainCores, rule.villain),
      styles: filterByKeywords(STORY_DATABASE.styles, rule.style),
    };
  }, [draft.themeMode]);

  function updateDraft<Key extends keyof StoryCreateInput>(key: Key, value: StoryCreateInput[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateTheme(themeMode: string) {
    setDraft(createDefaultDraft(themeMode as ThemeName));
  }

  async function createStory() {
    setStatus('建立作品中...');
    const response = await fetch('/api/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload.error ? '建立失敗，請檢查欄位。' : '建立失敗。');
      return;
    }

    setStories((current) => [payload.story, ...current]);
    setActiveStory(payload.story);
    setChapters([]);
    setStreamingText('');
    setStatus('作品已建立，可以開始 AI 生成。');
  }

  async function loadStory(story: StoryRow) {
    setActiveStory(story);
    setStatus('讀取章節中...');
    const response = await fetch(`/api/stories/${story.id}`);
    const payload = await response.json();

    if (!response.ok) {
      setStatus('讀取失敗。');
      return;
    }

    setChapters(payload.chapters ?? []);
    setStreamingText('');
    setStatus('作品已載入。');
  }

  function generate(choice?: Choice) {
    if (!activeStory) {
      setStatus('請先建立或選擇作品。');
      return;
    }

    startTransition(async () => {
      setStatus('AI 正在生成...');
      setStreamingText('');

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyId: activeStory.id,
          mode: activeStory.current_chapter > 0 ? 'next_chapter' : 'first_chapter',
          choice: choice?.label,
          customAction: choice?.text,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        setStatus(payload.error ?? 'AI 生成失敗，請稍後再試。');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const line = event.replace(/^data:\s*/, '');
          if (!line) continue;
          const payload = JSON.parse(line);

          if (payload.type === 'chunk') {
            setStreamingText((current) => current + payload.chunk);
          }

          if (payload.type === 'done') {
            setChapters((current) => [...current, payload.chapter]);
            setActiveStory((current) =>
              current
                ? { ...current, current_chapter: current.current_chapter + 1, updated_at: new Date().toISOString() }
                : current,
            );
            setStatus('章節已保存。');
          }
        }
      }
    });
  }

  const latestChapter = chapters.at(-1);
  const latestChoices = parseChoices(latestChapter?.choices);

  return (
    <main className="workspace-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">AI Novel Studio</p>
          <h1>諸天萬界小說生成系統</h1>
        </div>
        <p className="user-pill">{userEmail ?? '已登入'}</p>
      </header>

      <section className="mobile-stack">
        <div className="panel story-form-panel">
          <div className="section-heading">
            <h2>建立故事</h2>
            <p>手機優先：先選題材，再生成第一章。</p>
          </div>

          <label>
            書名
            <input value={draft.title} onChange={(event) => updateDraft('title', event.target.value)} />
          </label>

          <label>
            主題大類
            <select value={draft.themeMode} onChange={(event) => updateTheme(event.target.value)}>
              {themeNames.map((themeName) => (
                <option key={themeName}>{themeName}</option>
              ))}
            </select>
          </label>

          <div className="form-grid">
            <SelectField
              label="細分類"
              value={draft.subTheme}
              options={compatibleOptions.subThemes}
              onChange={(value) => updateDraft('subTheme', value)}
            />
            <SelectField
              label="故事引擎"
              value={draft.storyEngine}
              options={compatibleOptions.engines}
              onChange={(value) => updateDraft('storyEngine', value)}
            />
            <SelectField
              label="主角"
              value={draft.heroType}
              options={compatibleOptions.heroTypes}
              onChange={(value) => updateDraft('heroType', value)}
            />
            <SelectField
              label="身分入口"
              value={draft.hostType}
              options={compatibleOptions.hostTypes}
              onChange={(value) => updateDraft('hostType', value)}
            />
            <SelectField
              label="世界核心"
              value={draft.worldCore}
              options={compatibleOptions.worldCores}
              onChange={(value) => updateDraft('worldCore', value)}
            />
            <SelectField
              label="能力核心"
              value={draft.powerCore}
              options={compatibleOptions.powerCores}
              onChange={(value) => updateDraft('powerCore', value)}
            />
            <SelectField
              label="主要衝突"
              value={draft.conflictCore}
              options={compatibleOptions.conflictCores}
              onChange={(value) => updateDraft('conflictCore', value)}
            />
            <SelectField
              label="反派核心"
              value={draft.villainCore}
              options={compatibleOptions.villainCores}
              onChange={(value) => updateDraft('villainCore', value)}
            />
            <SelectField
              label="敘事風格"
              value={draft.styleMode}
              options={compatibleOptions.styles}
              onChange={(value) => updateDraft('styleMode', value)}
            />
          </div>

          <label>
            核心想法
            <textarea
              value={draft.coreIdea}
              onChange={(event) => updateDraft('coreIdea', event.target.value)}
              placeholder="可留空，AI 會依題材庫生成。"
            />
          </label>

          <button className="primary-button desktop-create" onClick={createStory} type="button">
            建立作品
          </button>
        </div>

        <div className="panel story-list-panel">
          <div className="section-heading">
            <h2>作品</h2>
            <p>{stories.length ? '選擇作品繼續生成。' : '尚未建立作品。'}</p>
          </div>
          <div className="story-list">
            {stories.map((story) => (
              <button
                className={story.id === activeStory?.id ? 'story-list-item active' : 'story-list-item'}
                key={story.id}
                onClick={() => void loadStory(story)}
                type="button"
              >
                <strong>{story.title}</strong>
                <span>第 {story.current_chapter} 章</span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel chapter-panel">
          <div className="section-heading">
            <h2>{activeStory?.title ?? '尚未選擇作品'}</h2>
            <p>{status || '建立作品後即可開始生成。'}</p>
          </div>

          <article className="chapter-reader">
            {chapters.map((chapter) => (
              <section key={chapter.id}>
                <h3>{chapter.title ?? `第 ${chapter.chapter_number} 章`}</h3>
                <p>{chapter.content}</p>
              </section>
            ))}
            {streamingText ? (
              <section className="streaming-chapter">
                <h3>生成中...</h3>
                <p>{streamingText}</p>
              </section>
            ) : null}
          </article>

          <div className="choice-grid">
            {latestChoices.map((choice) => (
              <button key={choice.label} onClick={() => generate(choice)} type="button">
                <b>{choice.label}</b>
                <span>{choice.text || '沿著這條路線續寫'}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="bottom-action-bar">
        <button className="secondary-button" onClick={createStory} type="button">
          建立作品
        </button>
        <button
          className="primary-button"
          disabled={!activeStory || isPending}
          onClick={() => generate()}
          type="button"
        >
          {isPending ? '生成中...' : activeStory?.current_chapter ? 'AI 續寫下一章' : 'AI 生成第一章'}
        </button>
      </div>
    </main>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function createDefaultDraft(themeMode: ThemeName): StoryCreateInput {
  const rule = getThemeRule(themeMode);
  const subTheme = STORY_DATABASE.themes[themeMode][0] ?? '';
  const heroType = filterByKeywords(STORY_DATABASE.heroTypes, rule.hero)[0] ?? '';
  const hostType = filterByKeywords(STORY_DATABASE.hostTypes, rule.host)[0] ?? '';
  const worldCore = filterByKeywords(STORY_DATABASE.worldCores, rule.world)[0] ?? '';
  const powerCore = filterByKeywords(STORY_DATABASE.powerCores, rule.power)[0] ?? '';
  const conflictCore = filterByKeywords(STORY_DATABASE.conflictCores, rule.conflict)[0] ?? '';
  const villainCore = filterByKeywords(STORY_DATABASE.villainCores, rule.villain)[0] ?? '';
  const styleMode = filterByKeywords(STORY_DATABASE.styles, rule.style)[0] ?? '';

  return {
    title: `我附身成${hostType || '新身分'}後，靠${powerCore || '命運提示'}逆轉全局`,
    genre: `${themeMode}、${subTheme}`,
    themeMode,
    subTheme,
    storyEngine: rule.engines?.[0] ?? '附身錯位流',
    heroType,
    hostType,
    worldCore,
    powerCore,
    conflictCore,
    villainCore,
    styleMode,
    coreIdea: '',
  };
}

function getThemeRule(themeMode: ThemeName): ThemeRule {
  return (THEME_RULES[themeMode] ?? {}) as ThemeRule;
}

function filterByKeywords(pool: readonly string[], keywords?: readonly string[]) {
  if (!keywords?.length) return pool;
  const filtered = pool.filter((item) => keywords.some((keyword) => item.includes(keyword)));
  return filtered.length ? filtered : pool;
}

function parseChoices(rawChoices: unknown): Choice[] {
  if (Array.isArray(rawChoices)) {
    const parsed = rawChoices
      .map((choice) => {
        if (
          typeof choice === 'object' &&
          choice !== null &&
          'label' in choice &&
          'text' in choice
        ) {
          return {
            label: String(choice.label),
            text: String(choice.text),
          };
        }
        return null;
      })
      .filter(Boolean) as Choice[];

    if (parsed.length) return parsed;
  }

  return [
    { label: 'A', text: '主動追查真相' },
    { label: 'B', text: '暫時退讓佈局' },
    { label: 'C', text: '使用能力改寫局面' },
  ];
}
