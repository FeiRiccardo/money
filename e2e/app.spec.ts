import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  // Force the plain-download path for Export (the OS share sheet is not scriptable).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
});

async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('balance')).toBeVisible();
}

async function addExpense(page: Page, amount: string, categories: string[], note = '') {
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  for (const name of categories) await page.getByRole('button', { name, exact: true }).click();
  if (note) await page.getByPlaceholder('e.g. Coffee').fill(note);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Transaction' })).toHaveCount(0);
}

test('first run: starts empty with the starter Categories and a zero balance', async ({ page }) => {
  await startFresh(page);

  await expect(page.getByText('Nothing here yet. Tap + to add your first expense or income.')).toBeVisible();
  await expect(page.getByTestId('balance')).toHaveText('€0.00');
});

test('add: Save needs an amount and a Category; the Transaction then shows in the list and the Balance', async ({ page }) => {
  await startFresh(page);
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  const save = page.getByRole('button', { name: 'Save', exact: true });

  await expect(save).toBeDisabled();
  await page.getByLabel('Amount', { exact: true }).fill('12,5');
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: 'Transport', exact: true }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('dialog', { name: 'New Transaction' })).toHaveCount(0);

  await expect(page.getByTestId('balance')).toContainText('12.50');
  await expect(page.getByRole('button', { name: /Transport.*12\.50/ })).toBeVisible();
});

test('summary: a Transaction with two Categories counts in each, but once in the real total', async ({ page }) => {
  await startFresh(page);
  await addExpense(page, '62.30', ['Groceries', 'Shopping'], 'Weekly shop');

  await page.getByRole('tab', { name: 'Summary' }).click();

  await expect(page.getByTestId('sum-expenses')).toHaveText('€62.30');
  await expect(page.getByText('Groceries', { exact: false }).first()).toBeVisible();
  const lines = page.locator('.cat-line');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText('€62.30');
  await expect(lines.nth(1)).toContainText('€62.30');
  await expect(page.getByText('Categories overlap', { exact: false })).toBeVisible();
});

test('edit: tapping a row opens the form pre-filled and the change updates the Balance', async ({ page }) => {
  await startFresh(page);
  await addExpense(page, '10', ['Groceries'], 'Shop');

  await page.getByRole('button', { name: /Shop/ }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('10.00');
  await page.getByLabel('Amount', { exact: true }).fill('25');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByTestId('balance')).toContainText('25.00');
});

test('delete: removes the Transaction at once and Undo brings it back', async ({ page }) => {
  await startFresh(page);
  await addExpense(page, '8', ['Dining out'], 'Lunch');

  await page.getByRole('button', { name: /Lunch/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByRole('button', { name: /Lunch/ })).toHaveCount(0);
  // Toasts stack, so the earlier "Added" toast (which has its own Undo) may still be there.
  await page.getByRole('status').filter({ hasText: 'Deleted' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /Lunch/ })).toBeVisible();
  await expect(page.getByTestId('balance')).toContainText('8.00');
});

test('deleting a Category leaves a Retired label on old Transactions and reserves its name', async ({ page }) => {
  await startFresh(page);
  await addExpense(page, '35', ['Health'], 'Pharmacy');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Categories/ }).click();
  await page.getByRole('button', { name: /^Health/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click(); // asks for confirmation first
  await expect(page.getByText('1 Transaction uses this Category')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await expect(page.locator('.tag.retired', { hasText: 'Health' })).toBeVisible();

  // The name stays reserved: creating "health" again is refused.
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByPlaceholder('New Category name').fill('health');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('belongs to a deleted Category')).toBeVisible();
});

test('export then import: erase everything, restore from the two CSV files, and the data is back', async ({ page }, testInfo) => {
  await startFresh(page);
  await addExpense(page, '62.30', ['Groceries', 'Shopping'], 'Weekly shop, new pan');

  const downloads: string[] = [];
  page.on('download', async (download) => {
    const path = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    downloads.push(path);
  });

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Export/ }).click();
  await expect.poll(() => downloads.length).toBe(3);

  const transactionsPath = downloads.find((p) => p.includes('transactions-'))!;
  const categoriesPath = downloads.find((p) => p.includes('categories-'))!;
  const accountsPath = downloads.find((p) => p.includes('accounts-'))!;
  expect(readFileSync(accountsPath, 'utf8')).toContain('Main account,0.00,main');
  const transactionsCsv = readFileSync(transactionsPath, 'utf8');
  expect(transactionsCsv).toBe(
    '﻿date,type,amount,categories,note,account,transfer\r\n' +
      `${transactionsCsv.split('\r\n')[1]}\r\n`, // date column is "today", so check the rest below
  );
  expect(transactionsCsv).toContain(',expense,62.30,Groceries|Shopping,"Weekly shop, new pan",Main account,');
  expect(readFileSync(categoriesPath, 'utf8')).toContain('expense,Groceries,groceries');

  // Erase everything: the app returns to the first-run screen.
  await page.getByRole('button', { name: /^Erase all data/ }).click();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await expect(page.getByRole('button', { name: 'Restore from backup' })).toBeVisible();

  // Restore from the two files.
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  await page.getByTestId('import-files').setInputFiles([transactionsPath, categoriesPath]);
  await expect(page.getByText('1 Transactions and 12 Categories will replace everything', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Replace everything' }).click();

  // The opening balance is not in the backup, so the app asks to check it.
  await expect(page.getByRole('dialog', { name: 'Check your opening balance' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('button', { name: /Weekly shop, new pan/ })).toBeVisible();
  await expect(page.getByTestId('balance')).toContainText('62.30');
});

test('import: a file with bad rows lists them and still imports the valid rows', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Restore from backup' }).click();

  const fs = await import('node:fs');
  const transactions = testInfo.outputPath('t.csv');
  const categories = testInfo.outputPath('c.csv');
  // Dated today, so the row shows on the month the home screen opens on.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  fs.writeFileSync(
    transactions,
    `date,type,amount,categories,note\r\n${today},expense,10.00,Food,ok\r\n2026-13-45,expense,5.00,Food,bad date\r\n`,
  );
  fs.writeFileSync(categories, 'type,name,default_key\r\nexpense,Food,\r\n');

  await page.getByTestId('import-files').setInputFiles([transactions, categories]);

  await expect(page.getByText('1 row will be skipped')).toBeVisible();
  await expect(page.getByText('row 3', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Replace everything' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: /ok/ })).toBeVisible();
});

test('language: switching to Italian translates the screens and the starter Category names', async ({ page }) => {
  await startFresh(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Italiano' }).click();
  await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  await page.getByRole('button', { name: /^Categorie/ }).click();
  await expect(page.getByRole('button', { name: /^Spesa/ })).toBeVisible();
});
