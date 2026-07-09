import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SignInForm } from '@/components/auth/sign-in-form';
import { hasPublicSupabaseEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { signInWithEmail } from './actions';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  if (hasPublicSupabaseEnv()) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      redirect('/');
    }
  }

  const params = await searchParams;
  const message = params.message;

  return (
    <main className="page-shell auth-page">
      <section className="hero-card auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Cloud Save</p>
        <h1 id="login-title">登入後開始生成故事</h1>
        <p className="intro">登入後作品、章節與 AI 續寫紀錄會保存到 Supabase。</p>

        {!hasPublicSupabaseEnv() ? (
          <div className="status-panel">
            尚未設定 Supabase 環境變數。請在 Vercel 設定 `NEXT_PUBLIC_SUPABASE_URL` 與
            `NEXT_PUBLIC_SUPABASE_ANON_KEY`。
          </div>
        ) : (
          <SignInForm action={signInWithEmail} />
        )}

        {message === 'check-email' ? (
          <p className="success-text">登入連結已寄出，請到信箱確認。</p>
        ) : null}
        {message === 'signin-error' ? <p className="error-text">登入失敗，請稍後再試。</p> : null}
        <Link className="text-link" href="/">
          回首頁
        </Link>
      </section>
    </main>
  );
}
