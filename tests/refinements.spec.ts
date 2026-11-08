import { test, expect, type Page } from '@playwright/test';
import { defaultState, type AppState } from '../src/lib/model';

async function seed(page: Page, customize: (s: AppState) => void = () => {}) {
  const state = structuredClone(defaultState);
  customize(state);
  await page.goto('/');
  await page.evaluate(
    (s) => localStorage.setItem('lockin-state-v1', JSON.stringify(s)),
    state,
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Lights Out', exact: true }),
  ).toBeEnabled();
}
async function createCurrentSchedule(page: Page, name = 'Current focus') {
  await page.getByRole('button', { name: /^Auto Lights Out/ }).click();
  await page.getByRole('button', { name: 'New schedule', exact: true }).click();
  await page.getByLabel('Schedule name').fill(name);
  await page.getByLabel('Lights out at').fill('09:00');
  await page.getByLabel('Lights back at').fill('12:00');
  await page
    .getByRole('button', { name: 'Create schedule', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'Your focus hours are already here.',
  );
}

test('custom colors are previewed, explicitly saved, and restored as palette swatches', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByLabel('Custom accent color')
    .evaluate((element: HTMLInputElement) => {
      element.value = '#7845ef';
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  await expect(
    page.getByRole('button', { name: 'Save accent', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCSS('--accent', '#7845ef');
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('lockin-state-v1')!).settings.accent,
    ),
  ).toBe('#d8edab');
  await page.getByRole('button', { name: 'Save accent', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Accent color #7845ef', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Overview/ }).click();
  const first = await page
    .locator('.orb')
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: 'Accent color #a6d9ed', exact: true })
    .click();
  await page.getByRole('button', { name: /Overview/ }).click();
  await expect
    .poll(() =>
      page
        .locator('.orb')
        .evaluate((el) => getComputedStyle(el).backgroundImage),
    )
    .not.toBe(first);
});

test('dragging within a filtered category reorders both directions and supports undo', async ({
  page,
}) => {
  await seed(page);
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Social media/ })
    .click();
  const rows = page.locator('.website-row');
  await rows.nth(0).dragTo(rows.nth(1), { targetPosition: { x: 100, y: 50 } });
  await expect(rows.first()).toContainText('X / Twitter');
  await expect(rows.nth(1)).toContainText('Instagram');
  await rows.nth(1).dragTo(rows.first(), { targetPosition: { x: 100, y: 8 } });
  await expect(rows.first()).toContainText('Instagram');
  await page.keyboard.press('Control+z');
  await expect(rows.first()).toContainText('X / Twitter');
});

test('current schedules require a choice and Next time skips just one occurrence', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-09T10:00:00+02:00') });
  await seed(page);
  await createCurrentSchedule(page);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.schedule-card')).toHaveCount(0);
  await createCurrentSchedule(page);
  await page.getByRole('button', { name: 'Next time', exact: true }).click();
  await expect(page.locator('.schedule-card')).toContainText(
    'This occurrence skipped',
  );
  await expect(page.locator('.active-badge')).toHaveCount(0);
  const skip = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('lockin-state-v1')!).schedules[0]
        .skipUntil,
  );
  expect(skip).toBe(new Date('2026-11-09T12:00:00+02:00').getTime());
  await page.getByRole('switch', { name: 'Enable Current focus' }).click();
  await page.getByRole('switch', { name: 'Enable Current focus' }).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.locator('.active-badge')).toContainText('Active now');
  await expect(
    page.getByRole('button', { name: 'Delete Current focus' }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'General & connection' }).click();
  await page.getByRole('switch', { name: 'Enable test mode' }).click();
  await page.getByRole('button', { name: /^Auto Lights Out/ }).click();
  await expect(
    page.getByRole('button', { name: 'Delete Current focus' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Edit Current focus' }).click();
  await page.getByLabel('Schedule name').fill('Edited in test mode');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.locator('.schedule-card')).toContainText(
    'Edited in test mode',
  );
  await page
    .getByRole('switch', { name: 'Enable Edited in test mode' })
    .click();
  await expect(page.locator('.active-badge')).toHaveCount(0);
  await page
    .getByRole('switch', { name: 'Enable Edited in test mode' })
    .click();
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page
    .getByRole('button', { name: 'Delete Edited in test mode' })
    .click();
  await expect(page.locator('.schedule-card')).toHaveCount(0);
});

test('scheduled categories include websites whose Overview switches are off', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-09T10:00:00+02:00') });
  await seed(page, (s) => {
    s.sites.forEach((site) => (site.enabled = false));
    s.schedules = [
      {
        id: 'all',
        name: 'All entertainment',
        categoryIds: ['entertainment'],
        days: [1],
        start: '09:00',
        end: '12:00',
        enabled: true,
      },
    ];
    s.sites[0].enabled = true;
  });
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Entertainment/ })
    .click();
  await expect(page.locator('.website-row.blocked-row')).toHaveCount(3);
  await expect(
    page.getByRole('switch', { name: 'Include Netflix' }),
  ).not.toBeChecked();
});

test('saved durations rank by actual usage and remain available after reload', async ({
  page,
}) => {
  await seed(page, (s) => (s.settings.testMode = true));
  await page.getByLabel('Custom duration in minutes').fill('90');
  await page.getByLabel('Custom duration in minutes').press('Tab');
  await page.getByRole('button', { name: 'Save custom duration' }).click();
  await expect(page.locator('.duration-options')).toContainText('90 min');
  await page.getByRole('button', { name: 'Lights Out', exact: true }).click();
  await page
    .getByRole('button', { name: 'End Social media timer', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End test session', exact: true })
    .click();
  await expect(page.locator('.duration-options>button').first()).toHaveText(
    '90 min',
  );
  await page.reload();
  await expect(page.locator('.duration-options>button').first()).toHaveText(
    '90 min',
  );
});

test('application selection participates in sessions and confirms before closing apps', async ({
  page,
}) => {
  await seed(page, (s) => (s.settings.testMode = true));
  await page.getByRole('button', { name: /^Applications/ }).click();
  await page
    .getByRole('button', { name: 'Add application', exact: true })
    .click();
  await page
    .getByLabel('Application executable')
    .fill('C:\\Apps\\Game\\Game.exe');
  await page.getByLabel('Display name').fill('My game');
  await page
    .getByRole('button', { name: 'Save application', exact: true })
    .click();
  await expect(page.locator('.application-row')).toContainText('My game');
  await page
    .getByRole('button', { name: 'Timer for My game', exact: true })
    .click();
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Save any work');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: 'Timer for My game', exact: true })
    .click();
  await page.getByRole('button', { name: 'Start timer', exact: true }).click();
  await page
    .getByRole('button', { name: 'Start Lights Out', exact: true })
    .click();
  await expect(page.locator('.application-row')).toHaveClass(/blocked-row/);
  await page.getByRole('button', { name: 'View all timers' }).click();
  await page
    .getByRole('button', { name: 'End My game timer', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End test session', exact: true })
    .click();
  await page.getByRole('button', { name: /^Applications/ }).click();
  await expect(page.locator('.application-row')).not.toHaveClass(/blocked-row/);
});
