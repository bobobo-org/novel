import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('Home page scaffold', () => {
  it('renders the app name in the baseline page', () => {
    render(<Home />);

    expect(screen.getByRole('heading', { name: '諸天萬界小說生成系統' })).toBeInTheDocument();
    expect(screen.getByText(/AI 生成與 Supabase 持久化重建版本/)).toBeInTheDocument();
  });
});
