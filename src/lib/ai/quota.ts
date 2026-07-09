import type { SupabaseClient } from '@supabase/supabase-js';

const DAILY_SUCCESS_LIMIT = 20;
const MONTHLY_SUCCESS_LIMIT = 100;

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export async function assertGenerationQuota({
  userId,
  supabaseAdmin,
  now = new Date(),
}: {
  userId: string;
  supabaseAdmin: SupabaseClient;
  now?: Date;
}) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [daily, monthly] = await Promise.all([
    countSuccessfulEvents(supabaseAdmin, userId, dayStart),
    countSuccessfulEvents(supabaseAdmin, userId, monthStart),
  ]);

  if (daily >= DAILY_SUCCESS_LIMIT) {
    throw new QuotaExceededError('今日 AI 生成次數已用完，明天再繼續。');
  }

  if (monthly >= MONTHLY_SUCCESS_LIMIT) {
    throw new QuotaExceededError('本月 AI 生成次數已用完。');
  }
}

async function countSuccessfulEvents(supabaseAdmin: SupabaseClient, userId: string, since: Date) {
  const { count, error } = await supabaseAdmin
    .from('generation_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['started', 'succeeded'])
    .gte('created_at', since.toISOString());

  if (error) {
    throw error;
  }

  return count ?? 0;
}
