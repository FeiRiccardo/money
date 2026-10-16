import { expect, test, type Page } from '@playwright/test';

const iso = (monthsAgo: number, day: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - monthsAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('balance')).toBeVisible();
}

async function add(page: Page, amount: string, category: string, date: string, type?: 'Income') {
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  if (type) await page.getByRole('button', { name: type, exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: category, exact: true }).click();
  await page.getByLabel('Date', { exact: true }).fill(date);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Transaction' })).toHaveCount(0);
}

test.describe('charts page', () => {
  test('shows the trend, the category split and the change since last month', async ({ page }) => {
    await startFresh(page);
    await add(page, '100', 'Groceries', iso(1, 10));
    await add(page, '150', 'Groceries', iso(0, 5));
    await add(page, '600', 'Housing', iso(0, 6));
    await add(page, '1000', 'Salary', iso(0, 1), 'Income');

    await page.getByRole('button', { name: 'Charts' }).click();
    await expect(page.getByRole('heading', { name: 'Charts' })).toBeVisible();

    await expect(page.getByTestId('trend-chart').locator('[data-month]')).toHaveCount(6);
    await expect(page.getByTestId('donut-slice')).toHaveCount(2);

    const rows = page.locator('.compare li');
    await expect(rows.nth(0)).toContainText('Housing');
    await expect(rows.nth(0)).toContainText('new');
    await expect(rows.nth(1)).toContainText('Groceries');
    await expect(rows.nth(1).getByTestId('delta')).toContainText('▲');
    await expect(rows.nth(1).getByTestId('delta')).toContainText('€50.00');
  });

  test('switches to income, to a 12 month range, and steps back a month', async ({ page }) => {
    await startFresh(page);
    await add(page, '100', 'Groceries', iso(1, 10));
    await add(page, '1000', 'Salary', iso(0, 1), 'Income');

    await page.getByRole('button', { name: 'Charts' }).click();
    await page.getByRole('button', { name: '12 months' }).click();
    await expect(page.getByTestId('trend-chart').locator('[data-month]')).toHaveCount(12);

    await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'Income' }).click();
    await expect(page.locator('.compare li')).toHaveCount(1);
    await expect(page.locator('.compare li').first()).toContainText('Salary');

    await page.getByRole('button', { name: 'Previous month' }).click();
    await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: 'Expenses' }).click();
    await expect(page.locator('.compare li').first()).toContainText('Groceries');
  });

  test('says so when the month has nothing to chart', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Charts' }).click();
    await expect(page.getByTestId('chart-empty')).toBeVisible();
  });
});
