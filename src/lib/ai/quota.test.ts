import { describe, expect, it } from 'vitest';

import { assertGenerationQuota, QuotaExceededError } from './quota';

function mockSupabaseCounts(counts: number[]) {
  let index = 0;
  const statuses: unknown[] = [];

  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (_column: string, value: unknown) => {
            statuses.push(value);
            return {
              gte: async () => ({ count: counts[index++], error: null }),
            };
          },
        }),
      }),
    }),
  };

  return { client, statuses };
}

describe('quota checks', () => {
  it('allows a user below limits', async () => {
    const { client } = mockSupabaseCounts([19, 99]);

    await expect(
      assertGenerationQuota({
        userId: 'user-id',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabaseAdmin: client as any,
        now: new Date('2026-07-09T02:00:00Z'),
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks a user at the daily limit', async () => {
    const { client } = mockSupabaseCounts([20, 20]);

    await expect(
      assertGenerationQuota({
        userId: 'user-id',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabaseAdmin: client as any,
        now: new Date('2026-07-09T02:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('counts in-flight started events to avoid concurrent quota bypass', async () => {
    const { client, statuses } = mockSupabaseCounts([0, 0]);

    await assertGenerationQuota({
      userId: 'user-id',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabaseAdmin: client as any,
      now: new Date('2026-07-09T02:00:00Z'),
    });

    expect(statuses).toEqual([
      ['started', 'succeeded'],
      ['started', 'succeeded'],
    ]);
  });
});
