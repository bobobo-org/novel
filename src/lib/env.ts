import { z } from 'zod';

const publicSupabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSupabaseSchema = publicSupabaseSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const openAiSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-5.4-mini'),
});

export type RuntimeEnv = Record<string, string | undefined>;

export function hasPublicSupabaseEnv(env: RuntimeEnv = process.env) {
  return publicSupabaseSchema.safeParse(env).success;
}

export function getPublicSupabaseEnv(env: RuntimeEnv = process.env) {
  return publicSupabaseSchema.parse(env);
}

export function getServerSupabaseEnv(env: RuntimeEnv = process.env) {
  return serverSupabaseSchema.parse(env);
}

export function getOpenAiEnv(env: RuntimeEnv = process.env) {
  return openAiSchema.parse(env);
}

export function assertNoPublicServerSecrets(env: RuntimeEnv = process.env) {
  const publicServerSecretNames = Object.keys(env).filter(
    (key) =>
      key.startsWith('NEXT_PUBLIC_') &&
      (key.includes('SERVICE_ROLE') || key.includes('OPENAI') || key.includes('SECRET')),
  );

  if (publicServerSecretNames.length > 0) {
    throw new Error(`Server secrets cannot be public: ${publicServerSecretNames.join(', ')}`);
  }
}
