import { expect, test, type Page } from '@playwright/test';

async function openFilledForm(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Add a Transaction' }).click();
  await page.getByLabel('Amount', { exact: true }).fill('1234567,89');
  await page.getByRole('button', { name: 'Groceries', exact: true }).click();
}

const hasNoHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('landscape phone (568x320)', () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true, isMobile: true });

  test('Save stays on screen without scrolling', async ({ page }) => {
    await openFilledForm(page);

    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport({ ratio: 1 });
    expect(await hasNoHorizontalScroll(page)).toBe(true);
  });

  test('the Category chips can still be scrolled to and picked', async ({ page }) => {
    await openFilledForm(page);

    await page.getByRole('button', { name: 'Other', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Other', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('small phone (320x568)', () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });

  test('Save stays on screen with room to spare and nothing overflows sideways', async ({ page }) => {
    await openFilledForm(page);

    const save = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox();
    expect(save!.y + save!.height).toBeLessThanOrEqual(568 - 8);
    expect(await hasNoHorizontalScroll(page)).toBe(true);
  });

  test('Date and Note stack so each field is wide enough to use', async ({ page }) => {
    await openFilledForm(page);

    const note = await page.getByPlaceholder('e.g. Coffee').boundingBox();
    expect(note!.width).toBeGreaterThan(240);
  });

  test('a long amount still fits inside the screen', async ({ page }) => {
    await openFilledForm(page);

    const amount = await page.getByLabel('Amount', { exact: true }).boundingBox();
    expect(amount!.x + amount!.width).toBeLessThanOrEqual(320);
  });
});

test.describe('tablet (768x1024)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('the form stays a centred column that does not stretch edge to edge', async ({ page }) => {
    await openFilledForm(page);

    const save = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox();
    expect(save!.width).toBeLessThanOrEqual(520);
    expect(save!.x).toBeGreaterThan(100);
  });
});

for (const [name, width, height] of [
  ['desktop window (1280x800)', 1280, 800],
  ['tablet (768x1024)', 768, 1024],
  ['phone (390x844)', 390, 844],
] as const) {
  test.describe(`${name}: Date and Note`, () => {
    test.use({ viewport: { width, height } });

    test('sit in two rows, one under the other, both full width', async ({ page }) => {
      await openFilledForm(page);

      const date = await page.getByLabel('Date').boundingBox();
      const note = await page.getByPlaceholder('e.g. Coffee').boundingBox();
      expect(note!.y).toBeGreaterThanOrEqual(date!.y + date!.height); // Note is below Date
      expect(Math.abs(note!.x - date!.x)).toBeLessThan(2); // same left edge
      expect(Math.abs(note!.width - date!.width)).toBeLessThan(2); // same width
    });
  });
}

for (const width of [320, 375, 390, 430]) {
  test.describe(`phone ${width}px wide: fields`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('Date and Note have the same width and line up exactly with the Save button', async ({ page }) => {
      await openFilledForm(page);

      const date = await page.getByLabel('Date').boundingBox();
      const note = await page.getByPlaceholder('e.g. Coffee').boundingBox();
      const save = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox();
      for (const box of [date!, note!]) {
        expect(Math.abs(box.x - save!.x)).toBeLessThan(1);
        expect(Math.abs(box.x + box.width - (save!.x + save!.width))).toBeLessThan(1);
      }
    });
  });
}

/** Phones zoom into any input whose text is under 16px when it is tapped. */
async function smallestInputFontSize(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.min(...[...document.querySelectorAll('input')].map((el) => parseFloat(getComputedStyle(el).fontSize))),
  );
}

test.describe('no tap-to-zoom on phones', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('every input in the add form, including the new-Category box, is at least 16px', async ({ page }) => {
    await openFilledForm(page);
    await page.getByRole('button', { name: '+ New' }).click();

    expect(await smallestInputFontSize(page)).toBeGreaterThanOrEqual(16);
  });

  test('the Settings dialogs (account, Category name) use at least 16px too', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start fresh' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();

    await page.getByRole('button', { name: /^Accounts/ }).click();
    await page.getByRole('button', { name: /^Main account/ }).click();
    expect(await smallestInputFontSize(page)).toBeGreaterThanOrEqual(16);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await page.getByRole('button', { name: /^Categories/ }).click();
    await page.getByRole('button', { name: '+ New category' }).click();
    expect(await smallestInputFontSize(page)).toBeGreaterThanOrEqual(16);
  });

  test('the first-run starting balance field is at least 16px', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start fresh' }).click();

    expect(await smallestInputFontSize(page)).toBeGreaterThanOrEqual(16);
  });
});

test.describe('field size', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('Date and Note are the same height and big enough to tap (44px)', async ({ page }) => {
    await openFilledForm(page);

    const date = await page.getByLabel('Date').boundingBox();
    const note = await page.getByPlaceholder('e.g. Coffee').boundingBox();
    expect(date!.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(date!.height - note!.height)).toBeLessThan(1);
  });

  test('the date field drops the browser\'s native sizing so it obeys the page width', async ({ page }) => {
    await openFilledForm(page);

    const style = await page.getByLabel('Date').evaluate((el) => {
      const s = getComputedStyle(el);
      return { appearance: s.appearance, minWidth: s.minWidth, display: s.display };
    });
    expect(style).toEqual({ appearance: 'none', minWidth: '0px', display: 'block' });
  });
});

