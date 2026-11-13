import { expect, test, type Page } from '@playwright/test';

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

async function add(page: Page, amount: string, category: string, note: string, extra: { date?: string; repeat?: string } = {}) {
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: category, exact: true }).click();
  await page.getByPlaceholder('e.g. Coffee').fill(note);
  if (extra.date) await page.getByLabel('Date', { exact: true }).fill(extra.date);
  if (extra.repeat) await page.getByRole('combobox', { name: 'Repeat' }).selectOption(extra.repeat);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Transaction' })).toHaveCount(0);
}

const toast = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text });
const undoIn = (page: Page, text: string | RegExp) => toast(page, text).getByRole('button', { name: 'Undo' });

test.describe('Transactions', () => {
  test('adding says what was added, and Undo removes it again', async ({ page }) => {
    await startFresh(page);
    await add(page, '4.5', 'Dining out', 'Coffee');

    await expect(toast(page, 'Added · Coffee · €4.50')).toBeVisible();
    await expect(page.getByTestId('balance')).toContainText('4.50');

    await undoIn(page, 'Added · Coffee').click();

    await expect(toast(page, 'Added · Coffee')).toHaveCount(0);
    await expect(page.getByText('Nothing here yet.')).toBeVisible();
    await expect(page.getByTestId('balance')).toHaveText('€0.00');
  });

  test('editing says what changed, and Undo puts the old values back', async ({ page }) => {
    await startFresh(page);
    await add(page, '4.5', 'Dining out', 'Coffee');

    await page.getByRole('button', { name: /Coffee/ }).click();
    await page.getByLabel('Amount', { exact: true }).fill('6');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(toast(page, 'Updated · Coffee · €6.00')).toBeVisible();
    await expect(page.getByTestId('balance')).toContainText('6.00');

    await undoIn(page, 'Updated · Coffee').click();

    await expect(page.getByTestId('balance')).toContainText('4.50');
  });

  test('deleting says what was deleted, with an Undo', async ({ page }) => {
    await startFresh(page);
    await add(page, '8', 'Dining out', 'Lunch');

    await page.getByRole('button', { name: /Lunch/ }).click();
    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(toast(page, 'Deleted · Lunch · €8.00')).toBeVisible();
    await undoIn(page, 'Deleted · Lunch').click();
    await expect(page.getByRole('button', { name: /Lunch/ })).toBeVisible();
  });
});

test.describe('Categories and settings', () => {
  test('creating, renaming and deleting a Category each confirm, and deleting can be undone', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Categories/ }).click();

    await page.getByRole('button', { name: '+ New category' }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Gym');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(toast(page, 'Category “Gym” created')).toBeVisible();

    await page.getByRole('button', { name: /^Gym/ }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('Fitness');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(toast(page, 'Category renamed to “Fitness”')).toBeVisible();

    await page.getByRole('button', { name: /^Fitness/ }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(toast(page, 'Category “Fitness” deleted')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Fitness/ })).toHaveCount(0);

    await undoIn(page, 'Category “Fitness” deleted').click();
    await expect(page.getByRole('button', { name: /^Fitness/ })).toBeVisible();
  });

  test('saving an account confirms', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Accounts/ }).click();
    await page.getByRole('button', { name: /^Main account/ }).click();
    await page.getByRole('dialog').getByLabel('Opening balance (€)').fill('100');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

    await expect(toast(page, 'Account “Main account” saved')).toBeVisible();
  });

  test('erasing all data confirms, even though the app returns to the first screen', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Erase all data/ }).click();
    await page.getByRole('button', { name: 'Erase everything' }).click();

    await expect(page.getByRole('button', { name: 'Restore from backup' })).toBeVisible();
    await expect(toast(page, 'All data erased')).toBeVisible();
  });
});

test.describe('Recurring', () => {
  test('Repeat shows what was added, what repeats and how many were created; editing and stopping a rule confirm', async ({ page }) => {
    await startFresh(page);
    await add(page, '10', 'Transport', 'Bus pass', { date: iso(14), repeat: 'weekly' });

    await expect(toast(page, 'Added · Bus pass · €10.00')).toBeVisible();
    await expect(toast(page, 'Repeats weekly: Bus pass')).toBeVisible();
    await expect(toast(page, '2 recurring Transactions added')).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(3);

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Recurring/ }).click();
    await page.getByRole('button', { name: /↻ Bus pass/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(toast(page, 'Recurring Transaction updated: Bus pass')).toBeVisible();

    await page.getByRole('button', { name: /↻ Bus pass/ }).click();
    await page.getByRole('button', { name: 'Stop repeating' }).click();
    await page.getByRole('dialog', { name: 'Stop repeating?' }).getByRole('button', { name: 'Stop repeating' }).click();
    await expect(toast(page, 'Stopped repeating: Bus pass')).toBeVisible();
  });
});

