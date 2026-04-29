// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function readDotEnv(key) {
  try {
    const content = fs.readFileSync(path.join(process.cwd(), 'apps/api/.env'), 'utf8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match ? match[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

const AUTH_USERNAME = process.env.AUTH_USERNAME || readDotEnv('AUTH_USERNAME');
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || readDotEnv('AUTH_PASSWORD');

const PROMPT =
  '顺德，珠海， 出行人数3，两个大人一个小孩从北京出发旅游节奏：当地特色景点和必打卡景点，亲子 美食， 5月2号出发， 5月9号回北京';

const SS = path.join(process.cwd(), 'tests/screenshots');

test.afterEach(async ({ page }, info) => {
  if (info.status === 'failed') {
    await page.screenshot({ path: path.join(SS, 'test-planner-FAIL.png'), fullPage: true });
  }
});

test('smoke: end-to-end planner', async ({ page }) => {
  test.setTimeout(660_000);

  // 1. Login — clear any existing session cookie first so we always exercise
  //    the real login flow rather than skipping it when a prior cookie persists.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.waitForSelector('input[type="text"]', { timeout: 15_000 });
  await page.screenshot({ path: path.join(SS, 'test-planner-01-login.png') });

  await page.fill('input[type="text"]', AUTH_USERNAME);
  await page.fill('input[type="password"]', AUTH_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });
  await page.screenshot({ path: path.join(SS, 'test-planner-02-empty.png') });

  // 2. Reset to clean state, then wait for hero input
  await page.click('.sidebar-new-btn');
  await page.waitForSelector('.hero-composer-input', { timeout: 10_000 });

  // 3. Type prompt and submit
  await page.fill('.hero-composer-input', PROMPT);
  await page.click('.hero-submit');
  await page.screenshot({ path: path.join(SS, 'test-planner-03-after-send.png') });

  // 4. Wait for a rendered plan day card to appear in PlanningPreview.
  //    The `.plan-day` elements are only rendered once the ReAct loop has
  //    produced a structured plan and the `plan` SSE event has been handled.
  //    This cannot match any static hero-card text or loading-state copy.
  await page.waitForSelector('.plan-day', { timeout: 600_000 });

  await page.screenshot({ path: path.join(SS, 'test-planner-04-plan.png'), fullPage: true });

  const planDayCount = await page.evaluate(
    () => document.querySelectorAll('.plan-day').length,
  );
  // The prompt is a 7-night trip (May 2–9). Assert >= 7 days so a partial
  // plan emitted via plan_partial cannot cause a false-positive pass.
  expect(planDayCount).toBeGreaterThanOrEqual(7);
});
