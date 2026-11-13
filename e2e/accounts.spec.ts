import { expect, test, type Page } from '@playwright/test';

async function startFresh(page: Page, opening?: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  if (opening) {
    await page.getByLabel('Starting balance').fill(opening);
    await page.getByRole('button', { name: 'Continue' }).click();
  } else await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('balance')).toBeVisible();
}

async function openAccounts(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Accounts/ }).click();
}

async function createAccount(page: Page, name: string, opening: string) {
  await openAccounts(page);
  await page.getByRole('button', { name: '+ New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Opening balance (€)').fill(opening);
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
}

const picker = (page: Page) => page.getByRole('group', { name: 'Accounts' });

async function addTransfer(page: Page, amount: string, from: string, to: string, note = '') {
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByLabel('From', { exact: true }).selectOption({ label: from });
  await page.getByLabel('To', { exact: true }).selectOption({ label: to });
  if (note) await page.getByPlaceholder('e.g. Coffee').fill(note);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New transfer' })).toHaveCount(0);
}

test('a new database has one Main account holding the starting balance, and no account picker', async ({ page }) => {
  await startFresh(page, '100');

  await expect(page.getByTestId('balance')).toHaveText('€100.00');
  await expect(picker(page)).toHaveCount(0);
  await openAccounts(page);
  await expect(page.getByRole('button', { name: /^Main account/ })).toContainText('€100.00');
});

test('a second account gets its own balance, and the picker switches between it, the first and all of them', async ({ page }) => {
  await startFresh(page, '100');
  await createAccount(page, 'Savings', '500');

  await expect(picker(page)).toBeVisible();
  await expect(page.getByTestId('balance')).toHaveText('€600.00');
  await picker(page).getByRole('button', { name: 'Savings' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€500.00');
  await picker(page).getByRole('button', { name: 'Main account' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€100.00');
});

test('a Transaction goes on the chosen account and only moves that account\'s balance', async ({ page }) => {
  await startFresh(page, '100');
  await createAccount(page, 'Savings', '500');
  await picker(page).getByRole('button', { name: 'Savings' }).click();

  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await expect(page.getByLabel('Account', { exact: true })).toHaveValue(/.+/);
  await page.getByLabel('Amount', { exact: true }).fill('40');
  await page.getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByTestId('balance')).toHaveText('€460.00');
  await picker(page).getByRole('button', { name: 'Main account' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€100.00');
  await expect(page.getByRole('button', { name: /Groceries/ })).toHaveCount(0);
  await picker(page).getByRole('button', { name: 'All accounts' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€560.00');
  await expect(page.getByRole('button', { name: /Groceries/ })).toContainText('Savings');
});

test('a Transfer moves money between accounts without changing the total or the month summary', async ({ page }) => {
  await startFresh(page, '300');
  await createAccount(page, 'Savings', '0');

  await addTransfer(page, '120', 'Main account', 'Savings', 'Monthly saving');

  await expect(page.getByTestId('balance')).toHaveText('€300.00');
  await picker(page).getByRole('button', { name: 'Main account' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€180.00');
  await expect(page.getByRole('button', { name: /To Savings/ })).toBeVisible();
  await picker(page).getByRole('button', { name: 'Savings' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€120.00');
  await expect(page.getByRole('button', { name: /From Main account/ })).toBeVisible();

  await page.getByRole('tab', { name: 'Summary' }).click();
  await expect(page.getByTestId('sum-income')).toHaveText('€0.00');
  await expect(page.getByTestId('sum-expenses')).toHaveText('€0.00');
});

test('editing a Transfer changes both halves, and deleting it removes both and can be undone', async ({ page }) => {
  await startFresh(page, '300');
  await createAccount(page, 'Savings', '0');
  await addTransfer(page, '120', 'Main account', 'Savings');
  await picker(page).getByRole('button', { name: 'Savings' }).click();

  await page.getByRole('button', { name: /From Main account/ }).click();
  await page.getByLabel('Amount', { exact: true }).fill('150');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€150.00');
  await picker(page).getByRole('button', { name: 'Main account' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€150.00');

  await page.getByRole('button', { name: /To Savings/ }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€300.00');
  await picker(page).getByRole('button', { name: 'Savings' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€0.00');

  await page.getByRole('status').filter({ hasText: 'Transfer deleted' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€150.00');
});

test('a Transfer needs two different accounts', async ({ page }) => {
  await startFresh(page);
  await createAccount(page, 'Savings', '0');
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await page.getByLabel('Amount', { exact: true }).fill('10');
  await page.getByLabel('To', { exact: true }).selectOption({ label: 'Main account' });

  await expect(page.getByText('Choose two different accounts.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('deleting an account removes its Transactions, offers Undo, and the last account cannot be deleted', async ({ page }) => {
  await startFresh(page, '100');
  await createAccount(page, 'Savings', '500');
  await openAccounts(page);

  await page.getByRole('button', { name: /^Savings/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: /^Savings/ })).toHaveCount(0);
  await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /^Savings/ })).toContainText('€500.00');

  await page.getByRole('button', { name: /^Savings/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: /^Main account/ }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(page.getByText('You need at least one account.')).toBeVisible();
});

test('an account name must be unique', async ({ page }) => {
  await startFresh(page);
  await openAccounts(page);
  await page.getByRole('button', { name: '+ New account' }).click();
  await page.getByLabel('Name', { exact: true }).fill('main account');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Another account already has this name.')).toBeVisible();
});

test('the monthly report names the account it covers', async ({ page }) => {
  await startFresh(page);
  await createAccount(page, 'Savings', '0');
  await picker(page).getByRole('button', { name: 'Savings' }).click();
  await page.getByRole('tab', { name: 'Summary' }).click();
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page.getByRole('button', { name: 'Monthly report' }).click();

  await expect(page.getByTestId('report-account')).toContainText('Savings');
});

test('export then import brings back every account with its opening balance, and its Transactions and Transfers', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  });
  await startFresh(page, '300');
  await createAccount(page, 'Savings', '50');
  await addTransfer(page, '120', 'Main account', 'Savings', 'Monthly saving');

  const downloads: string[] = [];
  page.on('download', async (download) => {
    const path = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    downloads.push(path);
  });
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Export/ }).click();
  await expect.poll(() => downloads.length).toBe(3);

  await page.getByRole('button', { name: /^Erase all data/ }).click();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  await page.getByTestId('import-files').setInputFiles(downloads);
  await expect(page.getByText('2 accounts will also be restored.')).toBeVisible();
  await page.getByRole('button', { name: 'Replace everything' }).click();

  await expect(page.getByRole('dialog', { name: 'Check your opening balance' })).toHaveCount(0);
  await expect(page.getByTestId('balance')).toHaveText('€350.00');
  await picker(page).getByRole('button', { name: 'Main account' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€180.00');
  await expect(page.getByRole('button', { name: /To Savings/ })).toBeVisible();
  await picker(page).getByRole('button', { name: 'Savings' }).click();
  await expect(page.getByTestId('balance')).toHaveText('€170.00');
});