test.describe('Backup', () => {
  test('exporting confirms; a failed export shows an error toast instead', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByRole('button', { name: /^Export/ }).click();
    await expect(toast(page, 'Backup saved')).toBeVisible();

    await page.evaluate(() => {
      URL.createObjectURL = () => {
        throw new Error('simulated failure');
      };
    });
    await page.getByRole('button', { name: /^Export/ }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Export failed. Please try again.' })).toBeVisible();
  });

  test('importing confirms with an Undo', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Restore from backup' }).click();
    const fs = await import('node:fs');
    const transactions = testInfo.outputPath('t.csv');
    const categories = testInfo.outputPath('c.csv');
    fs.writeFileSync(transactions, 'date,type,amount,categories,note\r\n2026-10-01,expense,10.00,Food,ok\r\n');
    fs.writeFileSync(categories, 'type,name,default_key\r\nexpense,Food,\r\n');
    await page.getByTestId('import-files').setInputFiles([transactions, categories]);
    await page.getByRole('button', { name: 'Replace everything' }).click();

    await expect(toast(page, 'Backup imported')).toBeVisible();
    await expect(undoIn(page, 'Backup imported')).toBeVisible();
  });
});

test.describe('how toasts behave', () => {
  const addCategoryInForm = async (page: Page, name: string) => {
    await page.getByRole('button', { name: '+ New' }).click();
    await page.getByPlaceholder('New Category name').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  };

  test('no more than three show at once: the newest stay and the oldest go', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Add a Transaction' }).click();
    for (const name of ['One', 'Two', 'Three', 'Four']) await addCategoryInForm(page, name);

    await expect(toast(page, 'Category “Four” created')).toBeVisible();
    // Count right now. A retrying assertion could pass later, once old toasts expire on their own.
    expect(await page.getByRole('status').count()).toBe(3);
    await expect(toast(page, 'Category “One” created')).toHaveCount(0);
  });

  test('a plain toast goes away by itself after a few seconds', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Accounts/ }).click();
    await page.getByRole('button', { name: /^Main account/ }).click();
    await page.getByRole('dialog').getByLabel('Opening balance (€)').fill('5');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

    await expect(toast(page, 'Account “Main account” saved')).toBeVisible();
    await expect(toast(page, 'Account “Main account” saved')).toBeHidden({ timeout: 6000 });
  });

  test('holding the pointer over a toast keeps it, and it goes when you move away', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: /^Accounts/ }).click();
    await page.getByRole('button', { name: /^Main account/ }).click();
    await page.getByRole('dialog').getByLabel('Opening balance (€)').fill('5');
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

    const saved = toast(page, 'Account “Main account” saved');
    await saved.hover();
    await page.waitForTimeout(4000); // longer than the normal 3 seconds
    await expect(saved).toBeVisible();

    await page.mouse.move(2, 2);
    await expect(saved).toBeHidden({ timeout: 6000 });
  });

  test('the close button dismisses a toast at once', async ({ page }) => {
    await startFresh(page);
    await add(page, '4.5', 'Dining out', 'Coffee');

    await toast(page, 'Added · Coffee').getByRole('button', { name: 'Dismiss' }).click();

    await expect(toast(page, 'Added · Coffee')).toHaveCount(0);
  });

  test('an Undo toast stays longer than a plain one', async ({ page }) => {
    await startFresh(page);
    await add(page, '4.5', 'Dining out', 'Coffee');
    await expect(toast(page, 'Added · Coffee')).toBeVisible();

    await page.waitForTimeout(3800); // past the 3 seconds of a plain toast, within the 6 of an Undo toast

    await expect(toast(page, 'Added · Coffee')).toBeVisible();
  });

  test('messages follow the chosen language', async ({ page }) => {
    await startFresh(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Italiano' }).click();
    await page.getByRole('button', { name: 'Indietro' }).click();
    await page.getByRole('button', { name: 'Aggiungi una transazione' }).click();
    await page.getByLabel('Importo', { exact: true }).fill('4,5');
    await page.getByRole('button', { name: 'Ristoranti', exact: true }).click();
    await page.getByPlaceholder('es. Caffè').fill('Caffè');
    await page.getByRole('button', { name: 'Salva', exact: true }).click();

    await expect(toast(page, /Aggiunta · Caffè · 4,50/)).toBeVisible();
  });
});
