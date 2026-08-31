"use client";

import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

export class PublicLoungeAuthError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PublicLoungeAuthError";
    this.code = code;
  }
}

let browserClient: SupabaseClient | null = null;

function browserConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/u, "") ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  try {
    const parsed = new URL(url);
    const localDevelopment = process.env.NODE_ENV !== "production"
      && parsed.protocol === "http:"
      && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
    if ((!localDevelopment && parsed.protocol !== "https:")
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/") {
      throw new Error("invalid");
    }
  } catch {
    throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_NOT_CONNECTED");
  }
  if (!anonKey) throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_NOT_CONNECTED");
  return { url, anonKey };
}

export function getPublicLoungeBrowserAuthClient() {
  if (typeof window === "undefined") {
    throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_BROWSER_REQUIRED");
  }
  if (!browserClient) {
    const config = browserConfiguration();
    browserClient = createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
      },
    });
  }
  return browserClient;
}

export function safePublicLoungeReturnPath(value: string | null | undefined) {
  if (typeof window === "undefined") return "/lounge";
  const fallback = "/lounge";
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

export async function sendPublicLoungeMagicLink(email: string, returnPath: string) {
  const normalizedEmail = email.trim();
  if (!/^[^\s@]{1,128}@[^\s@]{1,190}$/u.test(normalizedEmail)) {
    throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_EMAIL_INVALID");
  }
  const callback = new URL("/auth/callback", window.location.origin);
  callback.searchParams.set("next", safePublicLoungeReturnPath(returnPath));
  const { error } = await getPublicLoungeBrowserAuthClient().auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      emailRedirectTo: callback.toString(),
      shouldCreateUser: true,
    },
  });
  if (error) throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_MAGIC_LINK_FAILED");
}

export async function completePublicLoungePkceCallback(code: string) {
  if (!/^[A-Za-z0-9._~-]{20,4096}$/u.test(code)) {
    throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_CALLBACK_INVALID");
  }
  const { data, error } = await getPublicLoungeBrowserAuthClient().auth.exchangeCodeForSession(code);
  if (error || !data.session?.access_token || !data.user) {
    throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_CALLBACK_FAILED");
  }
  return data.session;
}

export async function getPublicLoungeSession(): Promise<Session | null> {
  const { data, error } = await getPublicLoungeBrowserAuthClient().auth.getSession();
  if (error) throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_SESSION_FAILED");
  return data.session;
}

export async function requirePublicLoungeAccessToken() {
  const session = await getPublicLoungeSession();
  if (!session?.access_token) throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_REQUIRED");
  return session.access_token;
}

export async function signOutPublicLoungeUser() {
  const { error } = await getPublicLoungeBrowserAuthClient().auth.signOut({ scope: "local" });
  if (error) throw new PublicLoungeAuthError("PUBLIC_LOUNGE_AUTH_SIGN_OUT_FAILED");
}

export type PublicLoungeAuthState = { session: Session | null; user: User | null };
