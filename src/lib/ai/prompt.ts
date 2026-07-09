import type { ChapterRow, StoryRow } from '@/lib/stories/queries';

export type PromptInput = {
  story: StoryRow;
  latestChapter?: ChapterRow | null;
  memory?: string | null;
  mode: 'first_chapter' | 'next_chapter' | 'outline' | 'summarize';
  choice?: string;
  customAction?: string;
};

export function buildGenerationPrompt(input: PromptInput) {
  const { story, latestChapter, memory, mode, choice, customAction } = input;

  const system = [
    '你是繁體中文互動小說引擎。',
    '請直接輸出故事內容，不要提到你是 AI，也不要加入免責聲明。',
    '遵守使用者選定的題材、世界觀、能力、衝突與敘事風格。',
    '每次輸出需包含章節標題、章節正文、三個下一回合選項。',
    '選項格式必須是：A. ...、B. ...、C. ...。',
  ].join('\n');

  const user = [
    `生成模式：${mode}`,
    `書名：${story.title}`,
    `題材：${story.genre ?? ''}`,
    `主題：${story.theme_mode}`,
    `細分類：${story.sub_theme ?? ''}`,
    `故事引擎：${story.story_engine ?? ''}`,
    `主角原型：${story.hero_type ?? ''}`,
    `附身 / 身分入口：${story.host_type ?? ''}`,
    `世界核心：${story.world_core ?? ''}`,
    `能力核心：${story.power_core ?? ''}`,
    `主要衝突：${story.conflict_core ?? ''}`,
    `反派核心：${story.villain_core ?? ''}`,
    `敘事風格：${story.style_mode ?? ''}`,
    `核心想法：${story.core_idea ?? ''}`,
    memory ? `長篇記憶摘要：${memory}` : '',
    latestChapter
      ? `最新章節：\n${latestChapter.title ?? `第 ${latestChapter.chapter_number} 章`}\n${latestChapter.content}`
      : '',
    choice ? `使用者選擇：${choice}` : '',
    customAction ? `使用者自訂行動：${customAction}` : '',
    '',
    '請用以下格式輸出：',
    '【章節標題】',
    '第N章　標題',
    '',
    '【章節內容】',
    '章節正文',
    '',
    '【下一回合選擇】',
    'A. 選項一',
    'B. 選項二',
    'C. 選項三',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

export function parseGeneratedChapter(output: string) {
  const titleMatch = output.match(/【章節標題】\s*([\s\S]*?)(?:\n\s*【章節內容】|$)/);
  const contentMatch = output.match(/【章節內容】\s*([\s\S]*?)(?:\n\s*【下一回合選擇】|$)/);
  const choiceBlock = output.match(/【下一回合選擇】\s*([\s\S]*)/)?.[1] ?? '';

  const choices = ['A', 'B', 'C'].map((label) => {
    const match = choiceBlock.match(new RegExp(`${label}\\.\\s*(.+)`));
    return { label, text: match?.[1]?.trim() ?? '' };
  });

  return {
    title: titleMatch?.[1]?.trim() || null,
    content: contentMatch?.[1]?.trim() || output.trim(),
    choices,
  };
}
