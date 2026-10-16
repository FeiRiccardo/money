import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Force the plain-download path (the OS share sheet is not scriptable).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
});

// A 1x1 PNG, enough for the browser to decode and shrink.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const photo = (name = 'receipt.png') => ({ name, mimeType: 'image/png', buffer: PNG });

async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('balance')).toBeVisible();
}

async function openForm(page: Page, amount: string, category: string, note: string) {
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: category, exact: true }).click();
  await page.getByPlaceholder('e.g. Coffee').fill(note);
}

const save = async (page: Page) => {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Transaction' })).toHaveCount(0);
};

async function addWithPhoto(page: Page, note = 'Shoes') {
  await openForm(page, '59.90', 'Shopping', note);
  await page.getByTestId('photo-input').setInputFiles(photo());
  await expect(page.getByTestId('photo-thumb')).toHaveCount(1);
  await save(page);
}

test.describe('receipt photos', () => {
  test('a photo added to a new Transaction is marked in the list and shown again when editing', async ({ page }) => {
    await startFresh(page);
    await addWithPhoto(page);

    const row = page.locator('.tx-row', { hasText: 'Shoes' });
    await expect(row.getByRole('img', { name: '1 photo attached' })).toBeVisible();

    await row.click();
    await expect(page.getByTestId('photo-thumb')).toHaveCount(1);
    await page.getByRole('button', { name: 'View photo' }).click();
    await expect(page.getByRole('dialog', { name: 'Receipts' }).locator('img')).toBeVisible();
  });

  test('removing a photo only takes effect on Save, and stops at five photos', async ({ page }) => {
    await startFresh(page);
    await addWithPhoto(page);

    await page.locator('.tx-row', { hasText: 'Shoes' }).click();
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await expect(page.getByTestId('photo-thumb')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.tx-row', { hasText: 'Shoes' }).getByRole('img', { name: '1 photo attached' })).toBeVisible();

    await page.locator('.tx-row', { hasText: 'Shoes' }).click();
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.tx-row', { hasText: 'Shoes' }).getByRole('img', { name: /photo attached/ })).toHaveCount(0);

    await page.locator('.tx-row', { hasText: 'Shoes' }).click();
    await page.getByTestId('photo-input').setInputFiles(Array.from({ length: 7 }, (_, i) => photo(`r${i}.png`)));
    await expect(page.getByTestId('photo-thumb')).toHaveCount(5);
    await expect(page.getByTestId('photo-input')).toHaveCount(0);
  });
});

test.describe('monthly report', () => {
  test('shows the month totals, the Balance and every Transaction, ready to print', async ({ page }) => {
    await startFresh(page);
    await openForm(page, '20', 'Groceries', 'Shop');
    await save(page);
    await page.getByRole('button', { name: 'Add a Transaction' }).click();
    await page.getByRole('button', { name: 'Income', exact: true }).click();
    await page.getByLabel('Amount', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Salary', exact: true }).click();
    await page.getByPlaceholder('e.g. Coffee').fill('Pay');
    await save(page);

    await page.getByRole('tab', { name: 'Summary' }).click();
    await page.getByRole('button', { name: 'Monthly report' }).click();

    await expect(page.getByTestId('report-start')).toHaveText('€0.00');
    await expect(page.getByTestId('report-income')).toHaveText('€100.00');
    await expect(page.getByTestId('report-expenses')).toHaveText('€20.00');
    await expect(page.getByTestId('report-end')).toHaveText('€80.00');
    await expect(page.getByTestId('report-row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Print / Save as PDF' })).toBeVisible();

    // Print layout: the app chrome is gone and only the report is left.
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'Print / Save as PDF' })).toBeHidden();
    await expect(page.getByTestId('report')).toBeVisible();
  });
});

test.describe('ZIP backup', () => {
  test('brings back Transactions, photos and settings after the data was changed', async ({ page }, testInfo) => {
    await startFresh(page);
    await addWithPhoto(page);

    const downloads: string[] = [];
    page.on('download', async (download) => {
      const path = testInfo.outputPath(download.suggestedFilename());
      await download.saveAs(path);
      downloads.push(path);
    });
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Full backup (ZIP)' }).click();
    await expect.poll(() => downloads.length).toBe(1);
    expect(downloads[0]).toMatch(/money-backup-\d{4}-\d{2}-\d{2}\.zip$/);

    // Change things after the backup: another Transaction, and the photo removed from the first.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await openForm(page, '3', 'Groceries', 'Extra');
    await save(page);
    await page.locator('.tx-row', { hasText: 'Shoes' }).click();
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Import/ }).click();
    await page.getByTestId('import-files').setInputFiles(downloads[0]);
    await expect(page.getByText('1 receipt photos will be imported.')).toBeVisible();
    await page.getByRole('button', { name: 'Replace everything' }).click();
    // The opening balance came with the backup, so there is nothing to double-check.
    await expect(page.getByRole('dialog', { name: 'Check your opening balance' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.locator('.tx-row', { hasText: 'Extra' })).toHaveCount(0);
    await expect(page.locator('.tx-row', { hasText: 'Shoes' }).getByRole('img', { name: '1 photo attached' })).toBeVisible();
  });

  test('refuses a file that is not a ZIP backup', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Import/ }).click();
    await page.getByTestId('import-files').setInputFiles({ name: 'nope.zip', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });

    await expect(page.getByText('That file is not a ZIP backup.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace everything' })).toBeDisabled();
  });
});
