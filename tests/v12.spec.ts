import { test, expect, type Page } from '@playwright/test';
import {
  defaultState,
  type AppState,
  inheritActiveCategories,
  categoryLockedUntil,
} from '../src/lib/model';
import {
  keywordPattern,
  matchedKeyword,
  keywordRules,
} from '../extension/rules.js';
async function seed(page: Page, fn: (s: AppState) => void = () => {}) {
  const s = structuredClone(defaultState);
  fn(s);
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('lockin-state-v1', JSON.stringify(s)),
    s,
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Lights Out', exact: true }),
  ).toBeEnabled();
}

test('new websites inherit a running manual category lock and Overview shows the deadline', async ({
  page,
}) => {
  await seed(page, (s) => (s.settings.testMode = true));
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Social media/ })
    .click();
  await page.getByRole('button', { name: 'Lights Out', exact: true }).click();
  await expect(
    page.locator('.category-card').filter({ hasText: 'Social media' }),
  ).toContainText('Locked until');
  await page.getByRole('button', { name: 'Add website', exact: true }).click();
  await page.getByLabel('Website address').fill('example.org');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add website', exact: true })
    .click();
  await expect(
    page.locator('.website-row').filter({ hasText: 'example.org' }),
  ).toHaveClass(/blocked-row/);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('lockin-state-v1')!).sessions[0]
          .domains,
    ),
  ).toContain('example.org');
  await page.reload();
  await expect(
    page.locator('.website-row').filter({ hasText: 'example.org' }),
  ).toHaveClass(/blocked-row/);
});

test('scheduled categories show until when they are locked, including disabled sites', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-09T10:00:00+02:00') });
  await seed(
    page,
    (s) =>
      (s.schedules = [
        {
          id: 's',
          name: 'Morning',
          categoryIds: ['entertainment'],
          days: [1],
          start: '09:00',
          end: '12:00',
          enabled: true,
        },
      ]),
  );
  await expect(
    page.locator('.category-card').filter({ hasText: 'Entertainment' }),
  ).toContainText('Locked until 12:00');
});

test('website SVG and custom icon choices persist and category choices are expanded', async ({
  page,
}) => {
  await seed(page);
  await expect(
    page.locator('.website-row').first().locator('[data-site-icon="brand"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Website icon style').selectOption('custom');
  await page.getByRole('button', { name: /Overview/ }).click();
  await page.getByRole('button', { name: 'Actions for Instagram' }).click();
  await page.getByRole('button', { name: 'Edit website', exact: true }).click();
  await page.getByLabel('Custom website icon').selectOption('game');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.locator('.website-row').first().locator('[data-site-icon="custom"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  expect(await page.locator('.modal-swatches>button').count()).toBeGreaterThan(
    20,
  );
  expect(await page.locator('.icon-options>button').count()).toBeGreaterThan(
    25,
  );
  await page.getByLabel('Category name').fill('Games');
  await page.getByLabel('Category color hex').fill('#7137e8');
  await page.getByLabel('Search category icons').fill('game');
  await page
    .getByRole('button', { name: 'game category icon', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Create category', exact: true })
    .click();
  await expect(
    page.locator('.category-card').filter({ hasText: 'Games' }),
  ).toBeVisible();
  await page.reload();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('lockin-state-v1')!).sites[0]
          .customIcon,
    ),
  ).toBe('game');
});

test('URL filters can be configured and are protected during focus', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Filtering & protection' }).click();
  await page.getByRole('switch', { name: 'Enable URL keyword filter' }).click();
  await page.getByLabel('New URL keywords').fill('gambling, casino');
  await page.getByRole('button', { name: 'Add words', exact: true }).click();
  await expect(page.locator('.keyword-tags')).toContainText('casino');
  await page.getByRole('button', { name: /Overview/ }).click();
  await page.getByRole('button', { name: 'Lights Out', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Filtering & protection' }).click();
  await expect(
    page.getByRole('switch', { name: 'Enable URL keyword filter' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Remove keyword casino' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Set up Windows service' }),
  ).toBeDisabled();
});

test('keyword rules match case and repeated URL encoding and escape punctuation', () => {
  const state = structuredClone(defaultState);
  state.settings.keywordFilterEnabled = true;
  state.session = {
    id: 'legacy',
    siteIds: [],
    domains: [],
    startedAt: Date.now(),
    endsAt: Date.now() + 60000,
    testMode: true,
    protection: state.settings.protection,
  };
  const pattern = new RegExp(keywordPattern('porn'), 'i');
  for (const url of [
    'https://google.com/search?q=porn',
    'https://google.com/search?q=%50%4f%52%4e',
    'https://example.org/%2570%256f%2572%256e',
  ])
    expect(pattern.test(url)).toBeTruthy();
  expect(matchedKeyword('https://google.com/search?q=HENTAI', state)).toBe(
    'hentai',
  );
  expect(
    new RegExp(keywordPattern('a.b'), 'i').test('https://x/axb'),
  ).toBeFalsy();
  expect(keywordRules(state)).toHaveLength(4);
});

test('manual category inheritance preserves unrelated sites and existing frozen domains', () => {
  const before = structuredClone(defaultState);
  const now = Date.now();
  before.session = {
    id: 's',
    siteIds: ['instagram'],
    domains: ['instagram.com'],
    startedAt: now,
    endsAt: now + 60000,
    testMode: true,
    protection: before.settings.protection,
    categoryIds: ['social'],
  };
  const next = structuredClone(before);
  next.sites.push(
    {
      id: 'new',
      name: 'New',
      domain: 'new.example',
      categoryId: 'social',
      enabled: false,
    },
    {
      id: 'other',
      name: 'Other',
      domain: 'other.example',
      categoryId: 'shopping',
      enabled: true,
    },
  );
  inheritActiveCategories(before, next);
  expect(next.session!.domains).toContain('new.example');
  expect(next.session!.domains).not.toContain('other.example');
  expect(categoryLockedUntil(next, 'social', now)).toBe(now + 60000);
});
