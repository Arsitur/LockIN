import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Lights Out', exact: true }),
  ).toBeEnabled();
});

test('overview is usable, selects categories, and supports light appearance', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.locator('.website-row')).toHaveCount(8);
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Social media/ })
    .click();
  await expect(page.locator('.website-row')).toHaveCount(4);
  await expect(page.locator('.focus-footnote')).toContainText('1 category');
  await page
    .getByRole('switch', { name: 'Include Instagram', exact: true })
    .click();
  await expect(
    page.getByRole('switch', { name: 'Include Instagram', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Toggle color theme' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/light/);
  expect(errors).toEqual([]);
});

test('website CRUD, normalization, clipboard between categories and undo', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Add website', exact: true }).click();
  await page
    .getByLabel('Website address')
    .fill('https://www.example.com/a/path?hello=world');
  await page.getByLabel('Display name').fill('My example');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add website', exact: true })
    .click();
  await expect(page.locator('.website-row')).toHaveCount(9);
  await expect(page.locator('.website-row').last()).toContainText(
    'example.com',
  );
  await page
    .getByRole('button', { name: 'Select My example', exact: true })
    .click();
  await page.keyboard.press('Control+c');
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Shopping/ })
    .click();
  await page.keyboard.press('Control+v');
  await expect(page.locator('.website-row')).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: 'Select My example', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.website-row')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.website-row')).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Select My example', exact: true })
    .click();
  await page.keyboard.press('Control+x');
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Entertainment/ })
    .click();
  await page.keyboard.press('Control+v');
  await expect(page.locator('.website-row')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('.website-row')).toHaveCount(10);
});

test('reflection steps and exact phrase protect early unlock', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Unlock protection', exact: true })
    .click();
  await page.getByLabel('Unlock waiting period').selectOption('0');
  await page.getByRole('button', { name: 'Overview', exact: false }).click();
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Social media/ })
    .click();
  await page.getByRole('button', { name: 'Lights Out', exact: true }).click();
  await expect(page.locator('.active-timer').first()).toContainText(
    'Social media',
  );
  await page
    .getByRole('switch', { name: 'Include Instagram', exact: true })
    .click();
  await expect(
    page.locator('.website-row').filter({ hasText: 'Instagram' }),
  ).toHaveClass(/blocked-row/);
  await page
    .getByRole('button', { name: 'End Social media timer', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Step 1 of 2');
  await page.getByRole('button', { name: 'I’ve thought about it' }).click();
  await expect(page.getByRole('dialog')).toContainText('Step 2 of 2');
  await page.getByRole('button', { name: 'I’ve thought about it' }).click();
  await expect(
    page.getByRole('button', { name: 'End session', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Type your unlock phrase').fill('wrong');
  await expect(
    page.getByRole('button', { name: 'End session', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel('Type your unlock phrase')
    .fill('I am choosing distraction over my goals.');
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Lights Out', exact: true }),
  ).toBeVisible();
});

test('test mode bypasses protection without changing regular settings', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'General & connection' }).click();
  await page.getByRole('switch', { name: 'Enable test mode' }).click();
  await page.getByRole('button', { name: 'Overview', exact: false }).click();
  await page.getByRole('button', { name: '45 min', exact: true }).click();
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Social media/ })
    .click();
  await page.getByRole('button', { name: 'Lights Out', exact: true }).click();
  await expect(page.locator('.timer')).toContainText('45:00');
  await page
    .getByRole('button', { name: 'End Social media timer', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'End test session' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Lights Out', exact: true }),
  ).toBeVisible();
});

test('overnight schedules persist and can be paused and undone', async ({
  page,
}) => {
  await page.getByRole('button', { name: /^Auto Lights Out/ }).click();
  await page
    .getByRole('button', { name: 'Create your first schedule' })
    .click();
  await page.getByLabel('Schedule name').fill('Evening reset');
  await page.getByLabel('Lights out at').fill('22:00');
  await page.getByLabel('Lights back at').fill('06:00');
  await page
    .getByRole('button', { name: 'Create schedule', exact: true })
    .click();
  await expect(page.locator('.schedule-card')).toContainText('Evening reset');
  await expect(page.locator('.schedule-card')).toContainText('next day');
  await page.getByRole('switch', { name: 'Enable Evening reset' }).click();
  await expect(
    page.getByRole('switch', { name: 'Enable Evening reset' }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Delete Evening reset' }).click();
  await expect(page.locator('.schedule-card')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.schedule-card')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: /^Auto Lights Out/ }).click();
  await expect(page.locator('.schedule-card')).toContainText('Evening reset');
});

test('waiting period survives closing the dialog and expiry completes a session', async ({
  page,
}) => {
  await page.clock.install();
  await page.getByLabel('Custom duration in minutes').fill('1');
  await page.getByLabel('Custom duration in minutes').press('Tab');
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Social media/ })
    .click();
  await page.getByRole('button', { name: 'Lights Out', exact: true }).click();
  await page
    .getByRole('button', { name: 'End Social media timer', exact: true })
    .click();
  await expect(page.locator('.unlock-wait')).toContainText('01:00');
  await page
    .getByRole('button', { name: 'Actually, I’ll keep focusing' })
    .click();
  await page.clock.fastForward(20000);
  await page
    .getByRole('button', { name: 'End Social media timer', exact: true })
    .click();
  await expect(page.locator('.unlock-wait strong')).toHaveText(/00:[34]\d/);
  await page.clock.fastForward(41000);
  await expect(page.getByRole('dialog')).toContainText(
    'Your session has finished',
  );
  await page.getByRole('button', { name: 'Back to my space' }).click();
  await expect(page.locator('.mini-stats')).toContainText('1');
});

test('drag websites into categories and render without mobile overflow', async ({
  page,
}) => {
  await page
    .locator('.website-row')
    .first()
    .dragTo(
      page
        .locator('.category-nav')
        .getByRole('button', { name: /Entertainment/ }),
    );
  await page
    .locator('.category-nav')
    .getByRole('button', { name: /Entertainment/ })
    .click();
  await expect(page.locator('.website-row')).toHaveCount(4);
  await expect(
    page.getByRole('button', { name: 'Select Instagram' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(
    page.getByRole('button', { name: 'Lights Out', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
