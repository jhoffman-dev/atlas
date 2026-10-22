/*
 * PDFs made by hand for the reader's tests (#504): a few pages of invented
 * text in the standard Helvetica font, a title and an author in the document
 * information, an outline, and optionally a page with no text at all (what a
 * scan looks like to a reader). Written byte by byte, since the repo has no
 * PDF library that writes, and a PDF is only objects and a table of where
 * each one starts. Every word in them is made up, so no real document is in
 * the repo.
 */

/** A page of the fixture: its lines of text, top to bottom, or none for a "scanned" page. */
export interface FixturePage {
  readonly lines: readonly string[];
}

export interface FixtureSpec {
  readonly title?: string;
  readonly author?: string;
  readonly pages: readonly FixturePage[];
  /** Outline entries, each naming the page (from 1) it goes to. */
  readonly outline?: readonly { readonly title: string; readonly page: number }[];
}

/** US Letter, in points. */
export const FIXTURE_PAGE_SIZE = { width: 612, height: 792 } as const;
/** Where the first line's baseline sits, and how far apart the lines are, in points. */
const TOP_BASELINE = 720;
const LINE_GAP = 18;
const LEFT = 72;
const FONT_SIZE = 12;

/** A PDF of `spec`, as bytes. */
export function fixturePdf(spec: FixtureSpec): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalog = add('');
  const pagesRoot = add('');
  const font = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const pageIds = spec.pages.map((page) => {
    const content = pageContent(page);
    const stream = add(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
    return add(
      `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${FIXTURE_PAGE_SIZE.width} ${FIXTURE_PAGE_SIZE.height}] ` +
        `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`,
    );
  });
  objects[pagesRoot - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const outlines =
    spec.outline === undefined ? null : addOutline(spec.outline, pageIds, add, objects);
  objects[catalog - 1] =
    `<< /Type /Catalog /Pages ${pagesRoot} 0 R` +
    (outlines === null ? '' : ` /Outlines ${outlines} 0 R /PageMode /UseOutlines`) +
    ' >>';
  const info = add(
    '<< ' +
      (spec.title === undefined ? '' : `/Title ${pdfString(spec.title)} `) +
      (spec.author === undefined ? '' : `/Author ${pdfString(spec.author)} `) +
      '/Producer (DFAI test fixture) >>',
  );
  return serialise(objects, { root: catalog, info });
}

/** A long fixture: `count` pages of numbered lines, each page naming itself, for the perf budget. */
export function longFixturePdf(count: number): Buffer {
  const pages = Array.from({ length: count }, (_, at) => ({
    lines: Array.from(
      { length: 30 },
      (_, line) => `Page ${at + 1}, line ${line + 1}: the ferry crossed the grey water again.`,
    ),
  }));
  return fixturePdf({
    title: 'A Long Crossing',
    author: 'Tobias Fenn',
    pages,
    outline: Array.from({ length: Math.ceil(count / 50) }, (_, at) => ({
      title: `Part ${at + 1}`,
      page: at * 50 + 1,
    })),
  });
}

/** The reader's small fixture: three pages of text, then a page with no text (a "scan"). */
export function lanternFixturePdf(): Buffer {
  return fixturePdf({
    title: 'The Lantern Keepers',
    author: 'Mara Quill',
    pages: [
      {
        lines: [
          'Chapter One. The keepers of Brightwater lit the lamps at dusk.',
          'Every lantern on the harbour wall was trimmed by hand.',
          'A light kept is a promise kept, the old keeper said.',
        ],
      },
      {
        lines: [
          'Chapter Two. Fog came in from the north channel each spring.',
          'A light kept is a promise kept, the young keeper wrote.',
          'The ferry waited for the lamps before it left the quay.',
        ],
      },
      {
        lines: ['Chapter Three. The last lamp was lit in the year of the long frost.'],
      },
      { lines: [] },
    ],
    outline: [
      { title: 'Chapter One', page: 1 },
      { title: 'Chapter Two', page: 2 },
      { title: 'Chapter Three', page: 3 },
    ],
  });
}

function pageContent(page: FixturePage): string {
  if (page.lines.length === 0) {
    // A "scan": shapes and no text, so the page has nothing to select.
    return '0.55 g 72 420 468 260 re f 0.3 g 110 470 200 40 re f';
  }
  const lines = page.lines.map(
    (line, at) =>
      `BT /F1 ${FONT_SIZE} Tf ${LEFT} ${TOP_BASELINE - at * LINE_GAP} Td ${pdfString(line)} Tj ET`,
  );
  return lines.join('\n');
}

function addOutline(
  entries: readonly { title: string; page: number }[],
  pageIds: readonly number[],
  add: (body: string) => number,
  objects: string[],
): number {
  const root = add('');
  const ids = entries.map(() => add(''));
  entries.forEach((entry, at) => {
    const page = pageIds[Math.min(Math.max(entry.page, 1), pageIds.length) - 1] as number;
    const links = [
      at > 0 ? `/Prev ${ids[at - 1]} 0 R` : '',
      at < ids.length - 1 ? `/Next ${ids[at + 1]} 0 R` : '',
    ].join(' ');
    objects[(ids[at] as number) - 1] =
      `<< /Title ${pdfString(entry.title)} /Parent ${root} 0 R ${links} ` +
      `/Dest [${page} 0 R /XYZ 0 ${FIXTURE_PAGE_SIZE.height} 0] >>`;
  });
  objects[root - 1] =
    `<< /Type /Outlines /First ${ids[0]} 0 R /Last ${ids.at(-1)} 0 R /Count ${ids.length} >>`;
  return root;
}

function serialise(objects: readonly string[], trailer: { root: number; info: number }): Buffer {
  let body = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((object, at) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${at + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root ${trailer.root} 0 R /Info ${trailer.info} 0 R >>\n` +
    `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** A PDF literal string: parentheses and backslashes escaped. */
function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, '\\$&')})`;
}
