import { describe, expect, it } from 'vitest';
import Home from './page';

describe('Home page scaffold', () => {
  it('renders the app name in the baseline page', () => {
    const page = Home();

    expect(JSON.stringify(page)).toContain('諸天萬界小說生成系統');
  });
});
