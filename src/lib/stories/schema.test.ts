import { describe, expect, it } from 'vitest';

import { storyCreateSchema } from './schema';

describe('story schema', () => {
  it('accepts a minimal story', () => {
    const result = storyCreateSchema.parse({
      title: '命運錯位',
      themeMode: '附身變身',
    });

    expect(result.genre).toBe('');
    expect(result.themeMode).toBe('附身變身');
  });

  it('rejects missing titles and overlong core ideas', () => {
    expect(() => storyCreateSchema.parse({ title: '', themeMode: '附身變身' })).toThrow();
    expect(() =>
      storyCreateSchema.parse({
        title: '命運錯位',
        themeMode: '附身變身',
        coreIdea: '太長'.repeat(3000),
      }),
    ).toThrow();
  });
});
