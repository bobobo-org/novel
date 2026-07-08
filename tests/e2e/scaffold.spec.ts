import { expect, test } from '@playwright/test';

test('serves the scaffolded app shell', async ({ request }) => {
  const response = await request.get('/');
  const body = await response.text();

  expect(response.ok()).toBe(true);
  expect(body).toContain('諸天萬界小說生成系統');
});
