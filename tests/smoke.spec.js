import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('http://127.0.0.1:3000/');
  await expect(page).toHaveTitle(/MowNWA|TurfLynk/i);
});

test('health endpoint works', async ({ request }) => {
  const res = await request.get('http://127.0.0.1:3000/health');
  expect(res.ok()).toBeTruthy();

  const body = await res.json();
  expect(body.ok).toBe(true);
});

test('config endpoint works', async ({ request }) => {
  const res = await request.get('http://127.0.0.1:3000/api/config');
  expect(res.ok()).toBeTruthy();

  const body = await res.json();
  expect(body.siteBrand || body.appName).toBeTruthy();
});
