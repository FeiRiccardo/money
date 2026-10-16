import { describe, expect, it } from 'vitest';
import { buildPdf, type PdfRow } from './pdf';

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);
const rows = (n: number): PdfRow[] => Array.from({ length: n }, (_, i) => ({ left: `Row ${i}`, right: '1.00' }));

/** Reads back the cross-reference table the way a PDF viewer does and returns the object numbers it can find. */
function objectsFound(text: string): number[] {
  const start = Number(/startxref\n(\d+)\n%%EOF\n?$/.exec(text)![1]);
  expect(text.slice(start, start + 4)).toBe('xref');
  const entries = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  return entries.map((offset, i) => {
    const found = new RegExp(`^${i + 1} 0 obj`).test(text.slice(offset));
    return found ? i + 1 : -1;
  });
}

describe('buildPdf', () => {
  it('writes a valid one page document: header, objects at their recorded offsets, trailer', () => {
    const text = latin1(buildPdf([{ left: 'Monthly report', style: 'title' }, { left: 'Salary', right: '1,650.00' }]));

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toMatch(/\/Count 1\b/);
    expect(text).toContain('(Monthly report)');
    expect(text).toContain('(Salary)');
    expect(text).toContain('(1,650.00)');
    const found = objectsFound(text);
    expect(found.length).toBeGreaterThan(4);
    expect(found.every((n) => n > 0)).toBe(true);
    expect(text).toContain(`/Size ${found.length + 1}`);
  });

  it('starts a new page when the rows no longer fit, and keeps every row', () => {
    const text = latin1(buildPdf(rows(120)));

    const pages = Number(/\/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThan(5);
    for (const i of [0, 59, 119]) expect(text).toContain(`(Row ${i})`);
    expect(objectsFound(text).every((n) => n > 0)).toBe(true);
  });

  it('is still a valid document with no rows', () => {
    const text = latin1(buildPdf([]));

    expect(text).toMatch(/\/Count 1\b/);
    expect(objectsFound(text).every((n) => n > 0)).toBe(true);
  });

  it('escapes brackets and backslashes, and writes accents and the euro sign as WinAnsi bytes', () => {
    const bytes = buildPdf([{ left: 'Caffè (bar) a\\b', right: '€5.00 − x' }]);
    const text = latin1(bytes);

    expect(text).toContain('(Caffè \\(bar\\) a\\\\b)');
    // TextDecoder('latin1') reads bytes as Windows-1252, where 0x80 is the euro sign.
    expect(text).toContain('(€5.00 - x)');
    expect(text).toContain('/Encoding /WinAnsiEncoding');
  });

  it('wraps a long line of plain text onto several lines instead of cutting it', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`);
    const text = latin1(buildPdf([{ left: words.join(' '), style: 'muted' }]));

    for (const w of words) expect(text).toContain(w);
    expect(text).not.toContain('...');
    expect((text.match(/ Tj ET/g) ?? []).length).toBeGreaterThan(1);
  });

  it('cuts text that is too long for its column instead of running into the next one', () => {
    const long = 'x'.repeat(400);
    const text = latin1(buildPdf([{ left: long, middle: 'Food', right: '1.00' }]));

    expect(text).not.toContain(long);
    expect(text).toContain('(Food)');
  });
});
