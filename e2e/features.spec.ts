import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
});

const iso = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('balance')).toBeVisible();
}

async function add(page: Page, amount: string, categories: string[], note: string, options: { type?: 'Income'; date?: string; repeat?: string } = {}) {
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  if (options.type) await page.getByRole('button', { name: options.type, exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  for (const name of categories) await page.getByRole('button', { name, exact: true }).click();
  await page.getByPlaceholder('e.g. Coffee').fill(note);
  if (options.date) await page.getByLabel('Date', { exact: true }).fill(options.date);
  if (options.repeat) await page.getByRole('combobox', { name: 'Repeat' }).selectOption(options.repeat);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Transaction' })).toHaveCount(0);
}

async function seed(page: Page) {
  await startFresh(page);
  await add(page, '4.5', ['Dining out'], 'Caffè al bar');
  await add(page, '720', ['Housing'], 'Rent');
  await add(page, '62.30', ['Groceries', 'Shopping'], 'Weekly shop');
  await add(page, '1800', ['Salary'], 'October pay', { type: 'Income' });
}

const openSearch = async (page: Page) => {
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
};
const rowTitles = (page: Page) => page.locator('.tx-row .tx-title').allTextContents();

test.describe('search, filter and sort', () => {
  test('text search ignores case and accents, and shows the count and the real net', async ({ page }) => {
    await seed(page);
    await openSearch(page);

    await expect(page.getByTestId('result-count')).toHaveText('4 Transactions');
    await page.getByRole('searchbox', { name: 'Search' }).fill('CAFFE');

    await expect(page.getByTestId('result-count')).toHaveText('1 Transaction');
    await expect(page.getByTestId('result-net')).toContainText('4.50');
    await expect.poll(() => rowTitles(page)).toEqual(['Caffè al bar']);
  });

  test('a number finds the exact amount, and no match shows a helpful message', async ({ page }) => {
    await seed(page);
    await openSearch(page);

    await page.getByRole('searchbox', { name: 'Search' }).fill('62,30');
    await expect.poll(() => rowTitles(page)).toEqual(['Weekly shop']);

    await page.getByRole('searchbox', { name: 'Search' }).fill('nothing like this');
    await expect(page.getByText('No Transactions match.')).toBeVisible();
  });

  test('filters by type and by Category, and Clear filters resets everything', async ({ page }) => {
    await seed(page);
    await openSearch(page);

    await page.getByRole('button', { name: 'Income', exact: true }).click();
    await expect.poll(() => rowTitles(page)).toEqual(['October pay']);
    await page.getByRole('button', { name: 'All', exact: true }).click();

    await page.getByRole('button', { name: 'Any Category' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Groceries', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Housing', exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect.poll(async () => (await rowTitles(page)).sort()).toEqual(['Rent', 'Weekly shop']);

    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page.getByTestId('result-count')).toHaveText('4 Transactions');
  });

  test('sorts by amount and the choice is remembered on the home list after a reload', async ({ page }) => {
    await seed(page);
    await openSearch(page);

    await page.getByRole('combobox', { name: 'Sort' }).selectOption('largest');
    await expect.poll(async () => (await rowTitles(page))[0]).toBe('October pay');
    await page.getByRole('combobox', { name: 'Sort' }).selectOption('smallest');
    await expect.poll(async () => (await rowTitles(page))[0]).toBe('Caffè al bar');
    // The selector shows the new value only once the choice has been saved, so wait for that before reloading.
    await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveValue('smallest');

    await page.reload();
    // The home list uses the same remembered order: flat list (no day headers), smallest first.
    await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveValue('smallest');
    await expect.poll(async () => (await rowTitles(page))[0]).toBe('Caffè al bar');
    await expect(page.locator('.day-head')).toHaveCount(0);

    await page.getByRole('combobox', { name: 'Sort' }).selectOption('newest');
    await expect(page.locator('.day-head').first()).toBeVisible();
  });
});

test.describe('quick entry', () => {
  test('Duplicate opens a new form with the same amount, Categories and note, dated today, and saves a second one', async ({ page }) => {
    await startFresh(page);
    await add(page, '4.5', ['Dining out'], 'Coffee');

    await page.getByRole('button', { name: /Coffee/ }).click();
    await page.getByRole('button', { name: 'Duplicate' }).click();

    await expect(page.getByRole('dialog', { name: 'New Transaction' })).toBeVisible();
    await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('4.50');
    await expect(page.getByPlaceholder('e.g. Coffee')).toHaveValue('Coffee');
    await expect(page.getByRole('button', { name: 'Dining out', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Date', { exact: true })).toHaveValue(iso(0));

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => rowTitles(page)).toEqual(['Coffee', 'Coffee']);
    await expect(page.getByTestId('balance')).toContainText('9.00');
  });

  test('a Recent chip fills the form in one tap', async ({ page }) => {
    await startFresh(page);
    await add(page, '4.5', ['Dining out'], 'Coffee');

    await page.getByRole('button', { name: 'Add a Transaction' }).click();
    await page.getByRole('button', { name: /Coffee · €4\.50/ }).click();

    await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('4.50');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => rowTitles(page)).toEqual(['Coffee', 'Coffee']);
  });

  test('Duplicate never copies a retired label onto the new Transaction', async ({ page }) => {
    await startFresh(page);
    await add(page, '35', ['Health'], 'Pharmacy');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Categories/ }).click();
    await page.getByRole('button', { name: /^Health/ }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await page.getByRole('button', { name: /Pharmacy/ }).click();
    await page.getByRole('button', { name: 'Duplicate' }).click();

    // No Category yet, so Save stays disabled until the user picks one.
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(page.locator('.chip.retired')).toHaveCount(0);
  });
});

test.describe('recurring Transactions', () => {
  test('Repeat weekly on a past date back-fills what is due, marks them, and one Undo removes the batch', async ({ page }) => {
    await startFresh(page);
    await add(page, '10', ['Transport'], 'Bus pass', { date: iso(14), repeat: 'weekly' });

    // Start 14 days ago: the Transaction itself, then +7 days and +14 days (today).
    await expect(page.getByText('2 recurring Transactions added')).toBeVisible();
    await openSearch(page);
    await expect(page.getByTestId('result-count')).toHaveText('3 Transactions');
    await expect(page.locator('.repeat-mark')).toHaveCount(3);

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'recurring Transactions added' }).getByRole('button', { name: 'Undo' }).click();
    await openSearch(page);
    await expect(page.getByTestId('result-count')).toHaveText('1 Transaction');
  });

  test('Settings lists the rule; stopping it keeps every Transaction but removes the mark', async ({ page }) => {
    await startFresh(page);
    await add(page, '10', ['Transport'], 'Bus pass', { date: iso(14), repeat: 'weekly' });
    await expect(page.getByText('2 recurring Transactions added')).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Recurring/ }).click();
    await expect(page.getByText('↻ Bus pass')).toBeVisible();
    await expect(page.getByText(/Weekly · Next:/)).toBeVisible();

    await page.getByRole('button', { name: /↻ Bus pass/ }).click();
    await page.getByRole('button', { name: 'Stop repeating' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Stop repeating' }).click();
    await expect(page.getByText('No recurring Transactions yet.')).toBeVisible();

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await openSearch(page);
    await expect(page.getByTestId('result-count')).toHaveText('3 Transactions');
    await expect(page.locator('.repeat-mark')).toHaveCount(0);
  });

  test('a Transaction made by a rule shows its schedule in the edit form, with Stop repeating', async ({ page }) => {
    await startFresh(page);
    await add(page, '10', ['Transport'], 'Bus pass', { date: iso(14), repeat: 'weekly' });
    await expect(page.getByText('2 recurring Transactions added')).toBeVisible();

    await openSearch(page);
    await page.locator('.tx-row').first().click();

    await expect(page.getByText('↻ Repeats weekly')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Repeat' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop repeating' }).click();
    await page.getByRole('dialog', { name: 'Stop repeating?' }).getByRole('button', { name: 'Stop repeating' }).click();
    await expect(page.getByTestId('result-count')).toHaveText('3 Transactions');
    await expect(page.locator('.repeat-mark')).toHaveCount(0);
  });

  test('the backup gets a third file only when rules exist, and restoring brings the rule back', async ({ page }, testInfo) => {
    await startFresh(page);
    await add(page, '10', ['Transport'], 'Bus pass', { date: iso(3), repeat: 'weekly' });

    const downloads: string[] = [];
    page.on('download', async (download) => {
      const path = testInfo.outputPath(download.suggestedFilename());
      await download.saveAs(path);
      downloads.push(path);
    });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Export/ }).click();
    await expect.poll(() => downloads.length).toBe(3);

    const fileName = (p: string) => p.split(/[\\/]/).pop()!;
    const recurring = downloads.find((p) => fileName(p).startsWith('recurring-'))!;
    const csv = readFileSync(recurring, 'utf8');
    expect(csv).toContain('type,amount,categories,note,frequency,start_date,end_date,next_date');
    expect(csv).toContain('expense,10.00,Transport,Bus pass,weekly,');

    await page.getByRole('button', { name: /^Erase all data/ }).click();
    await page.getByRole('button', { name: 'Erase everything' }).click();
    await page.getByRole('button', { name: 'Restore from backup' }).click();
    await page.getByTestId('import-files').setInputFiles(downloads);
    await expect(page.getByText('1 recurring rule will also be restored.')).toBeVisible();
    await page.getByRole('button', { name: 'Replace everything' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Recurring/ }).click();
    await expect(page.getByText('↻ Bus pass')).toBeVisible();
  });

  test('importing only the two older files still works and leaves no rules', async ({ page }, testInfo) => {
    await startFresh(page);
    await add(page, '10', ['Transport'], 'Bus');
    const downloads: string[] = [];
    page.on('download', async (download) => {
      const path = testInfo.outputPath(download.suggestedFilename());
      await download.saveAs(path);
      downloads.push(path);
    });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Export/ }).click();
    await expect.poll(() => downloads.length).toBe(2); // no rules, so no third file

    await page.getByRole('button', { name: /^Erase all data/ }).click();
    await page.getByRole('button', { name: 'Erase everything' }).click();
    await page.getByRole('button', { name: 'Restore from backup' }).click();
    await page.getByTestId('import-files').setInputFiles(downloads);
    await page.getByRole('button', { name: 'Replace everything' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: /Bus/ })).toBeVisible();
  });
});

test.describe('Not-counted Categories', () => {
  test('take money from the Balance but stay out of the month totals, and are listed apart', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Categories/ }).click();
    await page.getByRole('button', { name: '+ New category' }).click();
    await page.getByLabel('Name').fill('Savings');
    await page.getByRole('checkbox', { name: /Not counted in summary and charts/ }).check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Savings not counted/ })).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await add(page, '20', ['Groceries'], 'Bread');
    await add(page, '500', ['Savings'], 'To savings');

    await expect(page.getByTestId('balance')).toHaveText('-€520.00');
    await page.getByRole('tab', { name: 'Summary' }).click();
    await expect(page.getByTestId('sum-expenses')).toHaveText('€20.00');
    await expect(page.getByTestId('not-counted')).toContainText('Savings');
    await expect(page.getByTestId('not-counted')).toContainText('−€500.00');

    // Counted again: it joins the totals.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Categories/ }).click();
    await page.getByRole('button', { name: /^Savings/ }).click();
    await page.getByRole('checkbox', { name: /Not counted/ }).uncheck();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('tab', { name: 'Summary' }).click();
    await expect(page.getByTestId('sum-expenses')).toHaveText('€520.00');
    await expect(page.getByTestId('not-counted')).toHaveCount(0);
  });
});
