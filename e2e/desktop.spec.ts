import { expect, test, type Page } from '@playwright/test';

// A laptop screen: wide, mouse, no touch.
test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('balance')).toBeVisible();
}

test('a wide screen shows a menu, and the Transactions next to the Summary', async ({ page }) => {
  await startFresh(page);
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  await expect(menu).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a Transaction', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: '+ Add a Transaction' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('12.50');
  await page.getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.getByPlaceholder('e.g. Coffee').fill('Bread');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.locator('.tx-row', { hasText: 'Bread' })).toBeVisible();
  await expect(page.getByTestId('sum-expenses')).toHaveText('€12.50');

  await menu.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  await menu.getByRole('button', { name: 'Home' }).click();
  await expect(page.locator('.tx-row', { hasText: 'Bread' })).toBeVisible();
});

test('the form is a panel over the page that Escape closes', async ({ page }) => {
  await startFresh(page);
  await page.getByRole('button', { name: '+ Add a Transaction' }).click();
  const form = page.getByRole('dialog', { name: 'New Transaction' });
  await expect(form).toBeVisible();
  const box = (await form.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(600);

  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
});

test('a narrow window keeps the phone layout', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  await startFresh(page);
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toHaveCount(0);
  await expect(page.getByRole('tablist')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a Transaction', exact: true })).toBeVisible();
});