/** Smallest font size across inputs, selects and textareas currently on the page. */
async function smallestControlFontSize(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.min(...[...document.querySelectorAll('input, select, textarea')].map((el) => parseFloat(getComputedStyle(el).fontSize))),
  );
}

test.describe('new screens on a small phone (320x568)', () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });

  async function startAndAdd(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start fresh' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Add a Transaction' }).click();
    await page.getByLabel('Amount', { exact: true }).fill('4.5');
    await page.getByRole('button', { name: 'Groceries', exact: true }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'New Transaction' })).toHaveCount(0);
  }

  test('Search with every filter open fits the screen and uses at least 16px text', async ({ page }) => {
    await startAndAdd(page);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('combobox', { name: 'Date' }).selectOption('custom');

    expect(await hasNoHorizontalScroll(page)).toBe(true);
    expect(await smallestControlFontSize(page)).toBeGreaterThanOrEqual(16);
    for (const control of [page.getByRole('combobox', { name: 'Sort' }), page.getByRole('combobox', { name: 'Date' })]) {
      const box = await control.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('the home list with its sort selector fits the screen', async ({ page }) => {
    await startAndAdd(page);

    expect(await hasNoHorizontalScroll(page)).toBe(true);
    const box = await page.getByRole('combobox', { name: 'Sort' }).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  });

  test('the add form with Repeat, End date and the Recent strip fits and has no small text', async ({ page }) => {
    await startAndAdd(page);
    await page.getByRole('button', { name: 'Add a Transaction' }).click();
    await page.getByRole('combobox', { name: 'Repeat' }).selectOption('monthly');

    await expect(page.getByLabel('Ends on (optional)')).toBeVisible();
    expect(await hasNoHorizontalScroll(page)).toBe(true);
    expect(await smallestControlFontSize(page)).toBeGreaterThanOrEqual(16);
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport({ ratio: 1 });
  });
});

test.describe('the + button', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('has its plus icon exactly in the centre of the circle', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Start fresh' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();

    const button = await page.getByRole('button', { name: 'Add a Transaction' }).boundingBox();
    const icon = await page.locator('.fab .fab-icon').boundingBox();

    expect(button!.width).toBeCloseTo(button!.height, 0); // a circle
    expect(Math.abs(icon!.x + icon!.width / 2 - (button!.x + button!.width / 2))).toBeLessThan(0.5);
    expect(Math.abs(icon!.y + icon!.height / 2 - (button!.y + button!.height / 2))).toBeLessThan(0.5);
  });
});

for (const [name, width, height] of [
  ['phone (390x844)', 390, 844],
  ['small phone (320x568)', 320, 568],
  ['landscape phone (568x320)', 568, 320],
] as const) {
  test.describe(`toasts on a ${name}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile: true });

    async function open(page: Page) {
      await page.goto('/');
      await page.getByRole('button', { name: 'Start fresh' }).click();
      await page.getByRole('button', { name: 'Skip' }).click();
    }

    test('stay on screen and do not cover the Save button while a form is open', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Add a Transaction' }).click();
      await page.getByLabel('Amount', { exact: true }).fill('5');
      await page.getByRole('button', { name: '+ New' }).click();
      await page.getByPlaceholder('New Category name').fill('Gym');
      await page.getByRole('button', { name: 'Add', exact: true }).click();

      const toast = await page.getByRole('status').filter({ hasText: 'Category “Gym” created' }).boundingBox();
      const save = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox();
      expect(toast!.x).toBeGreaterThanOrEqual(0);
      expect(toast!.x + toast!.width).toBeLessThanOrEqual(width);
      expect(toast!.y + toast!.height).toBeLessThanOrEqual(save!.y); // above Save, not over it
      expect(await hasNoHorizontalScroll(page)).toBe(true);
    });

    test('three stacked toasts still fit above the Save button', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Add a Transaction' }).click();
      for (const label of ['One', 'Two', 'Three']) {
        await page.getByRole('button', { name: '+ New' }).click();
        await page.getByPlaceholder('New Category name').fill(label);
        await page.getByRole('button', { name: 'Add', exact: true }).click();
      }

      const toasts = page.getByRole('status');
      await expect(toasts).toHaveCount(3);
      const first = await toasts.first().boundingBox();
      const last = await toasts.last().boundingBox();
      const save = await page.getByRole('button', { name: 'Save', exact: true }).boundingBox();
      expect(last!.y + last!.height).toBeLessThanOrEqual(save!.y);
      expect(first!.y).toBeGreaterThanOrEqual(0); // the top of the stack is still on screen
    });

    test('on the home screen sit above the + button', async ({ page }) => {
      await open(page);
      await page.getByRole('button', { name: 'Settings' }).click();
      await page.getByRole('button', { name: /^Accounts/ }).click();
      await page.getByRole('button', { name: /^Main account/ }).click();
      await page.getByRole('dialog').getByLabel('Opening balance (€)').fill('5');
      await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'Back', exact: true }).click();

      const toast = await page.getByRole('status').filter({ hasText: 'Account “Main account” saved' }).boundingBox();
      const fab = await page.getByRole('button', { name: 'Add a Transaction' }).boundingBox();
      expect(toast!.y + toast!.height).toBeLessThanOrEqual(fab!.y);
    });
  });
}
