import { describe, expect, it } from 'vitest';

import { STORY_DATABASE } from './story-data';

describe('offline story data', () => {
  it('exports exactly 16 theme categories', () => {
    expect(Object.keys(STORY_DATABASE.themes)).toHaveLength(16);
  });

  it('includes the legacy possession transformation subtype', () => {
    expect(STORY_DATABASE.themes['附身變身']).toContain('男生附身女生');
  });
});
