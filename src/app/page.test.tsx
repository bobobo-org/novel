import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home from './page';

describe('Home page', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders setup guidance when Supabase env is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');

    render(await Home());

    expect(screen.getByRole('heading', { name: '諸天萬界小說生成系統' })).toBeInTheDocument();
    expect(screen.getByText(/請先在 Vercel 設定 Supabase/)).toBeInTheDocument();
  });
});
