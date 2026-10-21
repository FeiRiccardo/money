import { devices, expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { createFakeDrive } from '../src/data/fakeDrive';
import { exportArchive } from '../src/domain/archive';

// Page requests must reach the routes below, not a service worker.
test.use({ serviceWorkers: 'block' });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT',
  'access-control-expose-headers': 'location',
};

/** Google's consent page says yes at once, and Drive is the in-memory fake (shared when given, as by two devices). */
async function fakeGoogle(page: Page, drive = createFakeDrive({ token: 'tok' })) {
  await page.route('https://accounts.google.com/**', (route) => {
    const asked = new URL(route.request().url());
    const back = `${asked.searchParams.get('redirect_uri')}#state=${asked.searchParams.get('state')}&access_token=tok&token_type=Bearer&expires_in=3599`;
    return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back)})</script>` });
  });
  await page.route(/^https:\/\/(www\.googleapis\.com|upload\.fake)\//, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const buffer = request.postDataBuffer();
    const result = drive.handle({
      method: request.method(),
      url: request.url(),
      headers: await request.allHeaders(),
      body: buffer ? new Uint8Array(buffer) : null,
    });
    return route.fulfill({ status: result.status, headers: { ...result.headers, ...CORS }, body: Buffer.from(result.body) });
  });
  return drive;
}

/** The notes of the Transactions in the Drive copy. */
function notesInDrive(drive: ReturnType<typeof createFakeDrive>): string {
  const [file] = drive.appFiles();
  return file ? strFromU8(unzipSync(file.bytes)['transactions.csv']) : '';
}

function backupWith(note: string): Uint8Array {
  const category = { id: 'c1', type: 'expense' as const, name: 'Groceries', defaultKey: 'groceries', lastUsedAt: 1 };
  const transaction = { id: 't1', date: '2026-10-01', type: 'expense' as const, cents: 1250, categoryIds: ['c1'], retired: [], note };
  return exportArchive(
    {
      data: { categories: [category], transactions: [transaction] },
      rules: [],
      settings: { language: 'en', openingCents: 0, sortOrder: 'newest' },
      attachments: new Map(),
    },
    (c) => c.name,
  );
}

async function startFresh(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('balance')).toBeVisible();
}

async function addExpense(page: Page, note: string) {
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('12.50');
  await page.getByRole('button', { name: 'Groceries', exact: true }).click();
  await page.getByPlaceholder('e.g. Coffee').fill(note);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Transaction' })).toHaveCount(0);
}

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /Connect Google Drive/ }).click();
  await expect(page.getByText('Google Drive connected')).toBeVisible();
}

test('connecting saves the data to Drive, and later changes are saved automatically', async ({ page }) => {
  const drive = await fakeGoogle(page);
  await startFresh(page);
  await addExpense(page, 'Bread');
  await connect(page);
  await expect.poll(() => notesInDrive(drive)).toContain('Bread');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('drive-saved-at')).not.toContainText('Never');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await addExpense(page, 'Milk');
  await expect.poll(() => notesInDrive(drive), { timeout: 15_000 }).toContain('Milk');
  expect(drive.appFiles()).toHaveLength(1);
});

/** Makes the stored token one that has run out, as an hour later. */
async function expireToken(page: Page) {
  await page.evaluate(() => {
    const token = JSON.parse(localStorage.getItem('money.drive.token')!);
    localStorage.setItem('money.drive.token', JSON.stringify({ ...token, expiresAt: Date.now() - 1000 }));
  });
}

test('opening the app with an expired token reconnects by itself, for the same account', async ({ page }) => {
  const drive = await fakeGoogle(page);
  await startFresh(page);
  await connect(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('money.drive.account'))).toBe('"me@example.com"');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('drive-saved-at')).not.toContainText('Never');

  const asked: URL[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://accounts.google.com/')) asked.push(new URL(request.url()));
  });
  await expireToken(page);
  await page.reload();

  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0].searchParams.get('prompt')).toBe('none');
  expect(asked[0].searchParams.get('login_hint')).toBe('me@example.com');
  await expect(page.getByTestId('balance')).toBeVisible();
  await expect(page.getByText('Google Drive connected')).toHaveCount(0);

  // Connected again: changes are saved without the user doing anything.
  await addExpense(page, 'After reconnecting');
  await expect.poll(() => notesInDrive(drive), { timeout: 15_000 }).toContain('After reconnecting');
});

test('when Google cannot reconnect silently, a toast offers Reconnect and the app does not keep trying', async ({ page }) => {
  await fakeGoogle(page);
  await startFresh(page);
  await connect(page);

  // Signed out of Google: a silent request comes back with an error.
  let asked = 0;
  await page.route('https://accounts.google.com/**', (route) => {
    asked++;
    const url = new URL(route.request().url());
    const back = `${url.searchParams.get('redirect_uri')}#state=${url.searchParams.get('state')}&error=login_required`;
    return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back)})</script>` });
  });
  await expireToken(page);
  await page.reload();

  await expect(page.getByText('Google Drive could not reconnect by itself')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
  expect(asked).toBe(1);

  await page.reload();
  await expect(page.getByTestId('balance')).toBeVisible();
  await page.waitForTimeout(2500);
  expect(asked).toBe(1);
});

test('a new device restores the Drive backup from the first screen, then keeps saving over it', async ({ page }) => {
  const drive = await fakeGoogle(page);
  drive.writeFromAnotherDevice('money-backup.zip', backupWith('From my phone'));

  await page.goto('/');
  await page.getByRole('button', { name: 'Restore from Google Drive' }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore from Google Drive' });
  await expect(dialog).toContainText('1 Transactions');
  await dialog.getByRole('button', { name: 'Replace everything' }).click();
  await expect(page.locator('.tx-row', { hasText: 'From my phone' })).toBeVisible();

  await addExpense(page, 'From my laptop');
  await expect.poll(() => notesInDrive(drive), { timeout: 15_000 }).toContain('From my laptop');
});

test('does not overwrite a newer backup from another device until told to', async ({ page }) => {
  const drive = await fakeGoogle(page);
  await startFresh(page);
  await addExpense(page, 'Bread');
  await connect(page);
  await expect.poll(() => notesInDrive(drive)).toContain('Bread');

  // Back from Google, the app opens on Home.
  drive.writeFromAnotherDevice('money-backup.zip', backupWith('From my phone'));
  await addExpense(page, 'Milk');
  await expect(page.getByText('Google Drive has a newer backup from another device. Check Settings.')).toBeVisible({ timeout: 15_000 });
  expect(notesInDrive(drive)).toContain('From my phone');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Replace it with this device' }).click();
  await expect.poll(() => notesInDrive(drive)).toContain('Milk');
  expect(notesInDrive(drive)).not.toContain('From my phone');
});

test.describe('two devices', () => {
  async function phoneAndLaptop(browser: import('@playwright/test').Browser, page: Page) {
    const drive = await fakeGoogle(page);
    const laptop = await (
      await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://localhost:4173', serviceWorkers: 'block' })
    ).newPage();
    await fakeGoogle(laptop, drive);

    // The phone saves to Drive, the laptop restores that copy.
    await startFresh(page);
    await addExpense(page, 'Bread');
    await connect(page);
    await expect.poll(() => notesInDrive(drive)).toContain('Bread');
    await laptop.goto('/');
    await laptop.getByRole('button', { name: 'Restore from Google Drive' }).click();
    await laptop.getByRole('dialog', { name: 'Restore from Google Drive' }).getByRole('button', { name: 'Replace everything' }).click();
    await expect(laptop.locator('.tx-row', { hasText: 'Bread' })).toBeVisible();
    return { drive, laptop };
  }

  test('a change on one device is loaded by the other when it opens', async ({ browser, page }) => {
    const { drive, laptop } = await phoneAndLaptop(browser, page);

    await addExpense(page, 'Milk');
    await expect.poll(() => notesInDrive(drive), { timeout: 15_000 }).toContain('Milk');

    await laptop.reload();
    await expect(laptop.getByText('1 new Transaction loaded from Google Drive')).toBeVisible();
    await expect(laptop.locator('.tx-row', { hasText: 'Milk' })).toBeVisible();
  });

  test('a device with unsaved changes asks instead of loading the other copy', async ({ browser, page }) => {
    const { drive, laptop } = await phoneAndLaptop(browser, page);

    await addExpense(page, 'Milk');
    await expect.poll(() => notesInDrive(drive), { timeout: 15_000 }).toContain('Milk');

    // The laptop reopens before its own change reached Drive.
    await addExpense(laptop, 'Eggs');
    await laptop.reload();
    await expect(laptop.getByText('Google Drive has a newer backup from another device. Check Settings.')).toBeVisible();
    await expect(laptop.locator('.tx-row', { hasText: 'Eggs' })).toBeVisible();
    await expect(laptop.locator('.tx-row', { hasText: 'Milk' })).toHaveCount(0);
    expect(notesInDrive(drive)).toContain('Milk');
  });
});
