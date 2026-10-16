/** One line of the document: text on the left, optionally a middle column and an amount aligned to the right. */
export interface PdfRow {
  left: string;
  middle?: string;
  right?: string;
  style?: 'title' | 'heading' | 'strong' | 'normal' | 'muted';
  /** Extra space above the row, in points. */
  space?: number;
}

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 48;
const RIGHT_EDGE = PAGE_W - MARGIN;
const MIDDLE_X = 300;
const GAP = 10;

const STYLES = {
  title: { size: 18, bold: true },
  heading: { size: 11, bold: true },
  strong: { size: 10, bold: true },
  normal: { size: 10, bold: false },
  muted: { size: 9, bold: false },
} as const;

/** Text as WinAnsi characters (one byte each), the encoding the built-in fonts are asked to use. */
function winAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '€') out += '\x80';
    else if (ch === '−') out += '-';
    else if (code >= 0x20 && code < 0x7f) out += ch;
    else if (code >= 0xa0 && code <= 0xff) out += ch;
    else out += '?';
  }
  return out;
}

/** Approximate Helvetica width in points: good enough to right-align amounts and cut long text. */
function widthOf(text: string, size: number, bold: boolean): number {
  let em = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) em += 0.556;
    else if (/[iljtf.,:;'|! ]/.test(ch)) em += 0.28;
    else if (/[mwMW]/.test(ch)) em += 0.82;
    else if (/[A-Z]/.test(ch)) em += 0.67;
    else em += 0.54;
  }
  return em * size * (bold ? 1.06 : 1);
}

function fit(text: string, max: number, size: number, bold: boolean): string {
  if (widthOf(text, size, bold) <= max) return text;
  let cut = text;
  while (cut.length > 0 && widthOf(cut + '...', size, bold) > max) cut = cut.slice(0, -1);
  return cut + '...';
}

/** A row that is only text (no columns) is split into as many lines as it needs, so nothing is cut off. */
function wrapPlain(row: PdfRow): PdfRow[] {
  if (row.middle || row.right) return [row];
  const { size, bold } = STYLES[row.style ?? 'normal'];
  const lines: string[] = [];
  let line = '';
  for (const word of row.left.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && widthOf(next, size, bold) > RIGHT_EDGE - MARGIN) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines.map((left, i) => ({ ...row, left, space: i === 0 ? row.space : 0 }));
}

const escapeText =(text: string) => text.replace(/[\\()]/g, (c) => '\\' + c);

/** A small text-only PDF (A4, built-in Helvetica) with automatic page breaks. */
export function buildPdf(rows: PdfRow[]): Uint8Array {
  const pages: string[] = [];
  let ops = '';
  let y = PAGE_H - MARGIN;

  const flush = () => {
    pages.push(ops);
    ops = '';
    y = PAGE_H - MARGIN;
  };
  const put = (text: string, x: number, size: number, bold: boolean) => {
    ops += `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapeText(winAnsi(text))}) Tj ET\n`;
  };

  for (const row of rows.flatMap(wrapPlain)) {
    const { size, bold } = STYLES[row.style ?? 'normal'];
    const height = size * 1.5 + (row.space ?? 0);
    if (y - height < MARGIN && ops !== '') flush();
    y -= height;

    const rightWidth = row.right ? widthOf(winAnsi(row.right), size, bold) : 0;
    const limit = row.right ? RIGHT_EDGE - rightWidth - GAP : RIGHT_EDGE;
    const leftMax = (row.middle ? MIDDLE_X - GAP : limit) - MARGIN;
    put(fit(row.left, leftMax, size, bold), MARGIN, size, bold);
    if (row.middle) put(fit(row.middle, limit - MIDDLE_X, size - 1, false), MIDDLE_X, size - 1, false);
    if (row.right) put(row.right, RIGHT_EDGE - rightWidth, size, bold);
  }
  flush();

  // Objects in order: 1 catalog, 2 page list, 3 and 4 fonts, then a page and its content for each page.
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((content, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });

  let file = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(file.length);
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Uint8Array.from(file, (ch) => ch.charCodeAt(0));
}
