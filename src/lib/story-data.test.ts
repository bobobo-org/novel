import { describe, expect, it } from 'vitest';

import { COMMON_BANK, STORY_BANK, STORY_DATABASE, THEME_RULES } from './story-data';

describe('offline story data', () => {
  it('exports exactly 16 theme categories', () => {
    expect(Object.keys(STORY_DATABASE.themes)).toHaveLength(16);
  });

  it('includes the legacy possession transformation subtype', () => {
    expect(STORY_DATABASE.themes['附身變身']).toContain('男生附身女生');
  });

  it('exports story material for every theme category', () => {
    const themeNames = Object.keys(STORY_DATABASE.themes);

    expect(Object.keys(STORY_BANK).sort()).toEqual([...themeNames].sort());

    for (const themeName of themeNames) {
      const bank = STORY_BANK[themeName as keyof typeof STORY_BANK];

      expect(bank.relations.length).toBeGreaterThan(0);
      expect(bank.scenes.length).toBeGreaterThan(0);
      expect(bank.beats.length).toBeGreaterThan(0);
      expect(bank.twists.length).toBeGreaterThan(0);
      expect(bank.hooks.length).toBeGreaterThan(0);
      expect(bank.choices.length).toBeGreaterThan(0);
    }
  });

  it('exports common material and theme compatibility rules', () => {
    expect(COMMON_BANK.choices).toHaveLength(3);
    expect(Object.keys(THEME_RULES)).toContain('附身變身');
    expect(THEME_RULES['附身變身'].engines).toContain('附身錯位流');
  });
});
