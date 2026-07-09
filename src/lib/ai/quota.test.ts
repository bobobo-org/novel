import { describe, expect, it } from 'vitest';

import { assertGenerationQuota, QuotaExceededError } from './quota';

function mockSupabaseCounts(counts: number[]) {
  let index = 0;

  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            gte: async () => ({ count: counts[index++], error: null }),
          }),
        }),
      }),
    }),
  };
}

describe('quota checks', () => {
  it('allows a user below limits', async () => {
    await expect(
      assertGenerationQuota({
        userId: 'user-id',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabaseAdmin: mockSupabaseCounts([19, 99]) as any,
        now: new Date('2026-07-09T02:00:00Z'),
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks a user at the daily limit', async () => {
    await expect(
      assertGenerationQuota({
        userId: 'user-id',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabaseAdmin: mockSupabaseCounts([20, 20]) as any,
        now: new Date('2026-07-09T02:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });
});
