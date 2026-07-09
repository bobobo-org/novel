import { describe, expect, it } from 'vitest';

import {
  assertNoPublicServerSecrets,
  getOpenAiEnv,
  getPublicSupabaseEnv,
  getServerSupabaseEnv,
  hasPublicSupabaseEnv,
} from './env';

const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  OPENAI_API_KEY: 'openai-key',
  OPENAI_MODEL: 'gpt-5.4-mini',
};

describe('env helpers', () => {
  it('validates public Supabase env', () => {
    expect(hasPublicSupabaseEnv(validEnv)).toBe(true);
    expect(getPublicSupabaseEnv(validEnv).NEXT_PUBLIC_SUPABASE_URL).toBe(
      'https://example.supabase.co',
    );
  });

  it('validates server-only Supabase env', () => {
    expect(getServerSupabaseEnv(validEnv).SUPABASE_SERVICE_ROLE_KEY).toBe('service-role');
  });

  it('defaults the OpenAI model', () => {
    expect(getOpenAiEnv({ OPENAI_API_KEY: 'openai-key' }).OPENAI_MODEL).toBe('gpt-5.4-mini');
  });

  it('rejects server secrets exposed as NEXT_PUBLIC values', () => {
    expect(() =>
      assertNoPublicServerSecrets({
        NEXT_PUBLIC_OPENAI_API_KEY: 'bad',
      }),
    ).toThrow(/Server secrets cannot be public/);
  });
});
