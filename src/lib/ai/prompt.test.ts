import { describe, expect, it } from 'vitest';

import { buildGenerationPrompt, parseGeneratedChapter } from './prompt';

const story = {
  id: 'story-id',
  user_id: 'user-id',
  title: '命運錯位',
  genre: '附身、都市奇幻',
  theme_mode: '附身變身',
  sub_theme: '男生附身女生',
  story_engine: '附身錯位流',
  hero_type: '普通男生',
  host_type: '豪門千金',
  world_core: '現代都市',
  power_core: '時間暫停',
  conflict_core: '身分暴露',
  villain_core: '財閥家主',
  style_mode: '爽文反擊',
  core_idea: '主角必須守住身分。',
  status: 'draft',
  current_chapter: 1,
  created_at: '',
  updated_at: '',
};

describe('prompt builder', () => {
  it('includes Traditional Chinese instruction and story context', () => {
    const prompt = buildGenerationPrompt({
      story,
      mode: 'next_chapter',
      memory: '主角已經逃過第一次試探。',
      choice: 'A',
    });

    expect(prompt.system).toContain('繁體中文');
    expect(prompt.user).toContain('命運錯位');
    expect(prompt.user).toContain('主角已經逃過第一次試探');
    expect(prompt.user).toContain('使用者選擇：A');
  });

  it('parses chapter title, content, and choices', () => {
    const parsed = parseGeneratedChapter(`【章節標題】
第二章　晚宴試探

【章節內容】
她抬起眼，看見所有人都在等她犯錯。

【下一回合選擇】
A. 正面反擊
B. 假裝退讓
C. 暫停時間`);

    expect(parsed.title).toBe('第二章　晚宴試探');
    expect(parsed.content).toContain('所有人');
    expect(parsed.choices[2]).toEqual({ label: 'C', text: '暫停時間' });
  });
});
