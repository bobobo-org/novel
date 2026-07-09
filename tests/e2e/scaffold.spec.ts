import { expect, test } from '@playwright/test';

test('serves the scaffolded app shell', async ({ request }) => {
  const response = await request.get('/');
  const body = await response.text();

  expect(response.ok()).toBe(true);
  expect(body).toContain('諸天萬界小說生成系統');
});

test('mobile setup page has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '諸天萬界小說生成系統' })).toBeVisible();

  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasOverflow).toBe(false);
});
