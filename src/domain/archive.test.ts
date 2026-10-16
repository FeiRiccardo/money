import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportArchive, importArchive, type ArchiveContent } from './archive';
import type { Category, LedgerData, Transaction, TxType } from './types';

const cat = (id: string, type: TxType, name: string): Category => ({ id, type, name, lastUsedAt: 0 });
const tx = (id: string, date: string, type: TxType, cents: number, categoryIds: string[], note = ''): Transaction => ({
  id,
  date,
  type,
  cents,
  categoryIds,
  retired: [],
  note,
});
const nameOf = (c: Category) => c.name;
const TX_HEADER = 'date,type,amount,categories,note\r\n';
const CAT_HEADER = 'type,name,default_key\r\n';

const data: LedgerData = {
  categories: [cat('food', 'expense', 'Food'), cat('pay', 'income', 'Pay')],
  transactions: [
    tx('t2', '2026-10-17', 'expense', 6230, ['food'], 'Shop, big'),
    tx('t1', '2026-10-12', 'income', 180000, ['pay'], 'October'),
  ],
};
const settings = { language: 'it' as const, openingCents: -2500, sortOrder: 'largest' as const };
const content = (over: Partial<ArchiveContent> = {}): ArchiveContent => ({
  data,
  rules: [],
  settings,
  attachments: new Map(),
  ...over,
});

let counter = 0;
const newId = () => `new-${++counter}`;

function roundTrip(c: ArchiveContent) {
  const result = importArchive(exportArchive(c, nameOf), newId);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('ZIP backup', () => {
  it('brings back the Transactions, Categories and recurring rules it was made from', () => {
    const rule = {
      id: 'r1',
      type: 'expense' as const,
      cents: 5000,
      categoryIds: ['food'],
      retired: [],
      note: 'Box',
      frequency: 'monthly' as const,
      startDate: '2026-01-05',
      endDate: null,
      nextDate: '2026-11-05',
    };
    const { preview } = roundTrip(content({ rules: [rule] }));

    expect(preview.errors).toEqual([]);
    expect(preview.data.categories.map((c) => [c.type, c.name])).toEqual([
      ['expense', 'Food'],
      ['income', 'Pay'],
    ]);
    expect(preview.data.transactions.map((t) => [t.date, t.type, t.cents, t.note])).toEqual([
      ['2026-10-12', 'income', 180000, 'October'],
      ['2026-10-17', 'expense', 6230, 'Shop, big'],
    ]);
    expect(preview.rules.map((r) => [r.note, r.frequency, r.nextDate])).toEqual([['Box', 'monthly', '2026-11-05']]);
  });

  it('carries the settings: language, Opening balance and sort order', () => {
    expect(roundTrip(content()).settings).toEqual(settings);
  });

  it('ignores settings it does not understand, and reads an archive that has none', () => {
    const bad = zipSync({
      'transactions.csv': strToU8(TX_HEADER),
      'categories.csv': strToU8(CAT_HEADER),
      'settings.json': strToU8(JSON.stringify({ language: 'fr', openingCents: 'lots', sortOrder: 'newest' })),
    });
    const none = zipSync({
      'transactions.csv': strToU8(TX_HEADER),
      'categories.csv': strToU8(CAT_HEADER),
    });

    const fromBad = importArchive(bad);
    const fromNone = importArchive(none);

    expect(fromBad.ok && fromBad.settings).toEqual({ sortOrder: 'newest' });
    expect(fromNone.ok && fromNone.settings).toEqual({});
  });

  it('gives each receipt photo back to the Transaction it was attached to', () => {
    const photo = (n: number) => ({ mime: 'image/jpeg', bytes: new Uint8Array([n, n, n]) });
    const { preview, attachments } = roundTrip(
      content({ attachments: new Map([['t2', [photo(1), photo(2)]], ['t1', [photo(3)]]]) }),
    );
    const idOf = (note: string) => preview.data.transactions.find((t) => t.note === note)!.id;

    expect([...attachments.keys()].sort()).toEqual([idOf('October'), idOf('Shop, big')].sort());
    expect(attachments.get(idOf('October'))!.map((a) => [...a.bytes])).toEqual([[3, 3, 3]]);
    expect(attachments.get(idOf('Shop, big'))!.map((a) => [a.mime, ...a.bytes])).toEqual([
      ['image/jpeg', 1, 1, 1],
      ['image/jpeg', 2, 2, 2],
    ]);
  });

  it('drops photos whose Transaction row could not be imported, and files that are not images', () => {
    const csv = TX_HEADER + '2026-10-12,income,10.00,Pay,ok\r\n' + 'not-a-date,income,10.00,Pay,broken\r\n';
    const zip = zipSync({
      'transactions.csv': strToU8(csv),
      'categories.csv': strToU8(CAT_HEADER + 'income,Pay,\r\n'),
      'attachments/2-0.jpg': new Uint8Array([1]),
      'attachments/3-0.jpg': new Uint8Array([2]),
      'attachments/2-1.exe': new Uint8Array([3]),
      'attachments/readme.txt': new Uint8Array([4]),
    });

    const result = importArchive(zip, newId);
    if (!result.ok) throw new Error(result.reason);

    expect([...result.attachments.values()].flat().map((a) => [...a.bytes])).toEqual([[1]]);
  });

  it('refuses a file that is not a ZIP, and a ZIP without the Transactions file', () => {
    expect(importArchive(strToU8('not a zip at all'))).toEqual({ ok: false, reason: 'notAnArchive' });
    expect(importArchive(zipSync({ 'categories.csv': strToU8(CAT_HEADER) }))).toEqual({ ok: false, reason: 'missingFile' });
  });
});
