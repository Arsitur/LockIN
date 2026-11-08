import { test, expect, type Page } from '@playwright/test';
import {
  defaultState,
  hydrateState,
  categoryPolicy,
  type AppState,
} from '../src/lib/model';
import {
  activeKeywords,
  getBlockedDomains,
  nextBoundary,
} from '../extension/rules.js';

async function seed(page: Page, edit: (s: AppState) => void = () => {}) {
  const state = hydrateState(structuredClone(defaultState));
  state.settings.testMode = true;
  edit(state);
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('lockin-state-v1', JSON.stringify(s)),
    state,
  );
  await page.reload();
  await expect(page.locator('.website-row')).toHaveCount(8);
}
async function start(page: Page, name: string, minutes: number) {
  await page
    .getByRole('button', { name: `Timer for ${name}`, exact: true })
    .click();
  await page
    .getByLabel('Duration in minutes', { exact: true })
    .fill(String(minutes));
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function end(page: Page, name: string) {
  await page
    .getByRole('button', { name: `End ${name} timer`, exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End test session', exact: true })
    .click();
}
const row = (page: Page, name: string) =>
  page
    .locator('.website-row')
    .filter({
      has: page.getByRole('button', { name: `Select ${name}`, exact: true }),
    });

test('category timers run concurrently and overlapping site timers stay independent', async ({
  page,
}) => {
  await page.clock.install();
  await seed(page);
  await start(page, 'Social media', 2);
  await start(page, 'Entertainment', 5);
  await start(page, 'Instagram', 10);
  await expect(page.locator('.active-timer')).toHaveCount(3);
  await expect(row(page, 'Netflix')).toHaveClass(/blocked-row/);
  await end(page, 'Social media');
  await expect(row(page, 'Instagram')).toHaveClass(/blocked-row/);
  await expect(row(page, 'X / Twitter')).not.toHaveClass(/blocked-row/);
  await expect(row(page, 'YouTube')).toHaveClass(/blocked-row/);
  await page.reload();
  await expect(page.locator('.active-timer')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Timer for Social media', exact: true }),
  ).toContainText('2 min');
  await page.clock.fastForward(301000);
  await expect(page.locator('.active-timer')).toHaveCount(1);
  await expect(row(page, 'YouTube')).not.toHaveClass(/blocked-row/);
  await expect(row(page, 'Instagram')).toHaveClass(/blocked-row/);
  await end(page, 'Instagram');
  await expect(page.locator('.blocked-row')).toHaveCount(0);
});

test('each website remembers its duration and expiry releases only its own requests', async ({
  page,
}) => {
  await page.clock.install();
  await seed(page);
  await start(page, 'Instagram', 1);
  await start(page, 'YouTube', 3);
  await expect(page.locator('.blocked-row')).toHaveCount(2);
  await expect(row(page, 'Reddit')).not.toHaveClass(/blocked-row/);
  await page.clock.fastForward(61000);
  await expect(page.locator('.active-timer')).toHaveCount(1);
  await expect(row(page, 'Instagram')).not.toHaveClass(/blocked-row/);
  await expect(row(page, 'YouTube')).toHaveClass(/blocked-row/);
  await page
    .getByRole('button', { name: 'Timer for Instagram', exact: true })
    .click();
  await expect(
    page.getByLabel('Duration in minutes', { exact: true }),
  ).toHaveValue('1');
});

test('category filters and protection are configured independently and locked only for active categories', async ({
  page,
}) => {
  await seed(page, (s) => (s.settings.testMode = false));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Filtering & protection', exact: true })
    .click();
  await page
    .getByRole('switch', { name: 'Enable URL keyword filter', exact: true })
    .click();
  await page.getByLabel('New URL keywords').fill('social-only');
  await page.getByRole('button', { name: 'Add words', exact: true }).click();
  await page.getByRole('button', { name: /Overview/ }).click();
  await start(page, 'Social media', 25);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Filtering & protection', exact: true })
    .click();
  await expect(
    page.getByRole('switch', {
      name: 'Enable URL keyword filter',
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByLabel('Category', { exact: true })
    .selectOption('entertainment');
  await expect(
    page.getByRole('switch', {
      name: 'Enable URL keyword filter',
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.locator('.keyword-tags')).not.toContainText('social-only');
  await page
    .getByRole('switch', { name: 'Enable URL keyword filter', exact: true })
    .click();
  await page.getByLabel('New URL keywords').fill('entertainment-only');
  await page.getByRole('button', { name: 'Add words', exact: true }).click();
  await page
    .getByRole('button', { name: 'Unlock protection', exact: true })
    .click();
  await expect(page.getByLabel('Unlock waiting period')).toBeDisabled();
  await page
    .getByLabel('Category', { exact: true })
    .selectOption('entertainment');
  await expect(page.getByLabel('Unlock waiting period')).toBeEnabled();
  await page.getByLabel('Unlock waiting period').selectOption('5');
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('lockin-state-v1')!),
  );
  expect(activeKeywords(stored)).toContain('social-only');
  expect(activeKeywords(stored)).not.toContain('entertainment-only');
  expect(
    stored.categories.find((c: any) => c.id === 'social').policy.protection
      .waitMinutes,
  ).toBe(1);
  expect(
    stored.categories.find((c: any) => c.id === 'entertainment').policy
      .protection.waitMinutes,
  ).toBe(5);
});

test('unlock waiting progress belongs to its timer and survives a reload', async ({
  page,
}) => {
  await page.clock.install();
  await seed(page, (s) => {
    s.settings.testMode = false;
    s.categories[1].policy!.protection.waitMinutes = 5;
  });
  await start(page, 'Social media', 60);
  await start(page, 'Entertainment', 90);
  await page
    .getByRole('button', { name: 'End Social media timer', exact: true })
    .click();
  await expect(page.locator('.unlock-wait')).toContainText('01:00');
  await page
    .getByRole('button', { name: 'Actually, I’ll keep focusing' })
    .click();
  await page.clock.fastForward(20000);
  await page
    .getByRole('button', { name: 'End Entertainment timer', exact: true })
    .click();
  await expect(page.locator('.unlock-wait')).toContainText('05:00');
  await page
    .getByRole('button', { name: 'Actually, I’ll keep focusing' })
    .click();
  await page.reload();
  await page
    .getByRole('button', { name: 'End Social media timer', exact: true })
    .click();
  await expect(page.locator('.unlock-wait strong')).toHaveText(/00:[34]\d/);
});

test('filter union follows active category policies, schedules, and each timer deadline', () => {
  const now = new Date(2026, 10, 9, 10).getTime();
  const s = hydrateState(structuredClone(defaultState));
  s.categories[0].policy!.keywordFilterEnabled = true;
  s.categories[0].policy!.blockedKeywords = ['social-word'];
  s.categories[1].policy!.keywordFilterEnabled = true;
  s.categories[1].policy!.blockedKeywords = ['video-word'];
  expect(activeKeywords(s, now)).toEqual([]);
  s.sessions = [
    {
      id: 'site',
      siteIds: ['instagram'],
      domains: ['instagram.com'],
      categoryIds: [],
      policyCategoryId: 'social',
      label: 'Instagram',
      blockedKeywords: ['social-word'],
      protection: categoryPolicy(s, 'social').protection,
      testMode: false,
      startedAt: now,
      endsAt: now + 60000,
    },
  ];
  s.schedules = [
    {
      id: 'schedule',
      name: 'Video',
      categoryIds: ['entertainment'],
      days: [1],
      start: '09:00',
      end: '12:00',
      enabled: true,
    },
  ];
  expect(activeKeywords(s, now)).toEqual(['social-word', 'video-word']);
  expect(nextBoundary(s, new Date(now))).toBe(now + 60000);
  expect(activeKeywords(s, now + 61000)).toEqual(['video-word']);
  expect(getBlockedDomains(s, new Date(now + 61000))).not.toContain(
    'instagram.com',
  );
  expect(activeKeywords(s, new Date(2026, 10, 9, 12).getTime())).toEqual([]);
});
