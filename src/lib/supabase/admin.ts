import { createClient } from '@supabase/supabase-js';

import { getServerSupabaseEnv } from '@/lib/env';

export function createSupabaseAdminClient() {
  const env = getServerSupabaseEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
