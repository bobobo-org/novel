import Link from 'next/link';

import { SignOutButton } from '@/components/auth/sign-out-button';
import { StoryWorkspace } from '@/components/story/story-workspace';
import { hasPublicSupabaseEnv } from '@/lib/env';
import { listStories } from '@/lib/stories/queries';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { signOut } from './login/actions';

export const dynamic = 'force-dynamic';

export default async function Home() {
  if (!hasPublicSupabaseEnv()) {
    return <SetupRequired />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <Landing />;
  }

  const { data: stories } = await listStories(supabase);

  return (
    <>
      <StoryWorkspace initialStories={stories ?? []} userEmail={user.email} />
      <div className="sign-out-floating">
        <SignOutButton action={signOut} />
      </div>
    </>
  );
}

function Landing() {
  return (
    <main className="page-shell">
      <section className="hero-card" aria-labelledby="app-title">
        <p className="eyebrow">AI / Supabase Rebuild</p>
        <h1 id="app-title">諸天萬界小說生成系統</h1>
        <p className="intro">
          手機優先的 AI 互動小說工作台。登入後即可把作品、章節與續寫路線保存到 Supabase。
        </p>
        <Link className="primary-link" href="/login">
          登入開始生成
        </Link>
      </section>
    </main>
  );
}

function SetupRequired() {
  return (
    <main className="page-shell">
      <section className="hero-card" aria-labelledby="setup-title">
        <p className="eyebrow">Setup Required</p>
        <h1 id="setup-title">諸天萬界小說生成系統</h1>
        <p className="intro">
          App 已升級成 AI / Supabase 版本。請先在 Vercel 設定 Supabase 與 OpenAI 環境變數。
        </p>
        <div className="status-panel">
          需要：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、
          `SUPABASE_SERVICE_ROLE_KEY`、`OPENAI_API_KEY`、`OPENAI_MODEL`
        </div>
      </section>
    </main>
  );
}
